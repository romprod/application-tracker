import { describe, expect, it, vi } from "vitest";

import { OutlookEmailSyncOperationalError } from "../application/outlook_email_sync.js";
import {
  MicrosoftGraphOutlookMailReader,
  type MicrosoftGraphAccessTokenProvider,
} from "./microsoft_graph_outlook_mail.js";

const receivedAt = "2026-07-21T15:30:00.000Z";

function jsonResponse(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

function resolvedJsonResponse(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(jsonResponse(value, status, headers));
}

function graphMessage(overrides: Record<string, unknown> = {}) {
  return {
    bodyPreview: "Application received",
    from: {
      emailAddress: { address: "Recruiter@Example.com", name: "Recruiter" },
    },
    id: "message-1",
    internetMessageId: "<message-1@example.com>",
    parentFolderId: "jobs-folder",
    receivedDateTime: receivedAt,
    subject: "Application received",
    webLink: "https://outlook.office.com/mail/inbox/id/message-1",
    ...overrides,
  };
}

function tokenProvider(): MicrosoftGraphAccessTokenProvider {
  return {
    getAccessToken: vi.fn(() => Promise.resolve("graph-access-token")),
  };
}

function reader(
  fetcher: typeof fetch,
  folderPath = ["Inbox", "Jobs"],
  wait: (milliseconds: number) => Promise<unknown> = () =>
    Promise.resolve(undefined),
) {
  return new MicrosoftGraphOutlookMailReader(
    {
      folderPath,
      mailbox: "jobs@example.com",
    },
    tokenProvider(),
    fetcher,
    wait,
  );
}

describe("MicrosoftGraphOutlookMailReader", () => {
  it("verifies the configured mailbox and folder without reading messages", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn((input: string | URL | Request) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      requested.push(url);
      return resolvedJsonResponse({
        value: [{ displayName: "Jobs", id: "jobs-folder" }],
      });
    }) as unknown as typeof fetch;

    await expect(reader(fetcher).verifyConnection()).resolves.toBeUndefined();
    expect(requested).toHaveLength(1);
    expect(requested[0]?.pathname).toContain(
      "/users/jobs%40example.com/mailFolders/inbox/childFolders",
    );
    expect(requested[0]?.pathname).not.toContain("/messages");
  });

  it("traverses the configured folder and safely escapes bounded searches", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn((input: string | URL | Request) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      requested.push(url);
      if (url.pathname.includes("/mailFolders/inbox/childFolders")) {
        return resolvedJsonResponse({
          value: [{ displayName: "Recruiting", id: "recruiting-folder" }],
        });
      }
      if (
        url.pathname.includes("/mailFolders/recruiting-folder/childFolders")
      ) {
        return resolvedJsonResponse({
          value: [{ displayName: "Jobs", id: "jobs-folder" }],
        });
      }
      return resolvedJsonResponse({ value: [graphMessage()] });
    }) as unknown as typeof fetch;
    const mail = reader(fetcher, ["Inbox", "Recruiting", "Jobs"]);

    const result = await mail.searchMessages({
      companyName: 'Example "UK" \\ Labs',
      postingIds: ['abc"123'],
      roleTitle: "Platform\nEngineer",
    });

    expect(result).toMatchObject({
      messages: [
        {
          from: { address: "recruiter@example.com" },
          id: "message-1",
          searchKinds: ["company_role", "posting_id"],
        },
      ],
      queriesRun: 2,
    });
    const searches = requested
      .map((url) => url.searchParams.get("$search"))
      .filter((value): value is string => value !== null);
    expect(searches).toEqual([
      '"Example \\"UK\\" \\\\ Labs" AND "Platform Engineer"',
      '"abc\\"123"',
    ]);
    expect(
      requested.filter(({ pathname }) =>
        pathname.includes("/mailFolders/jobs-folder/messages"),
      ),
    ).toHaveLength(2);
  });

  it("lists a bounded chronological reconciliation window without reading bodies", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn((input: string | URL | Request) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      requested.push(url);
      if (url.pathname.includes("/childFolders")) {
        return resolvedJsonResponse({
          value: [{ displayName: "Jobs", id: "jobs-folder" }],
        });
      }
      return resolvedJsonResponse({
        value: [
          graphMessage({
            id: "message-2",
            internetMessageId: "<message-2@example.com>",
            receivedDateTime: "2026-07-21T16:30:00.000Z",
          }),
          graphMessage(),
        ],
      });
    }) as unknown as typeof fetch;

    const result = await reader(fetcher).listMessagesReceivedBetween({
      after: "2026-07-21T15:00:00.000Z",
      through: "2026-07-21T17:00:00.000Z",
    });

    expect(result).toMatchObject({
      messages: [
        { id: "message-1", searchKinds: [] },
        { id: "message-2", searchKinds: [] },
      ],
      truncated: false,
    });
    const request = requested.find(({ pathname }) =>
      pathname.includes("/mailFolders/jobs-folder/messages"),
    );
    expect(request?.searchParams.get("$filter")).toBe(
      "receivedDateTime gt 2026-07-21T15:00:00.000Z and receivedDateTime le 2026-07-21T17:00:00.000Z",
    );
    expect(request?.searchParams.get("$orderby")).toBe("receivedDateTime asc");
    expect(request?.searchParams.get("$select")).not.toContain("body,");
  });

  it("retains one chronological look-ahead summary for safe reconciliation batching", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn((input: string | URL | Request) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      requested.push(url);
      if (url.pathname.includes("/childFolders")) {
        return resolvedJsonResponse({
          value: [{ displayName: "Jobs", id: "jobs-folder" }],
        });
      }
      return resolvedJsonResponse({
        value: Array.from({ length: 51 }, (_, index) =>
          graphMessage({
            id: `message-${index + 1}`,
            internetMessageId: `<message-${index + 1}@example.com>`,
            receivedDateTime: `2026-07-21T16:${String(index).padStart(2, "0")}:00.000Z`,
          }),
        ),
      });
    }) as unknown as typeof fetch;

    const result = await reader(fetcher).listMessagesReceivedBetween({
      after: "2026-07-21T15:00:00.000Z",
      through: "2026-07-21T17:00:00.000Z",
    });

    expect(result.messages).toHaveLength(51);
    expect(result.messages[0]).toMatchObject({ id: "message-1" });
    expect(result.messages[50]).toMatchObject({ id: "message-51" });
    expect(result.truncated).toBe(true);
    const request = requested.find(({ pathname }) =>
      pathname.includes("/mailFolders/jobs-folder/messages"),
    );
    expect(request?.searchParams.get("$top")).toBe("51");
  });

  it("lists a bounded historical window newest-first without reading bodies", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn((input: string | URL | Request) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      requested.push(url);
      if (url.pathname.includes("/childFolders")) {
        return resolvedJsonResponse({
          value: [{ displayName: "Jobs", id: "jobs-folder" }],
        });
      }
      return resolvedJsonResponse({
        value: [
          graphMessage(),
          graphMessage({
            id: "message-2",
            internetMessageId: "<message-2@example.com>",
            receivedDateTime: "2026-07-21T16:30:00.000Z",
          }),
        ],
      });
    }) as unknown as typeof fetch;

    const result = await reader(fetcher).listMessagesReceivedBackward({
      after: "2026-07-14T17:00:00.000Z",
      before: "2026-07-21T17:00:00.000Z",
      limit: 2,
      offset: 20,
    });

    expect(result).toMatchObject({
      messages: [
        { id: "message-2", searchKinds: [] },
        { id: "message-1", searchKinds: [] },
      ],
      truncated: false,
    });
    const request = requested.find(({ pathname }) =>
      pathname.includes("/mailFolders/jobs-folder/messages"),
    );
    expect(request?.searchParams.get("$filter")).toBe(
      "receivedDateTime ge 2026-07-14T17:00:00.000Z and receivedDateTime lt 2026-07-21T17:00:00.000Z",
    );
    expect(request?.searchParams.get("$orderby")).toBe("receivedDateTime desc");
    expect(request?.searchParams.get("$skip")).toBe("20");
    expect(request?.searchParams.get("$top")).toBe("3");
    expect(request?.searchParams.get("$select")).not.toContain("body,");
  });

  it("validates stored evidence by exact RFC Message-ID and received time", async () => {
    const filters: string[] = [];
    const fetcher = vi.fn((input: string | URL | Request) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      const filter = url.searchParams.get("$filter") ?? "";
      filters.push(filter);
      if (filter.includes("missing")) {
        return resolvedJsonResponse({ value: [] });
      }
      const messageId = filter.includes("o''hare")
        ? "<o'hare@example.com>"
        : "<changed@example.com>";
      return resolvedJsonResponse({
        value: [
          graphMessage({
            internetMessageId: messageId,
            receivedDateTime:
              messageId === "<changed@example.com>"
                ? "2026-07-22T15:30:00.000Z"
                : receivedAt,
          }),
        ],
      });
    }) as unknown as typeof fetch;
    const mail = reader(fetcher);

    await expect(
      mail.validateEvidence([
        { messageId: "<o'hare@example.com>", receivedAt },
        { messageId: "<changed@example.com>", receivedAt },
        { messageId: "<missing@example.com>", receivedAt },
      ]),
    ).resolves.toEqual([
      { messageId: "<o'hare@example.com>", status: "valid" },
      { messageId: "<changed@example.com>", status: "metadata_mismatch" },
      { messageId: "<missing@example.com>", status: "not_found" },
    ]);
    expect(filters).toContain("internetMessageId eq '<o''hare@example.com>'");
  });

  it("retrieves an exact RFC Message-ID with its body only from the configured folder", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn((input: string | URL | Request) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      requested.push(url);
      if (url.pathname.includes("/childFolders")) {
        return resolvedJsonResponse({
          value: [{ displayName: "Jobs", id: "jobs-folder" }],
        });
      }
      return resolvedJsonResponse({
        value: [
          graphMessage({
            body: { content: "<p>Digest body</p>", contentType: "html" },
            internetMessageHeaders: [
              { name: "List-Unsubscribe", value: "<https://example.com>" },
            ],
            internetMessageId: "<o'hare@example.com>",
          }),
          graphMessage({
            id: "outside",
            internetMessageId: "<o'hare@example.com>",
            parentFolderId: "archive-folder",
          }),
          graphMessage({
            id: "different",
            internetMessageId: "<different@example.com>",
          }),
        ],
      });
    }) as unknown as typeof fetch;

    const result = await reader(fetcher).findMessagesByInternetMessageId(
      "<o'hare@example.com>",
    );

    expect(result).toEqual([
      expect.objectContaining({
        body: { content: "<p>Digest body</p>", contentType: "html" },
        id: "message-1",
        internetMessageId: "<o'hare@example.com>",
      }),
    ]);
    const request = requested.find(({ pathname }) =>
      pathname.includes("/mailFolders/jobs-folder/messages"),
    );
    expect(request?.searchParams.get("$filter")).toBe(
      "internetMessageId eq '<o''hare@example.com>'",
    );
    expect(request?.searchParams.get("$select")).toContain("body,");
    expect(request?.searchParams.get("$top")).toBe("2");
  });

  it("fails closed when an exact Message-ID result is unexpectedly paginated", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ displayName: "Jobs", id: "jobs-folder" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/users/jobs@example.com/messages?$skiptoken=opaque",
          value: [graphMessage()],
        }),
      ) as unknown as typeof fetch;

    await expect(
      reader(fetcher).findMessagesByInternetMessageId(
        "<message-1@example.com>",
      ),
    ).rejects.toMatchObject({ code: "outlook_graph_unavailable" });
  });

  it("retrieves full details only for messages still in the configured folder", async () => {
    const requestOptions: RequestInit[] = [];
    const fetcher = vi.fn(
      (input: string | URL | Request, options?: RequestInit) => {
        requestOptions.push(options ?? {});
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (url.pathname.includes("/childFolders")) {
          return resolvedJsonResponse({
            value: [{ displayName: "Jobs", id: "jobs-folder" }],
          });
        }
        if (url.pathname.endsWith("/messages/missing")) {
          return resolvedJsonResponse({}, 404);
        }
        if (url.pathname.endsWith("/messages/outside")) {
          return resolvedJsonResponse(
            graphMessage({ id: "outside", parentFolderId: "archive-folder" }),
          );
        }
        return resolvedJsonResponse(
          graphMessage({
            body: { content: "<p>Full message</p>", contentType: "html" },
            internetMessageHeaders: [
              { name: "List-Unsubscribe", value: "<https://example.com>" },
            ],
            replyTo: [
              {
                emailAddress: {
                  address: "Replies@Example.com",
                  name: "Replies",
                },
              },
            ],
          }),
        );
      },
    ) as unknown as typeof fetch;
    const mail = reader(fetcher);

    const details = await mail.getMessages(["message-1", "missing", "outside"]);

    expect(details).toEqual([
      expect.objectContaining({
        body: { content: "<p>Full message</p>", contentType: "html" },
        headers: [{ name: "List-Unsubscribe", value: "<https://example.com>" }],
        id: "message-1",
        replyTo: [{ address: "replies@example.com", name: "Replies" }],
      }),
    ]);
    for (const options of requestOptions) {
      expect(options).toMatchObject({
        headers: {
          Authorization: "Bearer graph-access-token",
          Prefer: 'IdType="ImmutableId"',
        },
        method: "GET",
        redirect: "error",
      });
    }
  });

  it.each([
    [401, "outlook_graph_authentication_failed"],
    [403, "outlook_graph_forbidden"],
    [404, "outlook_mailbox_unavailable"],
  ] as const)("maps Graph %i responses to %s", async (status, code) => {
    const fetcher = vi.fn(() =>
      resolvedJsonResponse({}, status),
    ) as unknown as typeof fetch;

    await expect(
      reader(fetcher).searchMessages({
        companyName: "Example",
        postingIds: [],
        roleTitle: "Engineer",
      }),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    [429, "outlook_graph_throttled"],
    [503, "outlook_graph_unavailable"],
  ] as const)("bounds retries for Graph %i responses", async (status, code) => {
    const wait = vi.fn(() => Promise.resolve(undefined));
    const fetcher = vi.fn(() =>
      resolvedJsonResponse({}, status, { "retry-after": "20" }),
    ) as unknown as typeof fetch;

    await expect(
      reader(fetcher, ["Inbox", "Jobs"], wait).searchMessages({
        companyName: "Example",
        postingIds: [],
        roleTitle: "Engineer",
      }),
    ).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(5000);
  });

  it("maps a missing search folder separately from a missing mailbox", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ displayName: "Jobs", id: "jobs-folder" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 404)) as unknown as typeof fetch;

    await expect(
      reader(fetcher).searchMessages({
        companyName: "Example",
        postingIds: [],
        roleTitle: "Engineer",
      }),
    ).rejects.toMatchObject({ code: "outlook_folder_not_found" });
  });

  it("rejects oversized Graph responses without parsing or retrying them", async () => {
    const fetcher = vi.fn(() =>
      resolvedJsonResponse({ value: [] }, 200, {
        "content-length": String(256 * 1024 + 1),
      }),
    ) as unknown as typeof fetch;

    await expect(
      reader(fetcher).searchMessages({
        companyName: "Example",
        postingIds: [],
        roleTitle: "Engineer",
      }),
    ).rejects.toBeInstanceOf(OutlookEmailSyncOperationalError);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
