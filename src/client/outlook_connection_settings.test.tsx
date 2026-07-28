import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  OutlookConnectionsClient,
  OutlookGraphConnection,
  OutlookGraphConnectionStatus,
} from "./outlook_connections_client";
import { OutlookConnectionSettings } from "./outlook_connection_settings";

const connection: OutlookGraphConnection = {
  assignedApplicationCount: 2,
  clientId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-07-28T10:00:00.000Z",
  enabled: true,
  folderPath: "Inbox\\Jobs",
  id: "33333333-3333-4333-8333-333333333333",
  lastErrorCode: null,
  lastTestedAt: "2026-07-28T10:00:00.000Z",
  mailbox: "jobs@example.com",
  name: "Work tenant",
  secretConfigured: true,
  tenantId: "11111111-1111-4111-8111-111111111111",
  updatedAt: "2026-07-28T10:00:00.000Z",
  verifiedAt: "2026-07-28T10:00:00.000Z",
};

function status(
  connections: OutlookGraphConnection[] = [connection],
  secureStorageConfigured = true,
): OutlookGraphConnectionStatus {
  return { connections, secureStorageConfigured };
}

function clientHarness(initial: OutlookGraphConnectionStatus) {
  let current = initial;
  const getStatus = vi.fn<OutlookConnectionsClient["getStatus"]>(() =>
    Promise.resolve(current),
  );
  const listOptions = vi.fn<OutlookConnectionsClient["listOptions"]>(() =>
    Promise.resolve([]),
  );
  const create = vi.fn<OutlookConnectionsClient["create"]>((input) => {
    current = status([
      {
        ...connection,
        clientId: input.clientId,
        folderPath: input.folderPath,
        mailbox: input.mailbox,
        name: input.name,
        tenantId: input.tenantId,
      },
    ]);
    return Promise.resolve(current);
  });
  const update = vi.fn<OutlookConnectionsClient["update"]>(
    (connectionId, input) => {
      current = status(
        current.connections.map((candidate) =>
          candidate.id === connectionId
            ? {
                ...candidate,
                clientId: input.clientId,
                folderPath: input.folderPath,
                mailbox: input.mailbox,
                name: input.name,
                tenantId: input.tenantId,
              }
            : candidate,
        ),
      );
      return Promise.resolve(current);
    },
  );
  const setEnabled = vi.fn<OutlookConnectionsClient["setEnabled"]>(
    (connectionId, enabled) => {
      current = status(
        current.connections.map((candidate) =>
          candidate.id === connectionId ? { ...candidate, enabled } : candidate,
        ),
      );
      return Promise.resolve(current);
    },
  );
  const verify = vi.fn<OutlookConnectionsClient["verify"]>(() =>
    Promise.resolve(current),
  );
  const deleteConnection = vi.fn<OutlookConnectionsClient["deleteConnection"]>(
    (connectionId) => {
      current = status(
        current.connections.filter(({ id }) => id !== connectionId),
      );
      return Promise.resolve(current);
    },
  );
  const graphClient: OutlookConnectionsClient = {
    create,
    deleteConnection,
    getStatus,
    listOptions,
    setEnabled,
    update,
    verify,
  };
  return {
    create,
    deleteConnection,
    graphClient,
    setEnabled,
    update,
  };
}

describe("OutlookConnectionSettings", () => {
  it("guides setup and creates a named verified connection without retaining the secret", async () => {
    const graph = clientHarness(status([]));
    render(<OutlookConnectionSettings client={graph.graphClient} />);

    expect(
      await screen.findByText("No Microsoft Graph connections yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Microsoft Entra app registrations" }),
    ).toHaveAttribute("href", expect.stringContaining("entra.microsoft.com"));
    fireEvent.click(
      screen.getByRole("button", { name: "Add first connection" }),
    );
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: connection.name },
    });
    fireEvent.change(screen.getByLabelText("Tenant ID"), {
      target: { value: connection.tenantId },
    });
    fireEvent.change(screen.getByLabelText("Application ID"), {
      target: { value: connection.clientId },
    });
    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: "private-client-secret" },
    });
    fireEvent.change(screen.getByLabelText("Mailbox"), {
      target: { value: connection.mailbox },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));

    await waitFor(() =>
      expect(graph.create).toHaveBeenCalledWith({
        clientId: connection.clientId,
        clientSecret: "private-client-secret",
        folderPath: "Inbox\\Jobs",
        mailbox: connection.mailbox,
        name: connection.name,
        tenantId: connection.tenantId,
      }),
    );
    expect(
      await screen.findByText("Work tenant is connected and ready."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByLabelText("Client secret")).toHaveValue("");
  });

  it("disables, edits, and explains hard-delete impact before deleting", async () => {
    const graph = clientHarness(status());
    render(<OutlookConnectionSettings client={graph.graphClient} />);

    expect(await screen.findByText("Work tenant")).toBeInTheDocument();
    expect(screen.getByText("2 applications")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() =>
      expect(graph.setEnabled).toHaveBeenCalledWith(connection.id, false),
    );
    expect(
      await screen.findByText(/email synchronization is paused/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByLabelText("Mailbox"), {
      target: { value: "recruiting@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test and save" }));
    await waitFor(() =>
      expect(graph.update).toHaveBeenCalledWith(connection.id, {
        clientId: connection.clientId,
        folderPath: connection.folderPath,
        mailbox: "recruiting@example.com",
        name: connection.name,
        tenantId: connection.tenantId,
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(graph.deleteConnection).not.toHaveBeenCalled();
    expect(
      screen.getByText(/will remain in the tracker with all existing evidence/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm permanent delete" }),
    );
    await waitFor(() =>
      expect(graph.deleteConnection).toHaveBeenCalledWith(connection.id, 2),
    );
    expect(
      await screen.findByText(/Applications and evidence were preserved/),
    ).toBeInTheDocument();
  });

  it("explains when the server encryption key is unavailable", async () => {
    render(
      <OutlookConnectionSettings
        client={clientHarness(status([], false)).graphClient}
      />,
    );

    expect(await screen.findByText("Storage unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Secure storage is not ready."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add connection" }),
    ).not.toBeInTheDocument();
  });
});
