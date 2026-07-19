import {
  ApplicationNotFoundError,
  type ApplicationEvent,
  type ApplicationRecord,
} from "./applications.js";
import type { AuthenticatedActor } from "./auth.js";
import type {
  CreateApplicationInput,
  UpdateApplicationInput,
} from "../domain/applications.js";
import type { McpAccessMode } from "./mcp_access.js";
import type { ReferenceValue } from "./reference_values.js";

export const applicationMcpToolNames = [
  "get_tracker_context",
  "get_job_search_summary",
  "list_applications",
  "get_application",
  "get_reference_data",
  "create_application",
  "update_application",
  "delete_application",
] as const;

export interface LocalMcpActorBinding {
  username: string;
  workspaceSlug: string;
}

export interface LocalMcpActorRepository {
  findActiveActor(
    binding: LocalMcpActorBinding,
  ): AuthenticatedActor | undefined;
}

export interface McpActorProvider {
  getActor(): AuthenticatedActor;
  getWorkspaceSlug(): string;
}

export interface McpApplicationsReader {
  listApplicationEvents(
    actor: AuthenticatedActor,
    applicationId: string,
  ): ApplicationEvent[];
  listApplications(actor: AuthenticatedActor): ApplicationRecord[];
}

export interface McpApplicationsService extends McpApplicationsReader {
  createApplication(
    actor: AuthenticatedActor,
    input: CreateApplicationInput,
  ): ApplicationRecord;
  deleteApplication(actor: AuthenticatedActor, applicationId: string): void;
  updateApplication(
    actor: AuthenticatedActor,
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord;
}

export interface McpAccessPolicy {
  getAccessMode(workspaceId: string): McpAccessMode;
  requireWriteAccess(actor: AuthenticatedActor): void;
}

export interface McpReferenceValuesReader {
  listReferenceValues(actor: AuthenticatedActor): ReferenceValue[];
}

export interface LocalMcpTrackerContext {
  access: McpAccessMode;
  actor: AuthenticatedActor["user"];
  workspace: {
    name: string;
    slug: string;
  };
}

export interface McpStatusCount {
  count: number;
  isTerminal: boolean;
  status: string;
  statusId: string;
}

export interface McpJobSearchSummary {
  asOfDate: string;
  byStatus: McpStatusCount[];
  dueTodayActions: number;
  openActions: number;
  openApplications: number;
  overdueActions: number;
  terminalApplications: number;
  totalApplications: number;
}

export interface McpApplicationSummary {
  appliedOn: string | null;
  companyName: string;
  id: string;
  location: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  roleTitle: string;
  status: string;
  statusId: string;
  statusIsTerminal: boolean;
  updatedAt: string;
}

export interface McpApplicationList {
  applications: McpApplicationSummary[];
  returned: number;
  total: number;
}

export interface McpApplicationDetail {
  application: ApplicationRecord;
  events: ApplicationEvent[];
}

export interface McpReferenceData {
  values: ReferenceValue[];
}

export interface ListMcpApplicationsInput {
  limit: number;
  statusId?: string;
}

export interface McpApplicationTools {
  createApplication(input: CreateApplicationInput): ApplicationRecord;
  deleteApplication(applicationId: string): {
    applicationId: string;
    deleted: true;
  };
  getApplication(applicationId: string): McpApplicationDetail;
  getJobSearchSummary(): McpJobSearchSummary;
  getReferenceData(): McpReferenceData;
  getTrackerContext(): LocalMcpTrackerContext;
  listApplications(input: ListMcpApplicationsInput): McpApplicationList;
  updateApplication(
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord;
}

export class LocalMcpActorUnavailableError extends Error {
  public constructor() {
    super("The configured local MCP actor is unavailable");
    this.name = "LocalMcpActorUnavailableError";
  }
}

export class LocalMcpActorProvider {
  public constructor(
    private readonly repository: LocalMcpActorRepository,
    private readonly binding: LocalMcpActorBinding,
  ) {}

  public getActor(): AuthenticatedActor {
    const actor = this.repository.findActiveActor(this.binding);
    if (!actor) throw new LocalMcpActorUnavailableError();
    return actor;
  }

  public getWorkspaceSlug(): string {
    return this.binding.workspaceSlug;
  }
}

function applicationSummary(
  application: ApplicationRecord,
): McpApplicationSummary {
  return {
    appliedOn: application.appliedOn,
    companyName: application.companyName,
    id: application.id,
    location: application.location,
    nextAction: application.nextAction,
    nextActionDue: application.nextActionDue,
    roleTitle: application.roleTitle,
    status: application.status,
    statusId: application.statusId,
    statusIsTerminal: application.statusIsTerminal,
    updatedAt: application.updatedAt,
  };
}

export class ApplicationMcpService implements McpApplicationTools {
  public constructor(
    private readonly actorProvider: McpActorProvider,
    private readonly applications: McpApplicationsService,
    private readonly referenceValues: McpReferenceValuesReader,
    private readonly accessPolicy: McpAccessPolicy,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public getTrackerContext(): LocalMcpTrackerContext {
    const actor = this.actorProvider.getActor();
    return {
      access: this.accessPolicy.getAccessMode(actor.workspaceId),
      actor: { ...actor.user },
      workspace: {
        name: actor.workspace.name,
        slug: this.actorProvider.getWorkspaceSlug(),
      },
    };
  }

  public getJobSearchSummary(): McpJobSearchSummary {
    const actor = this.actorProvider.getActor();
    const applications = this.applications.listApplications(actor);
    const references = this.referenceValues.listReferenceValues(actor);
    const asOfDate = this.clock().toISOString().slice(0, 10);
    const byStatus = new Map<string, McpStatusCount>();

    for (const reference of references) {
      if (reference.category !== "status") continue;
      byStatus.set(reference.id, {
        count: 0,
        isTerminal: reference.isTerminal,
        status: reference.label,
        statusId: reference.id,
      });
    }
    for (const application of applications) {
      const count = byStatus.get(application.statusId) ?? {
        count: 0,
        isTerminal: application.statusIsTerminal,
        status: application.status,
        statusId: application.statusId,
      };
      count.count += 1;
      byStatus.set(application.statusId, count);
    }

    const open = applications.filter(
      ({ statusIsTerminal }) => !statusIsTerminal,
    );
    const openActions = open.filter(({ nextAction }) => nextAction !== null);
    return {
      asOfDate,
      byStatus: [...byStatus.values()],
      dueTodayActions: openActions.filter(
        ({ nextActionDue }) => nextActionDue === asOfDate,
      ).length,
      openActions: openActions.length,
      openApplications: open.length,
      overdueActions: openActions.filter(
        ({ nextActionDue }) =>
          nextActionDue !== null && nextActionDue < asOfDate,
      ).length,
      terminalApplications: applications.length - open.length,
      totalApplications: applications.length,
    };
  }

  public listApplications(input: ListMcpApplicationsInput): McpApplicationList {
    const actor = this.actorProvider.getActor();
    const filtered = this.applications
      .listApplications(actor)
      .filter(
        ({ statusId }) =>
          input.statusId === undefined || statusId === input.statusId,
      );
    const limit = Math.max(1, Math.min(input.limit, 100));
    const applications = filtered.slice(0, limit).map(applicationSummary);
    return {
      applications,
      returned: applications.length,
      total: filtered.length,
    };
  }

  public getApplication(applicationId: string): McpApplicationDetail {
    const actor = this.actorProvider.getActor();
    const application = this.applications
      .listApplications(actor)
      .find(({ id }) => id === applicationId);
    if (!application) throw new ApplicationNotFoundError();
    return {
      application,
      events: this.applications.listApplicationEvents(actor, applicationId),
    };
  }

  public getReferenceData(): McpReferenceData {
    const actor = this.actorProvider.getActor();
    return { values: this.referenceValues.listReferenceValues(actor) };
  }

  public createApplication(input: CreateApplicationInput): ApplicationRecord {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.applications.createApplication(actor, input);
  }

  public updateApplication(
    applicationId: string,
    input: UpdateApplicationInput,
  ): ApplicationRecord {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    return this.applications.updateApplication(actor, applicationId, input);
  }

  public deleteApplication(applicationId: string): {
    applicationId: string;
    deleted: true;
  } {
    const actor = this.actorProvider.getActor();
    this.accessPolicy.requireWriteAccess(actor);
    this.applications.deleteApplication(actor, applicationId);
    return { applicationId, deleted: true };
  }
}
