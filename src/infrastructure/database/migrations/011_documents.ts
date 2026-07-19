import type { Migration } from "../migrations.js";

export const documentsMigration: Migration = {
  name: "documents",
  version: 11,
  sql: `
    CREATE TABLE file_objects (
      sha256 TEXT PRIMARY KEY
        CHECK (
          length(sha256) = 64 AND
          sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      byte_size INTEGER NOT NULL
        CHECK (byte_size BETWEEN 1 AND 52428800),
      content BLOB NOT NULL CHECK (length(content) = byte_size),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE documents (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
      workspace_id TEXT NOT NULL,
      file_sha256 TEXT NOT NULL,
      document_type_reference_id TEXT NOT NULL,
      original_filename TEXT NOT NULL
        CHECK (
          length(trim(original_filename)) BETWEEN 1 AND 255 AND
          instr(original_filename, char(0)) = 0 AND
          instr(original_filename, char(10)) = 0 AND
          instr(original_filename, char(13)) = 0 AND
          instr(original_filename, '/') = 0 AND
          instr(original_filename, '\\') = 0
        ),
      media_type TEXT NOT NULL
        CHECK (
          length(trim(media_type)) BETWEEN 3 AND 127 AND
          instr(media_type, '/') > 1 AND
          instr(media_type, char(10)) = 0 AND
          instr(media_type, char(13)) = 0
        ),
      uploaded_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (file_sha256) REFERENCES file_objects(sha256) ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, document_type_reference_id)
        REFERENCES reference_values(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, uploaded_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX documents_by_workspace_created
      ON documents (workspace_id, created_at DESC, id DESC);
    CREATE INDEX documents_by_file_object
      ON documents (file_sha256, id);

    CREATE TABLE application_documents (
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      associated_by_user_id TEXT NOT NULL,
      associated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, application_id, document_id),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, document_id)
        REFERENCES documents(workspace_id, id)
        ON DELETE CASCADE,
      FOREIGN KEY (workspace_id, associated_by_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_documents_by_document
      ON application_documents (workspace_id, document_id, application_id);

    CREATE TRIGGER documents_validate_type_insert
    BEFORE INSERT ON documents
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM reference_values
        WHERE id = NEW.document_type_reference_id
          AND workspace_id = NEW.workspace_id
          AND category = 'document_type'
          AND is_active = 1
      ) THEN RAISE(ABORT, 'invalid document type reference') END;
    END;

    CREATE TRIGGER documents_validate_type_update
    BEFORE UPDATE OF workspace_id, document_type_reference_id ON documents
    WHEN NEW.workspace_id IS NOT OLD.workspace_id OR
      NEW.document_type_reference_id IS NOT OLD.document_type_reference_id
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM reference_values
        WHERE id = NEW.document_type_reference_id
          AND workspace_id = NEW.workspace_id
          AND category = 'document_type'
          AND is_active = 1
      ) THEN RAISE(ABORT, 'invalid document type reference') END;
    END;

    CREATE TRIGGER application_documents_validate_insert
    BEFORE INSERT ON application_documents
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM applications
        WHERE id = NEW.application_id
          AND workspace_id = NEW.workspace_id
          AND deleted_at IS NULL
      ) THEN RAISE(ABORT, 'invalid document application reference') END;
    END;
  `,
};
