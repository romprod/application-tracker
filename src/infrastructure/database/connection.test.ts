import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openApplicationDatabase } from "./connection.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("openApplicationDatabase", () => {
  it("creates the workspace identity schema with foreign keys enabled", () => {
    const database = openApplicationDatabase(":memory:");

    try {
      const tableNames = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .pluck()
        .all() as string[];

      expect(tableNames).toEqual(
        expect.arrayContaining([
          "external_identities",
          "local_credentials",
          "schema_migrations",
          "sessions",
          "users",
          "workspace_memberships",
          "workspaces",
        ]),
      );
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      database.close();
    }
  });

  it("enforces membership roles and session workspace membership", () => {
    const database = openApplicationDatabase(":memory:");
    const timestamp = "2026-01-01T00:00:00.000Z";

    try {
      database
        .prepare(
          "INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
        )
        .run("workspace-000001", "Example workspace", "example", timestamp);
      const insertUser = database.prepare(
        `INSERT INTO users
           (id, username, display_name, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      );
      insertUser.run(
        "user-0000000001",
        "alex",
        "Alex Example",
        timestamp,
        timestamp,
      );
      insertUser.run(
        "user-0000000002",
        "casey",
        "Casey Example",
        timestamp,
        timestamp,
      );

      expect(() =>
        database
          .prepare(
            `INSERT INTO workspace_memberships
               (workspace_id, user_id, role, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run("workspace-000001", "user-0000000001", "owner", timestamp),
      ).toThrow();

      database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES (?, ?, 'admin', ?)`,
        )
        .run("workspace-000001", "user-0000000001", timestamp);

      expect(() =>
        database
          .prepare(
            `INSERT INTO sessions
               (id, token_hash, user_id, workspace_id, created_at, last_seen_at,
                idle_expires_at, absolute_expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "session-0000001",
            "0".repeat(64),
            "user-0000000002",
            "workspace-000001",
            timestamp,
            timestamp,
            "2026-01-01T01:00:00.000Z",
            "2026-01-02T00:00:00.000Z",
          ),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("uses WAL, a busy timeout, and owner-only file permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "application-tracker-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "application-tracker.sqlite");
    const database = openApplicationDatabase(databasePath);

    try {
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(database.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    } finally {
      database.close();
    }
  });
});
