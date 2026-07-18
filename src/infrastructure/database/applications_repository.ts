import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type {
  ApplicationRecord,
  ApplicationsRepository,
  CreateApplicationRecord,
} from "../../application/applications.js";

export class SqliteApplicationsRepository implements ApplicationsRepository {
  public constructor(private readonly database: Database.Database) {}

  public createApplication(input: CreateApplicationRecord): ApplicationRecord {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO applications
           (id, workspace_id, company_name, role_title, status, location,
            source_url, applied_on, notes, created_by_user_id, created_at,
            updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.companyName,
        input.roleTitle,
        input.status,
        input.location,
        input.sourceUrl,
        input.appliedOn,
        input.notes,
        input.createdByUserId,
        input.createdAt,
        input.createdAt,
      );

    return {
      appliedOn: input.appliedOn,
      companyName: input.companyName,
      createdAt: input.createdAt,
      id,
      location: input.location,
      notes: input.notes,
      roleTitle: input.roleTitle,
      sourceUrl: input.sourceUrl,
      status: input.status,
      updatedAt: input.createdAt,
    };
  }

  public listApplications(workspaceId: string): ApplicationRecord[] {
    return this.database
      .prepare(
        `SELECT
           id,
           company_name AS companyName,
           role_title AS roleTitle,
           status,
           location,
           source_url AS sourceUrl,
           applied_on AS appliedOn,
           notes,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM applications
         WHERE workspace_id = ?
         ORDER BY updated_at DESC, id DESC`,
      )
      .all(workspaceId) as ApplicationRecord[];
  }
}
