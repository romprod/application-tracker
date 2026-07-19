import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  ApplicationNotFoundError,
  InvalidApplicationReferenceError,
} from "../application/applications.js";
import {
  LocalMcpActorUnavailableError,
  type McpApplicationTools,
} from "../application/mcp.js";
import { McpWriteAccessDisabledError } from "../application/mcp_access.js";
import type {
  McpAuditAction,
  McpAuditRecorder,
  McpAuditResult,
  McpAuditTargetType,
  McpAuditTransport,
} from "../application/mcp_audit.js";
import {
  applicationIdSchema,
  createApplicationSchema,
  updateApplicationSchema,
} from "../domain/applications.js";
import { referenceValueIdSchema } from "../domain/reference_values.js";
import { noOpLogger, type ApplicationLogger } from "./logging.js";

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;
const writeAnnotations = {
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
  readOnlyHint: false,
} as const;
const deleteAnnotations = {
  ...writeAnnotations,
  destructiveHint: true,
} as const;

const emptyInputSchema = z.strictObject({});
const actorSchema = z.strictObject({
  displayName: z.string(),
  role: z.enum(["admin", "member"]),
  username: z.string(),
});
const trackerContextSchema = z.strictObject({
  access: z.enum(["read_only", "read_write"]),
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
const deleteApplicationResultSchema = z.strictObject({
  applicationId: applicationIdSchema,
  deleted: z.literal(true),
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

interface McpServerAuditOptions {
  actorUserId: string;
  recorder: McpAuditRecorder;
  runAtomically: <Result>(operation: () => Result) => Result;
  transport: McpAuditTransport;
  workspaceId: string;
}

interface ApplicationMcpServerOptions {
  audit?: McpServerAuditOptions;
  instructions: string;
  logger?: ApplicationLogger;
}

interface LocalMcpServerOptions {
  audit?: Omit<McpServerAuditOptions, "transport">;
  logger?: ApplicationLogger;
}

class McpWriteAuditFailedError extends Error {}

function recordAuditEvent(
  audit: McpServerAuditOptions | undefined,
  logger: ApplicationLogger,
  tool: McpAuditAction,
  targetType: McpAuditTargetType,
  result: McpAuditResult,
): boolean {
  if (!audit) return true;
  try {
    audit.recorder.record({
      action: tool,
      actorUserId: audit.actorUserId,
      result,
      targetType,
      transport: audit.transport,
      workspaceId: audit.workspaceId,
    });
    return true;
  } catch (error) {
    logger.error("mcp_audit_failed", { error, tool });
    return false;
  }
}

function executeTool(
  tool: McpAuditAction,
  targetType: McpAuditTargetType,
  logger: ApplicationLogger,
  audit: McpServerAuditOptions | undefined,
  operation: () => object,
): CallToolResult {
  try {
    const value = operation();
    return recordAuditEvent(audit, logger, tool, targetType, "success")
      ? successfulToolResult(value)
      : failedToolResult("internal_error");
  } catch (error) {
    if (error instanceof LocalMcpActorUnavailableError) {
      return recordAuditEvent(audit, logger, tool, targetType, "denied")
        ? failedToolResult("actor_unavailable")
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationNotFoundError) {
      return recordAuditEvent(audit, logger, tool, targetType, "not_found")
        ? failedToolResult("application_not_found")
        : failedToolResult("internal_error");
    }
    logger.error("mcp_tool_failed", { error, tool });
    recordAuditEvent(audit, logger, tool, targetType, "error");
    return failedToolResult("internal_error");
  }
}

function executeWriteTool(
  tool: McpAuditAction,
  logger: ApplicationLogger,
  audit: McpServerAuditOptions | undefined,
  operation: () => object,
): CallToolResult {
  if (!audit) {
    logger.error("mcp_write_audit_unavailable", { tool });
    return failedToolResult("internal_error");
  }
  try {
    const value = audit.runAtomically(() => {
      const result = operation();
      if (!recordAuditEvent(audit, logger, tool, "application", "success")) {
        throw new McpWriteAuditFailedError();
      }
      return result;
    });
    return successfulToolResult(value);
  } catch (error) {
    if (error instanceof McpWriteAuditFailedError) {
      return failedToolResult("internal_error");
    }
    if (
      error instanceof LocalMcpActorUnavailableError ||
      error instanceof McpWriteAccessDisabledError
    ) {
      return recordAuditEvent(audit, logger, tool, "application", "denied")
        ? failedToolResult(
            error instanceof McpWriteAccessDisabledError
              ? "write_access_disabled"
              : "actor_unavailable",
          )
        : failedToolResult("internal_error");
    }
    if (error instanceof ApplicationNotFoundError) {
      return recordAuditEvent(audit, logger, tool, "application", "not_found")
        ? failedToolResult("application_not_found")
        : failedToolResult("internal_error");
    }
    if (error instanceof InvalidApplicationReferenceError) {
      return recordAuditEvent(audit, logger, tool, "application", "error")
        ? failedToolResult("invalid_application_reference")
        : failedToolResult("internal_error");
    }
    logger.error("mcp_tool_failed", { error, tool });
    recordAuditEvent(audit, logger, tool, "application", "error");
    return failedToolResult("internal_error");
  }
}

export function createApplicationMcpServer(
  tools: McpApplicationTools,
  options: ApplicationMcpServerOptions,
): McpServer {
  const logger = options.logger ?? noOpLogger;
  const server = new McpServer(
    { name: "application-tracker", version: "0.1.0" },
    {
      instructions: options.instructions,
    },
  );

  server.registerTool(
    "get_tracker_context",
    {
      annotations: readOnlyAnnotations,
      description:
        "Confirm the actor, workspace, role, and current read-only or read-write access bound to this session.",
      inputSchema: emptyInputSchema,
      outputSchema: trackerContextSchema,
      title: "Get tracker context",
    },
    () =>
      executeTool(
        "get_tracker_context",
        "workspace",
        logger,
        options.audit,
        () => tools.getTrackerContext(),
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
      executeTool(
        "get_job_search_summary",
        "job_search",
        logger,
        options.audit,
        () => tools.getJobSearchSummary(),
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
      executeTool(
        "list_applications",
        "application_collection",
        logger,
        options.audit,
        () =>
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
      executeTool("get_application", "application", logger, options.audit, () =>
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
      executeTool(
        "get_reference_data",
        "reference_data",
        logger,
        options.audit,
        () => tools.getReferenceData(),
      ),
  );

  server.registerTool(
    "create_application",
    {
      annotations: writeAnnotations,
      description:
        "Create an application in the bound workspace when an administrator has enabled MCP write access. Call get_reference_data first and use stable reference IDs.",
      inputSchema: createApplicationSchema,
      outputSchema: applicationRecordSchema,
      title: "Create application",
    },
    (input) =>
      executeWriteTool("create_application", logger, options.audit, () =>
        tools.createApplication(input),
      ),
  );

  server.registerTool(
    "update_application",
    {
      annotations: writeAnnotations,
      description:
        "Update selected application fields in the bound workspace when MCP write access is enabled. Omitted fields remain unchanged; null clears nullable fields.",
      inputSchema: z.strictObject({
        applicationId: applicationIdSchema,
        update: updateApplicationSchema,
      }),
      outputSchema: applicationRecordSchema,
      title: "Update application",
    },
    ({ applicationId, update }) =>
      executeWriteTool("update_application", logger, options.audit, () =>
        tools.updateApplication(applicationId, update),
      ),
  );

  server.registerTool(
    "delete_application",
    {
      annotations: deleteAnnotations,
      description:
        "Soft-delete an application from the bound workspace when MCP write access is enabled. Pass confirm=true only after the user has explicitly approved this destructive action.",
      inputSchema: z.strictObject({
        applicationId: applicationIdSchema,
        confirm: z.literal(true),
      }),
      outputSchema: deleteApplicationResultSchema,
      title: "Delete application",
    },
    ({ applicationId }) =>
      executeWriteTool("delete_application", logger, options.audit, () =>
        tools.deleteApplication(applicationId),
      ),
  );

  return server;
}

export function createLocalMcpServer(
  tools: McpApplicationTools,
  options: LocalMcpServerOptions = {},
): McpServer {
  return createApplicationMcpServer(tools, {
    ...(options.audit
      ? { audit: { ...options.audit, transport: "local_stdio" } }
      : {}),
    instructions:
      "This local server is bound to one operator-selected actor and workspace. Call get_tracker_context before using workspace data. Mutation tools work only while a website administrator has enabled MCP write access, and delete_application also requires explicit confirmation.",
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
