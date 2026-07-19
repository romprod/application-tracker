export interface EmailLinkCandidate {
  host: string;
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

function parseCandidate(value: unknown): EmailLinkCandidate {
  if (
    !isRecord(value) ||
    typeof value.host !== "string" ||
    value.host.length < 1 ||
    value.host.length > 253 ||
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
  return { host: value.host, url: value.url };
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
