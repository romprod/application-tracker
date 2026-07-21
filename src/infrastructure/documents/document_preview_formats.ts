import MsgReaderModule, { type FieldsData } from "@kenjiuno/msgreader";
import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";
import { Parser as HtmlParser } from "htmlparser2";
import PostalMime, { type Address } from "postal-mime";
import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from "saxes";

import type {
  DocumentPreviewSource,
  EmailDocumentPreview,
  GeneratedDocumentPreview,
  TextDocumentPreview,
} from "../../application/document_previews.js";

const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EML_MEDIA_TYPE = "message/rfc822";
const MSG_MEDIA_TYPE = "application/vnd.ms-outlook";
const TEXT_MEDIA_TYPES = new Set([
  "application/json",
  "text/csv",
  "text/markdown",
  "text/plain",
]);
const EMAIL_ADDRESS_LIMIT = 25;
const EMAIL_FIELD_LIMIT = 500;
const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_FREE_SECTOR = 0xffffffff;

type MsgReaderConstructor = new (arrayBuffer: ArrayBuffer) => {
  getFileData(): FieldsData;
};

function isMsgReaderConstructor(value: unknown): value is MsgReaderConstructor {
  return typeof value === "function";
}

function resolveMsgReader(value: unknown): MsgReaderConstructor {
  if (isMsgReaderConstructor(value)) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "default" in value &&
    isMsgReaderConstructor(value.default)
  ) {
    return value.default;
  }
  throw new Error("MSG reader could not be loaded");
}

const MsgReader = resolveMsgReader(MsgReaderModule);

export interface DocumentPreviewParsePolicy {
  maxDecodedBytes: number;
  maxOutputCharacters: number;
}

function normalizedText(
  value: string,
  maximum: number,
): { text: string; truncated: boolean } {
  const normalized = value
    .replaceAll("\u0000", "")
    .replace(/\r\n?/g, "\n")
    .trim();
  return normalized.length > maximum
    ? { text: normalized.slice(0, maximum), truncated: true }
    : { text: normalized, truncated: false };
}

function boundedField(value: string | null | undefined): string | null {
  const normalized = [...(value ?? "")]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
    .join("")
    .trim();
  return normalized ? normalized.slice(0, EMAIL_FIELD_LIMIT) : null;
}

function mailboxLabel(
  name: string | null | undefined,
  address: string | null | undefined,
): string | null {
  const cleanName = boundedField(name);
  const cleanAddress = boundedField(address);
  if (
    cleanName &&
    cleanAddress &&
    cleanName.toLowerCase() !== cleanAddress.toLowerCase()
  ) {
    return `${cleanName} <${cleanAddress}>`.slice(0, EMAIL_FIELD_LIMIT);
  }
  return cleanAddress ?? cleanName;
}

function addressLabels(addresses: Address[] | undefined): string[] {
  return (addresses ?? [])
    .flatMap((address) =>
      address.group
        ? address.group.map((mailbox) =>
            mailboxLabel(mailbox.name, mailbox.address),
          )
        : [mailboxLabel(address.name, address.address)],
    )
    .filter((value): value is string => value !== null)
    .slice(0, EMAIL_ADDRESS_LIMIT);
}

function addressLabel(address: Address | undefined): string | null {
  return addressLabels(address ? [address] : [])[0] ?? null;
}

function htmlToPlainText(value: string, maximum: number): string {
  const chunks: string[] = [];
  let length = 0;
  let ignoredDepth = 0;
  const blockTags = new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "div",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "li",
    "main",
    "nav",
    "p",
    "section",
    "table",
    "td",
    "th",
    "tr",
  ]);
  const append = (text: string): void => {
    if (ignoredDepth > 0 || length >= maximum) return;
    const bounded = text.slice(0, maximum - length);
    if (!bounded) return;
    chunks.push(bounded);
    length += bounded.length;
  };
  const parser = new HtmlParser(
    {
      onclosetag(name) {
        if (name === "script" || name === "style") {
          ignoredDepth = Math.max(0, ignoredDepth - 1);
        } else if (blockTags.has(name)) {
          append("\n");
        }
      },
      onopentagname(name) {
        if (name === "script" || name === "style") ignoredDepth += 1;
        else if (name === "br") append("\n");
      },
      ontext: append,
    },
    { decodeEntities: true },
  );
  parser.end(value);
  return chunks.join("");
}

function textPreview(
  text: string,
  mediaType: string,
  maximum: number,
): TextDocumentPreview {
  return {
    kind: "text",
    mediaType,
    status: "ready",
    ...normalizedText(text, maximum),
  };
}

function attributeValue(
  tag: SaxesTagNS,
  localName: string,
): string | undefined {
  const attribute = Object.values(tag.attributes).find(
    (value): value is SaxesAttributeNS =>
      typeof value !== "string" && value.local === localName,
  );
  return attribute?.value;
}

function extractDocxXmlText(xml: string, maximum: number): string {
  const parser = new SaxesParser({ xmlns: true });
  const chunks: string[] = [];
  let length = 0;
  let textDepth = 0;
  const append = (value: string): void => {
    if (textDepth <= 0 || length >= maximum) return;
    const bounded = value.slice(0, maximum - length);
    chunks.push(bounded);
    length += bounded.length;
  };
  parser.on("doctype", () => {
    throw new Error("Document type declarations are not supported");
  });
  parser.on("opentag", (tag) => {
    if (tag.local === "t" || tag.local === "delText") textDepth += 1;
    if (tag.local === "tab") append("\t");
    if (tag.local === "br" || tag.local === "cr") append("\n");
    if (tag.local === "s") {
      const count = Math.min(
        100,
        Math.max(1, Number(attributeValue(tag, "c")) || 1),
      );
      append(" ".repeat(count));
    }
  });
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", (tag) => {
    if (tag.local === "t" || tag.local === "delText") textDepth -= 1;
    if (tag.local === "p") {
      textDepth += 1;
      append("\n\n");
      textDepth -= 1;
    }
    if (tag.local === "tc") {
      textDepth += 1;
      append("\t");
      textDepth -= 1;
    }
  });
  parser.write(xml).close();
  return chunks.join("");
}

function parseDocx(
  bytes: Uint8Array,
  policy: DocumentPreviewParsePolicy,
): TextDocumentPreview {
  let selectedBytes = 0;
  const files = unzipSync(bytes, {
    filter(file: UnzipFileInfo) {
      if (
        !/^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/i.test(
          file.name,
        )
      ) {
        return false;
      }
      if (
        !Number.isSafeInteger(file.originalSize) ||
        file.originalSize < 0 ||
        file.originalSize > policy.maxDecodedBytes
      ) {
        throw new Error("Invalid DOCX expanded size");
      }
      selectedBytes += file.originalSize;
      if (selectedBytes > policy.maxDecodedBytes) {
        throw new Error("DOCX expanded content exceeds the preview limit");
      }
      return true;
    },
  });
  if (!files["word/document.xml"]) {
    throw new Error("DOCX document body is missing");
  }
  const actualBytes = Object.values(files).reduce(
    (total, file) => total + file.byteLength,
    0,
  );
  if (actualBytes > policy.maxDecodedBytes) {
    throw new Error("DOCX expanded content exceeds the preview limit");
  }
  const names = Object.keys(files).sort((left, right) => {
    if (left === "word/document.xml") return -1;
    if (right === "word/document.xml") return 1;
    return left.localeCompare(right);
  });
  const text = names
    .map((name) =>
      extractDocxXmlText(
        strFromU8(files[name] as Uint8Array),
        policy.maxOutputCharacters,
      ),
    )
    .filter(Boolean)
    .join("\n\n");
  if (!text.trim()) throw new Error("DOCX contains no readable text");
  return textPreview(text, DOCX_MEDIA_TYPE, policy.maxOutputCharacters);
}

function emailPreview(
  input: Omit<EmailDocumentPreview, "kind" | "status" | "truncated"> & {
    truncated?: boolean;
  },
  maximum: number,
): EmailDocumentPreview {
  const bounded = normalizedText(input.text, maximum);
  return {
    cc: input.cc.slice(0, EMAIL_ADDRESS_LIMIT),
    date: boundedField(input.date),
    from: boundedField(input.from),
    kind: "email",
    mediaType: input.mediaType,
    status: "ready",
    subject: boundedField(input.subject),
    text: bounded.text,
    to: input.to.slice(0, EMAIL_ADDRESS_LIMIT),
    truncated: Boolean(input.truncated) || bounded.truncated,
  };
}

async function parseEml(
  bytes: Uint8Array,
  policy: DocumentPreviewParsePolicy,
): Promise<EmailDocumentPreview> {
  const email = await PostalMime.parse(Uint8Array.from(bytes), {
    maxHeadersSize: Math.min(
      Math.max(policy.maxDecodedBytes, 1024),
      512 * 1024,
    ),
    maxNestingDepth: 50,
  });
  const body =
    email.text ??
    (email.html
      ? htmlToPlainText(email.html, policy.maxOutputCharacters + 1)
      : "");
  return emailPreview(
    {
      cc: addressLabels(email.cc),
      date: email.date ?? null,
      from: addressLabel(email.from),
      mediaType: EML_MEDIA_TYPE,
      subject: email.subject ?? null,
      text: body,
      to: addressLabels(email.to),
    },
    policy.maxOutputCharacters,
  );
}

function assertSectorIndex(index: number, totalSectors: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= totalSectors) {
    throw new Error("Invalid MSG sector index");
  }
}

function sectorOffset(index: number, sectorSize: number): number {
  return (index + 1) * sectorSize;
}

function chain(
  start: number,
  table: readonly number[],
  maximumEntries: number,
): number[] {
  if (start === CFB_END_OF_CHAIN || start === CFB_FREE_SECTOR) return [];
  const result: number[] = [];
  const visited = new Set<number>();
  let current = start;
  while (current !== CFB_END_OF_CHAIN) {
    if (
      !Number.isInteger(current) ||
      current < 0 ||
      current >= table.length ||
      visited.has(current) ||
      result.length >= maximumEntries
    ) {
      throw new Error("Invalid MSG allocation chain");
    }
    visited.add(current);
    result.push(current);
    const next = table[current];
    if (next === undefined || next === CFB_FREE_SECTOR || next >= 0xfffffffa) {
      if (next === CFB_END_OF_CHAIN) break;
      throw new Error("Invalid MSG allocation chain terminator");
    }
    current = next;
  }
  return result;
}

function validateMsgContainer(
  bytes: Uint8Array,
  maximumDecodedBytes: number,
): void {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.byteLength < 1024 || magic.some((value, i) => bytes[i] !== value)) {
    throw new Error("Invalid MSG container header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorShift = view.getUint16(30, true);
  const miniSectorShift = view.getUint16(32, true);
  if ((sectorShift !== 9 && sectorShift !== 12) || miniSectorShift !== 6) {
    throw new Error("Unsupported MSG sector geometry");
  }
  const sectorSize = 2 ** sectorShift;
  const miniSectorSize = 2 ** miniSectorShift;
  if (bytes.byteLength % sectorSize !== 0) {
    throw new Error("Truncated MSG container");
  }
  const totalSectors = bytes.byteLength / sectorSize - 1;
  const fatSectorCount = view.getUint32(44, true);
  const firstDirectorySector = view.getUint32(48, true);
  const miniStreamCutoff = view.getUint32(56, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const miniFatSectorCount = view.getUint32(64, true);
  const firstDifatSector = view.getUint32(68, true);
  const difatSectorCount = view.getUint32(72, true);
  if (
    totalSectors < 1 ||
    fatSectorCount < 1 ||
    fatSectorCount > totalSectors ||
    miniStreamCutoff !== 4096 ||
    miniFatSectorCount > totalSectors ||
    difatSectorCount > totalSectors
  ) {
    throw new Error("Invalid MSG allocation metadata");
  }

  const fatSectorIds: number[] = [];
  for (let offset = 76; offset < 512; offset += 4) {
    const value = view.getUint32(offset, true);
    if (value !== CFB_FREE_SECTOR) fatSectorIds.push(value);
  }
  const visitedDifat = new Set<number>();
  let difatSector = firstDifatSector;
  const difatEntriesPerSector = sectorSize / 4 - 1;
  for (let count = 0; count < difatSectorCount; count += 1) {
    assertSectorIndex(difatSector, totalSectors);
    if (visitedDifat.has(difatSector)) {
      throw new Error("Cyclic MSG DIFAT chain");
    }
    visitedDifat.add(difatSector);
    const offset = sectorOffset(difatSector, sectorSize);
    for (let index = 0; index < difatEntriesPerSector; index += 1) {
      const value = view.getUint32(offset + index * 4, true);
      if (value !== CFB_FREE_SECTOR) fatSectorIds.push(value);
    }
    difatSector = view.getUint32(offset + difatEntriesPerSector * 4, true);
  }
  if (
    fatSectorIds.length !== fatSectorCount ||
    new Set(fatSectorIds).size !== fatSectorIds.length
  ) {
    throw new Error("Invalid MSG FAT sector list");
  }
  const fat: number[] = [];
  for (const fatSectorId of fatSectorIds) {
    assertSectorIndex(fatSectorId, totalSectors);
    const offset = sectorOffset(fatSectorId, sectorSize);
    for (let index = 0; index < sectorSize; index += 4) {
      fat.push(view.getUint32(offset + index, true));
    }
  }
  const directorySectors = chain(firstDirectorySector, fat, totalSectors);
  if (directorySectors.length === 0) {
    throw new Error("MSG directory is missing");
  }
  const directory = Buffer.concat(
    directorySectors.map((sector) => {
      const offset = sectorOffset(sector, sectorSize);
      return Buffer.from(bytes.buffer, bytes.byteOffset + offset, sectorSize);
    }),
  );

  const miniFatSectorIds = chain(
    firstMiniFatSector,
    fat,
    Math.max(1, miniFatSectorCount),
  );
  if (miniFatSectorIds.length !== miniFatSectorCount) {
    throw new Error("Invalid MSG mini FAT chain");
  }
  const miniFat: number[] = [];
  for (const sector of miniFatSectorIds) {
    const offset = sectorOffset(sector, sectorSize);
    for (let index = 0; index < sectorSize; index += 4) {
      miniFat.push(view.getUint32(offset + index, true));
    }
  }

  const entryCount = directory.byteLength / 128;
  const directoryView = new DataView(
    directory.buffer,
    directory.byteOffset,
    directory.byteLength,
  );
  const hierarchyEdges = new Map<number, number[]>();
  let rootMiniStreamSize = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    const offset = entry * 128;
    const nameBytes = directoryView.getUint16(offset + 64, true);
    const type = directoryView.getUint8(offset + 66);
    if (type === 0) continue;
    if (
      (type !== 1 && type !== 2 && type !== 5) ||
      nameBytes < 2 ||
      nameBytes > 64 ||
      nameBytes % 2 !== 0
    ) {
      throw new Error("Invalid MSG directory entry");
    }
    const edges = [68, 72, 76]
      .map((memberOffset) =>
        directoryView.getInt32(offset + memberOffset, true),
      )
      .filter((value) => value !== -1);
    if (edges.some((value) => value < 0 || value >= entryCount)) {
      throw new Error("Invalid MSG directory hierarchy");
    }
    hierarchyEdges.set(entry, edges);

    const start = directoryView.getUint32(offset + 116, true);
    const size = Number(directoryView.getBigUint64(offset + 120, true));
    if (!Number.isSafeInteger(size) || size > maximumDecodedBytes) {
      throw new Error("MSG stream exceeds the decoded preview limit");
    }
    if (type === 5) rootMiniStreamSize = size;
    if (size === 0) continue;
    if (type === 5 || size >= miniStreamCutoff) {
      const sectors = chain(start, fat, totalSectors);
      if (sectors.length * sectorSize < size) {
        throw new Error("Truncated MSG stream");
      }
    } else {
      const miniSectors = chain(start, miniFat, miniFat.length);
      if (miniSectors.length * miniSectorSize < size) {
        throw new Error("Truncated MSG mini stream");
      }
    }
  }
  const maximumMiniSectors = Math.ceil(rootMiniStreamSize / miniSectorSize);
  if (
    miniFat.some(
      (next, index) =>
        index < maximumMiniSectors &&
        next !== CFB_END_OF_CHAIN &&
        next !== CFB_FREE_SECTOR &&
        next >= maximumMiniSectors,
    )
  ) {
    throw new Error("Invalid MSG mini stream allocation");
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (entry: number): void => {
    if (visiting.has(entry)) throw new Error("Cyclic MSG directory hierarchy");
    if (visited.has(entry)) return;
    visiting.add(entry);
    for (const next of hierarchyEdges.get(entry) ?? []) visit(next);
    visiting.delete(entry);
    visited.add(entry);
  };
  visit(0);
}

function recipientLabels(fields: FieldsData, type: "to" | "cc"): string[] {
  return (fields.recipients ?? [])
    .filter((recipient) => recipient.recipType === type)
    .map((recipient) =>
      mailboxLabel(recipient.name, recipient.smtpAddress ?? recipient.email),
    )
    .filter((value): value is string => value !== null)
    .slice(0, EMAIL_ADDRESS_LIMIT);
}

function parseMsg(
  bytes: Uint8Array,
  policy: DocumentPreviewParsePolicy,
): EmailDocumentPreview {
  validateMsgContainer(bytes, policy.maxDecodedBytes);
  const copied = Uint8Array.from(bytes);
  const arrayBuffer = copied.buffer.slice(
    copied.byteOffset,
    copied.byteOffset + copied.byteLength,
  );
  const fields = new MsgReader(arrayBuffer).getFileData();
  if (fields.error) throw new Error("MSG parsing failed");
  const html =
    fields.bodyHtml ??
    (fields.html ? new TextDecoder().decode(fields.html) : undefined);
  const body =
    fields.body ??
    (html ? htmlToPlainText(html, policy.maxOutputCharacters + 1) : "");
  return emailPreview(
    {
      cc: recipientLabels(fields, "cc"),
      date:
        fields.messageDeliveryTime ??
        fields.clientSubmitTime ??
        fields.creationTime ??
        null,
      from: mailboxLabel(
        fields.senderName,
        fields.senderSmtpAddress ?? fields.senderEmail,
      ),
      mediaType: MSG_MEDIA_TYPE,
      subject: fields.subject ?? null,
      text: body,
      to: recipientLabels(fields, "to"),
    },
    policy.maxOutputCharacters,
  );
}

function binaryLooking(bytes: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  let suspicious = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) return true;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) suspicious += 1;
  }
  return suspicious > Math.max(1, Math.floor(text.length / 100));
}

export async function parseDocumentPreview(
  bytes: Uint8Array,
  source: DocumentPreviewSource,
  policy: DocumentPreviewParsePolicy,
): Promise<GeneratedDocumentPreview> {
  if (source.mediaType === DOCX_MEDIA_TYPE) return parseDocx(bytes, policy);
  if (source.mediaType === EML_MEDIA_TYPE) return await parseEml(bytes, policy);
  if (source.mediaType === MSG_MEDIA_TYPE) return parseMsg(bytes, policy);
  if (TEXT_MEDIA_TYPES.has(source.mediaType)) {
    if (binaryLooking(bytes)) throw new Error("Binary-looking text document");
    return textPreview(
      new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      source.mediaType,
      policy.maxOutputCharacters,
    );
  }
  return { mediaType: source.mediaType, status: "unsupported" };
}
