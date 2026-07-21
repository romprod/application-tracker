import { burn, type Entry } from "@kenjiuno/msgreader/lib/Burner.js";
import { TypeEnum } from "@kenjiuno/msgreader/lib/Reader.js";
import { strToU8, zipSync } from "fflate";

function utf16(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(`${value}\u0000`, "utf16le"));
}

function integer(value: number): Uint8Array {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return Uint8Array.from(bytes);
}

function stream(name: string, bytes: Uint8Array): Entry {
  return {
    binaryProvider: () => bytes,
    length: bytes.byteLength,
    name,
    type: TypeEnum.DOCUMENT,
  };
}

export function docxFixture(): Buffer {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Application Tracker DOCX preview</w:t></w:r></w:p>
        <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
      </w:body>
    </w:document>`;
  return Buffer.from(
    zipSync({ "word/document.xml": strToU8(document) }, { level: 6 }),
  );
}

export function emlFixture(): Buffer {
  return Buffer.from(
    [
      "From: Hiring Manager <hiring@example.test>",
      "To: Alex Example <alex@example.test>",
      "Cc: Recruiter <recruiter@example.test>",
      "Date: Sun, 19 Jul 2026 10:00:00 +0000",
      "Subject: Application Tracker EML preview",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Your interview is scheduled for Tuesday.",
      "",
    ].join("\r\n"),
  );
}

export function msgFixture(): Buffer {
  const entries: Entry[] = [
    {
      children: [1, 2, 3, 4, 5, 6],
      length: 0,
      name: "Root Entry",
      type: TypeEnum.ROOT,
    },
    stream("__substg1.0_001A001F", utf16("IPM.Note")),
    stream("__substg1.0_0037001F", utf16("Application Tracker MSG preview")),
    stream(
      "__substg1.0_1000001F",
      utf16("Your application has moved to the interview stage."),
    ),
    stream("__substg1.0_0C1A001F", utf16("Hiring Manager")),
    stream("__substg1.0_5D01001F", utf16("hiring@example.test")),
    {
      children: [7, 8, 9],
      length: 0,
      name: "__recip_version1.0_#00000000",
      type: TypeEnum.DIRECTORY,
    },
    stream("__substg1.0_3001001F", utf16("Alex Example")),
    stream("__substg1.0_39FE001F", utf16("alex@example.test")),
    stream("__substg1.0_0C150003", integer(1)),
  ];
  return Buffer.from(burn(entries));
}

export function pdfFixture(): Buffer {
  const content =
    "BT /F1 18 Tf 72 720 Td (Application Tracker PDF preview) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${String(Buffer.byteLength(content))} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${String(objects.length + 1)}\n`;
  pdf += "0000000000 65535 f \n";
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n`;
  pdf += `startxref\n${String(xrefOffset)}\n%%EOF\n`;
  return Buffer.from(pdf);
}
