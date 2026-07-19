import type Database from "better-sqlite3";

import type { AuthenticatedActor } from "../../application/auth.js";
import type {
  RemoteMcpActorBinding,
  RemoteMcpActorRepository,
} from "../../application/mcp_oauth.js";

interface StoredRemoteMcpActor {
  displayName: string;
  role: "admin" | "member";
  userId: string;
  username: string;
  workspaceId: string;
  workspaceName: string;
}

export class SqliteRemoteMcpActorRepository implements RemoteMcpActorRepository {
  public constructor(private readonly database: Database.Database) {}

  public findActiveActor(
    binding: RemoteMcpActorBinding,
  ): AuthenticatedActor | undefined {
    const stored = this.database
      .prepare(
        `SELECT users.id AS userId,
                users.username,
                users.display_name AS displayName,
                workspaces.id AS workspaceId,
                workspaces.name AS workspaceName,
                workspace_memberships.role
         FROM external_identities
         JOIN users ON users.id = external_identities.user_id
         JOIN workspace_memberships
           ON workspace_memberships.user_id = users.id
         JOIN workspaces
           ON workspaces.id = workspace_memberships.workspace_id
         WHERE external_identities.issuer = ?
           AND external_identities.subject = ?
           AND workspaces.slug = ?
           AND users.status = 'active'`,
      )
      .get(binding.issuer, binding.subject, binding.workspaceSlug) as
      StoredRemoteMcpActor | undefined;
    if (!stored) return undefined;
    return {
      authenticated: true,
      user: {
        displayName: stored.displayName,
        role: stored.role,
        username: stored.username,
      },
      userId: stored.userId,
      workspace: { name: stored.workspaceName },
      workspaceId: stored.workspaceId,
    };
  }
}
