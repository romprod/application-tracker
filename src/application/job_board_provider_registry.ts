import { Buffer } from "node:buffer";
import type { JobBoardProvider } from "../domain/job_board.js";

export interface JobBoardMatch {
  externalPostingId: string | null;
  provider: JobBoardProvider;
  url: URL;
}

export interface JobBoardAdapter {
  match(url: URL): JobBoardMatch | undefined;
  provider: JobBoardProvider;
}

const knownGenericJobHosts = [
  "ashbyhq.com",
  "bamboohr.com",
  "greenhouse.io",
  "icims.com",
  "jobvite.com",
  "lever.co",
  "myworkdayjobs.com",
  "recruitee.com",
  "smartrecruiters.com",
  "taleo.net",
  "teamtailor.com",
  "workable.com",
  "workday.com",
] as const;

const jobPathPattern =
  /(?:^|\/)(?:careers?|jobs?|openings?|opportunities|positions?|roles?|vacancies)(?:\/|$)/i;
const noisePattern =
  /(?:^|\/)(?:help|privacy|preferences|support|terms|unsubscribe)(?:\/|$)/i;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hostMatches(url: URL, hostname: string): boolean {
  const actual = url.hostname.toLowerCase();
  return actual === hostname || actual.endsWith(`.${hostname}`);
}

function firstPathMatch(url: URL, pattern: RegExp): string | null {
  return pattern.exec(url.pathname)?.[1] ?? null;
}

function canonicalUrl(origin: string, pathname: string): URL {
  return new URL(pathname, origin);
}

function decodedUrl(value: string, base?: string): URL | undefined {
  if (value.length > 2048) return undefined;
  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return undefined;
  }
}

function embeddedClickTarget(url: URL): URL | undefined {
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "email-send.cord.co" &&
    hostname !== "links.connect.hackajob.com"
  ) {
    return undefined;
  }
  const prefix = "/CL0/";
  const marker = url.pathname.lastIndexOf("/1/");
  if (!url.pathname.startsWith(prefix) || marker <= prefix.length) {
    return undefined;
  }
  try {
    return decodedUrl(
      decodeURIComponent(url.pathname.slice(prefix.length, marker)),
    );
  } catch {
    return undefined;
  }
}

function base64UrlJson(value: string): unknown {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(value)) return undefined;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

function hackajobClickTarget(url: URL): URL | undefined {
  if (
    url.hostname.toLowerCase() !== "cio.mail-hackajob.com" &&
    url.hostname.toLowerCase() !== "cio.hackajob.com"
  ) {
    return undefined;
  }
  const encoded = /^\/e\/c\/([^/]+)/.exec(url.pathname)?.[1];
  if (!encoded) return undefined;
  const decoded = base64UrlJson(encoded);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !("href" in decoded) ||
    typeof decoded.href !== "string"
  ) {
    return undefined;
  }
  return decodedUrl(decoded.href);
}

function nestedProviderTarget(url: URL): URL {
  const embedded = embeddedClickTarget(url) ?? hackajobClickTarget(url);
  return embedded ?? url;
}

function hackajobPostingTarget(url: URL): URL {
  const redirect = url.searchParams.get("redirect");
  if (!redirect) return url;
  return decodedUrl(redirect, "https://user.hackajob.com") ?? url;
}

function totaljobsPostingId(url: URL): string | null {
  const queryId =
    url.searchParams.get("JobId") ?? url.searchParams.get("jobId");
  if (queryId && /^\d+$/.test(queryId)) return queryId;
  const pathId = firstPathMatch(url, /\/job\/(\d+)(?:\/|$)/i);
  if (pathId) return pathId;
  const returnUrl = url.searchParams.get("returnUrl");
  if (!returnUrl) return null;
  const nested = decodedUrl(returnUrl, "https://www.totaljobs.com");
  return nested ? totaljobsPostingId(nested) : null;
}

const linkedinAdapter: JobBoardAdapter = {
  provider: "linkedin",
  match(url) {
    if (!hostMatches(url, "linkedin.com")) return undefined;
    const id = firstPathMatch(url, /\/(?:comm\/)?jobs\/view\/(\d+)(?:\/|$)/i);
    if (!id) return undefined;
    return {
      externalPostingId: id,
      provider: this.provider,
      url: canonicalUrl("https://www.linkedin.com", `/jobs/view/${id}`),
    };
  },
};

const cvLibraryAdapter: JobBoardAdapter = {
  provider: "cv_library",
  match(url) {
    if (!hostMatches(url, "cv-library.co.uk")) return undefined;
    const id =
      firstPathMatch(url, /\/job\/apply\/(\d+)(?:\/|$)/i) ??
      firstPathMatch(url, /\/job\/(\d+)(?:\/|$)/i);
    if (!id) return undefined;
    return {
      externalPostingId: id,
      provider: this.provider,
      url: canonicalUrl("https://www.cv-library.co.uk", `/job/${id}`),
    };
  },
};

const indeedAdapter: JobBoardAdapter = {
  provider: "indeed",
  match(url) {
    if (!hostMatches(url, "indeed.com")) return undefined;
    const id =
      url.searchParams.get("jk") ??
      url.searchParams.get("vjk") ??
      firstPathMatch(url, /-([0-9a-f]{16})(?:\/|$)/i);
    if (!id || !/^[0-9a-z-]{8,128}$/i.test(id)) return undefined;
    const origin = `https://${url.hostname.toLowerCase()}`;
    const canonical = canonicalUrl(origin, "/viewjob");
    canonical.searchParams.set("jk", id);
    return {
      externalPostingId: id,
      provider: this.provider,
      url: canonical,
    };
  },
};

const totaljobsAdapter: JobBoardAdapter = {
  provider: "totaljobs",
  match(url) {
    if (!hostMatches(url, "totaljobs.com")) return undefined;
    const id = totaljobsPostingId(url);
    if (!id) return undefined;
    return {
      externalPostingId: id,
      provider: this.provider,
      url: canonicalUrl("https://www.totaljobs.com", `/job/${id}`),
    };
  },
};

const michaelPageAdapter: JobBoardAdapter = {
  provider: "michael_page",
  match(url) {
    if (!hostMatches(url, "michaelpage.co.uk")) return undefined;
    const id = firstPathMatch(url, /\/ref\/(jn-\d{6}-\d+)(?:\/|$)/i);
    if (!id) return undefined;
    return {
      externalPostingId: id.toLowerCase(),
      provider: this.provider,
      url: canonicalUrl(
        "https://www.michaelpage.co.uk",
        url.pathname.replace(
          /(\/ref\/)jn-\d{6}-\d+(?:\/|$)/i,
          `$1${id.toLowerCase()}`,
        ),
      ),
    };
  },
};

const hackajobAdapter: JobBoardAdapter = {
  provider: "hackajob",
  match(input) {
    const url = hackajobPostingTarget(nestedProviderTarget(input));
    if (!hostMatches(url, "hackajob.com")) return undefined;
    const id = firstPathMatch(url, /\/(?:apply|job)\/([^/]+)(?:\/|$)/i);
    if (!id || !uuidPattern.test(id)) return undefined;
    return {
      externalPostingId: id.toLowerCase(),
      provider: this.provider,
      url: canonicalUrl("https://user.hackajob.com", `/apply/${id}`),
    };
  },
};

const cordAdapter: JobBoardAdapter = {
  provider: "cord",
  match(input) {
    const url = nestedProviderTarget(input);
    if (!hostMatches(url, "cord.com") && !hostMatches(url, "cord.co")) {
      return undefined;
    }
    const id = firstPathMatch(url, /\/jobs\/(\d+)(?:[-/]|$)/i);
    if (!id) return undefined;
    const canonical = new URL(url.href);
    canonical.hash = "";
    canonical.search = "";
    return {
      externalPostingId: id,
      provider: this.provider,
      url: canonical,
    };
  },
};

const talentAdapter: JobBoardAdapter = {
  provider: "talent",
  match(url) {
    if (!hostMatches(url, "talent.com")) return undefined;
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) return undefined;
    const canonical = canonicalUrl(`https://${url.hostname}`, url.pathname);
    canonical.searchParams.set("id", id);
    return {
      externalPostingId: id,
      provider: this.provider,
      url: canonical,
    };
  },
};

const genericAdapter: JobBoardAdapter = {
  provider: "generic",
  match(url) {
    if (noisePattern.test(url.pathname)) return undefined;
    const hostname = url.hostname.toLowerCase();
    if (
      !knownGenericJobHosts.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`),
      ) &&
      !jobPathPattern.test(url.pathname)
    ) {
      return undefined;
    }
    const canonical = new URL(url.href);
    canonical.hash = "";
    return {
      externalPostingId: null,
      provider: this.provider,
      url: canonical,
    };
  },
};

export const defaultJobBoardAdapters: readonly JobBoardAdapter[] = [
  linkedinAdapter,
  cvLibraryAdapter,
  indeedAdapter,
  totaljobsAdapter,
  michaelPageAdapter,
  hackajobAdapter,
  cordAdapter,
  talentAdapter,
  genericAdapter,
];

export class JobBoardProviderRegistry {
  public constructor(
    private readonly adapters: readonly JobBoardAdapter[] = defaultJobBoardAdapters,
  ) {}

  public match(url: URL): JobBoardMatch | undefined {
    for (const adapter of this.adapters) {
      const matched = adapter.match(url);
      if (matched) return matched;
    }
    return undefined;
  }
}
