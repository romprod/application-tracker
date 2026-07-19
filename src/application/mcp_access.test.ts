import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "./auth.js";
import {
  McpAccessForbiddenError,
  McpAccessService,
  McpWriteAccessDisabledError,
} from "./mcp_access.js";

const admin: AuthenticatedActor = {
  authenticated: true,
  user: { displayName: "Alex", role: "admin", username: "alex" },
  userId: "user-1",
  workspace: { name: "Applications" },
  workspaceId: "workspace-1",
};

describe("McpAccessService", () => {
  it("defaults to read-only and allows only administrators to change mode", () => {
    const getAccessMode = vi.fn(() => "read_only" as const);
    const setAccessMode = vi.fn();
    const service = new McpAccessService(
      { getAccessMode, setAccessMode },
      () => new Date("2026-07-19T15:00:00.000Z"),
    );

    expect(service.getAdministratorAccessMode(admin)).toBe("read_only");
    expect(() => service.requireWriteAccess(admin)).toThrow(
      McpWriteAccessDisabledError,
    );

    service.setAdministratorAccessMode(admin, "read_write");
    expect(setAccessMode).toHaveBeenCalledWith({
      accessMode: "read_write",
      updatedAt: "2026-07-19T15:00:00.000Z",
      updatedByUserId: "user-1",
      workspaceId: "workspace-1",
    });

    const member = {
      ...admin,
      user: { ...admin.user, role: "member" as const },
    };
    expect(() => service.getAdministratorAccessMode(member)).toThrow(
      McpAccessForbiddenError,
    );
    expect(() =>
      service.setAdministratorAccessMode(member, "read_write"),
    ).toThrow(McpAccessForbiddenError);
  });

  it("permits a workspace member to write when an administrator enabled it", () => {
    const service = new McpAccessService({
      getAccessMode: () => "read_write",
      setAccessMode: vi.fn(),
    });
    const member = {
      ...admin,
      user: { ...admin.user, role: "member" as const },
    };

    expect(() => service.requireWriteAccess(member)).not.toThrow();
  });
});
