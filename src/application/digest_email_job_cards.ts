import { DomUtils, parseDocument } from "htmlparser2";
import { isTag, type Element } from "domhandler";

import type { AvailableJobPostingInspection } from "./job_posting_inspection.js";
import { JobBoardProviderRegistry } from "./job_board_provider_registry.js";

const maximumCardElements = 100;
const maximumCardTextCharacters = 4_000;
const maximumIdentityCharacters = 160;
const maximumCardAncestors = 8;
const supportedCardElements = new Set([
  "article",
  "div",
  "li",
  "section",
  "table",
  "tbody",
  "td",
  "tr",
]);
const genericLinkText =
  /^(?:apply(?: now)?|details?|find out more|job|learn more|open|read more|see (?:details|job|role)|view(?: details| job| role)?|visit)$/i;
const htmlUrlPattern = /^https:\/\//i;
const textUrlPattern = /https:\/\/[^\s<>"'`]+/gi;

interface DigestCardIdentity {
  canonicalUrl: string;
  employer: string;
  title: string;
}

function identityText(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= maximumIdentityCharacters
    ? normalized
    : null;
}

function identityKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-GB");
}

function oneIdentity(values: string[]): string | null {
  const unique = new Map<string, string>();
  for (const value of values) {
    const bounded = identityText(value);
    if (bounded) unique.set(identityKey(bounded), bounded);
  }
  return unique.size === 1 ? [...unique.values()][0]! : null;
}

function signalText(element: Element): string {
  return [
    element.name,
    element.attribs.class,
    element.attribs.id,
    element.attribs.itemprop,
    element.attribs["data-testid"],
    element.attribs["data-qa"],
    element.attribs["data-test"],
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/[-_]/g, " ")
    .toLowerCase();
}

function hasTitleSignal(element: Element): boolean {
  return (
    /\b(?:job|role|position)\s*title\b/.test(signalText(element)) ||
    element.attribs["data-job-title"] !== undefined
  );
}

function hasEmployerSignal(element: Element): boolean {
  return (
    /\b(?:company(?:\s*name)?|employer|hiring\s*organization)\b/.test(
      signalText(element),
    ) ||
    element.attribs["data-company-name"] !== undefined ||
    element.attribs["data-employer"] !== undefined
  );
}

function descendants(element: Element): Element[] | null {
  const nested = DomUtils.findAll(() => true, element.children).slice(
    0,
    maximumCardElements,
  );
  return nested.length >= maximumCardElements ? null : [element, ...nested];
}

function hrefMatch(
  element: Element,
  providers: JobBoardProviderRegistry,
): ReturnType<JobBoardProviderRegistry["match"]> {
  const href = element.attribs.href;
  if (element.name !== "a" || !href || !htmlUrlPattern.test(href)) {
    return undefined;
  }
  try {
    return providers.match(new URL(href));
  } catch {
    return undefined;
  }
}

function supportedUrls(
  container: Element,
  providers: JobBoardProviderRegistry,
): string[] | null {
  const elements = descendants(container);
  if (!elements) return null;
  const urls = new Set<string>();
  for (const element of elements) {
    const match = hrefMatch(element, providers);
    if (match) urls.add(match.url.href);
  }
  return [...urls];
}

function labelledIdentity(text: string, label: "company" | "title"): string[] {
  const pattern =
    label === "company"
      ? /(?:^|\n)\s*(?:company|employer)\s*:\s*([^\n]{1,160})\s*(?=\n|$)/gi
      : /(?:^|\n)\s*(?:job title|role title|title)\s*:\s*([^\n]{1,160})\s*(?=\n|$)/gi;
  return [...text.matchAll(pattern)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

function cardIdentity(
  container: Element,
  postingLink: Element,
  canonicalUrl: string,
): DigestCardIdentity | null {
  const cardText = DomUtils.innerText(container.children);
  if (cardText.length === 0 || cardText.length > maximumCardTextCharacters) {
    return null;
  }
  const titleValues: string[] = [];
  const employerValues: string[] = [];
  const elements = descendants(container);
  if (!elements) return null;
  const linkText = identityText(DomUtils.innerText(postingLink.children));
  if (linkText && !genericLinkText.test(linkText)) titleValues.push(linkText);

  for (const element of elements) {
    if (hasTitleSignal(element)) {
      const attributeValue = element.attribs["data-job-title"];
      if (attributeValue) titleValues.push(attributeValue);
      titleValues.push(DomUtils.innerText(element.children));
    }
    if (hasEmployerSignal(element)) {
      const attributeValue =
        element.attribs["data-company-name"] ??
        element.attribs["data-employer"];
      if (attributeValue) employerValues.push(attributeValue);
      employerValues.push(DomUtils.innerText(element.children));
    }
  }
  titleValues.push(...labelledIdentity(cardText, "title"));
  employerValues.push(...labelledIdentity(cardText, "company"));
  const title = oneIdentity(titleValues);
  const employer = oneIdentity(employerValues);
  return title && employer ? { canonicalUrl, employer, title } : null;
}

function htmlCardIdentities(
  content: string,
  providers: JobBoardProviderRegistry,
): DigestCardIdentity[] {
  const document = parseDocument(content, { decodeEntities: true });
  const links = DomUtils.findAll(
    (element) => hrefMatch(element, providers) !== undefined,
    document.children,
  ).slice(0, 20);
  const identities: DigestCardIdentity[] = [];
  for (const link of links) {
    const match = hrefMatch(link, providers);
    if (!match) continue;
    let ancestor = link.parent;
    for (
      let depth = 0;
      ancestor && depth < maximumCardAncestors;
      depth += 1, ancestor = ancestor.parent
    ) {
      if (!isTag(ancestor) || !supportedCardElements.has(ancestor.name)) {
        continue;
      }
      const urls = supportedUrls(ancestor, providers);
      if (!urls) break;
      if (urls.length > 1) break;
      if (urls[0] !== match.url.href) continue;
      const identity = cardIdentity(ancestor, link, match.url.href);
      if (identity) {
        identities.push(identity);
        break;
      }
    }
  }
  return identities;
}

function cleanTextUrl(value: string): string {
  return value.replace(/[),.;:!?\]}]+$/g, "");
}

function textCardIdentities(
  content: string,
  providers: JobBoardProviderRegistry,
): DigestCardIdentity[] {
  const identities: DigestCardIdentity[] = [];
  for (const block of content.split(/\r?\n\s*\r?\n/).slice(0, 100)) {
    if (block.length > maximumCardTextCharacters) continue;
    const urls = new Set<string>();
    for (const match of block.matchAll(textUrlPattern)) {
      try {
        const supported = providers.match(new URL(cleanTextUrl(match[0])));
        if (supported) urls.add(supported.url.href);
      } catch {
        continue;
      }
    }
    if (urls.size !== 1) continue;
    const title = oneIdentity(labelledIdentity(block, "title"));
    const employer = oneIdentity(labelledIdentity(block, "company"));
    if (title && employer) {
      identities.push({
        canonicalUrl: [...urls][0]!,
        employer,
        title,
      });
    }
  }
  return identities;
}

function fallbackInspection(
  identity: DigestCardIdentity,
): AvailableJobPostingInspection {
  return {
    applyUrl: identity.canonicalUrl,
    canonicalUrl: identity.canonicalUrl,
    closingDate: null,
    description: null,
    employer: identity.employer,
    location: null,
    salary: null,
    status: "available",
    title: identity.title,
    workArrangement: null,
  };
}

export function digestEmailJobCardInspections(
  content: string,
  contentType: "html" | "text",
  providers = new JobBoardProviderRegistry(),
): ReadonlyMap<string, AvailableJobPostingInspection> {
  const identities =
    contentType === "html"
      ? htmlCardIdentities(content, providers)
      : textCardIdentities(content, providers);
  const grouped = new Map<string, DigestCardIdentity[]>();
  for (const identity of identities) {
    const existing = grouped.get(identity.canonicalUrl) ?? [];
    existing.push(identity);
    grouped.set(identity.canonicalUrl, existing);
  }

  const inspections = new Map<string, AvailableJobPostingInspection>();
  for (const [url, candidates] of grouped) {
    const titles = oneIdentity(candidates.map(({ title }) => title));
    const employers = oneIdentity(candidates.map(({ employer }) => employer));
    if (titles && employers) {
      inspections.set(
        url,
        fallbackInspection({
          canonicalUrl: url,
          employer: employers,
          title: titles,
        }),
      );
    }
  }
  return inspections;
}
