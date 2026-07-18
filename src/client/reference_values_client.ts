export type ReferenceCategory =
  "status" | "source" | "role_type" | "document_type";

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

export interface CreateReferenceValueInput {
  category: ReferenceCategory;
  isTerminal: boolean;
  label: string;
}

export interface UpdateReferenceValueInput {
  isActive?: boolean;
  isTerminal?: boolean;
  label?: string;
}

export interface ReferenceValuesClient {
  createValue(input: CreateReferenceValueInput): Promise<ReferenceValue>;
  deleteValue(referenceValueId: string): Promise<void>;
  listValues(): Promise<ReferenceValue[]>;
  updateValue(
    referenceValueId: string,
    input: UpdateReferenceValueInput,
  ): Promise<ReferenceValue>;
}

export class ReferenceValuesClientError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "ReferenceValuesClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCategory(value: unknown): value is ReferenceCategory {
  return (
    value === "status" ||
    value === "source" ||
    value === "role_type" ||
    value === "document_type"
  );
}

function parseValue(value: unknown): ReferenceValue {
  if (
    !isRecord(value) ||
    !isCategory(value.category) ||
    typeof value.createdAt !== "string" ||
    typeof value.id !== "string" ||
    typeof value.isActive !== "boolean" ||
    typeof value.isTerminal !== "boolean" ||
    typeof value.label !== "string" ||
    typeof value.sortOrder !== "number" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new ReferenceValuesClientError("invalid_response");
  }
  return {
    category: value.category,
    createdAt: value.createdAt,
    id: value.id,
    isActive: value.isActive,
    isTerminal: value.isTerminal,
    label: value.label,
    sortOrder: value.sortOrder,
    updatedAt: value.updatedAt,
  };
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ReferenceValuesClientError("invalid_response");
  }
}

function errorCode(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string"
  ) {
    return value.error.code;
  }
  return "request_failed";
}

async function successfulBody(response: Response): Promise<unknown> {
  const body = await readResponse(response);
  if (!response.ok) throw new ReferenceValuesClientError(errorCode(body));
  return body;
}

function parseValueResponse(value: unknown): ReferenceValue {
  if (!isRecord(value)) {
    throw new ReferenceValuesClientError("invalid_response");
  }
  return parseValue(value.value);
}

export const browserReferenceValuesClient: ReferenceValuesClient = {
  async listValues() {
    const response = await fetch("/api/settings/lists", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await successfulBody(response);
    if (!isRecord(body) || !Array.isArray(body.values)) {
      throw new ReferenceValuesClientError("invalid_response");
    }
    return body.values.map(parseValue);
  },

  async createValue(input) {
    const response = await fetch("/api/settings/lists", {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    return parseValueResponse(await successfulBody(response));
  },

  async updateValue(referenceValueId, input) {
    const response = await fetch(
      `/api/settings/lists/${encodeURIComponent(referenceValueId)}`,
      {
        body: JSON.stringify(input),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PATCH",
      },
    );
    return parseValueResponse(await successfulBody(response));
  },

  async deleteValue(referenceValueId) {
    const response = await fetch(
      `/api/settings/lists/${encodeURIComponent(referenceValueId)}`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
    if (response.ok) return;
    throw new ReferenceValuesClientError(
      errorCode(await readResponse(response)),
    );
  },
};
