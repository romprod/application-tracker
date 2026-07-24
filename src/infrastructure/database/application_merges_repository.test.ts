import { describe, expect, it } from "vitest";

import {
  ApplicationMergeNotFoundError,
  ApplicationMergeUnsafeError,
  ApplicationMergeVersionConflictError,
  type ApplicationDuplicateReasonKind,
  type ApplicationMergeStateError,
  type ApplicationRecord,
} from "../../application/applications.js";
import { openApplicationDatabase } from "./connection.js";
import { SqliteApplicationsRepository } from "./applications_repository.js";
import { SqliteSetupRepository } from "./setup_repository.js";

const createdAt = "2026-07-24T10:00:00.000Z";
const mergedAt = "2026-07-24T11:00:00.000Z";

function createHarness() {
  const database = openApplicationDatabase(":memory:");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: createdAt,
    displayName: "Alex Example",
    passwordHash: "scrypt$1024$8$1$c2FsdC1zYWx0LXNhbHQ$hash-value-long-enough",
    username: "alex",
    workspaceName: "Applications",
  });
  const repository = new SqliteApplicationsRepository(database);
  const referenceId = (
    category: "document_type" | "status",
    label: string,
  ): string => {
    const id = database
      .prepare(
        `SELECT id FROM reference_values
         WHERE workspace_id = ? AND category = ? AND label = ?`,
      )
      .pluck()
      .get(setup.workspace.id, category, label);
    if (typeof id !== "string") throw new Error("Missing reference fixture");
    return id;
  };
  const createApplication = (
    overrides: Partial<{
      agency: string | null;
      appliedOn: string | null;
      companyName: string;
      contacts: ApplicationRecord["contacts"];
      links: ApplicationRecord["links"];
      location: string | null;
      notes: string | null;
      roleTitle: string;
      sourceUrl: string | null;
      statusId: string;
    }> = {},
  ) =>
    repository.createApplication({
      agency: overrides.agency ?? null,
      appliedOn: overrides.appliedOn ?? null,
      companyName: overrides.companyName ?? "Example Studio",
      contacts: overrides.contacts ?? [],
      createdAt,
      createdByUserId: setup.administrator.id,
      links: overrides.links ?? [],
      location: overrides.location ?? null,
      nextAction: null,
      nextActionDue: null,
      notes: overrides.notes ?? null,
      rating: null,
      roleTypeId: null,
      roleTitle: overrides.roleTitle ?? "Platform Engineer",
      salary: null,
      sourceId: null,
      sourceUrl: overrides.sourceUrl ?? null,
      statusId: overrides.statusId ?? referenceId("status", "Applied"),
      workspaceId: setup.workspace.id,
      workArrangement: null,
    });
  return { createApplication, database, referenceId, repository, setup };
}

function addSourceRelationships(
  harness: ReturnType<typeof createHarness>,
  source: ApplicationRecord,
) {
  const { database, referenceId, setup } = harness;
  database
    .prepare(
      `INSERT INTO application_job_postings
         (id, workspace_id, application_id, provider, external_posting_id,
          canonical_url, created_at, updated_at)
       VALUES (?, ?, ?, 'linkedin', '4405273020', ?, ?, ?)`,
    )
    .run(
      "11111111-1111-4111-8111-111111111111",
      setup.workspace.id,
      source.id,
      "https://www.linkedin.com/jobs/view/4405273020",
      createdAt,
      createdAt,
    );
  database
    .prepare(
      `INSERT INTO application_email_evidence
         (id, workspace_id, application_id, message_id, web_url, received_at,
          created_at, updated_at)
       VALUES (?, ?, ?, '<message@example.com>', ?, ?, ?, ?)`,
    )
    .run(
      "22222222-2222-4222-8222-222222222222",
      setup.workspace.id,
      source.id,
      "https://outlook.office.com/mail/id/source",
      createdAt,
      createdAt,
      createdAt,
    );
  const sha256 = "a".repeat(64);
  database
    .prepare(
      `INSERT INTO file_objects (sha256, byte_size, content, created_at)
       VALUES (?, 4, ?, ?)`,
    )
    .run(sha256, Buffer.from("test"), createdAt);
  database
    .prepare(
      `INSERT INTO documents
         (id, workspace_id, file_sha256, document_type_reference_id,
          original_filename, media_type, uploaded_by_user_id, created_at)
       VALUES (?, ?, ?, ?, 'evidence.txt', 'text/plain', ?, ?)`,
    )
    .run(
      "33333333-3333-4333-8333-333333333333",
      setup.workspace.id,
      sha256,
      referenceId("document_type", "Other"),
      setup.administrator.id,
      createdAt,
    );
  database
    .prepare(
      `INSERT INTO application_documents
         (workspace_id, application_id, document_id, associated_by_user_id,
          associated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      setup.workspace.id,
      source.id,
      "33333333-3333-4333-8333-333333333333",
      setup.administrator.id,
      createdAt,
    );
}

describe("SqliteApplicationsRepository application merges", () => {
  it("returns bounded duplicate candidates with deterministic reasons", () => {
    const harness = createHarness();
    const { createApplication, database, repository, setup } = harness;
    try {
      createApplication({
        agency: "Example Recruitment",
        appliedOn: "2026-07-20",
        contacts: [
          {
            email: "recruiter@example.com",
            name: "Morgan Recruiter",
            phone: null,
            role: "Recruiter",
          },
        ],
        location: "London",
        sourceUrl: "https://jobs.example.com/platform?id=1",
      });
      createApplication({
        agency: "example recruitment",
        appliedOn: "2026-07-22",
        contacts: [
          {
            email: "RECRUITER@example.com",
            name: "Morgan Recruiter",
            phone: null,
            role: "Recruiter",
          },
        ],
        location: "london",
        sourceUrl: "https://jobs.example.com/platform?id=1",
      });
      createApplication({
        companyName: "Another Company",
        roleTitle: "Another Role",
      });

      const firstPage = repository.auditDuplicateApplications(
        setup.workspace.id,
        { limit: 1, offset: 0 },
      );
      expect(firstPage).toMatchObject({
        nextOffset: null,
        offset: 0,
        returned: 1,
        total: 1,
      });
      const candidate = firstPage.candidates[0];
      expect(candidate?.confidence).toBe("definite");
      const reasonKinds = new Set(
        candidate?.reasons.map(({ kind }) => kind) ?? [],
      );
      const expectedReasonKinds: ApplicationDuplicateReasonKind[] = [
        "canonical_url",
        "company_title",
        "agency",
        "location",
        "applied_date",
        "contact",
      ];
      for (const kind of expectedReasonKinds) {
        expect(reasonKinds.has(kind)).toBe(true);
      }
      expect(
        database
          .prepare("SELECT count(*) FROM application_merges")
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("previews every scalar conflict without mutating either record", () => {
    const harness = createHarness();
    const { createApplication, database, referenceId, repository, setup } =
      harness;
    try {
      const source = createApplication({
        contacts: [
          {
            email: "shared@example.com",
            name: "Shared Contact",
            phone: null,
            role: "Recruiter",
          },
        ],
        notes: "Source notes",
        statusId: referenceId("status", "Interview"),
      });
      const target = createApplication({
        contacts: [
          {
            email: "shared@example.com",
            name: "Shared Contact",
            phone: null,
            role: "Hiring manager",
          },
        ],
        notes: "Target notes",
        statusId: referenceId("status", "Applied"),
      });

      const preview = repository.previewApplicationMerge(
        setup.workspace.id,
        source.id,
        target.id,
      );
      expect(preview.safeToApply).toBe(false);
      expect(preview.fieldConflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "notes", resolution: null }),
          expect.objectContaining({ field: "statusId", resolution: null }),
        ]),
      );
      expect(preview.unresolvedConflicts).toEqual(
        expect.arrayContaining([
          "field:notes",
          "field:statusId",
          "relationship:contacts",
        ]),
      );
      expect(preview.contacts).toMatchObject({
        conflicts: [
          {
            key: "email:shared@example.com",
            source: { role: "Recruiter" },
            target: { role: "Hiring manager" },
          },
        ],
        requiresResolution: true,
      });
      expect(() =>
        repository.mergeApplications({
          actorUserId: setup.administrator.id,
          expectedSourceUpdatedAt: source.updatedAt,
          expectedTargetUpdatedAt: target.updatedAt,
          mergedAt,
          resolutions: { fields: {} },
          sourceApplicationId: source.id,
          targetApplicationId: target.id,
          workspaceId: setup.workspace.id,
        }),
      ).toThrowError(ApplicationMergeUnsafeError);
      expect(repository.listApplications(setup.workspace.id)).toHaveLength(2);
      expect(
        database
          .prepare("SELECT count(*) FROM application_merges")
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("applies explicit scalar and relationship conflict resolutions", () => {
    const harness = createHarness();
    const { createApplication, database, referenceId, repository, setup } =
      harness;
    try {
      const source = createApplication({
        contacts: [
          {
            email: "shared@example.com",
            name: "Shared Contact",
            phone: null,
            role: "Recruiter",
          },
        ],
        notes: "Source notes",
        statusId: referenceId("status", "Interview"),
      });
      const target = createApplication({
        contacts: [
          {
            email: "shared@example.com",
            name: "Shared Contact",
            phone: null,
            role: "Hiring manager",
          },
        ],
        notes: "Target notes",
        statusId: referenceId("status", "Applied"),
      });
      const resolutions = {
        contacts: [
          {
            email: "shared@example.com",
            name: "Shared Contact",
            role: "Recruiter",
          },
        ],
        fields: {
          notes: "source" as const,
          statusId: "source" as const,
        },
      };

      expect(
        repository.previewApplicationMerge(
          setup.workspace.id,
          source.id,
          target.id,
          resolutions,
        ),
      ).toMatchObject({
        contacts: { requiresResolution: false },
        safeToApply: true,
        survivor: {
          contacts: [
            expect.objectContaining({
              email: "shared@example.com",
              role: "Recruiter",
            }),
          ],
          notes: "Source notes",
          status: "Interview",
        },
      });
      expect(
        repository.mergeApplications({
          actorUserId: setup.administrator.id,
          expectedSourceUpdatedAt: source.updatedAt,
          expectedTargetUpdatedAt: target.updatedAt,
          mergedAt,
          resolutions,
          sourceApplicationId: source.id,
          targetApplicationId: target.id,
          workspaceId: setup.workspace.id,
        }),
      ).toMatchObject({
        applied: true,
        preview: {
          survivor: {
            notes: "Source notes",
            status: "Interview",
          },
        },
      });
      expect(
        repository.listApplicationEvents(setup.workspace.id, target.id),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromStatus: "Applied",
            toStatus: "Interview",
            type: "status_changed",
          }),
        ]),
      );
    } finally {
      database.close();
    }
  });

  it("atomically consolidates relationships, preserves source events, and retries idempotently", () => {
    const harness = createHarness();
    const { createApplication, database, repository, setup } = harness;
    try {
      const source = createApplication({
        contacts: [
          {
            email: "source@example.com",
            name: "Source Contact",
            phone: null,
            role: "Recruiter",
          },
        ],
        links: [{ label: "Source", url: "https://example.com/source" }],
        notes: "Retained source notes",
      });
      const target = createApplication({
        contacts: [
          {
            email: "target@example.com",
            name: "Target Contact",
            phone: null,
            role: "Hiring manager",
          },
        ],
        links: [{ label: "Target", url: "https://example.com/target" }],
      });
      addSourceRelationships(harness, source);
      const sourceEventsBefore = database
        .prepare(
          `SELECT * FROM application_events
           WHERE workspace_id = ? AND application_id = ?
           ORDER BY rowid`,
        )
        .all(setup.workspace.id, source.id);

      const applied = repository.mergeApplications({
        actorUserId: setup.administrator.id,
        expectedSourceUpdatedAt: source.updatedAt,
        expectedTargetUpdatedAt: target.updatedAt,
        mergedAt,
        resolutions: { fields: {} },
        sourceApplicationId: source.id,
        targetApplicationId: target.id,
        workspaceId: setup.workspace.id,
      });
      expect(applied).toMatchObject({
        alreadyApplied: false,
        applied: true,
        lineage: {
          sourceApplicationId: source.id,
          targetApplicationId: target.id,
        },
        preview: {
          safeToApply: true,
          survivor: {
            notes: "Retained source notes",
          },
        },
      });
      expect(
        applied.preview.survivor.contacts.map(({ name }) => name).sort(),
      ).toEqual(["Source Contact", "Target Contact"]);
      expect(
        applied.preview.survivor.links.map(({ label }) => label).sort(),
      ).toEqual(["Source", "Target"]);
      expect(repository.listApplications(setup.workspace.id)).toHaveLength(1);
      expect(
        database
          .prepare(
            `SELECT application_id FROM application_job_postings
             WHERE workspace_id = ?`,
          )
          .pluck()
          .get(setup.workspace.id),
      ).toBe(target.id);
      expect(
        database
          .prepare(
            `SELECT application_id FROM application_email_evidence
             WHERE workspace_id = ?`,
          )
          .pluck()
          .get(setup.workspace.id),
      ).toBe(target.id);
      expect(
        database
          .prepare(
            `SELECT application_id FROM application_documents
             WHERE workspace_id = ? AND document_id = ?
             ORDER BY application_id`,
          )
          .pluck()
          .all(setup.workspace.id, "33333333-3333-4333-8333-333333333333"),
      ).toEqual([source.id, target.id].sort());
      expect(
        database
          .prepare(
            `SELECT * FROM application_events
             WHERE workspace_id = ? AND application_id = ?
             ORDER BY rowid`,
          )
          .all(setup.workspace.id, source.id),
      ).toEqual(sourceEventsBefore);
      expect(
        repository.listApplicationEvents(setup.workspace.id, source.id),
      ).toHaveLength(sourceEventsBefore.length);

      const retried = repository.mergeApplications({
        actorUserId: setup.administrator.id,
        expectedSourceUpdatedAt: source.updatedAt,
        expectedTargetUpdatedAt: target.updatedAt,
        mergedAt: "2026-07-24T12:00:00.000Z",
        resolutions: { fields: {} },
        sourceApplicationId: source.id,
        targetApplicationId: target.id,
        workspaceId: setup.workspace.id,
      });
      expect(retried.alreadyApplied).toBe(true);
      expect(retried.lineage?.id).toBe(applied.lineage?.id);
      expect(
        database
          .prepare("SELECT count(*) FROM application_merges")
          .pluck()
          .get(),
      ).toBe(1);
      expect(() =>
        database
          .prepare(
            `UPDATE application_merges SET merged_at = ?
             WHERE source_application_id = ?`,
          )
          .run("2026-07-24T14:00:00.000Z", source.id),
      ).toThrow("application merges are immutable");
      expect(() =>
        database
          .prepare(
            "DELETE FROM application_merges WHERE source_application_id = ?",
          )
          .run(source.id),
      ).toThrow("application merges are immutable");
      expect(
        database
          .prepare(
            `SELECT count(*) FROM application_documents
             WHERE workspace_id = ? AND document_id = ?`,
          )
          .pluck()
          .get(setup.workspace.id, "33333333-3333-4333-8333-333333333333"),
      ).toBe(2);
    } finally {
      database.close();
    }
  });

  it("rejects stale, cross-workspace, deleted, and already-merged records", () => {
    const harness = createHarness();
    const { createApplication, database, repository, setup } = harness;
    try {
      const source = createApplication();
      const target = createApplication();
      const otherTarget = createApplication();
      expect(() =>
        repository.mergeApplications({
          actorUserId: setup.administrator.id,
          expectedSourceUpdatedAt: "2026-07-24T09:00:00.000Z",
          expectedTargetUpdatedAt: target.updatedAt,
          mergedAt,
          resolutions: { fields: {} },
          sourceApplicationId: source.id,
          targetApplicationId: target.id,
          workspaceId: setup.workspace.id,
        }),
      ).toThrowError(ApplicationMergeVersionConflictError);
      expect(() =>
        repository.previewApplicationMerge(
          "workspace-outside-scope",
          source.id,
          target.id,
        ),
      ).toThrowError(ApplicationMergeNotFoundError);

      repository.deleteApplication({
        actorUserId: setup.administrator.id,
        applicationId: source.id,
        deletedAt: mergedAt,
        workspaceId: setup.workspace.id,
      });
      expect(() =>
        repository.previewApplicationMerge(
          setup.workspace.id,
          source.id,
          target.id,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "application_merge_deleted",
        }) as ApplicationMergeStateError,
      );

      const mergeSource = createApplication();
      repository.mergeApplications({
        actorUserId: setup.administrator.id,
        expectedSourceUpdatedAt: mergeSource.updatedAt,
        expectedTargetUpdatedAt: target.updatedAt,
        mergedAt: "2026-07-24T12:00:00.000Z",
        resolutions: { fields: {} },
        sourceApplicationId: mergeSource.id,
        targetApplicationId: target.id,
        workspaceId: setup.workspace.id,
      });
      expect(() =>
        repository.mergeApplications({
          actorUserId: setup.administrator.id,
          expectedSourceUpdatedAt: mergeSource.updatedAt,
          expectedTargetUpdatedAt: otherTarget.updatedAt,
          mergedAt: "2026-07-24T13:00:00.000Z",
          resolutions: { fields: {} },
          sourceApplicationId: mergeSource.id,
          targetApplicationId: otherTarget.id,
          workspaceId: setup.workspace.id,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "application_already_merged",
        }) as ApplicationMergeStateError,
      );
    } finally {
      database.close();
    }
  });

  it("rolls back every change when relationship consolidation fails", () => {
    const harness = createHarness();
    const { createApplication, database, repository, setup } = harness;
    try {
      const source = createApplication({
        notes: "Must not survive a failed merge",
      });
      const target = createApplication();
      addSourceRelationships(harness, source);
      database.exec(`
        CREATE TRIGGER fail_merge_evidence
        BEFORE UPDATE OF application_id ON application_email_evidence
        BEGIN
          SELECT RAISE(ABORT, 'simulated relationship failure');
        END;
      `);

      expect(() =>
        repository.mergeApplications({
          actorUserId: setup.administrator.id,
          expectedSourceUpdatedAt: source.updatedAt,
          expectedTargetUpdatedAt: target.updatedAt,
          mergedAt,
          resolutions: { fields: {} },
          sourceApplicationId: source.id,
          targetApplicationId: target.id,
          workspaceId: setup.workspace.id,
        }),
      ).toThrow("simulated relationship failure");
      expect(repository.listApplications(setup.workspace.id)).toHaveLength(2);
      expect(
        repository
          .listApplications(setup.workspace.id)
          .find(({ id }) => id === target.id)?.notes,
      ).toBeNull();
      expect(
        database
          .prepare(
            `SELECT application_id FROM application_email_evidence
             WHERE workspace_id = ?`,
          )
          .pluck()
          .get(setup.workspace.id),
      ).toBe(source.id);
      expect(
        database
          .prepare("SELECT count(*) FROM application_merges")
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      database.close();
    }
  });
});
