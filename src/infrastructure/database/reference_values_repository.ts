import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  ReferenceValueConflictError,
  ReferenceValueInvalidError,
  ReferenceValueNotFoundError,
  ReferenceValueRequiredError,
  type CreateReferenceValueRecord,
  type ReferenceValue,
  type ReferenceValuesRepository,
  type UpdateReferenceValueRecord,
} from "../../application/reference_values.js";

interface StoredReferenceValue extends Omit<
  ReferenceValue,
  "isActive" | "isTerminal"
> {
  isActive: number;
  isTerminal: number;
}

function isConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT")
  );
}

function publicReferenceValue(row: StoredReferenceValue): ReferenceValue {
  return {
    ...row,
    isActive: row.isActive === 1,
    isTerminal: row.isTerminal === 1,
  };
}

const selectReferenceValue = `
  SELECT id, category, label, sort_order AS sortOrder,
         is_active AS isActive, is_terminal AS isTerminal,
         created_at AS createdAt, updated_at AS updatedAt
  FROM reference_values
`;

export class SqliteReferenceValuesRepository implements ReferenceValuesRepository {
  public constructor(private readonly database: Database.Database) {}

  public listReferenceValues(workspaceId: string): ReferenceValue[] {
    return (
      this.database
        .prepare(
          `${selectReferenceValue}
           WHERE workspace_id = ?
           ORDER BY CASE category
             WHEN 'status' THEN 1
             WHEN 'source' THEN 2
             WHEN 'role_type' THEN 3
             ELSE 4 END,
             sort_order, id`,
        )
        .all(workspaceId) as StoredReferenceValue[]
    ).map(publicReferenceValue);
  }

  public createReferenceValue(
    input: CreateReferenceValueRecord,
  ): ReferenceValue {
    const id = randomUUID();
    const create = this.database.transaction(() => {
      const sortOrder = this.database
        .prepare(
          `SELECT coalesce(max(sort_order), 0) + 10
           FROM reference_values
           WHERE workspace_id = ? AND category = ?`,
        )
        .pluck()
        .get(input.workspaceId, input.category) as number;
      this.database
        .prepare(
          `INSERT INTO reference_values
             (id, workspace_id, category, label, sort_order, is_active,
              is_terminal, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(
          id,
          input.workspaceId,
          input.category,
          input.label,
          sortOrder,
          input.isTerminal ? 1 : 0,
          input.createdAt,
          input.updatedAt,
        );
      return this.findRequired(input.workspaceId, id);
    });
    try {
      return create.immediate();
    } catch (error) {
      if (isConstraintError(error)) throw new ReferenceValueConflictError();
      throw error;
    }
  }

  public updateReferenceValue(
    input: UpdateReferenceValueRecord,
  ): ReferenceValue {
    const update = this.database.transaction(() => {
      const current = this.findRequired(
        input.workspaceId,
        input.referenceValueId,
      );
      const nextActive = input.isActive ?? current.isActive;
      const nextTerminal = input.isTerminal ?? current.isTerminal;
      if (current.category !== "status" && nextTerminal) {
        throw new ReferenceValueInvalidError();
      }
      this.assertRequiredValueRemains(
        input.workspaceId,
        current,
        nextActive,
        nextTerminal,
      );
      this.database
        .prepare(
          `UPDATE reference_values
           SET label = ?, is_active = ?, is_terminal = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
        )
        .run(
          input.label ?? current.label,
          nextActive ? 1 : 0,
          nextTerminal ? 1 : 0,
          input.updatedAt,
          input.workspaceId,
          input.referenceValueId,
        );
      return this.findRequired(input.workspaceId, input.referenceValueId);
    });
    try {
      return update.immediate();
    } catch (error) {
      if (isConstraintError(error)) throw new ReferenceValueConflictError();
      throw error;
    }
  }

  public deleteReferenceValue(
    workspaceId: string,
    referenceValueId: string,
  ): void {
    const remove = this.database.transaction(() => {
      const current = this.findRequired(workspaceId, referenceValueId);
      this.assertRequiredValueRemains(workspaceId, current, false, false);
      this.database
        .prepare(
          "DELETE FROM reference_values WHERE workspace_id = ? AND id = ?",
        )
        .run(workspaceId, referenceValueId);
    });
    remove.immediate();
  }

  private findRequired(
    workspaceId: string,
    referenceValueId: string,
  ): ReferenceValue {
    const row = this.database
      .prepare(`${selectReferenceValue} WHERE workspace_id = ? AND id = ?`)
      .get(workspaceId, referenceValueId) as StoredReferenceValue | undefined;
    if (!row) throw new ReferenceValueNotFoundError();
    return publicReferenceValue(row);
  }

  private assertRequiredValueRemains(
    workspaceId: string,
    current: ReferenceValue,
    nextActive: boolean,
    nextTerminal: boolean,
  ): void {
    if (current.isActive && !nextActive) {
      const activeCount = this.database
        .prepare(
          `SELECT count(*) FROM reference_values
           WHERE workspace_id = ? AND category = ? AND is_active = 1`,
        )
        .pluck()
        .get(workspaceId, current.category) as number;
      if (activeCount <= 1) throw new ReferenceValueRequiredError();
    }
    if (
      current.category === "status" &&
      current.isActive &&
      current.isTerminal &&
      (!nextActive || !nextTerminal)
    ) {
      const terminalCount = this.database
        .prepare(
          `SELECT count(*) FROM reference_values
           WHERE workspace_id = ? AND category = 'status'
             AND is_active = 1 AND is_terminal = 1`,
        )
        .pluck()
        .get(workspaceId) as number;
      if (terminalCount <= 1) throw new ReferenceValueRequiredError();
    }
  }
}
