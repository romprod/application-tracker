import type { AuthenticatedActor } from "./auth.js";
import type {
  ApplicationStatus,
  CreateApplicationInput,
} from "../domain/applications.js";

export interface ApplicationRecord {
  appliedOn: string | null;
  companyName: string;
  createdAt: string;
  id: string;
  location: string | null;
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
  notes: string | null;
  roleTitle: string;
  sourceUrl: string | null;
  status: ApplicationStatus;
  workspaceId: string;
}

export interface ApplicationsRepository {
  createApplication(input: CreateApplicationRecord): ApplicationRecord;
  listApplications(workspaceId: string): ApplicationRecord[];
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
}
