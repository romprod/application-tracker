import { describe, expect, it } from "vitest";

import { UsernameUnavailableError } from "../../application/users.js";
import { openApplicationDatabase } from "./connection.js";
import { SqliteSetupRepository } from "./setup_repository.js";
import { SqliteUsersRepository } from "./users_repository.js";

const createdAt = "2026-01-01T00:00:00.000Z";

function createRepository() {
  const database = openApplicationDatabase(":memory:");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: createdAt,
    displayName: "Alex Example",
    passwordHash: "scrypt$1024$8$1$c2FsdC1zYWx0LXNhbHQ$hash-value-long-enough",
    username: "alex",
    workspaceName: "Applications",
  });
  return {
    database,
    repository: new SqliteUsersRepository(database),
    setup,
  };
}

describe("SqliteUsersRepository", () => {
  it("creates a local workspace member atomically and lists safe fields", () => {
    const { database, repository, setup } = createRepository();

    try {
      const created = repository.createLocalUser({
        createdAt,
        displayName: "Sam Member",
        passwordHash:
          "scrypt$1024$8$1$bWVtYmVyLXNhbHQ$member-hash-value-long-enough",
        role: "member",
        username: "sam",
        workspaceId: setup.workspace.id,
      });

      expect(created).toMatchObject({
        displayName: "Sam Member",
        localAccount: true,
        role: "member",
        status: "active",
        username: "sam",
      });
      expect(repository.listWorkspaceUsers(setup.workspace.id)).toEqual([
        expect.objectContaining({ role: "admin", username: "alex" }),
        expect.objectContaining({ role: "member", username: "sam" }),
      ]);
      expect(
        database
          .prepare(
            "SELECT password_hash FROM local_credentials WHERE user_id = ?",
          )
          .pluck()
          .get(created.id),
      ).not.toBe("member password");
    } finally {
      database.close();
    }
  });

  it("treats SQL control text as a value and keeps account creation atomic", () => {
    const { database, repository, setup } = createRepository();
    const injection = "sam'); DROP TABLE users; --";

    try {
      repository.createLocalUser({
        createdAt,
        displayName: "Injection Test",
        passwordHash:
          "scrypt$1024$8$1$bWVtYmVyLXNhbHQ$member-hash-value-long-enough",
        role: "member",
        username: injection,
        workspaceId: setup.workspace.id,
      });
      expect(repository.listWorkspaceUsers(setup.workspace.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ username: injection }),
        ]),
      );
      expect(database.prepare("SELECT count(*) FROM users").pluck().get()).toBe(
        2,
      );

      expect(() =>
        repository.createLocalUser({
          createdAt,
          displayName: "Duplicate",
          passwordHash:
            "scrypt$1024$8$1$bWVtYmVyLXNhbHQ$member-hash-value-long-enough",
          role: "member",
          username: injection.toUpperCase(),
          workspaceId: setup.workspace.id,
        }),
      ).toThrow(UsernameUnavailableError);
      expect(database.prepare("SELECT count(*) FROM users").pluck().get()).toBe(
        2,
      );
    } finally {
      database.close();
    }
  });

  it("updates a workspace user's status and revokes active sessions", () => {
    const { database, repository, setup } = createRepository();

    try {
      const member = repository.createLocalUser({
        createdAt,
        displayName: "Sam Member",
        passwordHash:
          "scrypt$1024$8$1$bWVtYmVyLXNhbHQ$member-hash-value-long-enough",
        role: "member",
        username: "sam",
        workspaceId: setup.workspace.id,
      });
      database
        .prepare(
          `INSERT INTO sessions
             (id, token_hash, user_id, workspace_id, created_at, last_seen_at,
              idle_expires_at, absolute_expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "session-0000001",
          "a".repeat(64),
          member.id,
          setup.workspace.id,
          createdAt,
          createdAt,
          "2026-01-01T00:30:00.000Z",
          "2026-01-02T00:00:00.000Z",
        );

      expect(
        repository.setUserStatus({
          changedAt: "2026-01-01T00:10:00.000Z",
          status: "disabled",
          userId: member.id,
          workspaceId: setup.workspace.id,
        }),
      ).toMatchObject({ status: "disabled", username: "sam" });
      expect(
        database
          .prepare("SELECT revoked_at FROM sessions WHERE user_id = ?")
          .pluck()
          .get(member.id),
      ).toBe("2026-01-01T00:10:00.000Z");
    } finally {
      database.close();
    }
  });
});
