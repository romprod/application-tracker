import type Database from "better-sqlite3";

import type {
  OutlookGraphConnectionsRepository,
  SaveOutlookGraphConnectionRecord,
  StoredOutlookGraphConnection,
} from "../../application/outlook_graph_connections.js";

interface OutlookGraphConnectionRow extends Omit<
  StoredOutlookGraphConnection,
  "enabled"
> {
  enabled: number;
}

function connection(
  row: OutlookGraphConnectionRow | undefined,
): StoredOutlookGraphConnection | undefined {
  return row ? { ...row, enabled: row.enabled === 1 } : undefined;
}

const selectConnection = `
  SELECT
    connections.id,
    connections.name,
    connections.tenant_id AS tenantId,
    connections.client_id AS clientId,
    connections.client_secret_encrypted AS clientSecretEncrypted,
    connections.mailbox,
    connections.folder_path AS folderPath,
    connections.enabled,
    connections.verified_at AS verifiedAt,
    connections.last_tested_at AS lastTestedAt,
    connections.last_error_code AS lastErrorCode,
    connections.created_at AS createdAt,
    connections.updated_at AS updatedAt,
    (
      SELECT count(*)
      FROM application_outlook_graph_connections AS assignments
      JOIN applications
        ON applications.workspace_id = assignments.workspace_id
       AND applications.id = assignments.application_id
      WHERE assignments.workspace_id = connections.workspace_id
        AND assignments.connection_id = connections.id
        AND applications.deleted_at IS NULL
    ) AS assignedApplicationCount
  FROM outlook_graph_connections AS connections
`;

export class SqliteOutlookGraphConnectionsRepository implements OutlookGraphConnectionsRepository {
  public constructor(private readonly database: Database.Database) {}

  public list(workspaceId: string): StoredOutlookGraphConnection[] {
    return (
      this.database
        .prepare(
          `${selectConnection}
           WHERE connections.workspace_id = ?
           ORDER BY connections.enabled DESC,
                    connections.name COLLATE NOCASE,
                    connections.id`,
        )
        .all(workspaceId) as OutlookGraphConnectionRow[]
    ).map((row) => ({ ...row, enabled: row.enabled === 1 }));
  }

  public find(
    workspaceId: string,
    connectionId: string,
  ): StoredOutlookGraphConnection | undefined {
    return connection(
      this.database
        .prepare(
          `${selectConnection}
           WHERE connections.workspace_id = ? AND connections.id = ?`,
        )
        .get(workspaceId, connectionId) as
        OutlookGraphConnectionRow | undefined,
    );
  }

  public findByName(
    workspaceId: string,
    name: string,
  ): StoredOutlookGraphConnection | undefined {
    return connection(
      this.database
        .prepare(
          `${selectConnection}
           WHERE connections.workspace_id = ?
             AND connections.name = ? COLLATE NOCASE`,
        )
        .get(workspaceId, name) as OutlookGraphConnectionRow | undefined,
    );
  }

  public findAssignedToApplication(
    workspaceId: string,
    applicationId: string,
  ): StoredOutlookGraphConnection | undefined {
    return connection(
      this.database
        .prepare(
          `${selectConnection}
           JOIN application_outlook_graph_connections AS selected
             ON selected.workspace_id = connections.workspace_id
            AND selected.connection_id = connections.id
           WHERE selected.workspace_id = ?
             AND selected.application_id = ?`,
        )
        .get(workspaceId, applicationId) as
        OutlookGraphConnectionRow | undefined,
    );
  }

  public save(
    input: SaveOutlookGraphConnectionRecord,
  ): StoredOutlookGraphConnection {
    this.database
      .prepare(
        `INSERT INTO outlook_graph_connections
           (id, workspace_id, name, tenant_id, client_id,
            client_secret_encrypted, mailbox, folder_path, enabled,
            verified_at, last_tested_at, last_error_code, created_at,
            updated_at, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           tenant_id = excluded.tenant_id,
           client_id = excluded.client_id,
           client_secret_encrypted = excluded.client_secret_encrypted,
           mailbox = excluded.mailbox,
           folder_path = excluded.folder_path,
           enabled = excluded.enabled,
           verified_at = excluded.verified_at,
           last_tested_at = excluded.last_tested_at,
           last_error_code = excluded.last_error_code,
           updated_at = excluded.updated_at,
           updated_by_user_id = excluded.updated_by_user_id
         WHERE outlook_graph_connections.workspace_id = excluded.workspace_id`,
      )
      .run(
        input.id,
        input.workspaceId,
        input.name,
        input.tenantId,
        input.clientId,
        input.clientSecretEncrypted,
        input.mailbox,
        input.folderPath,
        input.enabled ? 1 : 0,
        input.verifiedAt,
        input.lastTestedAt,
        input.lastErrorCode,
        input.createdAt,
        input.updatedAt,
        input.updatedByUserId,
      );
    const saved = this.find(input.workspaceId, input.id);
    if (!saved) throw new Error("Outlook Graph connection was not saved");
    return saved;
  }

  public recordVerification(input: {
    connectionId: string;
    errorCode: string | null;
    testedAt: string;
    verifiedAt?: string;
    workspaceId: string;
  }): StoredOutlookGraphConnection | undefined {
    if (input.verifiedAt) {
      this.database
        .prepare(
          `UPDATE outlook_graph_connections
           SET verified_at = ?,
               last_tested_at = ?,
               last_error_code = NULL
           WHERE workspace_id = ? AND id = ?`,
        )
        .run(
          input.verifiedAt,
          input.testedAt,
          input.workspaceId,
          input.connectionId,
        );
    } else {
      this.database
        .prepare(
          `UPDATE outlook_graph_connections
           SET last_tested_at = ?,
               last_error_code = ?
           WHERE workspace_id = ? AND id = ?`,
        )
        .run(
          input.testedAt,
          input.errorCode,
          input.workspaceId,
          input.connectionId,
        );
    }
    return this.find(input.workspaceId, input.connectionId);
  }

  public setEnabled(input: {
    connectionId: string;
    enabled: boolean;
    updatedAt: string;
    updatedByUserId: string;
    verifiedAt?: string;
    workspaceId: string;
  }): StoredOutlookGraphConnection | undefined {
    if (input.enabled && input.verifiedAt) {
      this.database
        .prepare(
          `UPDATE outlook_graph_connections
           SET enabled = 1,
               verified_at = ?,
               last_tested_at = ?,
               last_error_code = NULL,
               updated_at = ?,
               updated_by_user_id = ?
           WHERE workspace_id = ? AND id = ?`,
        )
        .run(
          input.verifiedAt,
          input.updatedAt,
          input.updatedAt,
          input.updatedByUserId,
          input.workspaceId,
          input.connectionId,
        );
    } else {
      this.database
        .prepare(
          `UPDATE outlook_graph_connections
           SET enabled = 0,
               updated_at = ?,
               updated_by_user_id = ?
           WHERE workspace_id = ? AND id = ?`,
        )
        .run(
          input.updatedAt,
          input.updatedByUserId,
          input.workspaceId,
          input.connectionId,
        );
    }
    return this.find(input.workspaceId, input.connectionId);
  }

  public delete(workspaceId: string, connectionId: string): boolean {
    return (
      this.database
        .prepare(
          `DELETE FROM outlook_graph_connections
           WHERE workspace_id = ? AND id = ?`,
        )
        .run(workspaceId, connectionId).changes === 1
    );
  }
}
