import type { AuthenticatedActor } from "./auth.js";
import type {
  CreateReferenceValueInput,
  ReferenceCategory,
  UpdateReferenceValueInput,
} from "../domain/reference_values.js";

export interface ReferenceValue {
  category: ReferenceCategory;
  createdAt: string;
  id: string;
  isActive: boolean;
  isTerminal: boolean;
  label: string;
  sortOrder: number;
  updatedAt: string;
}

export interface CreateReferenceValueRecord {
  category: ReferenceCategory;
  createdAt: string;
  isTerminal: boolean;
  label: string;
  updatedAt: string;
  workspaceId: string;
}

export interface UpdateReferenceValueRecord extends UpdateReferenceValueInput {
  referenceValueId: string;
  updatedAt: string;
  workspaceId: string;
}

export interface ReferenceValuesRepository {
  createReferenceValue(input: CreateReferenceValueRecord): ReferenceValue;
  deleteReferenceValue(workspaceId: string, referenceValueId: string): void;
  listReferenceValues(workspaceId: string): ReferenceValue[];
  updateReferenceValue(input: UpdateReferenceValueRecord): ReferenceValue;
}

export class ReferenceValuesForbiddenError extends Error {
  public constructor() {
    super("Administrator access is required");
    this.name = "ReferenceValuesForbiddenError";
  }
}

export class ReferenceValueConflictError extends Error {
  public constructor() {
    super("A reference value with that label already exists");
    this.name = "ReferenceValueConflictError";
  }
}

export class ReferenceValueNotFoundError extends Error {
  public constructor() {
    super("Reference value not found");
    this.name = "ReferenceValueNotFoundError";
  }
}

export class ReferenceValueRequiredError extends Error {
  public constructor() {
    super("At least one active value of each required kind must remain");
    this.name = "ReferenceValueRequiredError";
  }
}

export class ReferenceValueInvalidError extends Error {
  public constructor() {
    super("The reference value is invalid for its category");
    this.name = "ReferenceValueInvalidError";
  }
}

function requireAdministrator(actor: AuthenticatedActor): void {
  if (actor.user.role !== "admin") {
    throw new ReferenceValuesForbiddenError();
  }
}

export class ReferenceValuesService {
  public constructor(
    private readonly repository: ReferenceValuesRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public listReferenceValues(actor: AuthenticatedActor): ReferenceValue[] {
    return this.repository.listReferenceValues(actor.workspaceId);
  }

  public createReferenceValue(
    actor: AuthenticatedActor,
    input: CreateReferenceValueInput,
  ): ReferenceValue {
    requireAdministrator(actor);
    const timestamp = this.clock().toISOString();
    return this.repository.createReferenceValue({
      category: input.category,
      createdAt: timestamp,
      isTerminal: input.isTerminal,
      label: input.label,
      updatedAt: timestamp,
      workspaceId: actor.workspaceId,
    });
  }

  public updateReferenceValue(
    actor: AuthenticatedActor,
    referenceValueId: string,
    input: UpdateReferenceValueInput,
  ): ReferenceValue {
    requireAdministrator(actor);
    return this.repository.updateReferenceValue({
      ...input,
      referenceValueId,
      updatedAt: this.clock().toISOString(),
      workspaceId: actor.workspaceId,
    });
  }

  public deleteReferenceValue(
    actor: AuthenticatedActor,
    referenceValueId: string,
  ): void {
    requireAdministrator(actor);
    this.repository.deleteReferenceValue(actor.workspaceId, referenceValueId);
  }
}
