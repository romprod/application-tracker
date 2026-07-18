import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthClientError } from "./auth_client";
import type {
  AuthClient,
  AuthSession,
  AuthenticatedSession,
} from "./auth_client";
import type { SetupClient } from "./setup_client";
import type { McpStatus, McpStatusClient } from "./mcp_status_client";
import type { ManagedUser, UsersClient } from "./users_client";

const authenticatedSession: AuthenticatedSession = {
  authenticated: true,
  user: {
    displayName: "Alex Example",
    role: "admin",
    username: "alex",
  },
  workspace: { name: "Applications" },
};

const administrator: ManagedUser = {
  createdAt: "2026-01-01T00:00:00.000Z",
  displayName: "Alex Example",
  id: "11111111-1111-4111-8111-111111111111",
  isCurrentUser: true,
  localAccount: true,
  role: "admin",
  status: "active",
  username: "alex",
};

const member: ManagedUser = {
  createdAt: "2026-01-02T00:00:00.000Z",
  displayName: "Sam Member",
  id: "22222222-2222-4222-8222-222222222222",
  isCurrentUser: false,
  localAccount: true,
  role: "member",
  status: "active",
  username: "sam",
};

const mcpStatus: McpStatus = {
  availability: "planned",
  capabilities: {
    auditEvents: false,
    oauthVerification: false,
    registeredTools: 0,
  },
  sessions: {
    absoluteLifetimeSeconds: 14_400,
    active: 0,
    enforcement: "inactive",
    globalLimit: 6,
    idleTimeoutSeconds: 900,
    initializing: 0,
    perActorLimit: 2,
  },
  transports: {
    local: { state: "unavailable", transport: "stdio" },
    remote: { state: "disabled", transport: "streamable_http" },
  },
};

function createSetupClient(
  status: Awaited<ReturnType<SetupClient["getStatus"]>>,
) {
  return {
    completeSetup: vi.fn<SetupClient["completeSetup"]>().mockResolvedValue({
      administrator: {
        displayName: "Alex Example",
        id: "user-0000000001",
        username: "alex",
      },
      workspace: { id: "workspace-00001", name: "Applications" },
    }),
    getStatus: vi.fn<SetupClient["getStatus"]>().mockResolvedValue(status),
  } satisfies SetupClient;
}

function createAuthClient(session: AuthSession) {
  return {
    getSession: vi.fn<AuthClient["getSession"]>().mockResolvedValue(session),
    login: vi.fn<AuthClient["login"]>().mockResolvedValue(authenticatedSession),
    logout: vi.fn<AuthClient["logout"]>().mockResolvedValue(),
  } satisfies AuthClient;
}

function createUsersClient(users: ManagedUser[] = [administrator, member]) {
  return {
    createUser: vi.fn<UsersClient["createUser"]>().mockResolvedValue(member),
    listUsers: vi.fn<UsersClient["listUsers"]>().mockResolvedValue(users),
    setStatus: vi
      .fn<UsersClient["setStatus"]>()
      .mockImplementation((userId, status) => {
        const user = users.find((candidate) => candidate.id === userId);
        return user
          ? Promise.resolve({ ...user, status })
          : Promise.reject(new Error("Missing test user"));
      }),
  } satisfies UsersClient;
}

function createMcpStatusClient() {
  return {
    getStatus: vi
      .fn<McpStatusClient["getStatus"]>()
      .mockResolvedValue(mcpStatus),
  } satisfies McpStatusClient;
}

describe("application shell", () => {
  it("asks an unauthenticated user to sign in after setup", async () => {
    render(
      <App
        authClient={createAuthClient({ authenticated: false })}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Sign in to your workspace.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "autocomplete",
      "username",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("opens the workspace for an existing authenticated session", async () => {
    render(
      <App
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Your search, kept in order.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alex Example")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("signs in with local credentials", async () => {
    const authClient = createAuthClient({ authenticated: false });
    render(
      <App
        authClient={authClient}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    await screen.findByRole("heading", { name: "Sign in to your workspace." });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "alex" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(authClient.login).toHaveBeenCalledWith({
        password: "correct horse battery staple",
        username: "alex",
      });
    });
    expect(
      await screen.findByRole("heading", {
        name: "Your search, kept in order.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("correct horse battery staple"),
    ).not.toBeInTheDocument();
  });

  it("does not reveal which credential was rejected", async () => {
    const authClient = createAuthClient({ authenticated: false });
    authClient.login.mockRejectedValue(
      new AuthClientError("invalid_credentials"),
    );
    render(
      <App
        authClient={authClient}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    await screen.findByRole("heading", { name: "Sign in to your workspace." });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "unknown-user" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "incorrect password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The username or password was not accepted.",
    );
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("revokes the session when the user signs out", async () => {
    const authClient = createAuthClient(authenticatedSession);
    render(
      <App
        authClient={authClient}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(authClient.logout).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("heading", {
        name: "Sign in to your workspace.",
      }),
    ).toBeInTheDocument();
  });

  it("opens the Users submenu from Settings for an administrator", async () => {
    const usersClient = createUsersClient();
    render(
      <App
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
        usersClient={usersClient}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect(
      await screen.findByRole("heading", { name: "Users and access." }),
    ).toBeInTheDocument();
    expect(usersClient.listUsers).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("navigation", { name: "Settings navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sam Member")).toBeInTheDocument();
  });

  it("opens the sanitized MCP status from Settings", async () => {
    const mcpStatusClient = createMcpStatusClient();
    render(
      <App
        authClient={createAuthClient(authenticatedSession)}
        mcpStatusClient={mcpStatusClient}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "MCP" }));

    expect(
      await screen.findByRole("heading", { name: "MCP, without blind spots." }),
    ).toBeInTheDocument();
    expect(mcpStatusClient.getStatus).toHaveBeenCalledOnce();
    expect(screen.getByText("Configured, not enforced")).toBeInTheDocument();
    expect(screen.getByText("6 session ceiling")).toBeInTheDocument();
    expect(screen.queryByText(/example-idp/i)).not.toBeInTheDocument();
  });

  it("creates a local user from Settings without retaining the password", async () => {
    const createdUser = {
      ...member,
      displayName: "Riley Admin",
      id: "33333333-3333-4333-8333-333333333333",
      role: "admin" as const,
      username: "riley",
    };
    const usersClient = createUsersClient([administrator]);
    usersClient.createUser.mockResolvedValue(createdUser);
    render(
      <App
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
        usersClient={usersClient}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Add a local account" });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Riley Admin" },
    });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "riley" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "riley password phrase" },
    });
    fireEvent.change(screen.getByLabelText("Workspace role"), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() =>
      expect(usersClient.createUser).toHaveBeenCalledWith({
        displayName: "Riley Admin",
        password: "riley password phrase",
        role: "admin",
        username: "riley",
      }),
    );
    expect(await screen.findByText("Riley Admin")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("disables another user and reflects the returned status", async () => {
    const usersClient = createUsersClient();
    render(
      <App
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
        usersClient={usersClient}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Disable Sam Member" }),
    );

    await waitFor(() =>
      expect(usersClient.setStatus).toHaveBeenCalledWith(member.id, "disabled"),
    );
    expect(await screen.findByText("Disabled")).toBeInTheDocument();
  });

  it("explains how to configure a missing setup token", async () => {
    const authClient = createAuthClient({ authenticated: false });
    render(
      <App
        authClient={authClient}
        setupClient={createSetupClient({
          required: true,
          tokenConfigured: false,
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "A setup token is required.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(authClient.getSession).not.toHaveBeenCalled();
  });

  it("creates the first administrator and continues to sign in", async () => {
    const setupClient = createSetupClient({
      required: true,
      tokenConfigured: true,
    });
    render(
      <App
        authClient={createAuthClient({ authenticated: false })}
        setupClient={setupClient}
      />,
    );

    await screen.findByRole("heading", {
      name: "Create the first administrator.",
    });
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Applications" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Alex Example" },
    });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "alex" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.change(screen.getByLabelText("One-time setup token"), {
      target: { value: "a".repeat(64) },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create administrator" }),
    );

    await waitFor(() => {
      expect(setupClient.completeSetup).toHaveBeenCalledWith({
        displayName: "Alex Example",
        password: "correct horse battery staple",
        setupToken: "a".repeat(64),
        username: "alex",
        workspaceName: "Applications",
      });
    });
    expect(
      await screen.findByText(
        "Administrator created. Sign in with your new account.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("a".repeat(64))).not.toBeInTheDocument();
  });
});
