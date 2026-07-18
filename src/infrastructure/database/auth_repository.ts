import type Database from "better-sqlite3";

import type {
  ActiveSession,
  AuthRepository,
  LocalAccount,
  NewSessionRecord,
} from "../../application/auth.js";

export class SqliteAuthRepository implements AuthRepository {
  public constructor(private readonly database: Database.Database) {}

  public findLocalAccount(username: string): LocalAccount | undefined {
    return this.database
      .prepare(
        `SELECT
           u.id AS userId,
           u.username,
           u.display_name AS displayName,
           u.status,
           lc.password_hash AS passwordHash,
           w.id AS workspaceId,
           w.name AS workspaceName,
           wm.role
         FROM users u
         JOIN local_credentials lc ON lc.user_id = u.id
         JOIN workspace_memberships wm ON wm.user_id = u.id
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE u.username = ? COLLATE NOCASE
         ORDER BY wm.created_at, wm.workspace_id
         LIMIT 1`,
      )
      .get(username) as LocalAccount | undefined;
  }

  public createSession(session: NewSessionRecord): void {
    this.database
      .prepare(
        `INSERT INTO sessions
           (id, token_hash, user_id, workspace_id, created_at, last_seen_at,
            idle_expires_at, absolute_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.sessionId,
        session.tokenHash,
        session.userId,
        session.workspaceId,
        session.createdAt,
        session.createdAt,
        session.idleExpiresAt,
        session.absoluteExpiresAt,
      );
  }

  public findActiveSession(
    tokenHash: string,
    now: string,
  ): ActiveSession | undefined {
    return this.database
      .prepare(
        `SELECT
           s.id AS sessionId,
           s.user_id AS userId,
           s.workspace_id AS workspaceId,
           s.last_seen_at AS lastSeenAt,
           s.absolute_expires_at AS absoluteExpiresAt,
           u.username,
           u.display_name AS displayName,
           w.name AS workspaceName,
           wm.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN workspace_memberships wm
           ON wm.workspace_id = s.workspace_id AND wm.user_id = s.user_id
         JOIN workspaces w ON w.id = s.workspace_id
         WHERE s.token_hash = ?
           AND s.revoked_at IS NULL
           AND s.idle_expires_at > ?
           AND s.absolute_expires_at > ?
           AND u.status = 'active'
         LIMIT 1`,
      )
      .get(tokenHash, now, now) as ActiveSession | undefined;
  }

  public refreshSession(
    sessionId: string,
    lastSeenAt: string,
    idleExpiresAt: string,
    now: string,
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE sessions
         SET last_seen_at = ?, idle_expires_at = ?
         WHERE id = ?
           AND revoked_at IS NULL
           AND idle_expires_at > ?
           AND absolute_expires_at > ?`,
      )
      .run(lastSeenAt, idleExpiresAt, sessionId, now, now);
    return result.changes === 1;
  }

  public revokeSession(tokenHash: string, revokedAt: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .run(revokedAt, tokenHash);
    return result.changes === 1;
  }

  public cleanupExpiredSessions(now: string): number {
    return this.database
      .prepare(
        `DELETE FROM sessions
         WHERE absolute_expires_at <= ? OR idle_expires_at <= ?`,
      )
      .run(now, now).changes;
  }
}
