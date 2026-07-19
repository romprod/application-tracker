import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Router, type Request, type Response } from "express";

import type { AuthenticatedActor } from "../application/auth.js";
import type { McpActorProvider } from "../application/mcp.js";
import type { RemoteMcpNetworkConfig } from "../application/mcp_oauth.js";
import {
  McpActorSessionLimitError,
  McpGlobalSessionLimitError,
  type McpSessionReservation,
  type RemoteMcpSessionRegistry,
} from "../application/mcp_sessions.js";
import {
  createRemoteMcpBearerAuth,
  remoteMcpActor,
  type RemoteMcpAuthorizer,
} from "./mcp_http_auth.js";
import { createRemoteMcpNetworkGuard } from "./mcp_http_network.js";
import { noOpLogger, type ApplicationLogger } from "./logging.js";

interface RemoteMcpSession {
  actorProvider: SessionActorProvider;
  actorUserId: string;
  transport: StreamableHTTPServerTransport;
  workspaceId: string;
}

export interface RemoteMcpHttpEndpointOptions {
  authorizer: RemoteMcpAuthorizer;
  createServer: (
    actorProvider: McpActorProvider,
    actor: AuthenticatedActor,
  ) => McpServer;
  logger?: ApplicationLogger;
  network: RemoteMcpNetworkConfig;
  requiredScope: string;
  sessions: RemoteMcpSessionRegistry;
  workspaceSlug: string;
}

class SessionActorProvider implements McpActorProvider {
  public constructor(
    private actor: AuthenticatedActor,
    private readonly workspaceSlug: string,
  ) {}

  public getActor(): AuthenticatedActor {
    return this.actor;
  }

  public getWorkspaceSlug(): string {
    return this.workspaceSlug;
  }

  public update(actor: AuthenticatedActor): boolean {
    if (
      actor.userId !== this.actor.userId ||
      actor.workspaceId !== this.actor.workspaceId
    ) {
      return false;
    }
    this.actor = actor;
    return true;
  }
}

function sessionId(request: Request): string | undefined {
  const value = request.headers["mcp-session-id"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sendProtocolError(
  response: Response,
  status: number,
  code: number,
  message: string,
): void {
  response.set("Cache-Control", "no-store");
  response.status(status).json({
    error: { code, message },
    id: null,
    jsonrpc: "2.0",
  });
}

export class RemoteMcpHttpEndpoint {
  private readonly authorizer: RemoteMcpAuthorizer;
  private readonly createServer: RemoteMcpHttpEndpointOptions["createServer"];
  private readonly logger: ApplicationLogger;
  private readonly network: RemoteMcpNetworkConfig;
  private readonly requiredScope: string;
  private readonly sessionRegistry: RemoteMcpSessionRegistry;
  private readonly sessions = new Map<string, RemoteMcpSession>();
  private readonly workspaceSlug: string;

  public constructor(options: RemoteMcpHttpEndpointOptions) {
    this.authorizer = options.authorizer;
    this.createServer = options.createServer;
    this.logger = options.logger ?? noOpLogger;
    this.network = options.network;
    this.requiredScope = options.requiredScope;
    this.sessionRegistry = options.sessions;
    this.workspaceSlug = options.workspaceSlug;
  }

  public isAvailable(): boolean {
    return true;
  }

  public router(): Router {
    const router = Router();
    router.use(createRemoteMcpNetworkGuard(this.network));
    router.use(
      createRemoteMcpBearerAuth({
        authorizer: this.authorizer,
        requiredScope: this.requiredScope,
        resourceUrl: this.network.resourceUrl,
      }),
    );
    router.all("/", (request, response, next) => {
      void this.handleRequest(request, response).catch(next);
    });
    return router;
  }

  private async handleRequest(
    request: Request,
    response: Response,
  ): Promise<void> {
    const actor = remoteMcpActor(response);
    const requestedSessionId = sessionId(request);
    if (
      request.method === "POST" &&
      !requestedSessionId &&
      isInitializeRequest(request.body)
    ) {
      await this.initialize(request, response, actor);
      return;
    }
    if (!requestedSessionId) {
      sendProtocolError(
        response,
        400,
        -32_000,
        "MCP-Session-Id header is required",
      );
      return;
    }

    const session = this.sessions.get(requestedSessionId);
    if (
      !session ||
      session.actorUserId !== actor.userId ||
      session.workspaceId !== actor.workspaceId ||
      !session.actorProvider.update(actor)
    ) {
      sendProtocolError(response, 404, -32_001, "Session not found");
      return;
    }
    if (!(await this.sessionRegistry.touch(requestedSessionId))) {
      this.sessions.delete(requestedSessionId);
      sendProtocolError(response, 404, -32_001, "Session not found");
      return;
    }

    await session.transport.handleRequest(
      request,
      response,
      request.method === "POST" ? request.body : undefined,
    );
  }

  private async initialize(
    request: Request,
    response: Response,
    actor: AuthenticatedActor,
  ): Promise<void> {
    let reservation: McpSessionReservation;
    try {
      reservation = await this.sessionRegistry.reserve({
        actorUserId: actor.userId,
        workspaceId: actor.workspaceId,
      });
    } catch (error) {
      if (
        error instanceof McpActorSessionLimitError ||
        error instanceof McpGlobalSessionLimitError
      ) {
        sendProtocolError(response, 429, -32_002, "Session limit reached");
        return;
      }
      throw error;
    }

    const actorProvider = new SessionActorProvider(actor, this.workspaceSlug);
    const server = this.createServer(actorProvider, actor);
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      this.sessions.delete(reservation.id);
      await server.close();
    };
    let activated = false;
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      onsessionclosed: async (closedSessionId) => {
        if (closedSessionId) await this.sessionRegistry.close(closedSessionId);
      },
      onsessioninitialized: async (initializedSessionId) => {
        if (initializedSessionId !== reservation.id) {
          throw new Error("Remote MCP session ID mismatch");
        }
        const active = await this.sessionRegistry.activate(reservation.id, {
          close,
        });
        if (!active) throw new Error("Remote MCP session reservation expired");
        this.sessions.set(reservation.id, {
          actorProvider,
          actorUserId: actor.userId,
          transport,
          workspaceId: actor.workspaceId,
        });
        activated = true;
      },
      sessionIdGenerator: () => reservation.id,
    });
    server.server.onerror = (error) => {
      this.logger.error("remote_mcp_protocol_failed", { error });
    };

    try {
      // The SDK class implements Transport at runtime, but its accessor types do
      // not satisfy exactOptionalPropertyTypes in downstream projects.
      await server.connect(transport as Transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      this.logger.error("remote_mcp_initialization_failed", { error });
      if (!response.headersSent) {
        sendProtocolError(response, 500, -32_603, "Internal server error");
      }
    } finally {
      if (!activated) {
        await this.sessionRegistry.close(reservation.id);
        await close();
      }
    }
  }
}
