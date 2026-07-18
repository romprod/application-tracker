export interface SetupStatus {
  required: boolean;
  tokenConfigured: boolean;
}

export interface InitialSetupInput {
  displayName: string;
  password: string;
  setupToken: string;
  username: string;
  workspaceName: string;
}

export interface SetupResult {
  administrator: {
    displayName: string;
    id: string;
    username: string;
  };
  workspace: {
    id: string;
    name: string;
  };
}

export interface SetupClient {
  completeSetup(input: InitialSetupInput): Promise<SetupResult>;
  getStatus(): Promise<SetupStatus>;
}

export class SetupClientError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "SetupClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SetupClientError("invalid_response");
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

function parseStatus(value: unknown): SetupStatus {
  if (
    !isRecord(value) ||
    typeof value.required !== "boolean" ||
    typeof value.tokenConfigured !== "boolean"
  ) {
    throw new SetupClientError("invalid_response");
  }
  return {
    required: value.required,
    tokenConfigured: value.tokenConfigured,
  };
}

function parseSetupResult(value: unknown): SetupResult {
  if (
    !isRecord(value) ||
    !isRecord(value.administrator) ||
    !isRecord(value.workspace) ||
    typeof value.administrator.displayName !== "string" ||
    typeof value.administrator.id !== "string" ||
    typeof value.administrator.username !== "string" ||
    typeof value.workspace.id !== "string" ||
    typeof value.workspace.name !== "string"
  ) {
    throw new SetupClientError("invalid_response");
  }

  return {
    administrator: {
      displayName: value.administrator.displayName,
      id: value.administrator.id,
      username: value.administrator.username,
    },
    workspace: {
      id: value.workspace.id,
      name: value.workspace.name,
    },
  };
}

export const browserSetupClient: SetupClient = {
  async completeSetup(input) {
    const response = await fetch("/api/setup", {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const body = await readResponse(response);
    if (!response.ok) {
      throw new SetupClientError(errorCode(body));
    }
    return parseSetupResult(body);
  },

  async getStatus() {
    const response = await fetch("/api/setup/status", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readResponse(response);
    if (!response.ok) {
      throw new SetupClientError(errorCode(body));
    }
    return parseStatus(body);
  },
};
