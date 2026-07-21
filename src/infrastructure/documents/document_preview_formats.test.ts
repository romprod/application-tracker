import { describe, expect, it } from "vitest";

import {
  docxFixture,
  emlFixture,
  msgFixture,
} from "../../../e2e/document_preview_fixtures.js";
import { parseDocumentPreview } from "./document_preview_formats.js";

const policy = {
  maxDecodedBytes: 8_388_608,
  maxOutputCharacters: 10_000,
};

describe("document preview format parsers", () => {
  it("extracts readable text from a real DOCX container", async () => {
    await expect(
      parseDocumentPreview(
        docxFixture(),
        {
          mediaType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          originalFilename: "cover-letter.docx",
        },
        policy,
      ),
    ).resolves.toEqual({
      kind: "text",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      status: "ready",
      text: "Application Tracker DOCX preview\n\nSecond paragraph",
      truncated: false,
    });
  });

  it("extracts a structured EML envelope and plain-text body", async () => {
    await expect(
      parseDocumentPreview(
        emlFixture(),
        { mediaType: "message/rfc822", originalFilename: "reply.eml" },
        policy,
      ),
    ).resolves.toEqual({
      cc: ["Recruiter <recruiter@example.test>"],
      date: "2026-07-19T10:00:00.000Z",
      from: "Hiring Manager <hiring@example.test>",
      kind: "email",
      mediaType: "message/rfc822",
      status: "ready",
      subject: "Application Tracker EML preview",
      text: "Your interview is scheduled for Tuesday.",
      to: ["Alex Example <alex@example.test>"],
      truncated: false,
    });
  });

  it("converts HTML-only EML bodies to inert text", async () => {
    const email = Buffer.from(
      [
        "From: hiring@example.test",
        "To: alex@example.test",
        "Subject: HTML-only message",
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<style>.hidden { color: red }</style><p>Hello <b>Alex</b></p><script>unsafe()</script>",
      ].join("\r\n"),
    );

    const preview = await parseDocumentPreview(
      email,
      { mediaType: "message/rfc822", originalFilename: "html.eml" },
      policy,
    );
    expect(preview).toMatchObject({
      kind: "email",
      status: "ready",
      text: "Hello Alex",
    });
  });

  it("extracts a structured Outlook MSG envelope and body", async () => {
    await expect(
      parseDocumentPreview(
        msgFixture(),
        {
          mediaType: "application/vnd.ms-outlook",
          originalFilename: "reply.msg",
        },
        policy,
      ),
    ).resolves.toEqual({
      cc: [],
      date: null,
      from: "Hiring Manager <hiring@example.test>",
      kind: "email",
      mediaType: "application/vnd.ms-outlook",
      status: "ready",
      subject: "Application Tracker MSG preview",
      text: "Your application has moved to the interview stage.",
      to: ["Alex Example <alex@example.test>"],
      truncated: false,
    });
  });

  it("fails closed for binary-looking text and decoded DOCX expansion", async () => {
    await expect(
      parseDocumentPreview(
        Buffer.from([0, 1, 2, 3]),
        { mediaType: "text/plain", originalFilename: "binary.txt" },
        policy,
      ),
    ).rejects.toThrow("Binary-looking text document");
    await expect(
      parseDocumentPreview(
        docxFixture(),
        {
          mediaType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          originalFilename: "expanded.docx",
        },
        { ...policy, maxDecodedBytes: 64 },
      ),
    ).rejects.toThrow("Invalid DOCX expanded size");
  });
});
