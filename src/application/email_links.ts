import type { EmailLinkExtractionInput } from "../domain/email_links.js";
import type { JobBoardProvider } from "../domain/job_board.js";
import { JobBoardProviderRegistry } from "./job_board_provider_registry.js";

export interface EmailLinkCandidate {
  externalPostingId: string | null;
  host: string;
  provider: JobBoardProvider;
  url: string;
}
const urlPattern = /https?:\/\/[^\s<>"'`]+/gi;
const encodedAmpersandPattern = /(?:&amp;|&#38;|&#x26;)/gi;
const urlContinuationPunctuation = /[-._~:/?#[\]@!$&()*+,;=%]/;

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
    .replace(/(\]\(\s*)(https?:\/\/[^)]{1,4096})(\))/gi, compactDelimitedUrl)
    .replace(
      /(\bhref\s*=\s*")(https?:\/\/[^"]{1,4096})(")/gi,
      compactDelimitedUrl,
    )
    .replace(
      /(\bhref\s*=\s*')(https?:\/\/[^']{1,4096})(')/gi,
      compactDelimitedUrl,
    );

  for (let index = 0; index < 20; index += 1) {
    const next = joined.replace(
      /(https?:\/\/[^\s<>"'`]{1,2048})\r?\n([^\s<>"'`])/gi,
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

export class EmailLinkExtractionService {
  public constructor(
    private readonly providers = new JobBoardProviderRegistry(),
  ) {}

  public extract(input: EmailLinkExtractionInput): EmailLinkCandidate[] {
    const candidates: EmailLinkCandidate[] = [];
    const seen = new Set<string>();
    const content = joinWrappedUrls(decodeQuotedPrintable(input.content));
    for (const match of content.matchAll(urlPattern)) {
      if (candidates.length >= 20) break;
      const raw = cleanCandidate(match[0]);
      let parsed: URL;
      try {
        parsed = unwrapRedirect(new URL(raw));
      } catch {
        continue;
      }
      if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.username !== "" ||
        parsed.password !== "" ||
        parsed.href.length > 2048
      ) {
        continue;
      }
      const provider = this.providers.match(parsed);
      if (!provider) continue;
      const normalized = provider.url.href;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      candidates.push({
        externalPostingId: provider.externalPostingId,
        host: provider.url.hostname.toLowerCase(),
        provider: provider.provider,
        url: normalized,
      });
    }
    return candidates;
  }
}
