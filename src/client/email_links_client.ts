import { jobBoardProviders, type JobBoardProvider } from "../domain/job_board";

export { jobBoardProviders, type JobBoardProvider } from "../domain/job_board";

export interface EmailLinkCandidate {
  externalPostingId: string | null;
  host: string;
  provider: JobBoardProvider;
  url: string;
}

export interface EmailLinksClient {
  extractJobLinks(content: string): Promise<EmailLinkCandidate[]>;
}

export class EmailLinksClientError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "EmailLinksClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJobBoardProvider(value: unknown): value is JobBoardProvider {
  return jobBoardProviders.some((provider) => provider === value);
}

function parseCandidate(value: unknown): EmailLinkCandidate {
  if (
    !isRecord(value) ||
    (value.externalPostingId !== null &&
      (typeof value.externalPostingId !== "string" ||
        value.externalPostingId.length < 1 ||
        value.externalPostingId.length > 128)) ||
    typeof value.host !== "string" ||
    value.host.length < 1 ||
    value.host.length > 253 ||
    !isJobBoardProvider(value.provider) ||
    typeof value.url !== "string" ||
    value.url.length > 2048
  ) {
    throw new EmailLinksClientError("invalid_response");
  }
  let parsed: URL;
  try {
    parsed = new URL(value.url);
  } catch {
    throw new EmailLinksClientError("invalid_response");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hostname.toLowerCase() !== value.host.toLowerCase()
  ) {
    throw new EmailLinksClientError("invalid_response");
  }
  return {
    externalPostingId: value.externalPostingId,
    host: value.host,
    provider: value.provider,
    url: value.url,
  };
}

export function jobBoardProviderLabel(provider: JobBoardProvider): string {
  switch (provider) {
    case "linkedin":
      return "LinkedIn";
    case "cv_library":
      return "CV-Library";
    case "indeed":
      return "Indeed";
    case "totaljobs":
      return "Totaljobs";
    case "michael_page":
      return "Michael Page";
    case "hackajob":
      return "hackajob";
    case "cord":
      return "Cord";
    case "talent":
      return "Talent.com";
    case "generic":
      return "Job site";
  }
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new EmailLinksClientError("invalid_response");
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

export const browserEmailLinksClient: EmailLinksClient = {
  async extractJobLinks(content) {
    const response = await fetch("/api/documents/email-links/extract", {
      body: JSON.stringify({ content }),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const body = await readResponse(response);
    if (!response.ok) throw new EmailLinksClientError(errorCode(body));
    if (
      !isRecord(body) ||
      !Array.isArray(body.links) ||
      body.links.length > 20
    ) {
      throw new EmailLinksClientError("invalid_response");
    }
    return body.links.map(parseCandidate);
  },
};
