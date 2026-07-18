import type { Migration } from "../migrations.js";

const defaultValues = `
  SELECT 'status' AS category, 'Prospect' AS label, 10 AS sort_order, 0 AS is_terminal
  UNION ALL SELECT 'status', 'Applied', 20, 0
  UNION ALL SELECT 'status', 'Interview', 30, 0
  UNION ALL SELECT 'status', 'Offer', 40, 0
  UNION ALL SELECT 'status', 'Closed', 50, 1
  UNION ALL SELECT 'source', 'Company website', 10, 0
  UNION ALL SELECT 'source', 'Job board', 20, 0
  UNION ALL SELECT 'source', 'Referral', 30, 0
  UNION ALL SELECT 'source', 'Recruiter', 40, 0
  UNION ALL SELECT 'source', 'Other', 50, 0
  UNION ALL SELECT 'role_type', 'Full-time', 10, 0
  UNION ALL SELECT 'role_type', 'Part-time', 20, 0
  UNION ALL SELECT 'role_type', 'Contract', 30, 0
  UNION ALL SELECT 'role_type', 'Internship', 40, 0
  UNION ALL SELECT 'role_type', 'Temporary', 50, 0
  UNION ALL SELECT 'document_type', 'CV', 10, 0
  UNION ALL SELECT 'document_type', 'Cover letter', 20, 0
  UNION ALL SELECT 'document_type', 'Portfolio', 30, 0
  UNION ALL SELECT 'document_type', 'Other', 40, 0
`;

export const referenceValuesMigration: Migration = {
  name: "reference_values",
  version: 8,
  sql: `
    CREATE TABLE reference_values (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      category TEXT NOT NULL
        CHECK (category IN ('status', 'source', 'role_type', 'document_type')),
      label TEXT NOT NULL COLLATE NOCASE
        CHECK (length(trim(label)) BETWEEN 1 AND 80),
      sort_order INTEGER NOT NULL CHECK (sort_order > 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      is_terminal INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (updated_at >= created_at),
      CHECK (category = 'status' OR is_terminal = 0),
      UNIQUE (workspace_id, category, label),
      UNIQUE (workspace_id, category, sort_order),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX reference_values_by_workspace_category
      ON reference_values (workspace_id, category, is_active DESC, sort_order, id);

    CREATE TRIGGER workspaces_seed_reference_values
    AFTER INSERT ON workspaces
    BEGIN
      INSERT INTO reference_values (
        id, workspace_id, category, label, sort_order, is_active, is_terminal,
        created_at, updated_at
      )
      SELECT
        lower(hex(randomblob(16))), NEW.id, defaults.category, defaults.label,
        defaults.sort_order, 1, defaults.is_terminal, NEW.created_at,
        NEW.created_at
      FROM (${defaultValues}) AS defaults;
    END;

    INSERT INTO reference_values (
      id, workspace_id, category, label, sort_order, is_active, is_terminal,
      created_at, updated_at
    )
    SELECT
      lower(hex(randomblob(16))), workspaces.id, defaults.category,
      defaults.label, defaults.sort_order, 1, defaults.is_terminal,
      workspaces.created_at, workspaces.created_at
    FROM workspaces
    CROSS JOIN (${defaultValues}) AS defaults;
  `,
};
