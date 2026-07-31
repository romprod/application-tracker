import type { Migration } from "../migrations.js";

export const applicationEmailEvidenceTypesMigration: Migration = {
  name: "application_email_evidence_types",
  version: 35,
  sql: `
    ALTER TABLE application_email_evidence
      ADD COLUMN evidence_type TEXT NOT NULL DEFAULT 'other'
      CHECK (evidence_type IN (
        'original_advert',
        'application_confirmation',
        'recruiter_message',
        'interview_invitation',
        'rejection',
        'offer',
        'withdrawal',
        'follow_up',
        'other'
      ));
  `,
};
