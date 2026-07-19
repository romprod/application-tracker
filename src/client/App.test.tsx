import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthClientError } from "./auth_client";
import type {
  ApplicationEvent,
  ApplicationRecord,
  ApplicationsClient,
} from "./applications_client";
import type {
  AuthClient,
  AuthSession,
  AuthenticatedSession,
} from "./auth_client";
import type { SetupClient } from "./setup_client";
import type { McpStatus, McpStatusClient } from "./mcp_status_client";
import type { ManagedUser, UsersClient } from "./users_client";
import type {
  ReferenceValue,
  ReferenceValuesClient,
} from "./reference_values_client";
import type { DocumentRecord, DocumentsClient } from "./documents_client";

afterEach(() => {
  vi.useRealTimers();
});

const authenticatedSession: AuthenticatedSession = {
  authenticated: true,
  user: {
    displayName: "Alex Example",
    role: "admin",
    username: "alex",
  },
  workspace: { name: "Applications" },
};

const applicationRecord: ApplicationRecord = {
  appliedOn: "2026-07-18",
  companyName: "Example Studio",
  contacts: [
    {
      email: "morgan@example.com",
      name: "Morgan Recruiter",
      phone: "+44 20 7946 0958",
      role: "Recruiter",
    },
  ],
  createdAt: "2026-07-18T12:15:00.000Z",
  id: "44444444-4444-4444-8444-444444444444",
  location: "Remote",
  links: [
    {
      label: "Hiring portal",
      url: "https://careers.example.com/application",
    },
  ],
  nextAction: "Send the portfolio follow-up.",
  nextActionDue: "2026-07-21",
  notes: "Referred by a former colleague.",
  roleType: "Full-time",
  roleTypeId: "99999999-9999-4999-8999-999999999999",
  roleTitle: "Product Designer",
  source: "Referral",
  sourceId: "88888888-8888-4888-8888-888888888888",
  sourceUrl: "https://jobs.example.com/product-designer",
  status: "Applied",
  statusId: "12121212-1212-4121-8121-121212121212",
  statusIsTerminal: false,
  updatedAt: "2026-07-18T12:15:00.000Z",
};

const applicationEvents: ApplicationEvent[] = [
  {
    actorDisplayName: "Alex Example",
    fromStatus: "Applied",
    id: "55555555-5555-4555-8555-555555555555",
    occurredAt: "2026-07-18T13:15:00.000Z",
    toStatus: "Interview",
    type: "status_changed",
  },
  {
    actorDisplayName: "Alex Example",
    fromStatus: null,
    id: "66666666-6666-4666-8666-666666666666",
    occurredAt: "2026-07-18T12:15:00.000Z",
    toStatus: "Applied",
    type: "application_created",
  },
];

const administrator: ManagedUser = {
  createdAt: "2026-01-01T00:00:00.000Z",
  displayName: "Alex Example",
  externalIdentities: [],
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
  externalIdentities: [],
  id: "22222222-2222-4222-8222-222222222222",
  isCurrentUser: false,
  localAccount: true,
  role: "member",
  status: "active",
  username: "sam",
};

const referenceValues: ReferenceValue[] = [
  {
    category: "status",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "77777777-7777-4777-8777-777777777777",
    isActive: true,
    isTerminal: false,
    label: "Prospect",
    sortOrder: 10,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    category: "status",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "12121212-1212-4121-8121-121212121212",
    isActive: true,
    isTerminal: false,
    label: "Applied",
    sortOrder: 20,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    category: "status",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "13131313-1313-4131-8131-131313131313",
    isActive: true,
    isTerminal: false,
    label: "Interview",
    sortOrder: 30,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    category: "source",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "88888888-8888-4888-8888-888888888888",
    isActive: true,
    isTerminal: false,
    label: "Referral",
    sortOrder: 10,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    category: "role_type",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "99999999-9999-4999-8999-999999999999",
    isActive: true,
    isTerminal: false,
    label: "Full-time",
    sortOrder: 10,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    category: "document_type",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    isActive: true,
    isTerminal: false,
    label: "CV",
    sortOrder: 10,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const documentRecord: DocumentRecord = {
  applications: [
    {
      companyName: applicationRecord.companyName,
      id: applicationRecord.id,
      roleTitle: applicationRecord.roleTitle,
    },
  ],
  byteSize: 8,
  createdAt: "2026-07-19T10:00:00.000Z",
  documentType: "CV",
  documentTypeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  mediaType: "application/pdf",
  originalFilename: "Original CV.pdf",
  uploadedByDisplayName: "Alex Example",
};

const mcpStatus: McpStatus = {
  availability: "available",
  capabilities: {
    auditEvents: true,
    oauthVerification: false,
    registeredTools: 5,
  },
  recentAuditEvents: [
    {
      action: "get_tracker_context",
      actor: { displayName: "Alex Example", username: "alex" },
      occurredAt: "2026-01-01T10:00:00.000Z",
      result: "success",
      targetType: "workspace",
      transport: "local_stdio",
    },
  ],
  sessions: {
    absoluteLifetimeSeconds: 14_400,
    active: 0,
    enforcement: "active",
    globalLimit: 6,
    idleTimeoutSeconds: 900,
    initializing: 0,
    perActorLimit: 2,
  },
  transports: {
    local: { state: "ready", transport: "stdio" },
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

function createUsersClient(
  users: ManagedUser[] = [administrator, member],
  externalIdentityProviderConfigured = false,
) {
  return {
    createUser: vi.fn<UsersClient["createUser"]>().mockResolvedValue(member),
    linkExternalIdentity: vi
      .fn<UsersClient["linkExternalIdentity"]>()
      .mockImplementation((userId, subject) => {
        const user = users.find((candidate) => candidate.id === userId);
        return user
          ? Promise.resolve({
              ...user,
              externalIdentities: [
                ...user.externalIdentities,
                {
                  createdAt: "2026-01-01T01:00:00.000Z",
                  id: "77777777-7777-4777-8777-777777777777",
                  subject,
                },
              ],
            })
          : Promise.reject(new Error("Missing test user"));
      }),
    listUsers: vi.fn<UsersClient["listUsers"]>().mockResolvedValue({
      externalIdentityProviderConfigured,
      users,
    }),
    setStatus: vi
      .fn<UsersClient["setStatus"]>()
      .mockImplementation((userId, status) => {
        const user = users.find((candidate) => candidate.id === userId);
        return user
          ? Promise.resolve({ ...user, status })
          : Promise.reject(new Error("Missing test user"));
      }),
    unlinkExternalIdentity: vi
      .fn<UsersClient["unlinkExternalIdentity"]>()
      .mockImplementation((userId, identityId) => {
        const user = users.find((candidate) => candidate.id === userId);
        return user
          ? Promise.resolve({
              ...user,
              externalIdentities: user.externalIdentities.filter(
                ({ id }) => id !== identityId,
              ),
            })
          : Promise.reject(new Error("Missing test user"));
      }),
  } satisfies UsersClient;
}

function createMcpStatusClient(status: McpStatus = mcpStatus) {
  return {
    getStatus: vi.fn<McpStatusClient["getStatus"]>().mockResolvedValue(status),
  } satisfies McpStatusClient;
}

function createReferenceValuesClient(values = referenceValues) {
  return {
    createValue: vi
      .fn<ReferenceValuesClient["createValue"]>()
      .mockImplementation((input) =>
        Promise.resolve({
          ...input,
          createdAt: "2026-07-18T12:00:00.000Z",
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          isActive: true,
          sortOrder: 20,
          updatedAt: "2026-07-18T12:00:00.000Z",
        }),
      ),
    deleteValue: vi
      .fn<ReferenceValuesClient["deleteValue"]>()
      .mockResolvedValue(),
    listValues: vi
      .fn<ReferenceValuesClient["listValues"]>()
      .mockResolvedValue(values),
    updateValue: vi
      .fn<ReferenceValuesClient["updateValue"]>()
      .mockImplementation((id, input) => {
        const value = values.find((candidate) => candidate.id === id);
        return value
          ? Promise.resolve({ ...value, ...input })
          : Promise.reject(new Error("Missing test reference value"));
      }),
  } satisfies ReferenceValuesClient;
}

function createApplicationsClient(
  applications: ApplicationRecord[] = [applicationRecord],
) {
  return {
    createApplication: vi
      .fn<ApplicationsClient["createApplication"]>()
      .mockResolvedValue(applicationRecord),
    deleteApplication: vi
      .fn<ApplicationsClient["deleteApplication"]>()
      .mockResolvedValue(),
    listApplications: vi
      .fn<ApplicationsClient["listApplications"]>()
      .mockResolvedValue(applications),
    listApplicationEvents: vi
      .fn<ApplicationsClient["listApplicationEvents"]>()
      .mockResolvedValue(applicationEvents),
    updateApplication: vi
      .fn<ApplicationsClient["updateApplication"]>()
      .mockImplementation((id, input) => {
        const contacts = input.contacts?.map((contact) => ({
          email: contact.email ?? null,
          name: contact.name,
          phone: contact.phone ?? null,
          role: contact.role ?? null,
        }));
        return Promise.resolve({
          ...applicationRecord,
          ...input,
          contacts: contacts ?? applicationRecord.contacts,
          id,
          links: input.links ?? applicationRecord.links,
          status:
            input.statusId === "13131313-1313-4131-8131-131313131313"
              ? "Interview"
              : applicationRecord.status,
          updatedAt: "2026-07-18T13:15:00.000Z",
        });
      }),
  } satisfies ApplicationsClient;
}

function createDocumentsClient(documents: DocumentRecord[] = [documentRecord]) {
  return {
    listDocuments: vi
      .fn<DocumentsClient["listDocuments"]>()
      .mockResolvedValue({ documents, maxUploadBytes: 10_485_760 }),
    uploadDocument: vi
      .fn<DocumentsClient["uploadDocument"]>()
      .mockImplementation((input) =>
        Promise.resolve({
          ...documentRecord,
          applications: input.applicationIds.includes(applicationRecord.id)
            ? [
                {
                  companyName: applicationRecord.companyName,
                  id: applicationRecord.id,
                  roleTitle: applicationRecord.roleTitle,
                },
              ]
            : [],
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          originalFilename: input.file.name,
        }),
      ),
  } satisfies DocumentsClient;
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
        applicationsClient={createApplicationsClient()}
        referenceValuesClient={createReferenceValuesClient()}
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
        name: "Your search, at a glance.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alex Example")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Next actions" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Send the portfolio follow-up.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("opens the application ledger for an authenticated user", async () => {
    const applicationsClient = createApplicationsClient();
    render(
      <App
        applicationsClient={applicationsClient}
        referenceValuesClient={createReferenceValuesClient()}
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Applications" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Applications" }),
    ).toBeInTheDocument();
    expect(applicationsClient.listApplications).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("table", { name: "Applications" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Example Studio")).toBeInTheDocument();
    expect(screen.getByText("Product Designer")).toBeInTheDocument();
    const companySort = screen.getByRole("button", {
      name: /Company \/ role, not sorted/,
    });
    fireEvent.click(companySort);
    expect(companySort.closest("th")).toHaveAttribute("aria-sort", "ascending");
    const search = screen.getByRole("searchbox", {
      name: "Search applications",
    });
    fireEvent.change(search, { target: { value: "Morgan Recruiter" } });
    expect(
      screen.getByRole("table", { name: "Applications" }),
    ).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "Hiring portal" } });
    expect(
      screen.getByRole("table", { name: "Applications" }),
    ).toBeInTheDocument();
  });

  it("opens the document library and uploads an associated original", async () => {
    const documentsClient = createDocumentsClient();
    render(
      <App
        applicationsClient={createApplicationsClient()}
        authClient={createAuthClient(authenticatedSession)}
        documentsClient={documentsClient}
        referenceValuesClient={createReferenceValuesClient()}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
    expect(
      await screen.findByRole("heading", { name: "Documents" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Original CV.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload document" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add a document",
    });
    const file = new File(["pdf-data"], "Product CV.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(within(dialog).getByLabelText("Choose file"), {
      target: { files: [file] },
    });
    fireEvent.change(within(dialog).getByLabelText("Document type"), {
      target: { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "Example Studio · Product Designer",
      }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Store document" }),
    );

    await waitFor(() =>
      expect(documentsClient.uploadDocument).toHaveBeenCalledWith({
        applicationIds: [applicationRecord.id],
        documentTypeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        file,
      }),
    );
    expect(await screen.findByText("Product CV.pdf was stored.")).toBeVisible();
    expect(screen.getByText("Product CV.pdf")).toBeInTheDocument();
  });

  it("adds an application and clears the intake form", async () => {
    const applicationsClient = createApplicationsClient([]);
    render(
      <App
        applicationsClient={applicationsClient}
        referenceValuesClient={createReferenceValuesClient()}
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Applications" }),
    );
    await screen.findByRole("option", { name: "Prospect" });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Log application" })[0]!,
    );
    await screen.findByRole("heading", { name: "Log an application" });
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Example Studio" },
    });
    fireEvent.change(screen.getByLabelText("Role title"), {
      target: { value: "Product Designer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save application" }));

    await waitFor(() =>
      expect(applicationsClient.createApplication).toHaveBeenCalledWith({
        companyName: "Example Studio",
        contacts: [],
        links: [],
        roleTitle: "Product Designer",
        statusId: "77777777-7777-4777-8777-777777777777",
      }),
    );
    expect(await screen.findByText("Example Studio")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Log an application" }),
    ).not.toBeInTheDocument();
  });

  it("edits an application and records a stage change", async () => {
    const applicationsClient = createApplicationsClient();
    render(
      <App
        applicationsClient={applicationsClient}
        referenceValuesClient={createReferenceValuesClient()}
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Applications" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Example Studio" }),
    );
    await screen.findByRole("dialog", { name: "Product Designer" });
    fireEvent.click(screen.getByRole("button", { name: "Edit application" }));
    expect(
      screen.getByRole("heading", { name: "Edit application" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Company")).toHaveValue("Example Studio");
    expect(screen.getByLabelText("Next action")).toHaveValue(
      "Send the portfolio follow-up.",
    );
    expect(screen.getByLabelText("Contact 1 name")).toHaveValue(
      "Morgan Recruiter",
    );
    expect(screen.getByLabelText("Additional link 1 label")).toHaveValue(
      "Hiring portal",
    );
    fireEvent.change(screen.getByLabelText("Stage"), {
      target: { value: "13131313-1313-4131-8131-131313131313" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(applicationsClient.updateApplication).toHaveBeenCalledWith(
        applicationRecord.id,
        {
          appliedOn: "2026-07-18",
          companyName: "Example Studio",
          contacts: applicationRecord.contacts,
          links: applicationRecord.links,
          location: "Remote",
          nextAction: "Send the portfolio follow-up.",
          nextActionDue: "2026-07-21",
          notes: "Referred by a former colleague.",
          roleTypeId: "99999999-9999-4999-8999-999999999999",
          roleTitle: "Product Designer",
          sourceId: "88888888-8888-4888-8888-888888888888",
          sourceUrl: "https://jobs.example.com/product-designer",
          statusId: "13131313-1313-4131-8131-131313131313",
        },
      ),
    );
    expect(
      await screen.findAllByText("Interview", {
        selector: "span[data-status]",
      }),
    ).not.toHaveLength(0);
    expect(screen.getByText("Example Studio was updated.")).toBeInTheDocument();
  });

  it("adds contacts and related links to a new application", async () => {
    const applicationsClient = createApplicationsClient([]);
    render(
      <App
        applicationsClient={applicationsClient}
        referenceValuesClient={createReferenceValuesClient()}
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Applications" }),
    );
    await screen.findByRole("option", { name: "Prospect" });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Log application" })[0]!,
    );
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Example Studio" },
    });
    fireEvent.change(screen.getByLabelText("Role title"), {
      target: { value: "Product Designer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    fireEvent.change(screen.getByLabelText("Contact 1 name"), {
      target: { value: "Morgan Recruiter" },
    });
    fireEvent.change(screen.getByLabelText("Contact 1 email"), {
      target: { value: "morgan@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add additional link" }),
    );
    fireEvent.change(screen.getByLabelText("Additional link 1 label"), {
      target: { value: "Hiring portal" },
    });
    fireEvent.change(screen.getByLabelText("Additional link 1 URL"), {
      target: { value: "https://careers.example.com/application" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save application" }));

    await waitFor(() =>
      expect(applicationsClient.createApplication).toHaveBeenCalledWith({
        companyName: "Example Studio",
        contacts: [
          {
            email: "morgan@example.com",
            name: "Morgan Recruiter",
          },
        ],
        links: [
          {
            label: "Hiring portal",
            url: "https://careers.example.com/application",
          },
        ],
        roleTitle: "Product Designer",
        statusId: "77777777-7777-4777-8777-777777777777",
      }),
    );
  });

  it("shows the current next action in the application drawer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 18, 12));

    render(
      <App
        applicationsClient={createApplicationsClient()}
        referenceValuesClient={createReferenceValuesClient()}
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Applications" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Example Studio" }),
    );

    const drawer = await screen.findByRole("dialog", {
      name: "Product Designer",
    });
    expect(
      within(drawer).getByRole("heading", {
        name: "Send the portfolio follow-up.",
      }),
    ).toBeInTheDocument();
    expect(within(drawer).getByText("Due in 3d")).toBeInTheDocument();
    expect(within(drawer).getByText("Morgan Recruiter")).toBeInTheDocument();
    expect(
      within(drawer).getByRole("link", { name: "morgan@example.com" }),
    ).toHaveAttribute("href", "mailto:morgan@example.com");
    expect(
      within(drawer).getByRole("link", { name: "+44 20 7946 0958" }),
    ).toHaveAttribute("href", "tel:+44 20 7946 0958");
    expect(within(drawer).getByText("Hiring portal")).toBeInTheDocument();
    expect(
      within(drawer).getByRole("link", {
        name: /Hiring portal.*careers\.example\.com.*opens in a new tab/,
      }),
    ).toHaveAttribute("href", "https://careers.example.com/application");
  });

  it("confirms and removes an application from the workspace", async () => {
    const applicationsClient = createApplicationsClient();
    render(
      <App
        applicationsClient={applicationsClient}
        referenceValuesClient={createReferenceValuesClient()}
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Applications" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Example Studio" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete application" }));

    const confirmation = await screen.findByRole("dialog", {
      name: "Remove Example Studio?",
    });
    expect(confirmation).toHaveAccessibleDescription(
      "This removes Product Designer from the workspace. Its audit history remains stored.",
    );
    expect(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Remove application" }),
    );

    await waitFor(() =>
      expect(applicationsClient.deleteApplication).toHaveBeenCalledWith(
        applicationRecord.id,
      ),
    );
    expect(
      await screen.findByText("Example Studio was removed."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Example Studio")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Remove Example Studio?" }),
    ).not.toBeInTheDocument();
  });

  it("cancels application removal without changing the workspace", async () => {
    const applicationsClient = createApplicationsClient();
    render(
      <App
        applicationsClient={applicationsClient}
        referenceValuesClient={createReferenceValuesClient()}
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Applications" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Example Studio" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete application" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(applicationsClient.deleteApplication).not.toHaveBeenCalled();
    expect(screen.getByText("Example Studio")).toBeInTheDocument();
  });

  it("loads and displays an application's stage history", async () => {
    const applicationsClient = createApplicationsClient();
    render(
      <App
        applicationsClient={applicationsClient}
        referenceValuesClient={createReferenceValuesClient()}
        authClient={createAuthClient(authenticatedSession)}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Applications" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Example Studio" }),
    );

    await waitFor(() =>
      expect(applicationsClient.listApplicationEvents).toHaveBeenCalledWith(
        applicationRecord.id,
      ),
    );
    expect(await screen.findByText("Applied → Interview")).toBeInTheDocument();
    expect(screen.getByText("Application created")).toBeInTheDocument();
    expect(screen.getAllByText("Alex Example").length).toBeGreaterThanOrEqual(
      2,
    );
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: "Product Designer" }),
      {
        key: "Escape",
      },
    );
    expect(
      screen.queryByRole("dialog", { name: "Product Designer" }),
    ).not.toBeInTheDocument();
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
        name: "Your search, at a glance.",
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
    fireEvent.click(screen.getByRole("button", { name: "Users" }));

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
    expect(screen.getByText("Local tools ready")).toBeInTheDocument();
    expect(screen.getByText("5 read-only tools available")).toBeInTheDocument();
    expect(screen.getByText("Registry ready")).toBeInTheDocument();
    expect(screen.getByText("6 session ceiling")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recent MCP activity" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Get Tracker Context")).toBeInTheDocument();
    expect(screen.getByText("Alex Example · @alex")).toBeInTheDocument();
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("list", { name: "MCP security controls" }),
      ).getByText("Active"),
    ).toBeInTheDocument();
  });

  it("reports authenticated remote MCP when runtime configuration enables it", async () => {
    const mcpStatusClient = createMcpStatusClient({
      ...mcpStatus,
      capabilities: { ...mcpStatus.capabilities, oauthVerification: true },
      transports: {
        ...mcpStatus.transports,
        remote: { state: "ready", transport: "streamable_http" },
      },
    });
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
      await screen.findByText((_content, element) => {
        return (
          element?.classList.contains("mcp-boundary-note") === true &&
          element.textContent?.includes("authenticated Streamable HTTP") ===
            true
        );
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/authenticated HTTP sessions/)).toBeInTheDocument();
  });

  it("lets administrators maintain workspace lists", async () => {
    const referenceValuesClient = createReferenceValuesClient();
    render(
      <App
        authClient={createAuthClient(authenticatedSession)}
        referenceValuesClient={referenceValuesClient}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(
      await screen.findByRole("heading", {
        name: "Make the tracker fit your search.",
      }),
    ).toBeInTheDocument();
    expect(referenceValuesClient.listValues).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Referral")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    fireEvent.change(screen.getByLabelText("New source"), {
      target: { value: "Community board" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add value" }));
    await waitFor(() =>
      expect(referenceValuesClient.createValue).toHaveBeenCalledWith({
        category: "source",
        isTerminal: false,
        label: "Community board",
      }),
    );
    expect(await screen.findByText("Community board")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Edit Prospect; active/ }),
    );
    fireEvent.change(screen.getByLabelText("Edit status Prospect"), {
      target: { value: "Lead" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save label" }));
    await waitFor(() =>
      expect(referenceValuesClient.updateValue).toHaveBeenCalledWith(
        "77777777-7777-4777-8777-777777777777",
        { label: "Lead" },
      ),
    );
    expect(await screen.findByText("Lead")).toBeInTheDocument();
  });

  it("lets members view lists without administration controls", async () => {
    const referenceValuesClient = createReferenceValuesClient();
    const memberSession: AuthenticatedSession = {
      ...authenticatedSession,
      user: { ...authenticatedSession.user, role: "member" },
    };
    render(
      <App
        authClient={createAuthClient(memberSession)}
        referenceValuesClient={referenceValuesClient}
        setupClient={createSetupClient({
          required: false,
          tokenConfigured: false,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Prospect")).toBeInTheDocument();
    expect(
      screen.getByText(/Only workspace administrators can change/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Users" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New source")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Disable Sam Member" }),
    );

    await waitFor(() =>
      expect(usersClient.setStatus).toHaveBeenCalledWith(member.id, "disabled"),
    );
    expect(await screen.findByText("Disabled")).toBeInTheDocument();
  });

  it("links and removes a remote identity from a workspace user", async () => {
    const usersClient = createUsersClient([administrator, member], true);
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
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Link remote identity to Sam Member",
      }),
    );
    fireEvent.change(screen.getByLabelText("OAuth subject for Sam Member"), {
      target: { value: "oauth-subject-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link subject" }));

    await waitFor(() =>
      expect(usersClient.linkExternalIdentity).toHaveBeenCalledWith(
        member.id,
        "oauth-subject-123",
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "oauth-subject-123" }),
    );
    expect(screen.getByText("Selected remote subject")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    await waitFor(() =>
      expect(usersClient.unlinkExternalIdentity).toHaveBeenCalledWith(
        member.id,
        "77777777-7777-4777-8777-777777777777",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "oauth-subject-123" }),
      ).not.toBeInTheDocument(),
    );
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
