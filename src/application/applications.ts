import type { AuthenticatedActor } from "./auth.js";
import type {
  ApplicationStatus,
  CreateApplicationInput,
  UpdateApplicationInput,
} from "../domain/applications.js";

export interface ApplicationRecord {
  appliedOn: string | null;
  companyName: string;
  createdAt: string;
  id: string;
  location: string | null;
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
  createdAt: string;
  createdByUserId: string;
  location: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  roleTitle: string;
  sourceUrl: string | null;
  status: ApplicationStatus;
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

export type UpdateApplicationRecord = UpdateApplicationInput & {
  actorUserId: string;
  applicationId: string;
  updatedAt: string;
  workspaceId: string;
};

export interface ApplicationsRepository {
  createApplication(input: CreateApplicationRecord): ApplicationRecord;
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
      createdAt: this.clock().toISOString(),
      createdByUserId: actor.userId,
      location: input.location ?? null,
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
    const application = this.repository.updateApplication({
      ...input,
      actorUserId: actor.userId,
      applicationId,
      updatedAt: this.clock().toISOString(),
      workspaceId: actor.workspaceId,
    });
    if (!application) throw new ApplicationNotFoundError();
    return application;
  }
}
