import type { Migration } from "../migrations.js";

export const structuredDocumentPreviewsMigration: Migration = {
  name: "structured_document_previews",
  version: 19,
  sql: `
    ALTER TABLE document_previews
      ADD COLUMN preview_kind TEXT NOT NULL DEFAULT 'text'
        CHECK (preview_kind IN ('text', 'email'));

    ALTER TABLE document_previews
      ADD COLUMN email_metadata_json TEXT
        CHECK (
          (preview_kind = 'text' AND email_metadata_json IS NULL) OR (
            preview_kind = 'email' AND
            email_metadata_json IS NOT NULL AND
            json_valid(email_metadata_json) AND
            length(email_metadata_json) <= 65536
          )
        );
  `,
};
