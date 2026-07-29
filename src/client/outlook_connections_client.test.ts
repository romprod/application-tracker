import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserOutlookConnectionsClient,
  OutlookConnectionsClientError,
} from "./outlook_connections_client";

const connection = {
  assignedApplicationCount: 2,
  clientId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-07-28T10:00:00.000Z",
  enabled: true,
  folderPath: "Inbox\\Jobs",
  id: "33333333-3333-4333-8333-333333333333",
  lastErrorCode: null,
  lastReconciledAt: null,
  lastTestedAt: "2026-07-28T10:00:00.000Z",
  mailbox: "jobs@example.com",
  name: "Work tenant",
  secretConfigured: true,
  tenantId: "11111111-1111-4111-8111-111111111111",
  updatedAt: "2026-07-28T10:00:00.000Z",
  verifiedAt: "2026-07-28T10:00:00.000Z",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserOutlookConnectionsClient", () => {
  it("parses named connections and sends each per-connection lifecycle request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((url) =>
      Promise.resolve(
        url === "/api/settings/outlook/options"
          ? response({
              connections: [
                {
                  enabled: connection.enabled,
                  id: connection.id,
                  mailbox: connection.mailbox,
                  name: connection.name,
                },
              ],
            })
          : response({
              status: {
                connections: [connection],
                secureStorageConfigured: true,
              },
            }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const createInput = {
      clientId: connection.clientId,
      clientSecret: "private-client-secret",
      folderPath: connection.folderPath,
      mailbox: connection.mailbox,
      name: connection.name,
      tenantId: connection.tenantId,
    };
    const updateInput = {
      clientId: connection.clientId,
      folderPath: connection.folderPath,
      mailbox: connection.mailbox,
      name: connection.name,
      tenantId: connection.tenantId,
    };

    await expect(browserOutlookConnectionsClient.getStatus()).resolves.toEqual({
      connections: [connection],
      secureStorageConfigured: true,
    });
    await expect(
      browserOutlookConnectionsClient.listOptions(),
    ).resolves.toEqual([
      {
        enabled: true,
        id: connection.id,
        mailbox: connection.mailbox,
        name: connection.name,
      },
    ]);
    await browserOutlookConnectionsClient.create(createInput);
    await browserOutlookConnectionsClient.update(connection.id, updateInput);
    await browserOutlookConnectionsClient.verify(connection.id);
    await browserOutlookConnectionsClient.setEnabled(connection.id, false);
    await browserOutlookConnectionsClient.deleteConnection(connection.id, 2);

    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, init?.method]),
    ).toEqual([
      ["/api/settings/outlook", undefined],
      ["/api/settings/outlook/options", undefined],
      ["/api/settings/outlook", "POST"],
      [`/api/settings/outlook/${connection.id}`, "PUT"],
      [`/api/settings/outlook/${connection.id}/verify`, "POST"],
      [`/api/settings/outlook/${connection.id}/state`, "PATCH"],
      [`/api/settings/outlook/${connection.id}`, "DELETE"],
    ]);
    expect(fetchMock.mock.calls[6]?.[1]?.body).toBe(
      JSON.stringify({
        confirm: true,
        expectedAssignedApplicationCount: 2,
      }),
    );
  });

  it("rejects malformed success payloads and returns deletion impact details", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response({ status: { connections: [{}] } }))
        .mockResolvedValueOnce(
          response(
            {
              assignedApplicationCount: 4,
              error: { code: "outlook_connection_impact_changed" },
            },
            409,
          ),
        ),
    );

    await expect(browserOutlookConnectionsClient.getStatus()).rejects.toEqual(
      new OutlookConnectionsClientError("invalid_response"),
    );
    await expect(
      browserOutlookConnectionsClient.deleteConnection(connection.id, 2),
    ).rejects.toEqual(
      new OutlookConnectionsClientError("outlook_connection_impact_changed", 4),
    );
  });
});
