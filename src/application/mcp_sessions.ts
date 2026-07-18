import { randomUUID } from "node:crypto";

export interface McpSessionPolicy {
  absoluteDurationMs: number;
  globalLimit: number;
  idleDurationMs: number;
  perActorLimit: number;
}

export interface McpSessionIdentity {
  actorUserId: string;
  workspaceId: string;
}

export interface McpSessionResource {
  close(): Promise<void> | void;
}

export interface McpSessionReservation {
  absoluteExpiresAt: string;
  id: string;
  idleExpiresAt: string;
  state: "initializing";
}

export interface McpSessionCounts {
  active: number;
  initializing: number;
}

export interface McpSessionCleanupResult {
  closed: number;
  failures: number;
}

interface InitializingSession extends McpSessionIdentity {
  absoluteExpiresAtMs: number;
  admittedAtMs: number;
  id: string;
  idleExpiresAtMs: number;
  state: "initializing";
}

interface ActiveSession extends Omit<InitializingSession, "state"> {
  lastSeenAtMs: number;
  resource: McpSessionResource;
  state: "active";
}

type StoredSession = ActiveSession | InitializingSession;

export class McpActorSessionLimitError extends Error {
  public readonly code = "actor_session_limit";

  public constructor() {
    super("The actor MCP session limit has been reached");
    this.name = "McpActorSessionLimitError";
  }
}

export class McpGlobalSessionLimitError extends Error {
  public readonly code = "global_session_limit";

  public constructor() {
    super("The global MCP session limit has been reached");
    this.name = "McpGlobalSessionLimitError";
  }
}

function isExpired(session: StoredSession, nowMs: number): boolean {
  return (
    session.absoluteExpiresAtMs <= nowMs || session.idleExpiresAtMs <= nowMs
  );
}

export class RemoteMcpSessionRegistry {
  private readonly sessions = new Map<string, StoredSession>();

  public constructor(
    private readonly policy: McpSessionPolicy,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {
    if (
      policy.globalLimit < 1 ||
      policy.perActorLimit < 1 ||
      policy.perActorLimit > policy.globalLimit ||
      policy.idleDurationMs < 1 ||
      policy.absoluteDurationMs <= policy.idleDurationMs
    ) {
      throw new Error("Invalid MCP session policy");
    }
  }

  public async reserve(
    identity: McpSessionIdentity,
  ): Promise<McpSessionReservation> {
    if (
      identity.actorUserId.trim().length === 0 ||
      identity.workspaceId.trim().length === 0
    ) {
      throw new Error("Invalid MCP session identity");
    }
    await this.cleanupExpired();
    const current = [...this.sessions.values()];
    if (current.length >= this.policy.globalLimit) {
      throw new McpGlobalSessionLimitError();
    }
    if (
      current.filter(({ actorUserId }) => actorUserId === identity.actorUserId)
        .length >= this.policy.perActorLimit
    ) {
      throw new McpActorSessionLimitError();
    }

    const nowMs = this.clock().getTime();
    const id = this.idFactory();
    if (this.sessions.has(id)) throw new Error("MCP session ID collision");
    const session: InitializingSession = {
      ...identity,
      absoluteExpiresAtMs: nowMs + this.policy.absoluteDurationMs,
      admittedAtMs: nowMs,
      id,
      idleExpiresAtMs: nowMs + this.policy.idleDurationMs,
      state: "initializing",
    };
    this.sessions.set(id, session);
    return {
      absoluteExpiresAt: new Date(session.absoluteExpiresAtMs).toISOString(),
      id,
      idleExpiresAt: new Date(session.idleExpiresAtMs).toISOString(),
      state: "initializing",
    };
  }

  public async activate(
    sessionId: string,
    resource: McpSessionResource,
  ): Promise<boolean> {
    await this.cleanupExpired();
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "initializing") {
      await resource.close();
      return false;
    }

    const nowMs = this.clock().getTime();
    this.sessions.set(sessionId, {
      ...session,
      idleExpiresAtMs: Math.min(
        session.absoluteExpiresAtMs,
        nowMs + this.policy.idleDurationMs,
      ),
      lastSeenAtMs: nowMs,
      resource,
      state: "active",
    });
    return true;
  }

  public async touch(sessionId: string): Promise<boolean> {
    await this.cleanupExpired();
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "active") return false;

    const nowMs = this.clock().getTime();
    this.sessions.set(sessionId, {
      ...session,
      idleExpiresAtMs: Math.min(
        session.absoluteExpiresAtMs,
        nowMs + this.policy.idleDurationMs,
      ),
      lastSeenAtMs: nowMs,
    });
    return true;
  }

  public async close(sessionId: string): Promise<McpSessionCleanupResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return { closed: 0, failures: 0 };
    this.sessions.delete(sessionId);
    return this.cleanupSessions([session]);
  }

  public async cleanupExpired(): Promise<McpSessionCleanupResult> {
    const nowMs = this.clock().getTime();
    const expired = [...this.sessions.values()].filter((session) =>
      isExpired(session, nowMs),
    );
    for (const session of expired) this.sessions.delete(session.id);
    return this.cleanupSessions(expired);
  }

  public async closeAll(): Promise<McpSessionCleanupResult> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    return this.cleanupSessions(sessions);
  }

  public sessionCounts(workspaceId: string): McpSessionCounts {
    const nowMs = this.clock().getTime();
    const sessions = [...this.sessions.values()].filter(
      (session) =>
        session.workspaceId === workspaceId && !isExpired(session, nowMs),
    );
    return {
      active: sessions.filter(({ state }) => state === "active").length,
      initializing: sessions.filter(({ state }) => state === "initializing")
        .length,
    };
  }

  private async cleanupSessions(
    sessions: StoredSession[],
  ): Promise<McpSessionCleanupResult> {
    const resources = sessions.flatMap((session) =>
      session.state === "active" ? [session.resource] : [],
    );
    const results = await Promise.allSettled(
      resources.map(async (resource) => resource.close()),
    );
    return {
      closed: sessions.length,
      failures: results.filter(({ status }) => status === "rejected").length,
    };
  }
}
