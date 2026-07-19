import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  ExternalIdentityUnavailableError,
  ManagedExternalIdentityNotFoundError,
  ManagedUserNotFoundError,
  UsernameUnavailableError,
  type CreateLocalUserRecord,
  type CreateExternalIdentityRecord,
  type DeleteExternalIdentityRecord,
  type ExternalIdentityLink,
  type SetUserStatusRecord,
  type UsersRepository,
  type WorkspaceUser,
} from "../../application/users.js";

interface WorkspaceUserRow extends Omit<
  WorkspaceUser,
  "externalIdentities" | "localAccount"
> {
  localAccount: number;
}

interface ExternalIdentityRow extends ExternalIdentityLink {
  userId: string;
}

function workspaceUser(
  row: WorkspaceUserRow,
  externalIdentities: ExternalIdentityLink[] = [],
): WorkspaceUser {
  return {
    ...row,
    externalIdentities,
    localAccount: row.localAccount === 1,
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export class SqliteUsersRepository implements UsersRepository {
  public constructor(private readonly database: Database.Database) {}

  public createExternalIdentity(
    input: CreateExternalIdentityRecord,
  ): ExternalIdentityLink {
    const create = this.database.transaction(() => {
      if (!this.findWorkspaceUser(input.workspaceId, input.userId)) {
        throw new ManagedUserNotFoundError();
      }
      const identity: ExternalIdentityLink = {
        createdAt: input.createdAt,
        id: randomUUID(),
        subject: input.subject,
      };
      this.database
        .prepare(
          `INSERT INTO external_identities
             (id, user_id, issuer, subject, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          identity.id,
          input.userId,
          input.issuer,
          input.subject,
          input.createdAt,
        );
      return identity;
    });

    try {
      return create.immediate();
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ExternalIdentityUnavailableError();
      }
      throw error;
    }
  }

  public deleteExternalIdentity(input: DeleteExternalIdentityRecord): void {
    const result = this.database
      .prepare(
        `DELETE FROM external_identities
         WHERE id = ?
           AND user_id = ?
           AND issuer = ?
           AND EXISTS (
             SELECT 1
             FROM workspace_memberships
             WHERE workspace_memberships.workspace_id = ?
               AND workspace_memberships.user_id = external_identities.user_id
           )`,
      )
      .run(input.identityId, input.userId, input.issuer, input.workspaceId);
    if (result.changes !== 1) {
      throw new ManagedExternalIdentityNotFoundError();
    }
  }

  public listWorkspaceUsers(
    workspaceId: string,
    externalIdentityIssuer?: string,
  ): WorkspaceUser[] {
    const rows = this.database
      .prepare(
        `SELECT
           u.id,
           u.username,
           u.display_name AS displayName,
           u.status,
           u.created_at AS createdAt,
           wm.role,
           CASE WHEN lc.user_id IS NULL THEN 0 ELSE 1 END AS localAccount
         FROM workspace_memberships wm
         JOIN users u ON u.id = wm.user_id
         LEFT JOIN local_credentials lc ON lc.user_id = u.id
         WHERE wm.workspace_id = ?
         ORDER BY u.created_at, u.username COLLATE NOCASE`,
      )
      .all(workspaceId) as WorkspaceUserRow[];
    const identities = externalIdentityIssuer
      ? (this.database
          .prepare(
            `SELECT
               external_identities.id,
               external_identities.user_id AS userId,
               external_identities.subject,
               external_identities.created_at AS createdAt
             FROM external_identities
             JOIN workspace_memberships
               ON workspace_memberships.user_id = external_identities.user_id
             WHERE workspace_memberships.workspace_id = ?
               AND external_identities.issuer = ?
             ORDER BY external_identities.created_at, external_identities.id`,
          )
          .all(workspaceId, externalIdentityIssuer) as ExternalIdentityRow[])
      : [];
    return rows.map((row) =>
      workspaceUser(
        row,
        identities
          .filter(({ userId }) => userId === row.id)
          .map(({ createdAt, id, subject }) => ({ createdAt, id, subject })),
      ),
    );
  }

  public createLocalUser(input: CreateLocalUserRecord): WorkspaceUser {
    const create = this.database.transaction(() => {
      const userId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO users
             (id, username, display_name, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          userId,
          input.username,
          input.displayName,
          input.createdAt,
          input.createdAt,
        );
      this.database
        .prepare(
          `INSERT INTO local_credentials
             (user_id, password_hash, password_changed_at)
           VALUES (?, ?, ?)`,
        )
        .run(userId, input.passwordHash, input.createdAt);
      this.database
        .prepare(
          `INSERT INTO workspace_memberships
             (workspace_id, user_id, role, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(input.workspaceId, userId, input.role, input.createdAt);

      return {
        createdAt: input.createdAt,
        displayName: input.displayName,
        externalIdentities: [],
        id: userId,
        localAccount: true,
        role: input.role,
        status: "active" as const,
        username: input.username,
      };
    });

    try {
      return create.immediate();
    } catch (error) {
      if (isUniqueConstraint(error)) throw new UsernameUnavailableError();
      throw error;
    }
  }

  public setUserStatus(input: SetUserStatusRecord): WorkspaceUser {
    const update = this.database.transaction(() => {
      const current = this.findWorkspaceUser(input.workspaceId, input.userId);
      if (!current) throw new ManagedUserNotFoundError();

      this.database
        .prepare(
          `UPDATE users SET status = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.status, input.changedAt, input.userId);
      if (input.status === "disabled") {
        this.database
          .prepare(
            `UPDATE sessions SET revoked_at = ?
             WHERE user_id = ? AND workspace_id = ? AND revoked_at IS NULL`,
          )
          .run(input.changedAt, input.userId, input.workspaceId);
      }

      return { ...current, status: input.status };
    });
    return update.immediate();
  }

  private findWorkspaceUser(
    workspaceId: string,
    userId: string,
  ): WorkspaceUser | undefined {
    const row = this.database
      .prepare(
        `SELECT
           u.id,
           u.username,
           u.display_name AS displayName,
           u.status,
           u.created_at AS createdAt,
           wm.role,
           CASE WHEN lc.user_id IS NULL THEN 0 ELSE 1 END AS localAccount
         FROM workspace_memberships wm
         JOIN users u ON u.id = wm.user_id
         LEFT JOIN local_credentials lc ON lc.user_id = u.id
         WHERE wm.workspace_id = ? AND u.id = ?
         LIMIT 1`,
      )
      .get(workspaceId, userId) as WorkspaceUserRow | undefined;
    return row ? workspaceUser(row) : undefined;
  }
}
