import { describe, expect, it } from "vitest";

import {
  DocumentPreviewCapacityError,
  DocumentPreviewInputLimitError,
  DocumentPreviewParseError,
  DocumentPreviewTimeoutError,
  type DocumentPreviewPolicy,
} from "../../application/document_previews.js";
import { DocumentPreviewSupervisor } from "./document_preview_supervisor.js";

const policy: DocumentPreviewPolicy = {
  maxConcurrentWorkers: 2,
  maxInputBytes: 1024,
  maxMemoryMb: 16,
  maxOutputCharacters: 24,
  timeoutMs: 500,
};

describe("DocumentPreviewSupervisor", () => {
  it("rejects excess work before starting another preview worker", async () => {
    const supervisor = new DocumentPreviewSupervisor(
      { ...policy, maxConcurrentWorkers: 1, timeoutMs: 25 },
      'const { parentPort } = require("node:worker_threads"); while (true) { parentPort.ref(); }',
    );

    const first = supervisor.generate(Buffer.from("first"), "text/plain");
    await new Promise((resolve) => setImmediate(resolve));
    await expect(
      supervisor.generate(Buffer.from("second"), "text/plain"),
    ).rejects.toBeInstanceOf(DocumentPreviewCapacityError);
    await expect(first).rejects.toBeInstanceOf(DocumentPreviewTimeoutError);

    await expect(
      supervisor.generate(Buffer.from("third"), "text/plain"),
    ).rejects.toBeInstanceOf(DocumentPreviewTimeoutError);
  });

  it("decodes supported text in an isolated worker and bounds the output", async () => {
    const supervisor = new DocumentPreviewSupervisor(policy);

    await expect(
      supervisor.generate(
        Buffer.from("First line\r\nSecond line with extra text"),
        "text/plain",
      ),
    ).resolves.toEqual({
      mediaType: "text/plain",
      status: "ready",
      text: "First line\nSecond line w",
      truncated: true,
    });
  });

  it("keeps unsupported formats available without starting a parser", async () => {
    const supervisor = new DocumentPreviewSupervisor(policy);

    await expect(
      supervisor.generate(Buffer.from("pdf-data"), "application/pdf"),
    ).resolves.toEqual({
      mediaType: "application/pdf",
      status: "unsupported",
    });
  });

  it("rejects oversized and binary-looking supported input", async () => {
    const supervisor = new DocumentPreviewSupervisor(policy);

    await expect(
      supervisor.generate(Buffer.alloc(1025), "text/plain"),
    ).rejects.toBeInstanceOf(DocumentPreviewInputLimitError);
    await expect(
      supervisor.generate(Buffer.from([0, 1, 2, 3]), "text/plain"),
    ).rejects.toBeInstanceOf(DocumentPreviewParseError);
  });

  it("terminates a parser that exceeds its wall-clock budget", async () => {
    const supervisor = new DocumentPreviewSupervisor(
      { ...policy, timeoutMs: 25 },
      'const { parentPort } = require("node:worker_threads"); while (true) { parentPort.ref(); }',
    );

    await expect(
      supervisor.generate(Buffer.from("content"), "text/plain"),
    ).rejects.toBeInstanceOf(DocumentPreviewTimeoutError);
  });

  it("fails closed when a worker returns an invalid message", async () => {
    const supervisor = new DocumentPreviewSupervisor(
      policy,
      'const { parentPort } = require("node:worker_threads"); parentPort.postMessage({ text: 7 });',
    );

    await expect(
      supervisor.generate(Buffer.from("content"), "text/plain"),
    ).rejects.toBeInstanceOf(DocumentPreviewParseError);
  });
});
