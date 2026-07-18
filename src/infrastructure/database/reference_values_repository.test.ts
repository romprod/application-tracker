import { describe, expect, it } from "vitest";

import {
  ReferenceValueConflictError,
  ReferenceValueInUseError,
  ReferenceValueRequiredError,
} from "../../application/reference_values.js";
import { openApplicationDatabase } from "./connection.js";
import { SqliteApplicationsRepository } from "./applications_repository.js";
import { SqliteReferenceValuesRepository } from "./reference_values_repository.js";
import { SqliteSetupRepository } from "./setup_repository.js";

const createdAt = "2026-07-18T12:00:00.000Z";

function createRepository() {
  const database = openApplicationDatabase(":memory:");
  const setup = new SqliteSetupRepository(database).createInitialAdministrator({
    completedAt: createdAt,
    displayName: "Alex Example",
    passwordHash: "scrypt$1024$8$1$c2FsdC1zYWx0LXNhbHQ$hash-value-long-enough",
    username: "alex",
    workspaceName: "Applications",
  });
  return {
    database,
    repository: new SqliteReferenceValuesRepository(database),
    workspaceId: setup.workspace.id,
  };
}

describe("SqliteReferenceValuesRepository", () => {
  it("seeds generic defaults for a newly created workspace", () => {
    const { database, repository, workspaceId } = createRepository();

    try {
      const values = repository.listReferenceValues(workspaceId);
      expect(values.filter(({ category }) => category === "status")).toEqual([
        expect.objectContaining({ label: "Prospect", sortOrder: 10 }),
        expect.objectContaining({ label: "Applied", sortOrder: 20 }),
        expect.objectContaining({ label: "Interview", sortOrder: 30 }),
        expect.objectContaining({ label: "Offer", sortOrder: 40 }),
        expect.objectContaining({
          isTerminal: true,
          label: "Closed",
          sortOrder: 50,
        }),
      ]);
      expect(
        values.filter(({ category }) => category === "document_type"),
      ).toHaveLength(4);
    } finally {
      database.close();
    }
  });

  it("creates, renames, disables, and deletes values in one workspace", () => {
    const { database, repository, workspaceId } = createRepository();

    try {
      const created = repository.createReferenceValue({
        category: "source",
        createdAt,
        isTerminal: false,
        label: "Community board",
        updatedAt: createdAt,
        workspaceId,
      });
      expect(created).toMatchObject({
        isActive: true,
        label: "Community board",
        sortOrder: 60,
      });

      expect(
        repository.updateReferenceValue({
          isActive: false,
          label: "Local community board",
          referenceValueId: created.id,
          updatedAt: "2026-07-18T13:00:00.000Z",
          workspaceId,
        }),
      ).toMatchObject({
        isActive: false,
        label: "Local community board",
      });
      repository.deleteReferenceValue(workspaceId, created.id);
      expect(
        repository
          .listReferenceValues(workspaceId)
          .some(({ id }) => id === created.id),
      ).toBe(false);
    } finally {
      database.close();
    }
  });

  it("isolates workspaces and treats SQL control text as a value", () => {
    const { database, repository, workspaceId } = createRepository();
    const secondWorkspaceId = "workspace-second";
    const injection = "Board'); DROP TABLE reference_values; --";

    try {
      database
        .prepare(
          "INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(secondWorkspaceId, "Second", "second", createdAt);
      repository.createReferenceValue({
        category: "source",
        createdAt,
        isTerminal: false,
        label: injection,
        updatedAt: createdAt,
        workspaceId,
      });

      expect(repository.listReferenceValues(secondWorkspaceId)).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ label: injection })]),
      );
      expect(
        database.prepare("SELECT count(*) FROM reference_values").pluck().get(),
      ).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });

  it("rejects duplicate labels and removal of the last required value", () => {
    const { database, repository, workspaceId } = createRepository();

    try {
      expect(() =>
        repository.createReferenceValue({
          category: "status",
          createdAt,
          isTerminal: false,
          label: "PROSPECT",
          updatedAt: createdAt,
          workspaceId,
        }),
      ).toThrow(ReferenceValueConflictError);

      for (const value of repository
        .listReferenceValues(workspaceId)
        .filter(({ category }) => category === "document_type")
        .slice(1)) {
        repository.deleteReferenceValue(workspaceId, value.id);
      }
      const finalDocumentType = repository
        .listReferenceValues(workspaceId)
        .find(({ category }) => category === "document_type");
      expect(() =>
        repository.deleteReferenceValue(workspaceId, finalDocumentType!.id),
      ).toThrow(ReferenceValueRequiredError);

      const closed = repository
        .listReferenceValues(workspaceId)
        .find(
          ({ category, isTerminal }) => category === "status" && isTerminal,
        );
      expect(() =>
        repository.updateReferenceValue({
          isTerminal: false,
          referenceValueId: closed!.id,
          updatedAt: createdAt,
          workspaceId,
        }),
      ).toThrow(ReferenceValueRequiredError);
    } finally {
      database.close();
    }
  });

  it("protects values that are referenced by application history", () => {
    const { database, repository, workspaceId } = createRepository();

    try {
      const prospect = repository
        .listReferenceValues(workspaceId)
        .find(
          ({ category, label }) =>
            category === "status" && label === "Prospect",
        );
      if (!prospect) throw new Error("Missing default status");
      const administratorId = database
        .prepare(
          `SELECT user_id FROM workspace_memberships
           WHERE workspace_id = ? AND role = 'admin'`,
        )
        .pluck()
        .get(workspaceId);
      if (typeof administratorId !== "string") {
        throw new Error("Missing test administrator");
      }
      new SqliteApplicationsRepository(database).createApplication({
        appliedOn: null,
        companyName: "Example Studio",
        createdAt,
        createdByUserId: administratorId,
        location: null,
        nextAction: null,
        nextActionDue: null,
        notes: null,
        roleTypeId: null,
        roleTitle: "Product Designer",
        sourceId: null,
        sourceUrl: null,
        statusId: prospect.id,
        workspaceId,
      });

      expect(() =>
        repository.deleteReferenceValue(workspaceId, prospect.id),
      ).toThrow(ReferenceValueInUseError);
    } finally {
      database.close();
    }
  });
});
