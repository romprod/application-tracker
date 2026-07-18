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

const authenticatedSession: AuthenticatedSession = {
  authenticated: true,
  user: {
    displayName: "Alex Example",
    role: "admin",
    username: "alex",
  },
  workspace: { name: "Applications" },
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
