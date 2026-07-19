import { Worker } from "node:worker_threads";

import {
  DocumentPreviewCapacityError,
  DocumentPreviewInputLimitError,
  DocumentPreviewParseError,
  DocumentPreviewTimeoutError,
  supportedDocumentPreviewMediaTypes,
  type DocumentPreviewGenerator,
  type DocumentPreviewPolicy,
  type GeneratedDocumentPreview,
} from "../../application/document_previews.js";

const previewWorkerSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");

  function fail() {
    parentPort.postMessage({ status: "failed" });
  }

  try {
    const bytes = new Uint8Array(workerData.bytes);
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let suspicious = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === 0) throw new Error("binary content");
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) suspicious += 1;
    }
    if (suspicious > Math.max(1, Math.floor(text.length / 100))) {
      throw new Error("binary content");
    }
    text = text.replace(/\r\n?/g, "\n");
    const truncated = text.length > workerData.maxOutputCharacters;
    if (truncated) text = text.slice(0, workerData.maxOutputCharacters);
    parentPort.postMessage({ status: "ready", text, truncated });
  } catch {
    fail();
  }
`;

interface PreviewWorkerMessage {
  status?: unknown;
  text?: unknown;
  truncated?: unknown;
}

function isSupportedMediaType(mediaType: string): boolean {
  return (supportedDocumentPreviewMediaTypes as readonly string[]).includes(
    mediaType,
  );
}

function parseWorkerMessage(
  message: unknown,
  mediaType: string,
  maxOutputCharacters: number,
): GeneratedDocumentPreview {
  if (typeof message !== "object" || message === null) {
    throw new DocumentPreviewParseError();
  }
  const candidate = message as PreviewWorkerMessage;
  if (
    candidate.status !== "ready" ||
    typeof candidate.text !== "string" ||
    candidate.text.length > maxOutputCharacters ||
    typeof candidate.truncated !== "boolean"
  ) {
    throw new DocumentPreviewParseError();
  }
  return {
    mediaType,
    status: "ready",
    text: candidate.text,
    truncated: candidate.truncated,
  };
}

export class DocumentPreviewSupervisor implements DocumentPreviewGenerator {
  private activeWorkers = 0;

  public constructor(
    private readonly policy: DocumentPreviewPolicy,
    private readonly workerSource: string = previewWorkerSource,
  ) {
    if (
      !Number.isInteger(policy.maxConcurrentWorkers) ||
      policy.maxConcurrentWorkers < 1
    ) {
      throw new Error("Invalid document preview worker policy");
    }
  }

  public async generate(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<GeneratedDocumentPreview> {
    const normalizedMediaType = mediaType.trim().toLowerCase();
    if (!isSupportedMediaType(normalizedMediaType)) {
      return { mediaType: normalizedMediaType, status: "unsupported" };
    }
    if (bytes.byteLength > this.policy.maxInputBytes) {
      throw new DocumentPreviewInputLimitError();
    }
    if (this.activeWorkers >= this.policy.maxConcurrentWorkers) {
      throw new DocumentPreviewCapacityError();
    }

    this.activeWorkers += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.activeWorkers -= 1;
    };

    try {
      const copiedBytes = Uint8Array.from(bytes);
      return await new Promise<GeneratedDocumentPreview>((resolve, reject) => {
        let worker: Worker;
        try {
          worker = new Worker(this.workerSource, {
            eval: true,
            resourceLimits: {
              maxOldGenerationSizeMb: this.policy.maxMemoryMb,
              maxYoungGenerationSizeMb: Math.max(
                4,
                Math.floor(this.policy.maxMemoryMb / 4),
              ),
              stackSizeMb: 2,
            },
            workerData: {
              bytes: copiedBytes,
              maxOutputCharacters: this.policy.maxOutputCharacters,
            },
          });
        } catch {
          reject(new DocumentPreviewParseError());
          return;
        }
        let settled = false;
        const finish = (operation: () => void, terminate = true): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (terminate) void worker.terminate();
          release();
          operation();
        };
        const timer = setTimeout(() => {
          finish(() => reject(new DocumentPreviewTimeoutError()));
        }, this.policy.timeoutMs);

        worker.once("message", (message: unknown) => {
          try {
            const preview = parseWorkerMessage(
              message,
              normalizedMediaType,
              this.policy.maxOutputCharacters,
            );
            finish(() => resolve(preview));
          } catch {
            finish(() => reject(new DocumentPreviewParseError()));
          }
        });
        worker.once("error", () => {
          finish(() => reject(new DocumentPreviewParseError()), false);
        });
        worker.once("exit", (code) => {
          if (!settled && code !== 0) {
            finish(() => reject(new DocumentPreviewParseError()), false);
          }
        });
      });
    } finally {
      release();
    }
  }
}
