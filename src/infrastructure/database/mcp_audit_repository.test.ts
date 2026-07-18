import { describe, expect, it } from "vitest";

import { McpAuditService } from "../../application/mcp_audit.js";
import { openApplicationDatabase } from "./connection.js";
import { SqliteMcpAuditRepository } from "./mcp_audit_repository.js";
import { SqliteSetupRepository } from "./setup_repository.js";

describe("SqliteMcpAuditRepository", () => {
  it("appends immutable events and returns only the selected workspace", () => {
    const database = openApplicationDatabase(":memory:");
    const setup = new SqliteSetupRepository(database);
    const first = setup.createInitialAdministrator({
      completedAt: "2026-01-01T00:00:00.000Z",
      displayName: "Alex Example",
      passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
      username: "alex",
      workspaceName: "Applications",
    });
    database
      .prepare(
        `INSERT INTO workspaces (id, name, slug, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        "workspace-second",
        "Second Workspace",
        "second",
        "2026-01-01T00:00:00.000Z",
      );
    database
      .prepare(
        `INSERT INTO workspace_memberships
           (workspace_id, user_id, role, created_at)
         VALUES (?, ?, 'admin', ?)`,
      )
      .run(
        "workspace-second",
        first.administrator.id,
        "2026-01-01T00:00:00.000Z",
      );
    const repository = new SqliteMcpAuditRepository(database);
    const times = [
      new Date("2026-01-01T10:00:00.000Z"),
      new Date("2026-01-01T11:00:00.000Z"),
    ];
    const service = new McpAuditService(
      repository,
      () => times.shift() ?? new Date("2026-01-01T12:00:00.000Z"),
      (() => {
        let sequence = 0;
        return () => `audit-event-${String(++sequence)}`;
      })(),
    );

    try {
      service.record({
        action: "get_tracker_context",
        actorUserId: first.administrator.id,
        result: "success",
        targetType: "workspace",
        transport: "local_stdio",
        workspaceId: first.workspace.id,
      });
      service.record({
        action: "get_application",
        actorUserId: first.administrator.id,
        result: "not_found",
        targetType: "application",
        transport: "local_stdio",
        workspaceId: "workspace-second",
      });

      expect(service.listRecent(first.workspace.id, 10)).toEqual([
        {
          action: "get_tracker_context",
          actor: { displayName: "Alex Example", username: "alex" },
          occurredAt: "2026-01-01T10:00:00.000Z",
          result: "success",
          targetType: "workspace",
          transport: "local_stdio",
        },
      ]);
      expect(service.listRecent("workspace-second", 10)).toEqual([
        {
          action: "get_application",
          actor: { displayName: "Alex Example", username: "alex" },
          occurredAt: "2026-01-01T11:00:00.000Z",
          result: "not_found",
          targetType: "application",
          transport: "local_stdio",
        },
      ]);

      expect(() =>
        database.prepare("UPDATE mcp_audit_events SET result = 'error'").run(),
      ).toThrow("MCP audit events are immutable");
      expect(() =>
        database.prepare("DELETE FROM mcp_audit_events").run(),
      ).toThrow("MCP audit events are immutable");
    } finally {
      database.close();
    }
  });

  it("enforces bounded recent reads", () => {
    const database = openApplicationDatabase(":memory:");
    const repository = new SqliteMcpAuditRepository(database);

    try {
      expect(() => repository.listRecent("workspace-example", 0)).toThrow(
        "MCP audit limit must be between 1 and 100",
      );
      expect(() => repository.listRecent("workspace-example", 101)).toThrow(
        "MCP audit limit must be between 1 and 100",
      );
    } finally {
      database.close();
    }
  });
});
