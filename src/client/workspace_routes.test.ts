import { describe, expect, it } from "vitest";

import { resolveWorkspaceRoute, workspacePagePath } from "./workspace_routes";

describe("workspace routes", () => {
  it.each([
    ["/", "overview", "/dashboard"],
    ["/dashboard/", "overview", "/dashboard"],
    ["/applications", "applications", "/applications"],
    ["/documents", "documents", "/documents"],
    ["/settings", "settings-lists", "/settings/lists"],
    ["/settings/lists", "settings-lists", "/settings/lists"],
    ["/settings/users", "settings-users", "/settings/users"],
    ["/settings/mcp", "settings-mcp", "/settings/mcp"],
    ["/unknown", "overview", "/dashboard"],
  ] as const)("resolves %s to %s", (pathname, page, path) => {
    expect(resolveWorkspaceRoute(pathname, "admin")).toEqual({ page, path });
  });

  it("redirects member-only access to viewable settings", () => {
    expect(resolveWorkspaceRoute("/settings/users", "member")).toEqual({
      page: "settings-lists",
      path: "/settings/lists",
    });
    expect(resolveWorkspaceRoute("/settings/mcp", "member")).toEqual({
      page: "settings-lists",
      path: "/settings/lists",
    });
  });

  it("provides a canonical path for every page", () => {
    expect(workspacePagePath("overview")).toBe("/dashboard");
    expect(workspacePagePath("applications")).toBe("/applications");
    expect(workspacePagePath("documents")).toBe("/documents");
    expect(workspacePagePath("settings-lists")).toBe("/settings/lists");
    expect(workspacePagePath("settings-users")).toBe("/settings/users");
    expect(workspacePagePath("settings-mcp")).toBe("/settings/mcp");
  });
});
