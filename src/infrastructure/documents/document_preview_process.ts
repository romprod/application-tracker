import { parseDocumentPreview } from "./document_preview_formats.js";

interface PreviewProcessRequest {
  bytes: string;
  maxDecodedBytes: number;
  maxOutputCharacters: number;
  source: {
    mediaType: string;
    originalFilename: string;
  };
}

function validRequest(value: unknown): value is PreviewProcessRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<PreviewProcessRequest>;
  return (
    typeof candidate.bytes === "string" &&
    candidate.bytes.length > 0 &&
    Number.isSafeInteger(candidate.maxDecodedBytes) &&
    (candidate.maxDecodedBytes ?? 0) >= 1024 &&
    Number.isSafeInteger(candidate.maxOutputCharacters) &&
    (candidate.maxOutputCharacters ?? 0) >= 1000 &&
    typeof candidate.source === "object" &&
    candidate.source !== null &&
    typeof candidate.source.mediaType === "string" &&
    typeof candidate.source.originalFilename === "string"
  );
}

async function readRequest(): Promise<PreviewProcessRequest> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of process.stdin as AsyncIterable<unknown>) {
    if (!(typeof chunk === "string" || chunk instanceof Uint8Array)) {
      throw new Error("Invalid preview request chunk");
    }
    const bytes =
      typeof chunk === "string" ? Buffer.from(chunk) : Uint8Array.from(chunk);
    length += bytes.byteLength;
    if (length > 16 * 1024 * 1024) throw new Error("Preview request too large");
    chunks.push(bytes);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!validRequest(parsed)) throw new Error("Invalid preview request");
  return parsed;
}

try {
  const request = await readRequest();
  const bytes = Buffer.from(request.bytes, "base64");
  const preview = await parseDocumentPreview(bytes, request.source, {
    maxDecodedBytes: request.maxDecodedBytes,
    maxOutputCharacters: request.maxOutputCharacters,
  });
  process.stdout.write(JSON.stringify(preview));
} catch {
  process.exitCode = 1;
}
