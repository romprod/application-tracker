import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { ApplicationNotFoundError } from "../application/applications.js";
import {
  LocalMcpActorUnavailableError,
  type LocalMcpTools,
} from "../application/mcp.js";
import { applicationIdSchema } from "../domain/applications.js";
import { referenceValueIdSchema } from "../domain/reference_values.js";
import { noOpLogger, type ApplicationLogger } from "./logging.js";

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;

const emptyInputSchema = z.strictObject({});
const actorSchema = z.strictObject({
  displayName: z.string(),
  role: z.enum(["admin", "member"]),
  username: z.string(),
});
const trackerContextSchema = z.strictObject({
  access: z.literal("read_only"),
  actor: actorSchema,
  workspace: z.strictObject({ name: z.string(), slug: z.string() }),
});
const statusCountSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  isTerminal: z.boolean(),
  status: z.string(),
  statusId: z.string(),
});
const jobSearchSummarySchema = z.strictObject({
  asOfDate: z.iso.date(),
  byStatus: z.array(statusCountSchema),
  dueTodayActions: z.number().int().nonnegative(),
  openActions: z.number().int().nonnegative(),
  openApplications: z.number().int().nonnegative(),
  overdueActions: z.number().int().nonnegative(),
  terminalApplications: z.number().int().nonnegative(),
  totalApplications: z.number().int().nonnegative(),
});
const applicationSummarySchema = z.strictObject({
  appliedOn: z.iso.date().nullable(),
  companyName: z.string(),
  id: applicationIdSchema,
  location: z.string().nullable(),
  nextAction: z.string().nullable(),
  nextActionDue: z.iso.date().nullable(),
  roleTitle: z.string(),
  status: z.string(),
  statusId: referenceValueIdSchema,
  statusIsTerminal: z.boolean(),
  updatedAt: z.iso.datetime(),
});
const applicationListSchema = z.strictObject({
  applications: z.array(applicationSummarySchema),
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const applicationContactSchema = z.strictObject({
  email: z.string().nullable(),
  name: z.string(),
  phone: z.string().nullable(),
  role: z.string().nullable(),
});
const applicationLinkSchema = z.strictObject({
  label: z.string(),
  url: z.url(),
});
const applicationRecordSchema = z.strictObject({
  appliedOn: z.iso.date().nullable(),
  companyName: z.string(),
  contacts: z.array(applicationContactSchema),
  createdAt: z.iso.datetime(),
  id: applicationIdSchema,
  location: z.string().nullable(),
  links: z.array(applicationLinkSchema),
  nextAction: z.string().nullable(),
  nextActionDue: z.iso.date().nullable(),
  notes: z.string().nullable(),
  roleTitle: z.string(),
  roleType: z.string().nullable(),
  roleTypeId: referenceValueIdSchema.nullable(),
  source: z.string().nullable(),
  sourceId: referenceValueIdSchema.nullable(),
  sourceUrl: z.url().nullable(),
  status: z.string(),
  statusId: referenceValueIdSchema,
  statusIsTerminal: z.boolean(),
  updatedAt: z.iso.datetime(),
});
const applicationEventSchema = z.strictObject({
  actorDisplayName: z.string(),
  fromStatus: z.string().nullable(),
  id: z.string(),
  occurredAt: z.iso.datetime(),
  toStatus: z.string(),
  type: z.enum(["application_created", "status_changed"]),
});
const applicationDetailSchema = z.strictObject({
  application: applicationRecordSchema,
  events: z.array(applicationEventSchema),
});
const referenceValueSchema = z.strictObject({
  category: z.enum(["status", "source", "role_type", "document_type"]),
  createdAt: z.iso.datetime(),
  id: referenceValueIdSchema,
  isActive: z.boolean(),
  isTerminal: z.boolean(),
  label: z.string(),
  sortOrder: z.number().int(),
  updatedAt: z.iso.datetime(),
});
const referenceDataSchema = z.strictObject({
  values: z.array(referenceValueSchema),
});

function successfulToolResult(value: object): CallToolResult {
  return {
    content: [{ text: JSON.stringify(value), type: "text" }],
    structuredContent: value as Record<string, unknown>,
  };
}

function failedToolResult(code: string): CallToolResult {
  return {
    content: [{ text: JSON.stringify({ error: { code } }), type: "text" }],
    isError: true,
  };
}

function executeTool(
  tool: string,
  logger: ApplicationLogger,
  operation: () => object,
): CallToolResult {
  try {
    return successfulToolResult(operation());
  } catch (error) {
    if (error instanceof LocalMcpActorUnavailableError) {
      return failedToolResult("actor_unavailable");
    }
    if (error instanceof ApplicationNotFoundError) {
      return failedToolResult("application_not_found");
    }
    logger.error("mcp_tool_failed", { error, tool });
    return failedToolResult("internal_error");
  }
}

export function createLocalMcpServer(
  tools: LocalMcpTools,
  logger: ApplicationLogger = noOpLogger,
): McpServer {
  const server = new McpServer(
    { name: "application-tracker", version: "0.1.0" },
    {
      instructions:
        "This local server is bound to one operator-selected actor and workspace. All tools are read-only. Call get_tracker_context before using workspace data.",
    },
  );

  server.registerTool(
    "get_tracker_context",
    {
      annotations: readOnlyAnnotations,
      description:
        "Confirm the actor, workspace, role, and read-only access bound to this process.",
      inputSchema: emptyInputSchema,
      outputSchema: trackerContextSchema,
      title: "Get tracker context",
    },
    () =>
      executeTool("get_tracker_context", logger, () =>
        tools.getTrackerContext(),
      ),
  );

  server.registerTool(
    "get_job_search_summary",
    {
      annotations: readOnlyAnnotations,
      description:
        "Return bounded workspace totals, status counts, and due-action counts.",
      inputSchema: emptyInputSchema,
      outputSchema: jobSearchSummarySchema,
      title: "Get job search summary",
    },
    () =>
      executeTool("get_job_search_summary", logger, () =>
        tools.getJobSearchSummary(),
      ),
  );

  server.registerTool(
    "list_applications",
    {
      annotations: readOnlyAnnotations,
      description:
        "List up to 100 application summaries, optionally filtered by status ID.",
      inputSchema: z.strictObject({
        limit: z.number().int().min(1).max(100).default(50),
        statusId: referenceValueIdSchema.optional(),
      }),
      outputSchema: applicationListSchema,
      title: "List applications",
    },
    (input) =>
      executeTool("list_applications", logger, () =>
        tools.listApplications({
          limit: input.limit,
          ...(input.statusId ? { statusId: input.statusId } : {}),
        }),
      ),
  );

  server.registerTool(
    "get_application",
    {
      annotations: readOnlyAnnotations,
      description:
        "Return one application with contacts, links, notes, and immutable stage events.",
      inputSchema: z.strictObject({ applicationId: applicationIdSchema }),
      outputSchema: applicationDetailSchema,
      title: "Get application",
    },
    ({ applicationId }) =>
      executeTool("get_application", logger, () =>
        tools.getApplication(applicationId),
      ),
  );

  server.registerTool(
    "get_reference_data",
    {
      annotations: readOnlyAnnotations,
      description:
        "Return workspace statuses, sources, role types, and document types with stable IDs.",
      inputSchema: emptyInputSchema,
      outputSchema: referenceDataSchema,
      title: "Get reference data",
    },
    () =>
      executeTool("get_reference_data", logger, () => tools.getReferenceData()),
  );

  return server;
}
