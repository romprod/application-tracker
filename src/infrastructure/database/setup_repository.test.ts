import { describe, expect, it } from "vitest";

import { SetupAlreadyCompleteError } from "../../application/setup.js";
import { openApplicationDatabase } from "./connection.js";
import { SqliteSetupRepository } from "./setup_repository.js";

describe("SqliteSetupRepository", () => {
  it("creates the initial workspace administrator atomically", () => {
    const database = openApplicationDatabase(":memory:");
    const repository = new SqliteSetupRepository(database);

    try {
      expect(repository.isSetupComplete()).toBe(false);

      const result = repository.createInitialAdministrator({
        completedAt: "2026-01-01T00:00:00.000Z",
        displayName: "Alex Example",
        passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
        username: "alex",
        workspaceName: "Applications",
      });

      expect(result.administrator).toMatchObject({
        displayName: "Alex Example",
        username: "alex",
      });
      expect(result.workspace).toMatchObject({ name: "Applications" });
      expect(repository.isSetupComplete()).toBe(true);
      expect(
        database
          .prepare(
            `SELECT role FROM workspace_memberships
             WHERE workspace_id = ? AND user_id = ?`,
          )
          .pluck()
          .get(result.workspace.id, result.administrator.id),
      ).toBe("admin");
      expect(
        database
          .prepare("SELECT password_hash FROM local_credentials")
          .pluck()
          .get(),
      ).toBe("scrypt$1024$8$1$salt$hash-value-long-enough");
    } finally {
      database.close();
    }
  });

  it("allows setup to complete only once", () => {
    const database = openApplicationDatabase(":memory:");
    const repository = new SqliteSetupRepository(database);
    const input = {
      completedAt: "2026-01-01T00:00:00.000Z",
      displayName: "Alex Example",
      passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
      username: "alex",
      workspaceName: "Applications",
    };

    try {
      repository.createInitialAdministrator(input);
      expect(() => repository.createInitialAdministrator(input)).toThrow(
        SetupAlreadyCompleteError,
      );
      expect(database.prepare("SELECT count(*) FROM users").pluck().get()).toBe(
        1,
      );
    } finally {
      database.close();
    }
  });
});
