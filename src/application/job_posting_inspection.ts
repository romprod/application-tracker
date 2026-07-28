import { DomUtils, parseDocument } from "htmlparser2";

import type { JobPostingInspectionInput } from "../domain/job_postings.js";
import { JobBoardProviderRegistry } from "./job_board_provider_registry.js";
import {
  maximumPublicHttpsResponseBytes,
  publicHttpsRequestTimeoutMs,
  type PublicHttpsReader,
  SecurePublicHttpsReader,
} from "../infrastructure/network/public_https_reader.js";

const maximumRedirects = 3;
const maximumDescriptionCharacters = 20_000;
const maximumMetadataNodes = 1_000;

export type JobPostingUnavailableReason =
  | "ambiguous_metadata"
  | "blocked"
  | "expired"
  | "fetch_failed"
  | "missing_structured_data"
  | "redirect_limit"
  | "unrecognized_url";

export interface AvailableJobPostingInspection {
  applyUrl: string | null;
  canonicalUrl: string;
  closingDate: string | null;
  description: string | null;
  employer: string | null;
  location: string | null;
  salary: string | null;
  status: "available";
  title: string | null;
  workArrangement: "hybrid" | "office" | "remote" | null;
}

export interface UnavailableJobPostingInspection {
  canonicalUrl: string | null;
  reason: JobPostingUnavailableReason;
  status: "unavailable";
}

export type JobPostingInspectionResult =
  AvailableJobPostingInspection | UnavailableJobPostingInspection;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, maximumLength) : null;
}

function jobPostingType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some(
    (type) =>
      typeof type === "string" &&
      type.toLowerCase().replace(/^https?:\/\/schema\.org\//, "") ===
        "jobposting",
  );
}

function collectJobPostings(value: unknown): JsonRecord[] {
  const postings: JsonRecord[] = [];
  let visited = 0;
  const visit = (candidate: unknown, depth: number) => {
    if (depth > 10 || visited >= maximumMetadataNodes) return;
    visited += 1;
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry, depth + 1);
      return;
    }
    if (!isRecord(candidate)) return;
    if (jobPostingType(candidate["@type"])) postings.push(candidate);
    for (const nested of Object.values(candidate)) visit(nested, depth + 1);
  };
  visit(value, 0);
  return postings;
}

function structuredJobPostings(html: string): JsonRecord[] {
  const document = parseDocument(html, { decodeEntities: true });
  const scripts = DomUtils.findAll(
    (element) =>
      element.name.toLowerCase() === "script" &&
      (element.attribs.type ?? "").toLowerCase().split(";", 1)[0]?.trim() ===
        "application/ld+json",
    document.children,
  ).slice(0, 20);
  const postings: JsonRecord[] = [];
  for (const script of scripts) {
    const source = DomUtils.textContent(script).trim();
    if (
      source.length === 0 ||
      source.length > maximumPublicHttpsResponseBytes
    ) {
      continue;
    }
    try {
      postings.push(...collectJobPostings(JSON.parse(source)));
    } catch {
      continue;
    }
  }
  return postings;
}

function explicitHttpsUrl(value: unknown, base: URL): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value, base);
    return parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      (parsed.port === "" || parsed.port === "443") &&
      parsed.href.length <= 2048
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function postingUrl(posting: JsonRecord, base: URL): string | null {
  const direct = explicitHttpsUrl(posting.url, base);
  if (direct) return direct;
  const action = posting.potentialAction;
  const actions = Array.isArray(action) ? action : [action];
  for (const candidate of actions) {
    if (!isRecord(candidate)) continue;
    const target = candidate.target;
    const targets = Array.isArray(target) ? target : [target];
    for (const targetCandidate of targets) {
      let value: unknown = targetCandidate;
      if (isRecord(targetCandidate)) value = targetCandidate.urlTemplate;
      const url = explicitHttpsUrl(value, base);
      if (url) return url;
    }
  }
  return null;
}

function matchingPosting(
  postings: JsonRecord[],
  canonicalUrl: URL,
  providers: JobBoardProviderRegistry,
): JsonRecord | undefined | null {
  if (postings.length === 1) return postings[0];
  const exact = postings.filter((posting) => {
    const url = postingUrl(posting, canonicalUrl);
    if (!url) return false;
    const match = providers.match(new URL(url));
    return match?.url.href === canonicalUrl.href;
  });
  return exact.length === 1 ? exact[0] : null;
}

function organizationName(value: unknown): string | null {
  if (typeof value === "string") return boundedText(value, 160);
  if (!isRecord(value)) return null;
  return boundedText(value.name, 160);
}

function addressText(value: unknown): string | null {
  if (typeof value === "string") return boundedText(value, 160);
  if (!isRecord(value)) return null;
  const address = isRecord(value.address) ? value.address : value;
  const parts = [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
    isRecord(address.addressCountry)
      ? (address.addressCountry.name ?? address.addressCountry["@id"])
      : address.addressCountry,
  ]
    .map((part) => boundedText(part, 80))
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ").slice(0, 160) : null;
}

function jobLocation(posting: JsonRecord): string | null {
  const values = Array.isArray(posting.jobLocation)
    ? posting.jobLocation
    : [posting.jobLocation];
  const locations = values
    .map(addressText)
    .filter((value): value is string => value !== null);
  return locations.length > 0
    ? [...new Set(locations)].join(" · ").slice(0, 160)
    : null;
}

function salaryText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return boundedText(String(value), 160);
  }
  if (!isRecord(value)) return null;
  const currency = boundedText(value.currency, 12);
  const quantified = isRecord(value.value) ? value.value : value;
  const minimum = quantified.minValue;
  const maximum = quantified.maxValue;
  const exact = quantified.value;
  const amount =
    (typeof minimum === "number" || typeof minimum === "string") &&
    (typeof maximum === "number" || typeof maximum === "string")
      ? `${String(minimum)}–${String(maximum)}`
      : typeof exact === "number" || typeof exact === "string"
        ? String(exact)
        : null;
  const unit = boundedText(quantified.unitText, 24);
  return boundedText([currency, amount, unit].filter(Boolean).join(" "), 160);
}

function workArrangement(
  value: unknown,
): AvailableJobPostingInspection["workArrangement"] {
  const values = (Array.isArray(value) ? value : [value])
    .map((entry) => boundedText(entry, 80)?.toLowerCase())
    .filter((entry): entry is string => Boolean(entry));
  if (values.some((entry) => entry.includes("telecommute"))) return "remote";
  if (values.some((entry) => entry.includes("hybrid"))) return "hybrid";
  if (
    values.some(
      (entry) => entry.includes("onsite") || entry.includes("on-site"),
    )
  ) {
    return "office";
  }
  return null;
}

function plainDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const separated = value.replace(
    /<\/?(?:article|blockquote|br|div|h[1-6]|li|ol|p|section|table|td|th|tr|ul)\b[^>]*>/gi,
    " ",
  );
  const document = parseDocument(separated, { decodeEntities: true });
  return boundedText(
    DomUtils.innerText(document.children),
    maximumDescriptionCharacters,
  );
}

function closingDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(value.trim());
  if (!match || Number.isNaN(Date.parse(value))) return null;
  return match[1] ?? null;
}

function isExpired(value: unknown, now: Date): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value < now.toISOString().slice(0, 10);
  }
  return parsed < now.getTime();
}

function redirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function blockedStatus(status: number): boolean {
  return [401, 403, 407, 409, 423, 429, 451].includes(status);
}

export class JobPostingInspectionService {
  public constructor(
    private readonly providers = new JobBoardProviderRegistry(),
    private readonly reader: PublicHttpsReader = new SecurePublicHttpsReader(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async inspect(
    input: JobPostingInspectionInput,
  ): Promise<JobPostingInspectionResult> {
    let requested: URL;
    try {
      requested = new URL(input.url);
    } catch {
      return {
        canonicalUrl: null,
        reason: "unrecognized_url",
        status: "unavailable",
      };
    }
    const initial = this.providers.match(requested);
    if (!initial) {
      return {
        canonicalUrl: null,
        reason: "unrecognized_url",
        status: "unavailable",
      };
    }

    let canonicalUrl = initial.url;
    const deadline = this.clock().getTime() + publicHttpsRequestTimeoutMs;
    for (let redirectsFollowed = 0; ; redirectsFollowed += 1) {
      let response;
      try {
        response = await this.reader.read(canonicalUrl, {
          includeBody: true,
          maxBytes: maximumPublicHttpsResponseBytes,
          timeoutMs: Math.min(
            publicHttpsRequestTimeoutMs,
            Math.max(1, deadline - this.clock().getTime()),
          ),
        });
      } catch {
        return {
          canonicalUrl: canonicalUrl.href,
          reason: "fetch_failed",
          status: "unavailable",
        };
      }

      if (redirectStatus(response.status)) {
        if (redirectsFollowed >= maximumRedirects) {
          return {
            canonicalUrl: canonicalUrl.href,
            reason: "redirect_limit",
            status: "unavailable",
          };
        }
        if (!response.location) {
          return {
            canonicalUrl: canonicalUrl.href,
            reason: "blocked",
            status: "unavailable",
          };
        }
        let redirected: URL;
        try {
          redirected = new URL(response.location, canonicalUrl);
        } catch {
          return {
            canonicalUrl: canonicalUrl.href,
            reason: "blocked",
            status: "unavailable",
          };
        }
        const next = this.providers.match(redirected);
        if (!next) {
          return {
            canonicalUrl: canonicalUrl.href,
            reason: "blocked",
            status: "unavailable",
          };
        }
        canonicalUrl = next.url;
        continue;
      }
      if (response.status === 404 || response.status === 410) {
        return {
          canonicalUrl: canonicalUrl.href,
          reason: "expired",
          status: "unavailable",
        };
      }
      if (
        response.status < 200 ||
        response.status >= 300 ||
        blockedStatus(response.status) ||
        !response.contentType
          ?.toLowerCase()
          .match(/^(?:text\/html\b|application\/xhtml\+xml\b)/)
      ) {
        return {
          canonicalUrl: canonicalUrl.href,
          reason: "blocked",
          status: "unavailable",
        };
      }

      const postings = structuredJobPostings(response.body);
      if (postings.length === 0) {
        return {
          canonicalUrl: canonicalUrl.href,
          reason: "missing_structured_data",
          status: "unavailable",
        };
      }
      const posting = matchingPosting(postings, canonicalUrl, this.providers);
      if (!posting) {
        return {
          canonicalUrl: canonicalUrl.href,
          reason: "ambiguous_metadata",
          status: "unavailable",
        };
      }
      if (isExpired(posting.validThrough, this.clock())) {
        return {
          canonicalUrl: canonicalUrl.href,
          reason: "expired",
          status: "unavailable",
        };
      }
      return {
        applyUrl: postingUrl(posting, canonicalUrl),
        canonicalUrl: canonicalUrl.href,
        closingDate: closingDate(posting.validThrough),
        description: plainDescription(posting.description),
        employer: organizationName(posting.hiringOrganization),
        location: jobLocation(posting),
        salary: salaryText(posting.baseSalary),
        status: "available",
        title: boundedText(posting.title, 160),
        workArrangement: workArrangement(posting.jobLocationType),
      };
    }
  }
}
