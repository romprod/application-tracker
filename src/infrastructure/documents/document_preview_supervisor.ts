import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DocumentPreviewCapacityError,
  DocumentPreviewInputLimitError,
  DocumentPreviewParseError,
  DocumentPreviewTimeoutError,
  supportedDocumentPreviewMediaTypes,
  type DocumentPreviewGenerator,
  type DocumentPreviewPolicy,
  type DocumentPreviewSource,
  type GeneratedDocumentPreview,
  type PdfDocumentPreview,
} from "../../application/document_previews.js";

export interface DocumentPreviewProcessCommand {
  args: string[];
  executable: string;
}

function isSupportedMediaType(mediaType: string): boolean {
  return (supportedDocumentPreviewMediaTypes as readonly string[]).includes(
    mediaType,
  );
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function nullableBoundedString(
  value: unknown,
  maximum: number,
): value is string | null {
  return value === null || boundedString(value, maximum);
}

function emailAddressList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 25 &&
    value.every((entry) => boundedString(entry, 500))
  );
}

function parseProcessResult(
  value: unknown,
  mediaType: string,
  maxOutputCharacters: number,
): GeneratedDocumentPreview {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DocumentPreviewParseError();
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.mediaType !== mediaType) {
    throw new DocumentPreviewParseError();
  }
  if (candidate.status === "unsupported") {
    return { mediaType, status: "unsupported" };
  }
  if (
    candidate.status !== "ready" ||
    typeof candidate.truncated !== "boolean" ||
    !boundedString(candidate.text, maxOutputCharacters)
  ) {
    throw new DocumentPreviewParseError();
  }
  if (candidate.kind === "text") {
    return {
      kind: "text",
      mediaType,
      status: "ready",
      text: candidate.text,
      truncated: candidate.truncated,
    };
  }
  if (
    candidate.kind !== "email" ||
    !emailAddressList(candidate.cc) ||
    !nullableBoundedString(candidate.date, 500) ||
    !nullableBoundedString(candidate.from, 500) ||
    !nullableBoundedString(candidate.subject, 500) ||
    !emailAddressList(candidate.to)
  ) {
    throw new DocumentPreviewParseError();
  }
  return {
    cc: candidate.cc,
    date: candidate.date,
    from: candidate.from,
    kind: "email",
    mediaType,
    status: "ready",
    subject: candidate.subject,
    text: candidate.text,
    to: candidate.to,
    truncated: candidate.truncated,
  };
}

function defaultProcessCommand(
  policy: DocumentPreviewPolicy,
): DocumentPreviewProcessCommand {
  const sourceRuntime = fileURLToPath(import.meta.url).endsWith(".ts");
  return {
    args: [
      `--max-old-space-size=${String(policy.maxMemoryMb)}`,
      ...(sourceRuntime ? ["--import", "tsx"] : []),
      fileURLToPath(
        new URL(
          sourceRuntime
            ? "./document_preview_process.ts"
            : "./document_preview_process.js",
          import.meta.url,
        ),
      ),
    ],
    executable: process.execPath,
  };
}

export class DocumentPreviewSupervisor implements DocumentPreviewGenerator {
  private activeProcesses = 0;
  private readonly processCommand: DocumentPreviewProcessCommand;

  public constructor(
    private readonly policy: DocumentPreviewPolicy,
    processCommand?: DocumentPreviewProcessCommand,
  ) {
    if (
      !Number.isInteger(policy.maxConcurrentWorkers) ||
      policy.maxConcurrentWorkers < 1 ||
      !Number.isInteger(policy.maxDecodedBytes) ||
      policy.maxDecodedBytes < 1024
    ) {
      throw new Error("Invalid document preview process policy");
    }
    this.processCommand = processCommand ?? defaultProcessCommand(policy);
  }

  public async generate(
    bytes: Uint8Array,
    source: DocumentPreviewSource,
  ): Promise<GeneratedDocumentPreview | PdfDocumentPreview> {
    const mediaType = source.mediaType.trim().toLowerCase();
    if (!isSupportedMediaType(mediaType)) {
      return { mediaType, status: "unsupported" };
    }
    if (mediaType === "application/pdf") {
      return { mediaType: "application/pdf", status: "pdf" };
    }
    if (bytes.byteLength > this.policy.maxInputBytes) {
      throw new DocumentPreviewInputLimitError();
    }
    if (this.activeProcesses >= this.policy.maxConcurrentWorkers) {
      throw new DocumentPreviewCapacityError();
    }

    this.activeProcesses += 1;
    const payload = JSON.stringify({
      bytes: Buffer.from(bytes).toString("base64"),
      maxDecodedBytes: this.policy.maxDecodedBytes,
      maxOutputCharacters: this.policy.maxOutputCharacters,
      source: { ...source, mediaType },
    });
    return await new Promise<GeneratedDocumentPreview>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(
          this.processCommand.executable,
          this.processCommand.args,
          {
            env: { NODE_ENV: "production" },
            stdio: ["pipe", "pipe", "ignore"],
            windowsHide: true,
          },
        );
      } catch {
        this.activeProcesses -= 1;
        reject(new DocumentPreviewParseError());
        return;
      }
      const stdout = child.stdout;
      const stdin = child.stdin;
      if (!stdout || !stdin) {
        child.kill("SIGKILL");
        this.activeProcesses -= 1;
        reject(new DocumentPreviewParseError());
        return;
      }

      let settled = false;
      let timedOut = false;
      let outputTooLarge = false;
      let outputLength = 0;
      const output: Buffer[] = [];
      const outputLimit = Math.max(
        128 * 1024,
        this.policy.maxOutputCharacters * 4 + 64 * 1024,
      );
      const finish = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeProcesses -= 1;
        operation();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.policy.timeoutMs);

      stdout.on("data", (chunk: Buffer) => {
        outputLength += chunk.byteLength;
        if (outputLength > outputLimit) {
          outputTooLarge = true;
          child.kill("SIGKILL");
          return;
        }
        output.push(chunk);
      });
      stdin.on("error", () => undefined);
      child.once("error", () => {
        finish(() => reject(new DocumentPreviewParseError()));
      });
      child.once("close", (code) => {
        if (timedOut) {
          finish(() => reject(new DocumentPreviewTimeoutError()));
          return;
        }
        if (outputTooLarge || code !== 0) {
          finish(() => reject(new DocumentPreviewParseError()));
          return;
        }
        try {
          const parsed: unknown = JSON.parse(
            Buffer.concat(output).toString("utf8"),
          );
          const preview = parseProcessResult(
            parsed,
            mediaType,
            this.policy.maxOutputCharacters,
          );
          finish(() => resolve(preview));
        } catch {
          finish(() => reject(new DocumentPreviewParseError()));
        }
      });
      stdin.end(payload);
    });
  }
}
