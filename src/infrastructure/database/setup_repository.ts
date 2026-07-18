import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  SetupAlreadyCompleteError,
  type CreateInitialAdministratorInput,
  type SetupRepository,
  type SetupResult,
} from "../../application/setup.js";

export class SqliteSetupRepository implements SetupRepository {
  public constructor(private readonly database: Database.Database) {}

  public isSetupComplete(): boolean {
    const completedAt = this.database
      .prepare("SELECT setup_completed_at FROM installation_state WHERE id = 1")
      .pluck()
      .get();

    return completedAt !== null;
  }

  public createInitialAdministrator(
    input: CreateInitialAdministratorInput,
  ): SetupResult {
    const completeSetup = this.database.transaction(() => {
      if (this.isSetupComplete()) {
        throw new SetupAlreadyCompleteError();
      }

      const administratorId = randomUUID();
      const workspaceId = randomUUID();

      this.database
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_at)
           VALUES (?, ?, 'default', ?)`,
        )
        .run(workspaceId, input.workspaceName, input.completedAt);
      this.database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          administratorId,
          input.username,
          input.displayName,
          input.completedAt,
          input.completedAt,
        );
      this.database
        .prepare(
          `INSERT INTO local_credentials
             (user_id, password_hash, password_changed_at)
           VALUES (?, ?, ?)`,
        )
        .run(administratorId, input.passwordHash, input.completedAt);
      this.database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES (?, ?, 'admin', ?)`,
        )
        .run(workspaceId, administratorId, input.completedAt);

      const stateUpdate = this.database
        .prepare(
          `UPDATE installation_state
           SET setup_completed_at = ?, initial_admin_user_id = ?
           WHERE id = 1 AND setup_completed_at IS NULL`,
        )
        .run(input.completedAt, administratorId);
      if (stateUpdate.changes !== 1) {
        throw new SetupAlreadyCompleteError();
      }

      return {
        administrator: {
          displayName: input.displayName,
          id: administratorId,
          username: input.username,
        },
        workspace: {
          id: workspaceId,
          name: input.workspaceName,
        },
      };
    });

    return completeSetup.immediate();
  }
}
