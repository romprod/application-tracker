import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthService, AuthenticatedActor } from "../application/auth.js";
import {
  OutlookGraphClientSecretRequiredError,
  OutlookGraphConnectionImpactChangedError,
  OutlookGraphConnectionNameConflictError,
  OutlookGraphConnectionNotFoundError,
  type OutlookGraphConnectionsService,
} from "../application/outlook_graph_connections.js";
import { OutlookEmailSyncOperationalError } from "../application/outlook_email_sync.js";
import { createApp } from "./app.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: {
    displayName: "Alex Example",
    role: "admin",
    username: "alex",
  },
  userId: "user-admin",
  workspace: { name: "Applications" },
  workspaceId: "workspace-applications",
};

const connectionId = "33333333-3333-4333-8333-333333333333";
const connection = {
  assignedApplicationCount: 2,
  clientId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-07-28T10:00:00.000Z",
  enabled: true,
  folderPath: "Inbox\\Jobs",
  id: connectionId,
  lastErrorCode: null,
  lastTestedAt: "2026-07-28T10:00:00.000Z",
  mailbox: "jobs@example.com",
  name: "Work tenant",
  secretConfigured: true as const,
  tenantId: "11111111-1111-4111-8111-111111111111",
  updatedAt: "2026-07-28T10:00:00.000Z",
  verifiedAt: "2026-07-28T10:00:00.000Z",
};
const status = {
  connections: [connection],
  secureStorageConfigured: true,
};

function authService(): AuthService {
  return {
    getActor: vi.fn((token: string | undefined) => {
      if (token === "admin-token") return actor;
      if (token === "member-token") {
        return {
          ...actor,
          user: { ...actor.user, role: "member" as const },
        };
      }
      return undefined;
    }),
  } as unknown as AuthService;
}

function service() {
  const create = vi.fn(() => Promise.resolve(status));
  const deleteConnection = vi.fn(() => ({
    connections: [],
    secureStorageConfigured: true,
  }));
  const getStatus = vi.fn(() => status);
  const listOptions = vi.fn(() => [
    {
      enabled: true,
      id: connectionId,
      mailbox: connection.mailbox,
      name: connection.name,
    },
  ]);
  const setEnabled = vi.fn(() => Promise.resolve(status));
  const update = vi.fn(() => Promise.resolve(status));
  const verify = vi.fn(() => Promise.resolve(status));
  const graphService = {
    create,
    delete: deleteConnection,
    getStatus,
    listOptions,
    setEnabled,
    update,
    verify,
  } as unknown as OutlookGraphConnectionsService;
  return {
    create,
    deleteConnection,
    getStatus,
    graphService,
    listOptions,
    setEnabled,
    update,
    verify,
  };
}

function authenticated(
  test: request.Test,
  token = "admin-token",
): request.Test {
  return test.set(
    "Cookie",
    `application_tracker_session=${encodeURIComponent(token)}`,
  );
}

function sameOrigin(test: request.Test): request.Test {
  return test
    .set("Host", "tracker.example.test")
    .set("Origin", "https://tracker.example.test");
}

describe("Outlook Graph connection routes", () => {
  it("protects administrator settings while exposing safe options to members", async () => {
    const graph = service();
    const app = createApp({
      authService: authService(),
      outlookGraphConnectionsService: graph.graphService,
    });
    await request(app)
      .get("/api/settings/outlook")
      .expect(401, { error: { code: "authentication_required" } });
    await authenticated(
      request(app).get("/api/settings/outlook"),
      "member-token",
    ).expect(403, { error: { code: "forbidden" } });
    await authenticated(
      request(app).get("/api/settings/outlook/options"),
      "member-token",
    ).expect(200, {
      connections: [
        {
          enabled: true,
          id: connectionId,
          mailbox: connection.mailbox,
          name: connection.name,
        },
      ],
    });
    expect(graph.listOptions).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: actor.workspaceId }),
    );
  });

  it("reports unavailable secure storage without exposing settings", async () => {
    const app = createApp({ authService: authService() });
    const response = await authenticated(
      request(app).get("/api/settings/outlook"),
    ).expect(200);
    expect(response.body).toEqual({
      status: { connections: [], secureStorageConfigured: false },
    });
    await authenticated(
      request(app).get("/api/settings/outlook/options"),
      "member-token",
    ).expect(200, { connections: [] });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects cross-origin mutations before accepting credentials", async () => {
    const app = createApp({
      authService: authService(),
      outlookGraphConnectionsService: service().graphService,
    });
    await authenticated(
      request(app)
        .post("/api/settings/outlook")
        .set("Host", "tracker.example.test")
        .set("Origin", "https://other.example.test"),
    )
      .send({})
      .expect(403, { error: { code: "csrf_rejected" } });
  });

  it("creates, edits, verifies, disables, and deletes one named connection", async () => {
    const graph = service();
    const app = createApp({
      authService: authService(),
      outlookGraphConnectionsService: graph.graphService,
    });
    const input = {
      clientId: connection.clientId,
      clientSecret: "private-client-secret",
      folderPath: connection.folderPath,
      mailbox: connection.mailbox,
      name: connection.name,
      tenantId: connection.tenantId,
    };

    const created = await sameOrigin(
      authenticated(request(app).post("/api/settings/outlook")),
    )
      .send(input)
      .expect(201);
    expect(graph.create).toHaveBeenCalledWith(actor, input);
    expect(JSON.stringify(created.body)).not.toContain(input.clientSecret);

    const updateInput = { ...input, clientSecret: undefined };
    await sameOrigin(
      authenticated(request(app).put(`/api/settings/outlook/${connectionId}`)),
    )
      .send(updateInput)
      .expect(200);
    expect(graph.update).toHaveBeenCalledWith(actor, connectionId, updateInput);

    await sameOrigin(
      authenticated(
        request(app).post(`/api/settings/outlook/${connectionId}/verify`),
      ),
    )
      .send({})
      .expect(200);
    expect(graph.verify).toHaveBeenCalledWith(actor, connectionId);

    await sameOrigin(
      authenticated(
        request(app).patch(`/api/settings/outlook/${connectionId}/state`),
      ),
    )
      .send({ enabled: false })
      .expect(200);
    expect(graph.setEnabled).toHaveBeenCalledWith(actor, connectionId, false);

    await sameOrigin(
      authenticated(
        request(app).delete(`/api/settings/outlook/${connectionId}`),
      ),
    )
      .send({ confirm: true })
      .expect(400, { error: { code: "confirmation_required" } });
    await sameOrigin(
      authenticated(
        request(app).delete(`/api/settings/outlook/${connectionId}`),
      ),
    )
      .send({ confirm: true, expectedAssignedApplicationCount: 2 })
      .expect(200);
    expect(graph.deleteConnection).toHaveBeenCalledWith(actor, connectionId, 2);
  });

  it("maps lifecycle, impact, duplicate-name, and Graph failures to stable errors", async () => {
    const graph = service();
    graph.update.mockRejectedValueOnce(
      new OutlookGraphClientSecretRequiredError(),
    );
    graph.verify.mockRejectedValueOnce(
      new OutlookEmailSyncOperationalError("outlook_graph_throttled"),
    );
    graph.setEnabled.mockRejectedValueOnce(
      new OutlookGraphConnectionNotFoundError(),
    );
    graph.create.mockRejectedValueOnce(
      new OutlookGraphConnectionNameConflictError(),
    );
    graph.deleteConnection.mockImplementationOnce(() => {
      throw new OutlookGraphConnectionImpactChangedError(4);
    });
    const app = createApp({
      authService: authService(),
      outlookGraphConnectionsService: graph.graphService,
    });
    const input = {
      clientId: connection.clientId,
      folderPath: connection.folderPath,
      mailbox: connection.mailbox,
      name: connection.name,
      tenantId: connection.tenantId,
    };

    await sameOrigin(
      authenticated(request(app).put(`/api/settings/outlook/${connectionId}`)),
    )
      .send(input)
      .expect(409, { error: { code: "outlook_client_secret_required" } });
    await sameOrigin(
      authenticated(
        request(app).post(`/api/settings/outlook/${connectionId}/verify`),
      ),
    )
      .send({})
      .expect(503, { error: { code: "outlook_graph_throttled" } });
    await sameOrigin(
      authenticated(
        request(app).patch(`/api/settings/outlook/${connectionId}/state`),
      ),
    )
      .send({ enabled: true })
      .expect(404, { error: { code: "outlook_connection_not_found" } });
    await sameOrigin(authenticated(request(app).post("/api/settings/outlook")))
      .send({ ...input, clientSecret: "secret" })
      .expect(409, { error: { code: "outlook_connection_name_conflict" } });
    await sameOrigin(
      authenticated(
        request(app).delete(`/api/settings/outlook/${connectionId}`),
      ),
    )
      .send({ confirm: true, expectedAssignedApplicationCount: 2 })
      .expect(409, {
        assignedApplicationCount: 4,
        error: { code: "outlook_connection_impact_changed" },
      });
  });
});
