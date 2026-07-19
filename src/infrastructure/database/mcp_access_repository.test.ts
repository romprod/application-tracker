import { afterEach, describe, expect, it } from "vitest";

import { openApplicationDatabase } from "./connection.js";
import { SqliteMcpAccessRepository } from "./mcp_access_repository.js";
import { SqliteSetupRepository } from "./setup_repository.js";

const databases: ReturnType<typeof openApplicationDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteMcpAccessRepository", () => {
  it("defaults to read-only and persists administrator changes", () => {
    const database = openApplicationDatabase(":memory:");
    databases.push(database);
    const setup = new SqliteSetupRepository(
      database,
    ).createInitialAdministrator({
      completedAt: "2026-07-19T14:00:00.000Z",
      displayName: "Alex Example",
      passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
      username: "alex",
      workspaceName: "Applications",
    });
    const repository = new SqliteMcpAccessRepository(database);

    expect(repository.getAccessMode(setup.workspace.id)).toBe("read_only");
    repository.setAccessMode({
      accessMode: "read_write",
      updatedAt: "2026-07-19T15:00:00.000Z",
      updatedByUserId: setup.administrator.id,
      workspaceId: setup.workspace.id,
    });
    expect(repository.getAccessMode(setup.workspace.id)).toBe("read_write");
    expect(
      database
        .prepare(
          `SELECT access_mode AS accessMode,
                  updated_by_user_id AS updatedByUserId,
                  updated_at AS updatedAt
           FROM mcp_workspace_settings WHERE workspace_id = ?`,
        )
        .get(setup.workspace.id),
    ).toEqual({
      accessMode: "read_write",
      updatedAt: "2026-07-19T15:00:00.000Z",
      updatedByUserId: setup.administrator.id,
    });
  });
});
