import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import {
  InsufficientMcpScopeError,
  InvalidMcpAccessTokenError,
  RemoteMcpActorUnavailableError,
  RemoteMcpAuthorizationService,
  type McpAccessTokenVerifier,
  type RemoteMcpActorRepository,
} from "./mcp_oauth.js";

const actor: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};

function serviceWith(
  scopes: string[],
  resolvedActor: AuthenticatedActor | null = actor,
) {
  const verify = vi.fn(() =>
    Promise.resolve({
      issuer: "https://identity.example/application/o/mcp/",
      scopes: new Set(scopes),
      subject: "identity-123",
    }),
  );
  const findActiveActor = vi.fn(() => resolvedActor ?? undefined);
  const verifier: McpAccessTokenVerifier = { verify };
  const repository: RemoteMcpActorRepository = { findActiveActor };
  return {
    findActiveActor,
    service: new RemoteMcpAuthorizationService(
      verifier,
      repository,
      "tracker:read",
      "default",
    ),
    verify,
  };
}

describe("RemoteMcpAuthorizationService", () => {
  it("maps an exact granted scope and verified identity to a local actor", async () => {
    const { findActiveActor, service, verify } = serviceWith([
      "openid",
      "tracker:read",
    ]);

    await expect(service.authorize("signed-token")).resolves.toEqual({
      accessMode: "read_only",
      actor,
      principalId:
        "oauth:https://identity.example/application/o/mcp/:identity-123",
      workspaceSlug: "default",
    });
    expect(verify).toHaveBeenCalledWith("signed-token");
    expect(findActiveActor).toHaveBeenCalledWith({
      issuer: "https://identity.example/application/o/mcp/",
      subject: "identity-123",
      workspaceSlug: "default",
    });
  });

  it("rejects a similar but non-matching scope", async () => {
    const { findActiveActor, service } = serviceWith(["tracker:read:all"]);

    await expect(service.authorize("signed-token")).rejects.toBeInstanceOf(
      InsufficientMcpScopeError,
    );
    expect(findActiveActor).not.toHaveBeenCalled();
  });

  it("rejects an identity without an active workspace membership", async () => {
    const { service } = serviceWith(["tracker:read"], null);

    await expect(service.authorize("signed-token")).rejects.toBeInstanceOf(
      RemoteMcpActorUnavailableError,
    );
  });

  it("does not replace a verifier's stable token error", async () => {
    const verifier: McpAccessTokenVerifier = {
      verify: vi.fn(() => Promise.reject(new InvalidMcpAccessTokenError())),
    };
    const repository: RemoteMcpActorRepository = {
      findActiveActor: vi.fn(),
    };
    const service = new RemoteMcpAuthorizationService(
      verifier,
      repository,
      "tracker:read",
      "default",
    );

    await expect(service.authorize("bad-token")).rejects.toBeInstanceOf(
      InvalidMcpAccessTokenError,
    );
  });
});
