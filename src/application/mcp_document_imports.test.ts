import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import {
  InvalidMcpDocumentImportError,
  McpDocumentImportCapacityError,
  McpDocumentImportConflictError,
  McpDocumentImportManager,
  McpDocumentImportNotFoundError,
} from "./mcp_document_imports.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};
const documentTypeId = "11111111-1111-4111-8111-111111111111";

function beginInput(bytes: Buffer) {
  return {
    applicationIds: ["22222222-2222-4222-8222-222222222222"],
    byteSize: bytes.byteLength,
    documentTypeId,
    mediaType: "text/plain",
    originalFilename: "migration.txt",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    idempotencyKey: "legacy-jobtracker:DOC-001",
  };
}

describe("McpDocumentImportManager", () => {
  it("caps the default chunk size at a smaller installation upload limit", () => {
    expect(new McpDocumentImportManager(1024).maxChunkBytes).toBe(1024);
  });

  it("accepts canonical chunks, permits exact retries, and verifies the full digest", () => {
    const bytes = Buffer.from("complete migration payload");
    const manager = new McpDocumentImportManager(
      1024,
      { maxChunkBytes: 16 },
      () => new Date("2026-07-20T10:00:00.000Z"),
      () => "33333333-3333-4333-8333-333333333333",
    );
    const started = manager.begin(actor, beginInput(bytes));
    expect(manager.begin(actor, beginInput(bytes))).toEqual(started);

    const first = bytes.subarray(0, 16);
    const firstInput = {
      chunkSha256: createHash("sha256").update(first).digest("hex"),
      contentBase64: first.toString("base64"),
      offset: 0,
      uploadId: started.uploadId,
    };
    const progressed = manager.append(actor, firstInput);
    expect(progressed).toMatchObject({ nextOffset: 16, complete: false });
    expect(manager.append(actor, firstInput)).toEqual(progressed);

    const second = bytes.subarray(16);
    expect(
      manager.append(actor, {
        chunkSha256: createHash("sha256").update(second).digest("hex"),
        contentBase64: second.toString("base64"),
        offset: 16,
        uploadId: started.uploadId,
      }),
    ).toMatchObject({ nextOffset: bytes.length, complete: true });
    expect(manager.prepareCompletion(actor, started.uploadId)).toMatchObject({
      applicationIds: beginInput(bytes).applicationIds,
      bytes,
      documentTypeId,
      mediaType: "text/plain",
      originalFilename: "migration.txt",
      sha256: beginInput(bytes).sha256,
    });
  });

  it("rejects malformed data, conflicting offsets, cross-actor access, and cancelled uploads", () => {
    const bytes = Buffer.from("payload");
    const manager = new McpDocumentImportManager(1024, { maxChunkBytes: 16 });
    const started = manager.begin(actor, beginInput(bytes));

    expect(() =>
      manager.append(actor, {
        chunkSha256: "0".repeat(64),
        contentBase64: "not base64",
        offset: 0,
        uploadId: started.uploadId,
      }),
    ).toThrow(InvalidMcpDocumentImportError);
    expect(() =>
      manager.append(actor, {
        chunkSha256: createHash("sha256").update(bytes).digest("hex"),
        contentBase64: bytes.toString("base64"),
        offset: 1,
        uploadId: started.uploadId,
      }),
    ).toThrow(McpDocumentImportConflictError);
    expect(() =>
      manager.prepareCompletion(
        { ...actor, userId: "another-user" },
        started.uploadId,
      ),
    ).toThrow(McpDocumentImportNotFoundError);

    expect(manager.cancel(actor, started.uploadId)).toEqual({
      cancelled: true,
    });
    expect(() => manager.prepareCompletion(actor, started.uploadId)).toThrow(
      McpDocumentImportNotFoundError,
    );
  });

  it("enforces process-wide and per-actor active transfer limits", () => {
    const bytes = Buffer.from("payload");
    const manager = new McpDocumentImportManager(1024, {
      maxActiveUploads: 2,
      maxActiveUploadsPerActor: 1,
      maxChunkBytes: 16,
    });
    manager.begin(actor, beginInput(bytes));
    expect(() =>
      manager.begin(actor, {
        ...beginInput(bytes),
        idempotencyKey: "second-for-same-actor",
      }),
    ).toThrow(McpDocumentImportCapacityError);

    const secondActor = {
      ...actor,
      userId: "user-2",
      user: { ...actor.user, username: "taylor" },
    };
    manager.begin(secondActor, {
      ...beginInput(bytes),
      idempotencyKey: "second-actor",
    });
    expect(() =>
      manager.begin(
        { ...actor, userId: "user-3" },
        { ...beginInput(bytes), idempotencyKey: "third-actor" },
      ),
    ).toThrow(McpDocumentImportCapacityError);
  });
});
