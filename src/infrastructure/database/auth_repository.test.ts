import { describe, expect, it } from "vitest";

import { openApplicationDatabase } from "./connection.js";
import { SqliteAuthRepository } from "./auth_repository.js";
import { SqliteSetupRepository } from "./setup_repository.js";

const createdAt = "2026-01-01T00:00:00.000Z";

function createRepository() {
  const database = openApplicationDatabase(":memory:");
  const setup = new SqliteSetupRepository(database);
  const result = setup.createInitialAdministrator({
    completedAt: createdAt,
    displayName: "Alex Example",
    passwordHash: "scrypt$1024$8$1$c2FsdC1zYWx0LXNhbHQ$hash-value-long-enough",
    username: "alex",
    workspaceName: "Applications",
  });

  return { database, repository: new SqliteAuthRepository(database), result };
}

describe("SqliteAuthRepository", () => {
  it("finds a local account and its explicit workspace membership", () => {
    const { database, repository, result } = createRepository();

    try {
      expect(repository.findLocalAccount("ALEX")).toEqual({
        displayName: "Alex Example",
        passwordHash:
          "scrypt$1024$8$1$c2FsdC1zYWx0LXNhbHQ$hash-value-long-enough",
        role: "admin",
        status: "active",
        userId: result.administrator.id,
        username: "alex",
        workspaceId: result.workspace.id,
        workspaceName: "Applications",
      });
    } finally {
      database.close();
    }
  });

  it("treats SQL injection text as a username value", () => {
    const { database, repository } = createRepository();

    try {
      expect(repository.findLocalAccount("alex' OR 1=1 --")).toBeUndefined();
      expect(database.prepare("SELECT count(*) FROM users").pluck().get()).toBe(
        1,
      );
    } finally {
      database.close();
    }
  });

  it("stores only a token hash and enforces expiry and revocation", () => {
    const { database, repository, result } = createRepository();
    const session = {
      absoluteExpiresAt: "2026-01-02T00:00:00.000Z",
      createdAt,
      idleExpiresAt: "2026-01-01T00:30:00.000Z",
      sessionId: "session-0000001",
      tokenHash: "a".repeat(64),
      userId: result.administrator.id,
      workspaceId: result.workspace.id,
    };

    try {
      repository.createSession(session);
      expect(
        repository.findActiveSession(
          session.tokenHash,
          "2026-01-01T00:10:00.000Z",
        ),
      ).toMatchObject({
        displayName: "Alex Example",
        role: "admin",
        sessionId: session.sessionId,
        username: "alex",
      });
      expect(
        database.prepare("SELECT token_hash FROM sessions").pluck().get(),
      ).toBe(session.tokenHash);

      repository.revokeSession(session.tokenHash, "2026-01-01T00:11:00.000Z");
      expect(
        repository.findActiveSession(
          session.tokenHash,
          "2026-01-01T00:12:00.000Z",
        ),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
