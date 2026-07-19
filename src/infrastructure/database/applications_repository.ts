import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import {
  InvalidApplicationReferenceError,
  type ApplicationContact,
  type ApplicationEvent,
  type ApplicationLink,
  type ApplicationRecord,
  type ApplicationsRepository,
  type CreateApplicationRecord,
  type DeleteApplicationRecord,
  type UpdateApplicationRecord,
} from "../../application/applications.js";

interface StoredApplicationRecord extends Omit<
  ApplicationRecord,
  "contacts" | "links" | "statusIsTerminal"
> {
  statusIsTerminal: number;
}

type StoredContact = ApplicationContact & { applicationId: string };
type StoredLink = ApplicationLink & { applicationId: string };

const relationHydrationBatchSize = 500;

function publicApplicationSelect(): string {
  return `SELECT
            applications.id,
            applications.company_name AS companyName,
            applications.role_title AS roleTitle,
            statuses.id AS statusId,
            statuses.label AS status,
            statuses.is_terminal AS statusIsTerminal,
            sources.id AS sourceId,
            sources.label AS source,
            role_types.id AS roleTypeId,
            role_types.label AS roleType,
            applications.location,
            applications.source_url AS sourceUrl,
            applications.applied_on AS appliedOn,
            applications.next_action AS nextAction,
            applications.next_action_due AS nextActionDue,
            applications.notes,
            applications.created_at AS createdAt,
            applications.updated_at AS updatedAt
          FROM applications AS applications
          JOIN reference_values AS statuses
            ON statuses.id = applications.status_reference_id
          LEFT JOIN reference_values AS sources
            ON sources.id = applications.source_reference_id
          LEFT JOIN reference_values AS role_types
            ON role_types.id = applications.role_type_reference_id`;
}

export class SqliteApplicationsRepository implements ApplicationsRepository {
  public constructor(private readonly database: Database.Database) {}

  private hydrateApplications(
    workspaceId: string,
    stored: StoredApplicationRecord[],
  ): ApplicationRecord[] {
    if (stored.length === 0) return [];
    const applications = stored.map((application) => ({
      ...application,
      contacts: [] as ApplicationContact[],
      statusIsTerminal: application.statusIsTerminal === 1,
      links: [] as ApplicationLink[],
    }));
    const byId = new Map(
      applications.map((application) => [application.id, application]),
    );
    const applicationIds = stored.map(({ id }) => id);
    const contacts: StoredContact[] = [];
    const links: StoredLink[] = [];
    for (
      let offset = 0;
      offset < applicationIds.length;
      offset += relationHydrationBatchSize
    ) {
      const batch = applicationIds.slice(
        offset,
        offset + relationHydrationBatchSize,
      );
      const placeholders = batch.map(() => "?").join(", ");
      contacts.push(
        ...(this.database
          .prepare(
            `SELECT application_id AS applicationId, name, role, email, phone
             FROM application_contacts
             WHERE workspace_id = ? AND application_id IN (${placeholders})
             ORDER BY application_id, position`,
          )
          .all(workspaceId, ...batch) as StoredContact[]),
      );
      links.push(
        ...(this.database
          .prepare(
            `SELECT application_id AS applicationId, label, url
             FROM application_links
             WHERE workspace_id = ? AND application_id IN (${placeholders})
             ORDER BY application_id, position`,
          )
          .all(workspaceId, ...batch) as StoredLink[]),
      );
    }
    for (const { applicationId, ...contact } of contacts) {
      byId.get(applicationId)?.contacts.push(contact);
    }
    for (const { applicationId, ...link } of links) {
      byId.get(applicationId)?.links.push(link);
    }
    return applications;
  }

  private replaceContacts(
    workspaceId: string,
    applicationId: string,
    contacts: ApplicationContact[],
  ): void {
    this.database
      .prepare(
        `DELETE FROM application_contacts
         WHERE workspace_id = ? AND application_id = ?`,
      )
      .run(workspaceId, applicationId);
    const insert = this.database.prepare(
      `INSERT INTO application_contacts
         (workspace_id, application_id, position, name, role, email, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    contacts.forEach((contact, position) => {
      insert.run(
        workspaceId,
        applicationId,
        position,
        contact.name,
        contact.role,
        contact.email,
        contact.phone,
      );
    });
  }

  private replaceLinks(
    workspaceId: string,
    applicationId: string,
    links: ApplicationLink[],
  ): void {
    this.database
      .prepare(
        `DELETE FROM application_links
         WHERE workspace_id = ? AND application_id = ?`,
      )
      .run(workspaceId, applicationId);
    const insert = this.database.prepare(
      `INSERT INTO application_links
         (workspace_id, application_id, position, label, url)
       VALUES (?, ?, ?, ?, ?)`,
    );
    links.forEach((link, position) => {
      insert.run(workspaceId, applicationId, position, link.label, link.url);
    });
  }

  public createApplication(input: CreateApplicationRecord): ApplicationRecord {
    const id = randomUUID();
    const eventId = randomUUID();
    const create = this.database.transaction(() => {
      const status = this.activeReference(
        input.workspaceId,
        input.statusId,
        "status",
      );
      if (input.sourceId) {
        this.activeReference(input.workspaceId, input.sourceId, "source");
      }
      if (input.roleTypeId) {
        this.activeReference(input.workspaceId, input.roleTypeId, "role_type");
      }
      this.database
        .prepare(
          `INSERT INTO applications
           (id, workspace_id, company_name, role_title, legacy_status,
            status_reference_id, source_reference_id, role_type_reference_id,
            location, source_url, applied_on, next_action, next_action_due,
            notes, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.workspaceId,
          input.companyName,
          input.roleTitle,
          status.isTerminal ? "closed" : "prospect",
          input.statusId,
          input.sourceId,
          input.roleTypeId,
          input.location,
          input.sourceUrl,
          input.appliedOn,
          input.nextAction,
          input.nextActionDue,
          input.notes,
          input.createdByUserId,
          input.createdAt,
          input.createdAt,
        );
      this.database
        .prepare(
          `INSERT INTO application_events
             (id, workspace_id, application_id, actor_user_id, event_type,
              from_status, to_status, occurred_at)
           VALUES (?, ?, ?, ?, 'application_created', NULL, ?, ?)`,
        )
        .run(
          eventId,
          input.workspaceId,
          id,
          input.createdByUserId,
          status.label,
          input.createdAt,
        );
      this.replaceContacts(input.workspaceId, id, input.contacts ?? []);
      this.replaceLinks(input.workspaceId, id, input.links ?? []);
      const stored = this.findStoredApplication(input.workspaceId, id);
      if (!stored) throw new Error("Created application could not be read");
      const [created] = this.hydrateApplications(input.workspaceId, [stored]);
      if (!created)
        throw new Error("Created application could not be hydrated");
      return created;
    });
    return create.immediate();
  }

  public listApplications(workspaceId: string): ApplicationRecord[] {
    const stored = this.database
      .prepare(
        `${publicApplicationSelect()}
         WHERE applications.workspace_id = ?
           AND applications.deleted_at IS NULL
         ORDER BY applications.updated_at DESC, applications.id DESC`,
      )
      .all(workspaceId) as StoredApplicationRecord[];
    return this.hydrateApplications(workspaceId, stored);
  }

  public deleteApplication(input: DeleteApplicationRecord): boolean {
    const remove = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE applications
           SET deleted_at = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .run(
          input.deletedAt,
          input.deletedAt,
          input.workspaceId,
          input.applicationId,
        );
      if (result.changes === 0) return false;

      this.database
        .prepare(
          `INSERT INTO application_deletions
             (application_id, workspace_id, actor_user_id, deleted_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          input.applicationId,
          input.workspaceId,
          input.actorUserId,
          input.deletedAt,
        );
      return true;
    });

    return remove.immediate();
  }

  public listApplicationEvents(
    workspaceId: string,
    applicationId: string,
  ): ApplicationEvent[] | undefined {
    const applicationExists = this.database
      .prepare(
        `SELECT 1 FROM applications
         WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
      )
      .pluck()
      .get(workspaceId, applicationId);
    if (applicationExists === undefined) return undefined;

    return this.database
      .prepare(
        `SELECT
           events.id,
           events.event_type AS type,
           events.from_status AS fromStatus,
           events.to_status AS toStatus,
           events.occurred_at AS occurredAt,
           actors.display_name AS actorDisplayName
         FROM application_events AS events
         JOIN users AS actors ON actors.id = events.actor_user_id
         WHERE events.workspace_id = ? AND events.application_id = ?
         ORDER BY events.occurred_at DESC, events.rowid DESC`,
      )
      .all(workspaceId, applicationId) as ApplicationEvent[];
  }

  public updateApplication(
    input: UpdateApplicationRecord,
  ): ApplicationRecord | undefined {
    const update = this.database.transaction(() => {
      const stored = this.findStoredApplication(
        input.workspaceId,
        input.applicationId,
      );
      if (!stored) return undefined;
      const [current] = this.hydrateApplications(input.workspaceId, [stored]);
      if (!current) return undefined;

      const statusId = input.statusId ?? current.statusId;
      const status =
        statusId === current.statusId
          ? {
              isTerminal: current.statusIsTerminal,
              label: current.status,
            }
          : this.activeReference(input.workspaceId, statusId, "status");
      const sourceId =
        input.sourceId === undefined ? current.sourceId : input.sourceId;
      const roleTypeId =
        input.roleTypeId === undefined ? current.roleTypeId : input.roleTypeId;
      if (sourceId && sourceId !== current.sourceId) {
        this.activeReference(input.workspaceId, sourceId, "source");
      }
      if (roleTypeId && roleTypeId !== current.roleTypeId) {
        this.activeReference(input.workspaceId, roleTypeId, "role_type");
      }

      this.database
        .prepare(
          `UPDATE applications
           SET company_name = ?, role_title = ?, legacy_status = ?,
               status_reference_id = ?, source_reference_id = ?,
               role_type_reference_id = ?, location = ?, source_url = ?,
               applied_on = ?, next_action = ?, next_action_due = ?,
               notes = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .run(
          input.companyName ?? current.companyName,
          input.roleTitle ?? current.roleTitle,
          status.isTerminal ? "closed" : "prospect",
          statusId,
          sourceId,
          roleTypeId,
          input.location === undefined ? current.location : input.location,
          input.sourceUrl === undefined ? current.sourceUrl : input.sourceUrl,
          input.appliedOn === undefined ? current.appliedOn : input.appliedOn,
          input.nextAction === undefined
            ? current.nextAction
            : input.nextAction,
          input.nextActionDue === undefined
            ? current.nextActionDue
            : input.nextActionDue,
          input.notes === undefined ? current.notes : input.notes,
          input.updatedAt,
          input.workspaceId,
          input.applicationId,
        );

      if (input.contacts !== undefined) {
        this.replaceContacts(
          input.workspaceId,
          input.applicationId,
          input.contacts,
        );
      }
      if (input.links !== undefined) {
        this.replaceLinks(input.workspaceId, input.applicationId, input.links);
      }

      if (statusId !== current.statusId) {
        this.database
          .prepare(
            `INSERT INTO application_events
               (id, workspace_id, application_id, actor_user_id, event_type,
                from_status, to_status, occurred_at)
             VALUES (?, ?, ?, ?, 'status_changed', ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            input.workspaceId,
            input.applicationId,
            input.actorUserId,
            current.status,
            status.label,
            input.updatedAt,
          );
      }
      const updatedStored = this.findStoredApplication(
        input.workspaceId,
        input.applicationId,
      );
      if (!updatedStored) return undefined;
      const [updated] = this.hydrateApplications(input.workspaceId, [
        updatedStored,
      ]);
      return updated;
    });

    return update.immediate();
  }

  private activeReference(
    workspaceId: string,
    referenceValueId: string,
    category: "role_type" | "source" | "status",
  ): { isTerminal: boolean; label: string } {
    const row = this.database
      .prepare(
        `SELECT label, is_terminal AS isTerminal
         FROM reference_values
         WHERE workspace_id = ? AND id = ? AND category = ? AND is_active = 1`,
      )
      .get(workspaceId, referenceValueId, category) as
      { isTerminal: number; label: string } | undefined;
    if (!row) throw new InvalidApplicationReferenceError();
    return { isTerminal: row.isTerminal === 1, label: row.label };
  }

  private findStoredApplication(
    workspaceId: string,
    applicationId: string,
  ): StoredApplicationRecord | undefined {
    return this.database
      .prepare(
        `${publicApplicationSelect()}
         WHERE applications.workspace_id = ? AND applications.id = ?
           AND applications.deleted_at IS NULL`,
      )
      .get(workspaceId, applicationId) as StoredApplicationRecord | undefined;
  }
}
