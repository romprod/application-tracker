import { createHash, randomUUID } from "node:crypto";

import type { AuthenticatedActor } from "./auth.js";
import {
  documentUploadMetadataSchema,
  type DocumentUploadMetadata,
} from "../domain/documents.js";

export const MCP_DOCUMENT_CHUNK_BYTES = 12 * 1024;

export interface BeginMcpDocumentImportInput extends DocumentUploadMetadata {
  byteSize: number;
  idempotencyKey: string;
  sha256: string;
}

export interface McpDocumentImportProgress {
  byteSize: number;
  complete: boolean;
  maxChunkBytes: number;
  nextOffset: number;
  receivedBytes: number;
  idempotencyKey: string;
  uploadId: string;
}

export interface PreparedMcpDocumentImport extends DocumentUploadMetadata {
  bytes: Uint8Array;
  sha256: string;
}

interface StoredChunk {
  content: Buffer;
  offset: number;
  sha256: string;
}

interface ImportSession {
  actorUserId: string;
  chunks: StoredChunk[];
  input: BeginMcpDocumentImportInput;
  lastAccessedAt: number;
  receivedBytes: number;
  uploadId: string;
  workspaceId: string;
}

export class InvalidMcpDocumentImportError extends Error {
  public constructor() {
    super("The document import is invalid");
    this.name = "InvalidMcpDocumentImportError";
  }
}

export class McpDocumentImportConflictError extends Error {
  public constructor() {
    super("The document import conflicts with existing transfer state");
    this.name = "McpDocumentImportConflictError";
  }
}

export class McpDocumentImportIncompleteError extends Error {
  public constructor() {
    super("The document import has not received every byte");
    this.name = "McpDocumentImportIncompleteError";
  }
}

export class McpDocumentImportNotFoundError extends Error {
  public constructor() {
    super("The document import was not found");
    this.name = "McpDocumentImportNotFoundError";
  }
}

export class McpDocumentImportCapacityError extends Error {
  public constructor() {
    super("The document import capacity has been reached");
    this.name = "McpDocumentImportCapacityError";
  }
}

function canonicalInput(
  input: BeginMcpDocumentImportInput,
): BeginMcpDocumentImportInput {
  const metadata = documentUploadMetadataSchema.safeParse({
    applicationIds: input.applicationIds,
    documentTypeId: input.documentTypeId,
    mediaType: input.mediaType,
    originalFilename: input.originalFilename,
  });
  if (!metadata.success) throw new InvalidMcpDocumentImportError();
  return {
    ...metadata.data,
    applicationIds: [...metadata.data.applicationIds].sort(),
    byteSize: input.byteSize,
    idempotencyKey: input.idempotencyKey.trim(),
    sha256: input.sha256,
  };
}

function sameInput(
  left: BeginMcpDocumentImportInput,
  right: BeginMcpDocumentImportInput,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalBase64(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new InvalidMcpDocumentImportError();
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new InvalidMcpDocumentImportError();
  }
  return decoded;
}

export class McpDocumentImportManager {
  private readonly sessions = new Map<string, ImportSession>();

  public constructor(
    private readonly maxUploadBytes: number,
    private readonly options: {
      idleDurationMs?: number;
      maxActiveUploads?: number;
      maxActiveUploadsPerActor?: number;
      maxChunkBytes?: number;
    } = {},
    private readonly clock: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {
    if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) {
      throw new Error("Invalid MCP document import policy");
    }
    if (
      !Number.isSafeInteger(this.idleDurationMs) ||
      this.idleDurationMs < 1_000 ||
      !Number.isSafeInteger(this.maxActiveUploads) ||
      this.maxActiveUploads < 1 ||
      !Number.isSafeInteger(this.maxActiveUploadsPerActor) ||
      this.maxActiveUploadsPerActor < 1 ||
      this.maxActiveUploadsPerActor > this.maxActiveUploads ||
      !Number.isSafeInteger(this.maxChunkBytes) ||
      this.maxChunkBytes < 1 ||
      this.maxChunkBytes > maxUploadBytes
    ) {
      throw new Error("Invalid MCP document import policy");
    }
  }

  public get maxChunkBytes(): number {
    return (
      this.options.maxChunkBytes ??
      Math.min(MCP_DOCUMENT_CHUNK_BYTES, this.maxUploadBytes)
    );
  }

  public get maximumUploadBytes(): number {
    return this.maxUploadBytes;
  }

  private get idleDurationMs(): number {
    return this.options.idleDurationMs ?? 15 * 60 * 1_000;
  }

  private get maxActiveUploadsPerActor(): number {
    return this.options.maxActiveUploadsPerActor ?? 2;
  }

  private get maxActiveUploads(): number {
    return this.options.maxActiveUploads ?? 8;
  }

  private purgeExpired(now: number): void {
    for (const [uploadId, session] of this.sessions) {
      if (now - session.lastAccessedAt >= this.idleDurationMs) {
        this.sessions.delete(uploadId);
      }
    }
  }

  private requireSession(
    actor: AuthenticatedActor,
    uploadId: string,
  ): ImportSession {
    const now = this.clock().getTime();
    this.purgeExpired(now);
    const session = this.sessions.get(uploadId);
    if (
      !session ||
      session.actorUserId !== actor.userId ||
      session.workspaceId !== actor.workspaceId
    ) {
      throw new McpDocumentImportNotFoundError();
    }
    session.lastAccessedAt = now;
    return session;
  }

  private progress(session: ImportSession): McpDocumentImportProgress {
    return {
      byteSize: session.input.byteSize,
      complete: session.receivedBytes === session.input.byteSize,
      maxChunkBytes: this.maxChunkBytes,
      nextOffset: session.receivedBytes,
      receivedBytes: session.receivedBytes,
      idempotencyKey: session.input.idempotencyKey,
      uploadId: session.uploadId,
    };
  }

  public begin(
    actor: AuthenticatedActor,
    rawInput: BeginMcpDocumentImportInput,
  ): McpDocumentImportProgress {
    const now = this.clock().getTime();
    this.purgeExpired(now);
    const input = canonicalInput(rawInput);
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > this.maxUploadBytes ||
      !/^[0-9a-f]{64}$/.test(input.sha256) ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 160
    ) {
      throw new InvalidMcpDocumentImportError();
    }
    const existing = [...this.sessions.values()].find(
      (session) =>
        session.actorUserId === actor.userId &&
        session.workspaceId === actor.workspaceId &&
        session.input.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (!sameInput(existing.input, input)) {
        throw new McpDocumentImportConflictError();
      }
      existing.lastAccessedAt = now;
      return this.progress(existing);
    }
    const activeForActor = [...this.sessions.values()].filter(
      (session) =>
        session.actorUserId === actor.userId &&
        session.workspaceId === actor.workspaceId,
    ).length;
    if (activeForActor >= this.maxActiveUploadsPerActor) {
      throw new McpDocumentImportCapacityError();
    }
    if (this.sessions.size >= this.maxActiveUploads) {
      throw new McpDocumentImportCapacityError();
    }
    const uploadId = this.idFactory();
    if (this.sessions.has(uploadId)) {
      throw new McpDocumentImportCapacityError();
    }
    const session: ImportSession = {
      actorUserId: actor.userId,
      chunks: [],
      input,
      lastAccessedAt: now,
      receivedBytes: 0,
      uploadId,
      workspaceId: actor.workspaceId,
    };
    this.sessions.set(uploadId, session);
    return this.progress(session);
  }

  public append(
    actor: AuthenticatedActor,
    input: {
      chunkSha256: string;
      contentBase64: string;
      offset: number;
      uploadId: string;
    },
  ): McpDocumentImportProgress {
    const session = this.requireSession(actor, input.uploadId);
    const content = canonicalBase64(input.contentBase64);
    if (
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0 ||
      content.byteLength < 1 ||
      content.byteLength > this.maxChunkBytes ||
      !/^[0-9a-f]{64}$/.test(input.chunkSha256) ||
      createHash("sha256").update(content).digest("hex") !== input.chunkSha256
    ) {
      throw new InvalidMcpDocumentImportError();
    }
    const replay = session.chunks.find(
      (chunk) => chunk.offset === input.offset,
    );
    if (replay) {
      if (
        replay.sha256 !== input.chunkSha256 ||
        !replay.content.equals(content)
      ) {
        throw new McpDocumentImportConflictError();
      }
      return this.progress(session);
    }
    if (
      input.offset !== session.receivedBytes ||
      session.receivedBytes + content.byteLength > session.input.byteSize
    ) {
      throw new McpDocumentImportConflictError();
    }
    session.chunks.push({
      content,
      offset: input.offset,
      sha256: input.chunkSha256,
    });
    session.receivedBytes += content.byteLength;
    return this.progress(session);
  }

  public prepareCompletion(
    actor: AuthenticatedActor,
    uploadId: string,
  ): PreparedMcpDocumentImport {
    const session = this.requireSession(actor, uploadId);
    if (session.receivedBytes !== session.input.byteSize) {
      throw new McpDocumentImportIncompleteError();
    }
    const bytes = Buffer.concat(
      session.chunks
        .toSorted((left, right) => left.offset - right.offset)
        .map(({ content }) => content),
    );
    if (
      bytes.byteLength !== session.input.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== session.input.sha256
    ) {
      throw new InvalidMcpDocumentImportError();
    }
    return {
      applicationIds: [...session.input.applicationIds],
      bytes,
      documentTypeId: session.input.documentTypeId,
      mediaType: session.input.mediaType,
      originalFilename: session.input.originalFilename,
      sha256: session.input.sha256,
    };
  }

  public cancel(
    actor: AuthenticatedActor,
    uploadId: string,
  ): { cancelled: true } {
    const session = this.requireSession(actor, uploadId);
    this.sessions.delete(session.uploadId);
    return { cancelled: true };
  }
}
