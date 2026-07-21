import { describe, expect, it } from "vitest";

import { ApplicationLedgerService } from "./applications.js";
import { LocalMcpActorProvider } from "./mcp.js";
import {
  InvalidJobPostingEvidenceError,
  JobEmailReconciliationService,
} from "./job_email_reconciliation.js";
import { SqliteApplicationsRepository } from "../infrastructure/database/applications_repository.js";
import { openApplicationDatabase } from "../infrastructure/database/connection.js";
import { SqliteJobEmailReconciliationRepository } from "../infrastructure/database/job_email_reconciliation_repository.js";
import { SqliteMcpActorRepository } from "../infrastructure/database/mcp_actor_repository.js";
import { SqliteSetupRepository } from "../infrastructure/database/setup_repository.js";

function fixture() {
  const database = openApplicationDatabase(":memory:");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: "2026-07-21T09:00:00.000Z",
    displayName: "Alex Example",
    passwordHash: "scrypt$1024$8$1$salt$hash-value-long-enough",
    username: "alex",
    workspaceName: "Applications",
  });
  const actor = new LocalMcpActorProvider(
    new SqliteMcpActorRepository(database),
    { username: "alex", workspaceSlug: "default" },
  ).getActor();
  const statusId = database
    .prepare(
      `SELECT id FROM reference_values
       WHERE workspace_id = ? AND category = 'status'
       ORDER BY sort_order LIMIT 1`,
    )
    .pluck()
    .get(setup.workspace.id) as string;
  const applications = new ApplicationLedgerService(
    new SqliteApplicationsRepository(database),
    () => new Date("2026-07-21T10:00:00.000Z"),
  );
  const reconciliation = new JobEmailReconciliationService(
    new SqliteJobEmailReconciliationRepository(database),
    applications,
    (operation) => database.transaction(operation).immediate(),
    () => new Date("2026-07-21T10:05:00.000Z"),
  );
  return { actor, applications, database, reconciliation, statusId };
}

describe("JobEmailReconciliationService", () => {
  it("matches legacy application URLs and persists idempotent evidence", () => {
    const { actor, applications, database, reconciliation, statusId } =
      fixture();
    try {
      const existing = applications.createApplication(actor, {
        companyName: "Example Ltd",
        roleTitle: "Platform Engineer",
        sourceUrl:
          "https://www.linkedin.com/jobs/view/4405273020?trackingId=email",
        statusId,
      });

      expect(
        reconciliation.match(actor, {
          companyName: "Example Ltd",
          roleTitle: "Platform Engineer",
          posting: {
            url: "https://www.linkedin.com/comm/jobs/view/4405273020?refId=mail",
          },
        }),
      ).toMatchObject({
        level: "posting_id",
        matches: [{ id: existing.id }],
        outcome: "matched",
      });

      const input = {
        application: {
          companyName: "Example Ltd",
          roleTitle: "Platform Engineer",
          statusId,
        },
        email: {
          messageId: "<linkedin-4405273020@example.com>",
          receivedAt: "2026-07-21T09:30:00Z",
          webUrl: "https://outlook.office.com/mail/inbox/id/example",
        },
        posting: {
          url: "https://www.linkedin.com/comm/jobs/view/4405273020?refId=mail",
        },
        update: { notes: "Imported from Outlook" },
      } as const;
      const first = reconciliation.upsert(actor, input);
      const repeated = reconciliation.upsert(actor, input);

      expect(first).toMatchObject({
        action: "updated",
        application: { id: existing.id, notes: "Imported from Outlook" },
        emailEvidenceLinked: true,
        postingLinked: true,
      });
      expect(repeated).toMatchObject({
        action: "matched",
        application: { id: existing.id },
        emailEvidenceLinked: false,
        postingLinked: false,
      });
      expect(
        database
          .prepare("SELECT count(*) FROM application_job_postings")
          .pluck()
          .get(),
      ).toBe(1);
      expect(
        database
          .prepare("SELECT count(*) FROM application_email_evidence")
          .pluck()
          .get(),
      ).toBe(1);
      expect(applications.listApplications(actor)).toHaveLength(1);
      expect(() =>
        database
          .prepare(
            `INSERT INTO application_job_postings
               (id, workspace_id, application_id, provider,
                external_posting_id, canonical_url, created_at, updated_at)
             VALUES (?, ?, ?, 'linkedin', '4405273020', NULL, ?, ?)`,
          )
          .run(
            "duplicate-posting",
            actor.workspaceId,
            existing.id,
            "2026-07-21T10:06:00.000Z",
            "2026-07-21T10:06:00.000Z",
          ),
      ).toThrow();
      expect(() =>
        database
          .prepare(
            `INSERT INTO application_email_evidence
               (id, workspace_id, application_id, message_id, web_url,
                received_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
          )
          .run(
            "duplicate-email",
            actor.workspaceId,
            existing.id,
            input.email.messageId,
            "2026-07-21T09:30:00.000Z",
            "2026-07-21T10:06:00.000Z",
            "2026-07-21T10:06:00.000Z",
          ),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("returns ambiguity for duplicate company and title fallback matches", () => {
    const { actor, applications, database, reconciliation, statusId } =
      fixture();
    try {
      applications.createApplication(actor, {
        companyName: "Example Ltd",
        roleTitle: "Platform Engineer",
        statusId,
      });
      applications.createApplication(actor, {
        companyName: "  EXAMPLE LTD ",
        roleTitle: "Platform   Engineer",
        statusId,
      });

      expect(
        reconciliation.match(actor, {
          companyName: "example ltd",
          roleTitle: "platform engineer",
        }),
      ).toMatchObject({
        level: "company_title",
        outcome: "ambiguous",
      });
    } finally {
      database.close();
    }
  });

  it("detects conflicting strong evidence without mutating either record", () => {
    const { actor, applications, database, reconciliation, statusId } =
      fixture();
    try {
      const first = reconciliation.upsert(actor, {
        application: {
          companyName: "First Company",
          roleTitle: "Engineer",
          statusId,
        },
        email: {
          messageId: "<first@example.com>",
          receivedAt: "2026-07-21T09:30:00Z",
        },
        posting: {
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
      });
      const second = applications.createApplication(actor, {
        companyName: "Second Company",
        roleTitle: "Engineer",
        statusId,
      });

      const result = reconciliation.match(actor, {
        companyName: "Second Company",
        emailMessageId: "<first@example.com>",
        roleTitle: "Engineer",
        posting: {
          url: "https://www.linkedin.com/jobs/view/4405273020",
        },
      });

      expect(result.outcome).toBe("conflict");
      expect(result.matches.map(({ id }) => id).sort()).toEqual(
        [first.application.id, second.id].sort(),
      );
      expect(applications.listApplications(actor)).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it("rejects inconsistent posting claims and parameterizes email identities", () => {
    const { actor, applications, database, reconciliation, statusId } =
      fixture();
    try {
      expect(() =>
        reconciliation.match(actor, {
          posting: {
            externalPostingId: "4405273020",
            provider: "linkedin",
            url: "https://careers.example.com/jobs/platform-engineer",
          },
        }),
      ).toThrow(InvalidJobPostingEvidenceError);

      const messageId = "<x'); DELETE FROM applications; --@example.com>";
      const result = reconciliation.upsert(actor, {
        application: {
          companyName: "Parameterized Ltd",
          roleTitle: "Database Engineer",
          statusId,
        },
        email: {
          messageId,
          receivedAt: "2026-07-21T09:30:00Z",
        },
      });

      expect(result.emailEvidence[0]?.messageId).toBe(messageId);
      expect(applications.listApplications(actor)).toHaveLength(1);
      expect(
        database.prepare("SELECT count(*) FROM applications").pluck().get(),
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});
