import type Database from "better-sqlite3";

import type { AuthenticatedActor } from "../../application/auth.js";
import type {
  LocalMcpActorBinding,
  LocalMcpActorRepository,
} from "../../application/mcp.js";

interface StoredMcpActor {
  displayName: string;
  role: "admin" | "member";
  userId: string;
  username: string;
  workspaceId: string;
  workspaceName: string;
}

export class SqliteMcpActorRepository implements LocalMcpActorRepository {
  public constructor(private readonly database: Database.Database) {}

  public findActiveActor(
    binding: LocalMcpActorBinding,
  ): AuthenticatedActor | undefined {
    const stored = this.database
      .prepare(
        `SELECT users.id AS userId,
                users.username,
                users.display_name AS displayName,
                workspaces.id AS workspaceId,
                workspaces.name AS workspaceName,
                workspace_memberships.role
         FROM users
         JOIN workspace_memberships
           ON workspace_memberships.user_id = users.id
         JOIN workspaces
           ON workspaces.id = workspace_memberships.workspace_id
         WHERE users.username = ?
           AND workspaces.slug = ?
           AND users.status = 'active'`,
      )
      .get(binding.username, binding.workspaceSlug) as
      StoredMcpActor | undefined;
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
