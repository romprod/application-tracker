import { randomUUID } from "node:crypto";

import type { applicationMcpToolNames } from "./mcp.js";

export type McpAuditAction = (typeof applicationMcpToolNames)[number];
export type McpAuditResult = "denied" | "error" | "not_found" | "success";
export type McpAuditTargetType =
  | "application"
  | "application_collection"
  | "job_search"
  | "reference_data"
  | "workspace";
export type McpAuditTransport = "local_stdio" | "remote_http";

export interface McpAuditEvent {
  action: McpAuditAction;
  actor: {
    displayName: string;
    username: string;
  };
  occurredAt: string;
  result: McpAuditResult;
  targetType: McpAuditTargetType;
  transport: McpAuditTransport;
}

export interface NewMcpAuditEvent {
  action: McpAuditAction;
  actorUserId: string;
  result: McpAuditResult;
  targetType: McpAuditTargetType;
  transport: McpAuditTransport;
  workspaceId: string;
}

export interface StoredMcpAuditEvent extends NewMcpAuditEvent {
  id: string;
  occurredAt: string;
}

export interface McpAuditRepository {
  append(event: StoredMcpAuditEvent): void;
  listRecent(workspaceId: string, limit: number): McpAuditEvent[];
}

export interface McpAuditRecorder {
  record(event: NewMcpAuditEvent): void;
}

export interface McpAuditReader {
  listRecent(workspaceId: string, limit: number): McpAuditEvent[];
}

export const noOpMcpAuditRecorder: McpAuditRecorder = {
  record: () => undefined,
};

export const emptyMcpAuditReader: McpAuditReader = {
  listRecent: () => [],
};

export class McpAuditService implements McpAuditRecorder, McpAuditReader {
  public constructor(
    private readonly repository: McpAuditRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {}

  public record(event: NewMcpAuditEvent): void {
    this.repository.append({
      ...event,
      id: this.idFactory(),
      occurredAt: this.clock().toISOString(),
    });
  }

  public listRecent(workspaceId: string, limit: number): McpAuditEvent[] {
    return this.repository.listRecent(workspaceId, limit);
  }
}
