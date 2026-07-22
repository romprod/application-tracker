export type WorkspacePage =
  | "applications"
  | "documents"
  | "overview"
  | "settings-lists"
  | "settings-mcp"
  | "settings-users";

type WorkspaceRole = "admin" | "member";

const pagePaths: Record<WorkspacePage, string> = {
  applications: "/applications",
  documents: "/documents",
  overview: "/dashboard",
  "settings-lists": "/settings/lists",
  "settings-mcp": "/settings/mcp",
  "settings-users": "/settings/users",
};

const pathPages = new Map<string, WorkspacePage>([
  ["/", "overview"],
  ["/dashboard", "overview"],
  ["/applications", "applications"],
  ["/documents", "documents"],
  ["/settings", "settings-lists"],
  ["/settings/lists", "settings-lists"],
  ["/settings/mcp", "settings-mcp"],
  ["/settings/users", "settings-users"],
]);

function normalizedPath(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
}

export function workspacePagePath(page: WorkspacePage): string {
  return pagePaths[page];
}

export function resolveWorkspaceRoute(
  pathname: string,
  role: WorkspaceRole,
): { page: WorkspacePage; path: string } {
  let page = pathPages.get(normalizedPath(pathname)) ?? "overview";
  if (
    role !== "admin" &&
    (page === "settings-mcp" || page === "settings-users")
  ) {
    page = "settings-lists";
  }
  return { page, path: workspacePagePath(page) };
}
