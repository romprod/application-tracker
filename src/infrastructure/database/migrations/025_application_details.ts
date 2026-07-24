import type { Migration } from "../migrations.js";

export const applicationDetailsMigration: Migration = {
  name: "application_details",
  version: 25,
  sql: `
    ALTER TABLE applications
      ADD COLUMN agency TEXT
      CHECK (
        agency IS NULL OR length(trim(agency)) BETWEEN 1 AND 160
      );

    ALTER TABLE applications
      ADD COLUMN salary TEXT
      CHECK (
        salary IS NULL OR length(trim(salary)) BETWEEN 1 AND 160
      );

    ALTER TABLE applications
      ADD COLUMN rating INTEGER
      CHECK (
        rating IS NULL OR rating BETWEEN 1 AND 5
      );

    ALTER TABLE applications
      ADD COLUMN work_arrangement TEXT
      CHECK (
        work_arrangement IS NULL
        OR work_arrangement IN ('hybrid', 'remote', 'office')
      );
  `,
};
