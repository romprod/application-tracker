import type { Migration } from "../migrations.js";

export const applicationContactsLinksMigration: Migration = {
  name: "application_contacts_links",
  version: 7,
  sql: `
    CREATE TABLE application_contacts (
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
      role TEXT CHECK (
        role IS NULL OR length(trim(role)) BETWEEN 1 AND 160
      ),
      email TEXT CHECK (
        email IS NULL OR (
          length(trim(email)) BETWEEN 3 AND 254 AND
          instr(email, '@') BETWEEN 2 AND length(email) - 1
        )
      ),
      phone TEXT CHECK (
        phone IS NULL OR length(trim(phone)) BETWEEN 1 AND 50
      ),
      PRIMARY KEY (application_id, position),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_contacts_by_application
      ON application_contacts (workspace_id, application_id, position);

    CREATE TABLE application_links (
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
      label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
      url TEXT NOT NULL CHECK (
        length(url) BETWEEN 1 AND 2048 AND
        (lower(url) LIKE 'https://%' OR lower(url) LIKE 'http://%')
      ),
      PRIMARY KEY (application_id, position),
      FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications(workspace_id, id)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX application_links_by_application
      ON application_links (workspace_id, application_id, position);
  `,
};
