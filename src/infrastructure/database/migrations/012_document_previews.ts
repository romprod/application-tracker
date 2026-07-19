import type { Migration } from "../migrations.js";

export const documentPreviewsMigration: Migration = {
  name: "document_previews",
  version: 12,
  sql: `
    CREATE TABLE document_previews (
      workspace_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      parser_version TEXT NOT NULL
        CHECK (
          length(parser_version) BETWEEN 1 AND 64 AND
          parser_version NOT GLOB '*[^a-zA-Z0-9._-]*'
        ),
      media_type TEXT NOT NULL
        CHECK (
          length(media_type) BETWEEN 3 AND 127 AND
          instr(media_type, '/') > 1
        ),
      plain_text TEXT NOT NULL CHECK (length(plain_text) <= 1000000),
      is_truncated INTEGER NOT NULL CHECK (is_truncated IN (0, 1)),
      generated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, document_id, parser_version),
      FOREIGN KEY (workspace_id, document_id)
        REFERENCES documents(workspace_id, id)
        ON DELETE CASCADE
    ) STRICT;
  `,
};
