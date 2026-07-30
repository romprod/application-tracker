import { z } from "zod";

import type {
  JobBoardMatch,
  JobBoardProviderRegistry,
} from "./job_board_provider_registry.js";
import type { JobBoardProvider } from "../domain/job_board.js";

const workerProtocolVersion = 1;
const minimumWorkerTokenCharacters = 32;

const browserFallbackUnavailableReasonSchema = z.enum([
  "ambiguous_metadata",
  "blocked",
  "expired",
  "malformed_structured_data",
  "missing_structured_data",
  "navigation_timeout",
  "provider_challenge",
  "resource_exhausted",
  "worker_disabled",
  "worker_failure",
]);

const commonWorkerResponseSchema = z.strictObject({
  blockedRequests: z.number().int().min(0).max(1000),
  canonicalUrl: z.url({ protocol: /^https$/ }),
  version: z.literal(workerProtocolVersion),
});

const availableWorkerResponseSchema = commonWorkerResponseSchema.extend({
  posting: z.record(z.string(), z.unknown()),
  status: z.literal("available"),
});

const unavailableWorkerResponseSchema = commonWorkerResponseSchema.extend({
  reason: browserFallbackUnavailableReasonSchema,
  retryAfter: z.iso.datetime().optional(),
  status: z.literal("unavailable"),
});

const workerResponseSchema = z.discriminatedUnion("status", [
  availableWorkerResponseSchema,
  unavailableWorkerResponseSchema,
]);

export type BrowserFallbackUnavailableReason = z.infer<
  typeof browserFallbackUnavailableReasonSchema
>;

export interface AvailableBrowserFallbackInspection {
  blockedRequests: number;
  canonicalUrl: string;
  posting: Record<string, unknown>;
  status: "available";
}

export interface UnavailableBrowserFallbackInspection {
  blockedRequests: number;
  canonicalUrl: string;
  reason: BrowserFallbackUnavailableReason;
  retryAfter?: string;
  status: "unavailable";
}

export type BrowserFallbackInspection =
  AvailableBrowserFallbackInspection | UnavailableBrowserFallbackInspection;

export interface JobPostingBrowserFallback {
  inspect(match: JobBoardMatch): Promise<BrowserFallbackInspection>;
  supports(provider: JobBoardProvider): boolean;
}

export interface JobPostingBrowserFallbackConfig {
  enabled: boolean;
  navigationTimeoutMs: number;
  providers: readonly JobBoardProvider[];
  responseMaxBytes: number;
  token?: string;
  workerUrl: string;
}

export interface BrowserFallbackTelemetryEvent {
  blockedRequests: number;
  durationMs: number;
  outcome: "available" | "unavailable";
  provider: JobBoardProvider;
  reason: BrowserFallbackUnavailableReason | "none";
}

export type BrowserFallbackTelemetry = (
  event: BrowserFallbackTelemetryEvent,
) => void;

type WorkerFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

function unavailable(
  match: JobBoardMatch,
  reason: BrowserFallbackUnavailableReason,
): UnavailableBrowserFallbackInspection {
  return {
    blockedRequests: 0,
    canonicalUrl: match.url.href,
    reason,
    status: "unavailable",
  };
}

async function boundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("Camoufox worker response is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let result = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw new Error("Camoufox worker response is too large");
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

function validatedWorkerUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "camoufox-worker" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "8080" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Invalid Camoufox worker URL");
  }
  return url;
}

export class CamoufoxJobPostingBrowserFallback implements JobPostingBrowserFallback {
  private readonly workerUrl: URL;

  public constructor(
    private readonly config: JobPostingBrowserFallbackConfig,
    private readonly workerFetch: WorkerFetch = fetch,
    private readonly clock: () => number = Date.now,
    private readonly telemetry: BrowserFallbackTelemetry = () => undefined,
  ) {
    this.workerUrl = validatedWorkerUrl(config.workerUrl);
    if (
      config.enabled &&
      (!config.token ||
        config.token.length < minimumWorkerTokenCharacters ||
        config.token.length > 512)
    ) {
      throw new Error(
        "Enabled Camoufox fallback requires a strong worker token",
      );
    }
  }

  public supports(provider: JobBoardProvider): boolean {
    return this.config.enabled && this.config.providers.includes(provider);
  }

  public async inspect(
    match: JobBoardMatch,
  ): Promise<BrowserFallbackInspection> {
    if (!this.supports(match.provider)) {
      return unavailable(match, "worker_disabled");
    }
    const startedAt = this.clock();
    let result: BrowserFallbackInspection;
    try {
      result = await this.request(match);
    } catch {
      result = unavailable(match, "worker_failure");
    }
    this.telemetry({
      blockedRequests: result.blockedRequests,
      durationMs: Math.max(0, this.clock() - startedAt),
      outcome: result.status,
      provider: match.provider,
      reason: result.status === "available" ? "none" : result.reason,
    });
    return result;
  }

  private async request(
    match: JobBoardMatch,
  ): Promise<BrowserFallbackInspection> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.navigationTimeoutMs + 2_000,
    );
    timer.unref();
    try {
      const endpoint = new URL("/v1/inspect", this.workerUrl);
      const response = await this.workerFetch(endpoint, {
        body: JSON.stringify({
          canonicalUrl: match.url.href,
          provider: match.provider,
        }),
        headers: {
          Authorization: `Bearer ${this.config.token ?? ""}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) return unavailable(match, "worker_failure");
      const source = await boundedResponseText(
        response,
        this.config.responseMaxBytes,
      );
      const parsed = workerResponseSchema.safeParse(JSON.parse(source));
      if (!parsed.success || parsed.data.canonicalUrl !== match.url.href) {
        return unavailable(match, "worker_failure");
      }
      if (parsed.data.status === "available") {
        return {
          blockedRequests: parsed.data.blockedRequests,
          canonicalUrl: parsed.data.canonicalUrl,
          posting: parsed.data.posting,
          status: "available",
        };
      }
      return {
        blockedRequests: parsed.data.blockedRequests,
        canonicalUrl: parsed.data.canonicalUrl,
        reason: parsed.data.reason,
        ...(parsed.data.retryAfter
          ? { retryAfter: parsed.data.retryAfter }
          : {}),
        status: "unavailable",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class DisabledJobPostingBrowserFallback implements JobPostingBrowserFallback {
  public supports(): boolean {
    return false;
  }

  public inspect(match: JobBoardMatch): Promise<BrowserFallbackInspection> {
    return Promise.resolve(unavailable(match, "worker_disabled"));
  }
}

export function exactBrowserCanaryMatch(
  providers: JobBoardProviderRegistry,
  value: string,
): JobBoardMatch | undefined {
  let requested: URL;
  try {
    requested = new URL(value);
  } catch {
    return undefined;
  }
  const match = providers.match(requested);
  return match?.provider === "indeed" && match.url.href === requested.href
    ? match
    : undefined;
}
