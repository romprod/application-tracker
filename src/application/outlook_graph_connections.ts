import { randomUUID } from "node:crypto";

import type { AuthenticatedActor } from "./auth.js";
import {
  OutlookEmailSyncOperationalError,
  type OutlookMailReader,
  type OutlookMailReaderProvider,
} from "./outlook_email_sync.js";
import {
  parseOutlookFolderPath,
  type CreateOutlookGraphConnectionInput,
  type UpdateOutlookGraphConnectionInput,
} from "../domain/outlook_graph_connections.js";

export interface OutlookGraphConnection {
  assignedApplicationCount: number;
  clientId: string;
  createdAt: string;
  enabled: boolean;
  folderPath: string;
  id: string;
  lastErrorCode: string | null;
  lastTestedAt: string;
  mailbox: string;
  name: string;
  secretConfigured: true;
  tenantId: string;
  updatedAt: string;
  verifiedAt: string;
}

export interface OutlookGraphConnectionOption {
  enabled: boolean;
  id: string;
  mailbox: string;
  name: string;
}

export interface OutlookGraphConnectionStatus {
  connections: OutlookGraphConnection[];
  secureStorageConfigured: boolean;
}

export interface StoredOutlookGraphConnection extends Omit<
  OutlookGraphConnection,
  "secretConfigured"
> {
  clientSecretEncrypted: string;
}

export interface SaveOutlookGraphConnectionRecord {
  clientId: string;
  clientSecretEncrypted: string;
  createdAt: string;
  enabled: boolean;
  folderPath: string;
  id: string;
  lastErrorCode: null;
  lastTestedAt: string;
  mailbox: string;
  name: string;
  tenantId: string;
  updatedAt: string;
  updatedByUserId: string;
  verifiedAt: string;
  workspaceId: string;
}

export interface OutlookGraphConnectionsRepository {
  delete(workspaceId: string, connectionId: string): boolean;
  find(
    workspaceId: string,
    connectionId: string,
  ): StoredOutlookGraphConnection | undefined;
  findAssignedToApplication(
    workspaceId: string,
    applicationId: string,
  ): StoredOutlookGraphConnection | undefined;
  findByName(
    workspaceId: string,
    name: string,
  ): StoredOutlookGraphConnection | undefined;
  list(workspaceId: string): StoredOutlookGraphConnection[];
  recordVerification(input: {
    connectionId: string;
    errorCode: string | null;
    testedAt: string;
    verifiedAt?: string;
    workspaceId: string;
  }): StoredOutlookGraphConnection | undefined;
  save(input: SaveOutlookGraphConnectionRecord): StoredOutlookGraphConnection;
  setEnabled(input: {
    connectionId: string;
    enabled: boolean;
    updatedAt: string;
    updatedByUserId: string;
    verifiedAt?: string;
    workspaceId: string;
  }): StoredOutlookGraphConnection | undefined;
}

export interface OutlookGraphClientSecretCipher {
  decrypt(
    encrypted: string,
    context: OutlookGraphConnectionCipherContext,
  ): string;
  encrypt(secret: string, context: OutlookGraphConnectionCipherContext): string;
}

export interface OutlookGraphConnectionCipherContext {
  clientId: string;
  connectionId: string;
  tenantId: string;
  workspaceId: string;
}

export interface OutlookGraphConnectionAdapter {
  createReader(config: OutlookGraphRuntimeConnection): OutlookMailReader;
  verify(config: OutlookGraphRuntimeConnection): Promise<void>;
}

export interface OutlookGraphRuntimeConnection {
  clientId: string;
  clientSecret: string;
  folderPath: string[];
  mailbox: string;
  tenantId: string;
}

export class OutlookGraphConnectionForbiddenError extends Error {
  public constructor() {
    super("Administrator access is required");
    this.name = "OutlookGraphConnectionForbiddenError";
  }
}

export class OutlookGraphConnectionNotFoundError extends Error {
  public constructor() {
    super("The Outlook connection was not found");
    this.name = "OutlookGraphConnectionNotFoundError";
  }
}

export class OutlookGraphConnectionNameConflictError extends Error {
  public constructor() {
    super("An Outlook connection already uses that name");
    this.name = "OutlookGraphConnectionNameConflictError";
  }
}

export class OutlookGraphConnectionImpactChangedError extends Error {
  public constructor(public readonly assignedApplicationCount: number) {
    super("The Outlook connection assignment count changed");
    this.name = "OutlookGraphConnectionImpactChangedError";
  }
}

export class OutlookGraphClientSecretRequiredError extends Error {
  public constructor() {
    super("A Microsoft Graph client secret is required");
    this.name = "OutlookGraphClientSecretRequiredError";
  }
}

export class OutlookGraphConnectionStorageError extends Error {
  public constructor() {
    super("The Outlook connection could not be read securely");
    this.name = "OutlookGraphConnectionStorageError";
  }
}

function requireAdministrator(actor: AuthenticatedActor): void {
  if (actor.user.role !== "admin") {
    throw new OutlookGraphConnectionForbiddenError();
  }
}

function cipherContext(
  workspaceId: string,
  connection: Pick<OutlookGraphConnection, "clientId" | "id" | "tenantId">,
): OutlookGraphConnectionCipherContext {
  return {
    clientId: connection.clientId,
    connectionId: connection.id,
    tenantId: connection.tenantId,
    workspaceId,
  };
}

function publicConnection(
  connection: StoredOutlookGraphConnection,
): OutlookGraphConnection {
  return {
    assignedApplicationCount: connection.assignedApplicationCount,
    clientId: connection.clientId,
    createdAt: connection.createdAt,
    enabled: connection.enabled,
    folderPath: connection.folderPath,
    id: connection.id,
    lastErrorCode: connection.lastErrorCode,
    lastTestedAt: connection.lastTestedAt,
    mailbox: connection.mailbox,
    name: connection.name,
    secretConfigured: true,
    tenantId: connection.tenantId,
    updatedAt: connection.updatedAt,
    verifiedAt: connection.verifiedAt,
  };
}

export class OutlookGraphConnectionsService implements OutlookMailReaderProvider {
  public constructor(
    private readonly repository: OutlookGraphConnectionsRepository,
    private readonly secrets: OutlookGraphClientSecretCipher,
    private readonly adapter: OutlookGraphConnectionAdapter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public getStatus(actor: AuthenticatedActor): OutlookGraphConnectionStatus {
    requireAdministrator(actor);
    return {
      connections: this.repository
        .list(actor.workspaceId)
        .map(publicConnection),
      secureStorageConfigured: true,
    };
  }

  public listOptions(
    actor: AuthenticatedActor,
  ): OutlookGraphConnectionOption[] {
    return this.repository.list(actor.workspaceId).map((connection) => ({
      enabled: connection.enabled,
      id: connection.id,
      mailbox: connection.mailbox,
      name: connection.name,
    }));
  }

  public async create(
    actor: AuthenticatedActor,
    input: CreateOutlookGraphConnectionInput,
  ): Promise<OutlookGraphConnectionStatus> {
    requireAdministrator(actor);
    this.requireAvailableName(actor.workspaceId, input.name);
    const id = randomUUID();
    const runtime = this.runtimeConnection(input, input.clientSecret);
    await this.adapter.verify(runtime);
    const now = this.clock().toISOString();
    this.saveConnection({
      clientId: input.clientId,
      clientSecretEncrypted: this.secrets.encrypt(
        input.clientSecret,
        cipherContext(actor.workspaceId, { ...input, id }),
      ),
      createdAt: now,
      enabled: true,
      folderPath: input.folderPath,
      id,
      lastErrorCode: null,
      lastTestedAt: now,
      mailbox: input.mailbox,
      name: input.name,
      tenantId: input.tenantId,
      updatedAt: now,
      updatedByUserId: actor.userId,
      verifiedAt: now,
      workspaceId: actor.workspaceId,
    });
    return this.getStatus(actor);
  }

  public async update(
    actor: AuthenticatedActor,
    connectionId: string,
    input: UpdateOutlookGraphConnectionInput,
  ): Promise<OutlookGraphConnectionStatus> {
    requireAdministrator(actor);
    const existing = this.requireConnection(actor.workspaceId, connectionId);
    this.requireAvailableName(actor.workspaceId, input.name, connectionId);
    let clientSecret = input.clientSecret;
    if (!clientSecret) {
      if (
        existing.clientId !== input.clientId ||
        existing.tenantId !== input.tenantId
      ) {
        throw new OutlookGraphClientSecretRequiredError();
      }
      clientSecret = this.decrypt(actor.workspaceId, existing);
    }
    await this.adapter.verify(this.runtimeConnection(input, clientSecret));
    const now = this.clock().toISOString();
    this.saveConnection({
      clientId: input.clientId,
      clientSecretEncrypted: this.secrets.encrypt(
        clientSecret,
        cipherContext(actor.workspaceId, {
          ...input,
          id: existing.id,
        }),
      ),
      createdAt: existing.createdAt,
      enabled: existing.enabled,
      folderPath: input.folderPath,
      id: existing.id,
      lastErrorCode: null,
      lastTestedAt: now,
      mailbox: input.mailbox,
      name: input.name,
      tenantId: input.tenantId,
      updatedAt: now,
      updatedByUserId: actor.userId,
      verifiedAt: now,
      workspaceId: actor.workspaceId,
    });
    return this.getStatus(actor);
  }

  public async verify(
    actor: AuthenticatedActor,
    connectionId: string,
  ): Promise<OutlookGraphConnectionStatus> {
    requireAdministrator(actor);
    const connection = this.requireConnection(actor.workspaceId, connectionId);
    const testedAt = this.clock().toISOString();
    try {
      await this.adapter.verify(
        this.runtimeStoredConnection(actor.workspaceId, connection),
      );
      this.repository.recordVerification({
        connectionId,
        errorCode: null,
        testedAt,
        verifiedAt: testedAt,
        workspaceId: actor.workspaceId,
      });
    } catch (error) {
      if (error instanceof OutlookEmailSyncOperationalError) {
        this.repository.recordVerification({
          connectionId,
          errorCode: error.code,
          testedAt,
          workspaceId: actor.workspaceId,
        });
      }
      throw error;
    }
    return this.getStatus(actor);
  }

  public async setEnabled(
    actor: AuthenticatedActor,
    connectionId: string,
    enabled: boolean,
  ): Promise<OutlookGraphConnectionStatus> {
    requireAdministrator(actor);
    const connection = this.requireConnection(actor.workspaceId, connectionId);
    const now = this.clock().toISOString();
    let verifiedAt: string | undefined;
    if (enabled) {
      try {
        await this.adapter.verify(
          this.runtimeStoredConnection(actor.workspaceId, connection),
        );
        verifiedAt = now;
      } catch (error) {
        if (error instanceof OutlookEmailSyncOperationalError) {
          this.repository.recordVerification({
            connectionId,
            errorCode: error.code,
            testedAt: now,
            workspaceId: actor.workspaceId,
          });
        }
        throw error;
      }
    }
    const updated = this.repository.setEnabled({
      connectionId,
      enabled,
      updatedAt: now,
      updatedByUserId: actor.userId,
      ...(verifiedAt ? { verifiedAt } : {}),
      workspaceId: actor.workspaceId,
    });
    if (!updated) throw new OutlookGraphConnectionNotFoundError();
    return this.getStatus(actor);
  }

  public delete(
    actor: AuthenticatedActor,
    connectionId: string,
    expectedAssignedApplicationCount: number,
  ): OutlookGraphConnectionStatus {
    requireAdministrator(actor);
    const connection = this.requireConnection(actor.workspaceId, connectionId);
    if (
      connection.assignedApplicationCount !== expectedAssignedApplicationCount
    ) {
      throw new OutlookGraphConnectionImpactChangedError(
        connection.assignedApplicationCount,
      );
    }
    if (!this.repository.delete(actor.workspaceId, connectionId)) {
      throw new OutlookGraphConnectionNotFoundError();
    }
    return this.getStatus(actor);
  }

  public forApplication(
    workspaceId: string,
    applicationId: string,
  ): OutlookMailReader {
    const connection = this.repository.findAssignedToApplication(
      workspaceId,
      applicationId,
    );
    if (!connection) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_graph_connection_unassigned",
      );
    }
    if (!connection.enabled) {
      throw new OutlookEmailSyncOperationalError(
        "outlook_email_sync_unavailable",
      );
    }
    try {
      return this.adapter.createReader(
        this.runtimeStoredConnection(workspaceId, connection),
      );
    } catch {
      throw new OutlookEmailSyncOperationalError(
        "outlook_email_sync_unavailable",
      );
    }
  }

  private decrypt(
    workspaceId: string,
    connection: StoredOutlookGraphConnection,
  ): string {
    try {
      return this.secrets.decrypt(
        connection.clientSecretEncrypted,
        cipherContext(workspaceId, connection),
      );
    } catch {
      throw new OutlookGraphConnectionStorageError();
    }
  }

  private requireAvailableName(
    workspaceId: string,
    name: string,
    exceptConnectionId?: string,
  ): void {
    const named = this.repository.findByName(workspaceId, name);
    if (named && named.id !== exceptConnectionId) {
      throw new OutlookGraphConnectionNameConflictError();
    }
  }

  private saveConnection(
    input: SaveOutlookGraphConnectionRecord,
  ): StoredOutlookGraphConnection {
    try {
      return this.repository.save(input);
    } catch (error) {
      const named = this.repository.findByName(input.workspaceId, input.name);
      if (named && named.id !== input.id) {
        throw new OutlookGraphConnectionNameConflictError();
      }
      throw error;
    }
  }

  private requireConnection(
    workspaceId: string,
    connectionId: string,
  ): StoredOutlookGraphConnection {
    const connection = this.repository.find(workspaceId, connectionId);
    if (!connection) throw new OutlookGraphConnectionNotFoundError();
    return connection;
  }

  private runtimeConnection(
    input: Pick<
      CreateOutlookGraphConnectionInput,
      "clientId" | "folderPath" | "mailbox" | "tenantId"
    >,
    clientSecret: string,
  ): OutlookGraphRuntimeConnection {
    return {
      clientId: input.clientId,
      clientSecret,
      folderPath: parseOutlookFolderPath(input.folderPath),
      mailbox: input.mailbox,
      tenantId: input.tenantId,
    };
  }

  private runtimeStoredConnection(
    workspaceId: string,
    connection: StoredOutlookGraphConnection,
  ): OutlookGraphRuntimeConnection {
    return this.runtimeConnection(
      connection,
      this.decrypt(workspaceId, connection),
    );
  }
}
