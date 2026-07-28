import type {
  EmailLinkCandidate,
  EmailLinkExtractionService,
} from "./email_links.js";
import type { EmailLinkExtractionInput } from "../domain/email_links.js";
import { JobBoardProviderRegistry } from "./job_board_provider_registry.js";
import {
  publicHttpsRequestTimeoutMs,
  type PublicHttpsReader,
  SecurePublicHttpsReader,
} from "../infrastructure/network/public_https_reader.js";

export const allowedJobTrackingHosts = ["cts.indeed.com"] as const;
const maximumTrackingLinks = 5;
const maximumRedirects = 3;
const urlPattern = /https:\/\/[^\s<>"'`]+/gi;
const encodedAmpersandPattern = /(?:&amp;|&#38;|&#x26;)/gi;
const urlContinuationPunctuation = /[-._~:/?#[\]@!$&()*+,;=%]/;

export interface ResolvedJobLinkCandidate extends EmailLinkCandidate {
  redirectsFollowed: number;
  resolution: "deterministic" | "tracking_redirect";
}

export interface UnavailableJobLink {
  host: string;
  reason:
    | "fetch_failed"
    | "invalid_redirect"
    | "redirect_limit"
    | "redirect_not_allowed"
    | "unrecognized_destination";
}

export interface JobLinkResolutionResult {
  candidates: ResolvedJobLinkCandidate[];
  tracking: {
    attempted: number;
    resolved: number;
    unavailable: UnavailableJobLink[];
  };
}

function decodeQuotedPrintable(value: string): string {
  if (!/^content-transfer-encoding:\s*quoted-printable\s*$/im.test(value)) {
    return value;
  }
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function compactDelimitedUrl(
  match: string,
  prefix: string,
  url: string,
  suffix: string,
): string {
  if (!/\r?\n/.test(url)) return match;
  const compact = url.replace(/\r?\n[ \t]*/g, "");
  return compact.length <= 2048 ? `${prefix}${compact}${suffix}` : match;
}

function joinWrappedUrls(value: string): string {
  let joined = value
    .replace(/(\]\(\s*)(https:\/\/[^)]{1,4096})(\))/gi, compactDelimitedUrl)
    .replace(
      /(\bhref\s*=\s*")(https:\/\/[^"]{1,4096})(")/gi,
      compactDelimitedUrl,
    )
    .replace(
      /(\bhref\s*=\s*')(https:\/\/[^']{1,4096})(')/gi,
      compactDelimitedUrl,
    );
  for (let index = 0; index < 20; index += 1) {
    const next = joined.replace(
      /(https:\/\/[^\s<>"'`]{1,2048})\r?\n([^\s<>"'`])/gi,
      (match, before: string, after: string) => {
        const previous = before.at(-1) ?? "";
        return urlContinuationPunctuation.test(previous) ||
          urlContinuationPunctuation.test(after)
          ? `${before}${after}`
          : match;
      },
    );
    if (next === joined) break;
    joined = next;
  }
  return joined;
}

function unwrapTransparentRedirect(url: URL): URL {
  const hostname = url.hostname.toLowerCase();
  const nested = hostname.endsWith(".safelinks.protection.outlook.com")
    ? url.searchParams.get("url")
    : (hostname === "google.com" || hostname.endsWith(".google.com")) &&
        url.pathname === "/url"
      ? (url.searchParams.get("q") ?? url.searchParams.get("url"))
      : null;
  if (!nested || nested.length > 2048) return url;
  try {
    return new URL(nested);
  } catch {
    return url;
  }
}

function trackingUrls(content: string): URL[] {
  const urls: URL[] = [];
  const seen = new Set<string>();
  const decoded = joinWrappedUrls(decodeQuotedPrintable(content)).replace(
    encodedAmpersandPattern,
    "&",
  );
  for (const match of decoded.matchAll(urlPattern)) {
    if (urls.length >= maximumTrackingLinks) break;
    const raw = match[0].replace(/[),.;:!?\]}]+$/g, "");
    let url: URL;
    try {
      url = unwrapTransparentRedirect(new URL(raw));
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (
      !allowedJobTrackingHosts.includes(
        host as (typeof allowedJobTrackingHosts)[number],
      ) ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.href.length > 2048 ||
      seen.has(url.href)
    ) {
      continue;
    }
    seen.add(url.href);
    urls.push(url);
  }
  return urls;
}

function candidateFromMatch(
  match: ReturnType<JobBoardProviderRegistry["match"]>,
  resolution: ResolvedJobLinkCandidate["resolution"],
  redirectsFollowed: number,
): ResolvedJobLinkCandidate | undefined {
  return match
    ? {
        externalPostingId: match.externalPostingId,
        host: match.url.hostname.toLowerCase(),
        provider: match.provider,
        redirectsFollowed,
        resolution,
        url: match.url.href,
      }
    : undefined;
}

function redirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

export class JobLinkResolutionService {
  public constructor(
    private readonly extractor: EmailLinkExtractionService,
    private readonly providers = new JobBoardProviderRegistry(),
    private readonly reader: PublicHttpsReader = new SecurePublicHttpsReader(),
    private readonly clock: () => number = Date.now,
  ) {}

  public async resolve(
    input: EmailLinkExtractionInput,
  ): Promise<JobLinkResolutionResult> {
    const deterministic: ResolvedJobLinkCandidate[] = this.extractor
      .extract(input)
      .map((candidate) => ({
        ...candidate,
        redirectsFollowed: 0,
        resolution: "deterministic",
      }));
    const seen = new Set(deterministic.map(({ url }) => url));
    const unresolvedTracking = trackingUrls(input.content)
      .filter((url) => !this.providers.match(url))
      .slice(0, Math.max(0, 20 - deterministic.length));
    const outcomes = await Promise.all(
      unresolvedTracking.map((url) => this.resolveTrackingUrl(url)),
    );
    const candidates = [...deterministic];
    const unavailable: UnavailableJobLink[] = [];
    for (const outcome of outcomes) {
      if ("candidate" in outcome) {
        if (!seen.has(outcome.candidate.url)) {
          seen.add(outcome.candidate.url);
          candidates.push(outcome.candidate);
        }
      } else {
        unavailable.push(outcome.unavailable);
      }
    }
    return {
      candidates: candidates.slice(0, 20),
      tracking: {
        attempted: unresolvedTracking.length,
        resolved: outcomes.filter((outcome) => "candidate" in outcome).length,
        unavailable,
      },
    };
  }

  private async resolveTrackingUrl(
    initialUrl: URL,
  ): Promise<
    | { candidate: ResolvedJobLinkCandidate }
    | { unavailable: UnavailableJobLink }
  > {
    const deadline = this.clock() + publicHttpsRequestTimeoutMs;
    let current = initialUrl;
    for (let redirectsFollowed = 0; ; redirectsFollowed += 1) {
      const timeoutMs = Math.min(
        publicHttpsRequestTimeoutMs,
        Math.max(1, deadline - this.clock()),
      );
      let response;
      try {
        response = await this.reader.read(current, {
          includeBody: false,
          maxBytes: 0,
          timeoutMs,
        });
      } catch {
        return {
          unavailable: {
            host: initialUrl.hostname.toLowerCase(),
            reason: "fetch_failed",
          },
        };
      }

      const currentMatch = this.providers.match(current);
      const candidate = candidateFromMatch(
        currentMatch,
        "tracking_redirect",
        redirectsFollowed,
      );
      if (candidate) return { candidate };

      if (!redirectStatus(response.status)) {
        return {
          unavailable: {
            host: initialUrl.hostname.toLowerCase(),
            reason: "unrecognized_destination",
          },
        };
      }
      if (redirectsFollowed >= maximumRedirects) {
        return {
          unavailable: {
            host: initialUrl.hostname.toLowerCase(),
            reason: "redirect_limit",
          },
        };
      }
      if (!response.location) {
        return {
          unavailable: {
            host: initialUrl.hostname.toLowerCase(),
            reason: "invalid_redirect",
          },
        };
      }

      let next: URL;
      try {
        next = new URL(response.location, current);
      } catch {
        return {
          unavailable: {
            host: initialUrl.hostname.toLowerCase(),
            reason: "invalid_redirect",
          },
        };
      }
      const finalCandidate = candidateFromMatch(
        this.providers.match(next),
        "tracking_redirect",
        redirectsFollowed + 1,
      );
      if (finalCandidate) return { candidate: finalCandidate };
      if (
        next.protocol !== "https:" ||
        next.username !== "" ||
        next.password !== "" ||
        next.port !== "" ||
        !allowedJobTrackingHosts.includes(
          next.hostname.toLowerCase() as (typeof allowedJobTrackingHosts)[number],
        )
      ) {
        return {
          unavailable: {
            host: initialUrl.hostname.toLowerCase(),
            reason: "redirect_not_allowed",
          },
        };
      }
      current = next;
    }
  }
}
