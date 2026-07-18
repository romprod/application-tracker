import type { AuthenticatedActor } from "./auth.js";
import type {
  ApplicationStatus,
  ApplicationContactInput,
  ApplicationLinkInput,
  CreateApplicationInput,
  UpdateApplicationInput,
} from "../domain/applications.js";

export interface ApplicationContact {
  email: string | null;
  name: string;
  phone: string | null;
  role: string | null;
}

export interface ApplicationLink {
  label: string;
  url: string;
}

export interface ApplicationRecord {
  appliedOn: string | null;
  companyName: string;
  contacts: ApplicationContact[];
  createdAt: string;
  id: string;
  location: string | null;
  links: ApplicationLink[];
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  roleTitle: string;
  sourceUrl: string | null;
  status: ApplicationStatus;
  updatedAt: string;
}

export interface CreateApplicationRecord {
  appliedOn: string | null;
  companyName: string;
  contacts?: ApplicationContact[];
  createdAt: string;
  createdByUserId: string;
  location: string | null;
  links?: ApplicationLink[];
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  roleTitle: string;
  sourceUrl: string | null;
  status: ApplicationStatus;
  workspaceId: string;
}

export interface DeleteApplicationRecord {
  actorUserId: string;
  applicationId: string;
  deletedAt: string;
  workspaceId: string;
}

export type ApplicationEventType = "application_created" | "status_changed";

export interface ApplicationEvent {
  actorDisplayName: string;
  fromStatus: ApplicationStatus | null;
  id: string;
  occurredAt: string;
  toStatus: ApplicationStatus;
  type: ApplicationEventType;
}

export type UpdateApplicationRecord = Omit<
  UpdateApplicationInput,
  "contacts" | "links"
> & {
  actorUserId: string;
  applicationId: string;
  contacts?: ApplicationContact[];
  links?: ApplicationLink[];
  updatedAt: string;
  workspaceId: string;
};

function contactRecord(contact: ApplicationContactInput): ApplicationContact {
  return {
    email: contact.email ?? null,
    name: contact.name,
    phone: contact.phone ?? null,
    role: contact.role ?? null,
  };
}

function linkRecord(link: ApplicationLinkInput): ApplicationLink {
  return { label: link.label, url: link.url };
}

export interface ApplicationsRepository {
  createApplication(input: CreateApplicationRecord): ApplicationRecord;
  deleteApplication(input: DeleteApplicationRecord): boolean;
  listApplicationEvents(
    workspaceId: string,
    applicationId: string,
  ): ApplicationEvent[] | undefined;
  listApplications(workspaceId: string): ApplicationRecord[];
  updateApplication(
    input: UpdateApplicationRecord,
  ): ApplicationRecord | undefined;
}

export class ApplicationNotFoundError extends Error {
  public constructor() {
    super("Application not found");
    this.name = "ApplicationNotFoundError";
  }
}

export class ApplicationLedgerService {
  public constructor(
    private readonly repository: ApplicationsRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public createApplication(
    actor: AuthenticatedActor,
    input: CreateApplicationInput,
  ): ApplicationRecord {
    return this.repository.createApplication({
      appliedOn: input.appliedOn ?? null,
      companyName: input.companyName,
      contacts: (input.contacts ?? []).map(contactRecord),
      createdAt: this.clock().toISOString(),
      createdByUserId: actor.userId,
      location: input.location ?? null,
      links: (input.links ?? []).map(linkRecord),
      nextAction: input.nextAction ?? null,
      nextActionDue: input.nextActionDue ?? null,
      notes: input.notes ?? null,
      roleTitle: input.roleTitle,
      sourceUrl: input.sourceUrl ?? null,
      status: input.status,
      workspaceId: actor.workspaceId,
    });
  }

  public listApplications(actor: AuthenticatedActor): ApplicationRecord[] {
    return this.repository.listApplications(actor.workspaceId);
  }

  public deleteApplication(
    actor: AuthenticatedActor,
    applicationId: string,
  ): void {
    const deleted = this.repository.deleteApplication({
      actorUserId: actor.userId,
      applicationId,
      deletedAt: this.clock().toISOString(),
      workspaceId: actor.workspaceId,
    });
    if (!deleted) throw new ApplicationNotFoundError();
  }

  public listApplicationEvents(
    actor: AuthenticatedActor,
    applicationId: string,
  ): ApplicationEvent[] {
    const events = this.repository.listApplicationEvents(
      actor.workspaceId,
      applicationId,
    );
    if (!events) throw new ApplicationNotFoundError();
    return events;
  }

  public updateApplication(
    actor: AuthenticatedActor,
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord {
    const { contacts, links, ...fields } = input;
    const application = this.repository.updateApplication({
      ...fields,
      actorUserId: actor.userId,
      applicationId,
      ...(contacts ? { contacts: contacts.map(contactRecord) } : {}),
      ...(links ? { links: links.map(linkRecord) } : {}),
      updatedAt: this.clock().toISOString(),
      workspaceId: actor.workspaceId,
    });
    if (!application) throw new ApplicationNotFoundError();
    return application;
  }
}
