import type { EmailLinkExtractionInput } from "../domain/email_links.js";

export interface EmailLinkCandidate {
  host: string;
  url: string;
}

const knownJobHosts = [
  "ashbyhq.com",
  "bamboohr.com",
  "greenhouse.io",
  "icims.com",
  "indeed.com",
  "jobvite.com",
  "lever.co",
  "linkedin.com",
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
const urlPattern = /https?:\/\/[^\s<>"'`]+/gi;
const encodedAmpersandPattern = /(?:&amp;|&#38;|&#x26;)/gi;

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

function cleanCandidate(value: string): string {
  return value
    .replace(encodedAmpersandPattern, "&")
    .replace(/[),.;:!?\]}]+$/g, "");
}

function unwrapRedirect(url: URL): URL {
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

function isLikelyJobUrl(url: URL): boolean {
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.href.length > 2048 ||
    noisePattern.test(url.pathname)
  ) {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) {
    return /(?:^|\/)jobs(?:\/|$)/i.test(url.pathname);
  }
  if (hostname === "indeed.com" || hostname.endsWith(".indeed.com")) {
    return /(?:^|\/)(?:jobs?|viewjob)(?:\/|$)/i.test(url.pathname);
  }
  return (
    knownJobHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    ) || jobPathPattern.test(url.pathname)
  );
}

export class EmailLinkExtractionService {
  public extract(input: EmailLinkExtractionInput): EmailLinkCandidate[] {
    const candidates: EmailLinkCandidate[] = [];
    const seen = new Set<string>();
    const content = decodeQuotedPrintable(input.content);
    for (const match of content.matchAll(urlPattern)) {
      if (candidates.length >= 20) break;
      const raw = cleanCandidate(match[0]);
      let parsed: URL;
      try {
        parsed = unwrapRedirect(new URL(raw));
      } catch {
        continue;
      }
      if (!isLikelyJobUrl(parsed)) continue;
      parsed.hash = "";
      const normalized = parsed.href;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      candidates.push({ host: parsed.hostname.toLowerCase(), url: normalized });
    }
    return candidates;
  }
}
