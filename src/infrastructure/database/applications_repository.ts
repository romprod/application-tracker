import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type {
  ApplicationContact,
  ApplicationEvent,
  ApplicationLink,
  ApplicationRecord,
  ApplicationsRepository,
  CreateApplicationRecord,
  DeleteApplicationRecord,
  UpdateApplicationRecord,
} from "../../application/applications.js";

type StoredApplicationRecord = Omit<ApplicationRecord, "contacts" | "links">;

type StoredContact = ApplicationContact & { applicationId: string };
type StoredLink = ApplicationLink & { applicationId: string };

function publicApplicationSelect(): string {
  return `SELECT
            id,
            company_name AS companyName,
            role_title AS roleTitle,
            status,
            location,
            source_url AS sourceUrl,
            applied_on AS appliedOn,
            next_action AS nextAction,
            next_action_due AS nextActionDue,
            notes,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM applications`;
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
      links: [] as ApplicationLink[],
    }));
    const byId = new Map(
      applications.map((application) => [application.id, application]),
    );
    const placeholders = stored.map(() => "?").join(", ");
    const applicationIds = stored.map(({ id }) => id);
    const contacts = this.database
      .prepare(
        `SELECT application_id AS applicationId, name, role, email, phone
         FROM application_contacts
         WHERE workspace_id = ? AND application_id IN (${placeholders})
         ORDER BY application_id, position`,
      )
      .all(workspaceId, ...applicationIds) as StoredContact[];
    const links = this.database
      .prepare(
        `SELECT application_id AS applicationId, label, url
         FROM application_links
         WHERE workspace_id = ? AND application_id IN (${placeholders})
         ORDER BY application_id, position`,
      )
      .all(workspaceId, ...applicationIds) as StoredLink[];
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
      this.database
        .prepare(
          `INSERT INTO applications
           (id, workspace_id, company_name, role_title, status, location,
            source_url, applied_on, next_action, next_action_due, notes,
            created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          input.status,
          input.createdAt,
        );
      this.replaceContacts(input.workspaceId, id, input.contacts ?? []);
      this.replaceLinks(input.workspaceId, id, input.links ?? []);
    });
    create.immediate();

    return {
      appliedOn: input.appliedOn,
      companyName: input.companyName,
      contacts: input.contacts ?? [],
      createdAt: input.createdAt,
      id,
      location: input.location,
      links: input.links ?? [],
      nextAction: input.nextAction,
      nextActionDue: input.nextActionDue,
      notes: input.notes,
      roleTitle: input.roleTitle,
      sourceUrl: input.sourceUrl,
      status: input.status,
      updatedAt: input.createdAt,
    };
  }

  public listApplications(workspaceId: string): ApplicationRecord[] {
    const stored = this.database
      .prepare(
        `${publicApplicationSelect()}
         WHERE workspace_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC, id DESC`,
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
      const stored = this.database
        .prepare(
          `${publicApplicationSelect()}
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .get(input.workspaceId, input.applicationId) as
        StoredApplicationRecord | undefined;
      if (!stored) return undefined;
      const [current] = this.hydrateApplications(input.workspaceId, [stored]);
      if (!current) return undefined;

      const updated: ApplicationRecord = {
        appliedOn:
          input.appliedOn === undefined ? current.appliedOn : input.appliedOn,
        companyName: input.companyName ?? current.companyName,
        contacts: input.contacts ?? current.contacts,
        createdAt: current.createdAt,
        id: current.id,
        location:
          input.location === undefined ? current.location : input.location,
        links: input.links ?? current.links,
        nextAction:
          input.nextAction === undefined
            ? current.nextAction
            : input.nextAction,
        nextActionDue:
          input.nextActionDue === undefined
            ? current.nextActionDue
            : input.nextActionDue,
        notes: input.notes === undefined ? current.notes : input.notes,
        roleTitle: input.roleTitle ?? current.roleTitle,
        sourceUrl:
          input.sourceUrl === undefined ? current.sourceUrl : input.sourceUrl,
        status: input.status ?? current.status,
        updatedAt: input.updatedAt,
      };

      this.database
        .prepare(
          `UPDATE applications
           SET company_name = ?, role_title = ?, status = ?, location = ?,
               source_url = ?, applied_on = ?, next_action = ?,
               next_action_due = ?, notes = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .run(
          updated.companyName,
          updated.roleTitle,
          updated.status,
          updated.location,
          updated.sourceUrl,
          updated.appliedOn,
          updated.nextAction,
          updated.nextActionDue,
          updated.notes,
          updated.updatedAt,
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

      if (updated.status !== current.status) {
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
            updated.status,
            input.updatedAt,
          );
      }

      return updated;
    });

    return update.immediate();
  }
}
