import { setTimeout as delay } from "node:timers/promises";

import { ClientSecretCredential } from "@azure/identity";
import { z } from "zod";

import {
  OutlookEmailSyncOperationalError,
  maximumOutlookSearchCandidates,
  type OutlookEvidenceValidationInput,
  type OutlookExistingEvidenceValidation,
  type OutlookMailAddress,
  type OutlookMailMessageDetail,
  type OutlookMailMessageSummary,
  type OutlookMailReader,
  type OutlookMailSearchInput,
  type OutlookMailSearchResult,
  type OutlookSearchKind,
} from "../application/outlook_email_sync.js";
import type {
  OutlookGraphConnectionAdapter,
  OutlookGraphRuntimeConnection,
} from "../application/outlook_graph_connections.js";

const graphOrigin = "https://graph.microsoft.com";
const graphApiRoot = `${graphOrigin}/v1.0`;
const graphScope = `${graphOrigin}/.default`;
const graphMetadataResponseBytes = 256 * 1024;
const graphMessageResponseBytes = 768 * 1024;
const graphRequestTimeoutMs = 10_000;
const maximumGraphRetries = 2;
const maximumFolderPages = 3;
const maximumFolderPageSize = 100;
const maximumGraphMessagePageSize = 10;
const maximumGraphHeaders = 200;

const graphMailAddressSchema = z.object({
  address: z.string().trim().min(1).max(512),
  name: z.string().max(512).nullable().optional(),
});
const smtpAddressSchema = z.string().trim().email().max(254);
const graphRecipientSchema = z.object({
  emailAddress: graphMailAddressSchema.nullable().optional(),
});
const graphBodySchema = z.object({
  content: z.string(),
  contentType: z.enum(["html", "text"]),
});
const graphHeaderSchema = z.object({
  name: z.string().max(256),
  value: z.string().max(8192),
});
const graphMessageSchema = z.object({
  body: graphBodySchema.optional(),
  bodyPreview: z.string().max(4096).optional(),
  from: graphRecipientSchema.nullable().optional(),
  id: z.string().trim().min(1).max(2048),
  internetMessageHeaders: z.array(graphHeaderSchema).optional(),
  internetMessageId: z.string().trim().max(998).nullable().optional(),
  parentFolderId: z.string().trim().min(1).max(2048).optional(),
  receivedDateTime: z.iso.datetime(),
  replyTo: z.array(graphRecipientSchema).optional(),
  subject: z.string().max(4096).optional(),
  webLink: z.string().max(4096).nullable().optional(),
});
const graphMessagePageSchema = z.object({
  "@odata.nextLink": z.string().max(4096).optional(),
  value: z.array(graphMessageSchema),
});
const graphFolderSchema = z.object({
  displayName: z.string().max(512),
  id: z.string().trim().min(1).max(2048),
});
const graphFolderPageSchema = z.object({
  "@odata.nextLink": z.string().max(4096).optional(),
  value: z.array(graphFolderSchema),
});

type GraphMessage = z.infer<typeof graphMessageSchema>;

export interface MicrosoftGraphOutlookMailConfig {
  folderPath: string[];
  mailbox: string;
}

export interface MicrosoftGraphAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export class AzureClientSecretGraphTokenProvider implements MicrosoftGraphAccessTokenProvider {
  private readonly credential: ClientSecretCredential;

  public constructor(tenantId: string, clientId: string, clientSecret: string) {
    this.credential = new ClientSecretCredential(
      tenantId,
      clientId,
      clientSecret,
    );
  }

  public async getAccessToken(): Promise<string> {
    try {
      const token = await this.credential.getToken(graphScope);
      if (!token?.token) {
        throw new OutlookEmailSyncOperationalError(
          "outlook_graph_authentication_failed",
        );
      }
      return token.token;
    } catch (error) {
      if (error instanceof OutlookEmailSyncOperationalError) throw error;
      throw new OutlookEmailSyncOperationalError(
        "outlook_graph_authentication_failed",
      );
    }
  }
}

class GraphResourceNotFoundError extends Error {}

function normalizedWebUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.href.length > 2048
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function mailAddress(
  recipient: z.infer<typeof graphRecipientSchema> | null | undefined,
): OutlookMailAddress | null {
  const parsed = smtpAddressSchema.safeParse(recipient?.emailAddress?.address);
  if (!parsed.success) return null;
  return {
    address: parsed.data.toLocaleLowerCase("en"),
    name: recipient?.emailAddress?.name?.trim() || null,
  };
}

function messageSummary(
  message: GraphMessage,
  searchKind: OutlookSearchKind,
): OutlookMailMessageSummary {
  return {
    bodyPreview: message.bodyPreview ?? "",
    from: mailAddress(message.from),
    id: message.id,
    internetMessageId: message.internetMessageId?.trim() || null,
    receivedAt: new Date(message.receivedDateTime).toISOString(),
    searchKinds: [searchKind],
    subject: (message.subject ?? "").slice(0, 255),
    webUrl: normalizedWebUrl(message.webLink),
  };
}

function messageDetail(message: GraphMessage): OutlookMailMessageDetail {
  return {
    body: message.body ?? { content: "", contentType: "text" },
    bodyPreview: message.bodyPreview ?? "",
    from: mailAddress(message.from),
    headers: (message.internetMessageHeaders ?? [])
      .slice(0, maximumGraphHeaders)
      .map(({ name, value }) => ({ name, value })),
    id: message.id,
    internetMessageId: message.internetMessageId?.trim() || null,
    receivedAt: new Date(message.receivedDateTime).toISOString(),
    replyTo: (message.replyTo ?? []).flatMap((recipient) => {
      const address = mailAddress(recipient);
      return address ? [address] : [];
    }),
    subject: (message.subject ?? "").slice(0, 255),
    webUrl: normalizedWebUrl(message.webLink),
  };
}

function replaceAsciiControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? " " : character;
    })
    .join("");
}

function kqlPhrase(value: string): string {
  const safe = replaceAsciiControlCharacters(value.normalize("NFKC"))
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 512);
  return `"${safe}"`;
}

function searchQueries(
  input: OutlookMailSearchInput,
): Array<{ kind: OutlookSearchKind; query: string }> {
  const queries: Array<{ kind: OutlookSearchKind; query: string }> = [
    {
      kind: "company_role",
      query: `${kqlPhrase(input.companyName)} AND ${kqlPhrase(input.roleTitle)}`,
    },
  ];
  if (input.postingIds.length > 0) {
    queries.push({
      kind: "posting_id",
      query: input.postingIds.slice(0, 10).map(kqlPhrase).join(" OR "),
    });
  }
  return queries;
}

function graphUrl(pathOrUrl: string): URL {
  const url = pathOrUrl.startsWith("https://")
    ? new URL(pathOrUrl)
    : new URL(pathOrUrl, `${graphApiRoot}/`);
  if (
    url.origin !== graphOrigin ||
    !url.pathname.startsWith("/v1.0/") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new OutlookEmailSyncOperationalError("outlook_graph_unavailable");
  }
  return url;
}

function retryDelayMs(response: Response): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 5000);
  }
  return 250;
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > maximumBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new OutlookEmailSyncOperationalError("outlook_graph_unavailable");
  }
  if (!response.body) {
    throw new OutlookEmailSyncOperationalError("outlook_graph_unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let decoded = "";
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new OutlookEmailSyncOperationalError("outlook_graph_unavailable");
    }
    decoded += decoder.decode(value, { stream: true });
  }
  decoded += decoder.decode();
  try {
    return JSON.parse(decoded);
  } catch {
    throw new OutlookEmailSyncOperationalError("outlook_graph_unavailable");
  }
}

function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}

export class MicrosoftGraphOutlookMailReader implements OutlookMailReader {
  private folderId: string | undefined;

  public constructor(
    private readonly config: MicrosoftGraphOutlookMailConfig,
    private readonly tokens: MicrosoftGraphAccessTokenProvider,
    private readonly fetcher: typeof fetch = fetch,
    private readonly wait: (milliseconds: number) => Promise<unknown> = (
      milliseconds,
    ) => delay(milliseconds),
  ) {}

  public async verifyConnection(): Promise<void> {
    await this.resolveFolderId();
  }

  public async validateEvidence(
    evidence: OutlookEvidenceValidationInput[],
  ): Promise<OutlookExistingEvidenceValidation[]> {
    const results: OutlookExistingEvidenceValidation[] = [];
    for (let index = 0; index < evidence.length; index += 2) {
      const chunk = evidence.slice(index, index + 2);
      const resolved = await Promise.all(
        chunk.map(async (stored) => {
          const parameters = new URLSearchParams({
            $filter: `internetMessageId eq ${odataString(stored.messageId)}`,
            $select:
              "id,internetMessageId,receivedDateTime,webLink,parentFolderId",
            $top: "2",
          });
          let page: z.infer<typeof graphMessagePageSchema>;
          try {
            page = await this.request(
              `users/${encodeURIComponent(this.config.mailbox)}/messages?${parameters.toString()}`,
              graphMessagePageSchema,
              graphMetadataResponseBytes,
            );
          } catch (error) {
            if (error instanceof GraphResourceNotFoundError) {
              throw new OutlookEmailSyncOperationalError(
                "outlook_mailbox_unavailable",
              );
            }
            throw error;
          }
          if (page.value.length === 0) {
            return {
              messageId: stored.messageId,
              status: "not_found" as const,
            };
          }
          const exact = page.value.filter(
            ({ internetMessageId }) =>
              internetMessageId?.trim() === stored.messageId,
          );
          const status =
            exact.length === 1 &&
            sameInstant(exact[0]?.receivedDateTime ?? "", stored.receivedAt)
              ? ("valid" as const)
              : ("metadata_mismatch" as const);
          return { messageId: stored.messageId, status };
        }),
      );
      results.push(...resolved);
    }
    return results;
  }

  public async searchMessages(
    input: OutlookMailSearchInput,
  ): Promise<OutlookMailSearchResult> {
    const folderId = await this.resolveFolderId();
    const queries = searchQueries(input);
    const byId = new Map<string, OutlookMailMessageSummary>();
    for (const { kind, query } of queries) {
      const parameters = new URLSearchParams({
        $search: query,
        $select:
          "id,internetMessageId,subject,from,receivedDateTime,webLink,bodyPreview,parentFolderId",
        $top: String(maximumGraphMessagePageSize),
      });
      let page: z.infer<typeof graphMessagePageSchema>;
      try {
        page = await this.request(
          `users/${encodeURIComponent(this.config.mailbox)}/mailFolders/${encodeURIComponent(folderId)}/messages?${parameters.toString()}`,
          graphMessagePageSchema,
          graphMetadataResponseBytes,
        );
      } catch (error) {
        if (error instanceof GraphResourceNotFoundError) {
          this.folderId = undefined;
          throw new OutlookEmailSyncOperationalError(
            "outlook_folder_not_found",
          );
        }
        throw error;
      }
      for (const message of page.value) {
        const existing = byId.get(message.id);
        if (existing) {
          if (!existing.searchKinds.includes(kind))
            existing.searchKinds.push(kind);
          continue;
        }
        byId.set(message.id, messageSummary(message, kind));
      }
    }
    const messages = [...byId.values()]
      .sort((left, right) => {
        const receivedDifference =
          Date.parse(right.receivedAt) - Date.parse(left.receivedAt);
        if (receivedDifference !== 0) return receivedDifference;
        return (left.internetMessageId ?? left.id).localeCompare(
          right.internetMessageId ?? right.id,
        );
      })
      .slice(0, maximumOutlookSearchCandidates);
    return { messages, queriesRun: queries.length };
  }

  public async getMessages(ids: string[]): Promise<OutlookMailMessageDetail[]> {
    const folderId = await this.resolveFolderId();
    const messages: OutlookMailMessageDetail[] = [];
    for (let index = 0; index < ids.length; index += 2) {
      const chunk = ids.slice(index, index + 2);
      const details = await Promise.all(
        chunk.map(async (id) => {
          const parameters = new URLSearchParams({
            $select:
              "id,internetMessageId,subject,from,replyTo,receivedDateTime,webLink,body,bodyPreview,internetMessageHeaders,parentFolderId",
          });
          try {
            const message = await this.request(
              `users/${encodeURIComponent(this.config.mailbox)}/messages/${encodeURIComponent(id)}?${parameters.toString()}`,
              graphMessageSchema,
              graphMessageResponseBytes,
            );
            return message.parentFolderId === folderId
              ? messageDetail(message)
              : null;
          } catch (error) {
            if (error instanceof GraphResourceNotFoundError) return null;
            throw error;
          }
        }),
      );
      messages.push(
        ...details.filter(
          (message): message is OutlookMailMessageDetail => message !== null,
        ),
      );
    }
    return messages;
  }

  private async resolveFolderId(): Promise<string> {
    if (this.folderId) return this.folderId;
    let parentId = "inbox";
    for (const segment of this.config.folderPath.slice(1)) {
      let nextUrl: string | undefined;
      let matchedId: string | undefined;
      for (let pageIndex = 0; pageIndex < maximumFolderPages; pageIndex += 1) {
        const path =
          nextUrl ??
          `users/${encodeURIComponent(this.config.mailbox)}/mailFolders/${encodeURIComponent(parentId)}/childFolders?${new URLSearchParams(
            {
              $select: "id,displayName",
              $top: String(maximumFolderPageSize),
              includeHiddenFolders: "false",
            },
          ).toString()}`;
        let page: z.infer<typeof graphFolderPageSchema>;
        try {
          page = await this.request(
            path,
            graphFolderPageSchema,
            graphMetadataResponseBytes,
          );
        } catch (error) {
          if (error instanceof GraphResourceNotFoundError) {
            throw new OutlookEmailSyncOperationalError(
              "outlook_mailbox_unavailable",
            );
          }
          throw error;
        }
        const matches = page.value.filter(
          ({ displayName }) =>
            displayName.normalize("NFKC") === segment.normalize("NFKC"),
        );
        if (matches.length > 1 || (matchedId && matches.length > 0)) {
          throw new OutlookEmailSyncOperationalError(
            "outlook_folder_not_found",
          );
        }
        if (matches[0]) matchedId = matches[0].id;
        nextUrl = page["@odata.nextLink"];
        if (!nextUrl) break;
      }
      if (!matchedId) {
        throw new OutlookEmailSyncOperationalError("outlook_folder_not_found");
      }
      parentId = matchedId;
    }
    this.folderId = parentId;
    return parentId;
  }

  private async request<Schema extends z.ZodType>(
    pathOrUrl: string,
    schema: Schema,
    maximumBytes: number,
  ): Promise<z.output<Schema>> {
    const url = graphUrl(pathOrUrl);
    for (let attempt = 0; attempt <= maximumGraphRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            Authorization: `Bearer ${await this.tokens.getAccessToken()}`,
            Prefer: 'IdType="ImmutableId"',
          },
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(graphRequestTimeoutMs),
        });
      } catch (error) {
        if (error instanceof OutlookEmailSyncOperationalError) throw error;
        if (attempt < maximumGraphRetries) continue;
        throw new OutlookEmailSyncOperationalError("outlook_graph_unavailable");
      }
      if (response.ok) {
        const parsed = schema.safeParse(
          await boundedJson(response, maximumBytes),
        );
        if (!parsed.success) {
          throw new OutlookEmailSyncOperationalError(
            "outlook_graph_unavailable",
          );
        }
        return parsed.data;
      }
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401) {
        throw new OutlookEmailSyncOperationalError(
          "outlook_graph_authentication_failed",
        );
      }
      if (response.status === 403) {
        throw new OutlookEmailSyncOperationalError("outlook_graph_forbidden");
      }
      if (response.status === 404) throw new GraphResourceNotFoundError();
      if (
        (response.status === 429 || response.status === 503) &&
        attempt < maximumGraphRetries
      ) {
        await this.wait(retryDelayMs(response));
        continue;
      }
      if (response.status === 429) {
        throw new OutlookEmailSyncOperationalError("outlook_graph_throttled");
      }
      if (response.status >= 500 && attempt < maximumGraphRetries) continue;
      throw new OutlookEmailSyncOperationalError("outlook_graph_unavailable");
    }
    throw new OutlookEmailSyncOperationalError("outlook_graph_unavailable");
  }
}

export class MicrosoftGraphOutlookConnectionAdapter implements OutlookGraphConnectionAdapter {
  public createReader(
    config: OutlookGraphRuntimeConnection,
  ): MicrosoftGraphOutlookMailReader {
    return new MicrosoftGraphOutlookMailReader(
      { folderPath: config.folderPath, mailbox: config.mailbox },
      new AzureClientSecretGraphTokenProvider(
        config.tenantId,
        config.clientId,
        config.clientSecret,
      ),
    );
  }

  public async verify(config: OutlookGraphRuntimeConnection): Promise<void> {
    await this.createReader(config).verifyConnection();
  }
}
