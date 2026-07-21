import { describe, expect, it } from "vitest";

import {
  DocumentPreviewCapacityError,
  DocumentPreviewInputLimitError,
  DocumentPreviewParseError,
  DocumentPreviewTimeoutError,
  type DocumentPreviewPolicy,
  type DocumentPreviewSource,
} from "../../application/document_previews.js";
import {
  DocumentPreviewSupervisor,
  type DocumentPreviewProcessCommand,
} from "./document_preview_supervisor.js";

const policy: DocumentPreviewPolicy = {
  maxConcurrentWorkers: 2,
  maxDecodedBytes: 8192,
  maxInputBytes: 1024,
  maxMemoryMb: 16,
  maxOutputCharacters: 24,
  timeoutMs: 500,
};

function source(
  mediaType: string,
  originalFilename = "notes.txt",
): DocumentPreviewSource {
  return { mediaType, originalFilename };
}

function command(script: string): DocumentPreviewProcessCommand {
  return { args: ["-e", script], executable: process.execPath };
}

const textResponseProcess = String.raw`
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const request = JSON.parse(input);
    process.stdout.write(JSON.stringify({
      kind: "text",
      mediaType: request.source.mediaType,
      status: "ready",
      text: "First line\nSecond line w",
      truncated: true,
    }));
  });
`;

const hangingProcess =
  "process.stdin.resume(); setInterval(() => undefined, 1000);";

describe("DocumentPreviewSupervisor", () => {
  it("rejects excess work before starting another parser process", async () => {
    const supervisor = new DocumentPreviewSupervisor(
      { ...policy, maxConcurrentWorkers: 1, timeoutMs: 25 },
      command(hangingProcess),
    );

    const first = supervisor.generate(
      Buffer.from("first"),
      source("text/plain"),
    );
    await new Promise((resolve) => setImmediate(resolve));
    await expect(
      supervisor.generate(Buffer.from("second"), source("text/plain")),
    ).rejects.toBeInstanceOf(DocumentPreviewCapacityError);
    await expect(first).rejects.toBeInstanceOf(DocumentPreviewTimeoutError);

    await expect(
      supervisor.generate(Buffer.from("third"), source("text/plain")),
    ).rejects.toBeInstanceOf(DocumentPreviewTimeoutError);
  });

  it("validates a bounded parser-process response", async () => {
    const supervisor = new DocumentPreviewSupervisor(
      policy,
      command(textResponseProcess),
    );

    await expect(
      supervisor.generate(
        Buffer.from("First line\r\nSecond line with extra text"),
        source("text/plain"),
      ),
    ).resolves.toEqual({
      kind: "text",
      mediaType: "text/plain",
      status: "ready",
      text: "First line\nSecond line w",
      truncated: true,
    });
  });

  it("recognizes PDF originals without starting a parser", async () => {
    const supervisor = new DocumentPreviewSupervisor(policy);

    await expect(
      supervisor.generate(
        Buffer.from("pdf-data"),
        source("application/pdf", "cv.pdf"),
      ),
    ).resolves.toEqual({
      mediaType: "application/pdf",
      status: "pdf",
    });
  });

  it("rejects oversized supported input", async () => {
    const supervisor = new DocumentPreviewSupervisor(policy);

    await expect(
      supervisor.generate(Buffer.alloc(1025), source("text/plain")),
    ).rejects.toBeInstanceOf(DocumentPreviewInputLimitError);
  });

  it("terminates a parser that exceeds its wall-clock budget", async () => {
    const supervisor = new DocumentPreviewSupervisor(
      { ...policy, timeoutMs: 25 },
      command(hangingProcess),
    );

    await expect(
      supervisor.generate(Buffer.from("content"), source("text/plain")),
    ).rejects.toBeInstanceOf(DocumentPreviewTimeoutError);
  });

  it("fails closed when a parser process returns an invalid message", async () => {
    const supervisor = new DocumentPreviewSupervisor(
      policy,
      command(
        'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("{\\"text\\":7}"));',
      ),
    );

    await expect(
      supervisor.generate(Buffer.from("content"), source("text/plain")),
    ).rejects.toBeInstanceOf(DocumentPreviewParseError);
  });
});
