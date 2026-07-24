import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import { workspaceIdentityMigration } from "./migrations/001_workspace_identity.js";
import { installationStateMigration } from "./migrations/002_installation_state.js";
import { applicationLedgerMigration } from "./migrations/003_application_ledger.js";
import { applicationHistoryMigration } from "./migrations/004_application_history.js";
import { applicationNextActionsMigration } from "./migrations/005_application_next_actions.js";
import { applicationDeletionsMigration } from "./migrations/006_application_deletions.js";
import { applicationContactsLinksMigration } from "./migrations/007_application_contacts_links.js";
import { referenceValuesMigration } from "./migrations/008_reference_values.js";
import { applicationReferencesMigration } from "./migrations/009_application_references.js";
import { mcpAuditEventsMigration } from "./migrations/010_mcp_audit_events.js";
import { documentsMigration } from "./migrations/011_documents.js";
import { documentPreviewsMigration } from "./migrations/012_document_previews.js";
import { mcpWorkspaceSettingsMigration } from "./migrations/013_mcp_workspace_settings.js";
import { mcpWriteAuditActionsMigration } from "./migrations/014_mcp_write_audit_actions.js";
import { mcpClientsMigration } from "./migrations/015_mcp_clients.js";
import { mcpDocumentTransferAuditActionsMigration } from "./migrations/016_mcp_document_transfer_audit_actions.js";
import { mcpBuiltInOAuthMigration } from "./migrations/017_mcp_builtin_oauth.js";
import { mcpConnectionAccessMigration } from "./migrations/018_mcp_connection_access.js";
import { structuredDocumentPreviewsMigration } from "./migrations/019_structured_document_previews.js";
import { jobEmailReconciliationMigration } from "./migrations/020_job_email_reconciliation.js";
import { mcpEmailLinkExtractionAuditMigration } from "./migrations/021_mcp_email_link_extraction_audit.js";
import { emailStatusEventOrderingMigration } from "./migrations/022_email_status_event_ordering.js";
import { mcpBulkApplicationUpdateAuditMigration } from "./migrations/023_mcp_bulk_application_update_audit.js";
import { mcpSchemaStatusAuditMigration } from "./migrations/024_mcp_schema_status_audit.js";
import { applicationDetailsMigration } from "./migrations/025_application_details.js";

export interface Migration {
  name: string;
  sql: string;
  version: number;
}

interface AppliedMigration {
  checksum: string;
  name: string;
  version: number;
}

export interface MigrationHistory {
  appliedVersions: number[];
  applicationSchemaVersion: number;
  requiresMigration: boolean;
  schemaVersion: number;
}

export const applicationMigrations: readonly Migration[] = [
  workspaceIdentityMigration,
  installationStateMigration,
  applicationLedgerMigration,
  applicationHistoryMigration,
  applicationNextActionsMigration,
  applicationDeletionsMigration,
  applicationContactsLinksMigration,
  referenceValuesMigration,
  applicationReferencesMigration,
  mcpAuditEventsMigration,
  documentsMigration,
  documentPreviewsMigration,
  mcpWorkspaceSettingsMigration,
  mcpWriteAuditActionsMigration,
  mcpClientsMigration,
  mcpDocumentTransferAuditActionsMigration,
  mcpBuiltInOAuthMigration,
  mcpConnectionAccessMigration,
  structuredDocumentPreviewsMigration,
  jobEmailReconciliationMigration,
  mcpEmailLinkExtractionAuditMigration,
  emailStatusEventOrderingMigration,
  mcpBulkApplicationUpdateAuditMigration,
  mcpSchemaStatusAuditMigration,
  applicationDetailsMigration,
];

const createMigrationTable = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL CHECK (length(checksum) = 64),
    applied_at TEXT NOT NULL
  ) STRICT;
`;

function migrationChecksum(migration: Migration): string {
  return createHash("sha256")
    .update(String(migration.version))
    .update("\0")
    .update(migration.name)
    .update("\0")
    .update(migration.sql)
    .digest("hex");
}

function validateMigrationPlan(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration plan must contain version ${String(expectedVersion)} in order`,
      );
    }

    if (!/^[a-z][a-z0-9_]*$/.test(migration.name)) {
      throw new Error(
        `Migration ${String(migration.version)} has an invalid name`,
      );
    }
  });
}

export function verifyMigrationHistory(
  database: Database.Database,
  migrations: readonly Migration[] = applicationMigrations,
): MigrationHistory {
  validateMigrationPlan(migrations);
  const appliedMigrations = database
    .prepare(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
    )
    .all() as AppliedMigration[];

  for (const [index, applied] of appliedMigrations.entries()) {
    const expectedVersion = index + 1;
    if (applied.version !== expectedVersion) {
      throw new Error(
        `Database migration history is missing version ${String(expectedVersion)}`,
      );
    }
    const migration = migrations.find(
      (candidate) => candidate.version === applied.version,
    );

    if (!migration) {
      throw new Error(
        `Database migration version ${String(applied.version)} is newer than this application`,
      );
    }

    const checksum = migrationChecksum(migration);
    if (migration.name !== applied.name || checksum !== applied.checksum) {
      throw new Error(
        `Migration drift detected for version ${String(applied.version)}`,
      );
    }
  }

  const applicationSchemaVersion = migrations.length;
  const schemaVersion = appliedMigrations.at(-1)?.version ?? 0;
  return {
    appliedVersions: appliedMigrations.map(({ version }) => version),
    applicationSchemaVersion,
    requiresMigration: schemaVersion < applicationSchemaVersion,
    schemaVersion,
  };
}

export function migrateDatabase(
  database: Database.Database,
  migrations: readonly Migration[] = applicationMigrations,
): void {
  validateMigrationPlan(migrations);
  database.exec(createMigrationTable);
  const history = verifyMigrationHistory(database, migrations);

  const insertMigration = database.prepare(
    `INSERT INTO schema_migrations (version, name, checksum, applied_at)
     VALUES (?, ?, ?, ?)`,
  );
  const applyMigration = database.transaction(
    (migration: Migration, checksum: string) => {
      database.exec(migration.sql);
      insertMigration.run(
        migration.version,
        migration.name,
        checksum,
        new Date().toISOString(),
      );
    },
  );
  const appliedVersions = new Set(history.appliedVersions);

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration.immediate(migration, migrationChecksum(migration));
    }
  }
}
