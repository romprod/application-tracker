import { Router, type RequestHandler } from "express";

export interface McpProtectedResourceMetadataConfig {
  authorizationServer: string;
  requiredScope: string;
  resourceUrl: string;
}

export function mcpProtectedResourceMetadataPath(resourceUrl: string): string {
  const resource = new URL(resourceUrl);
  return `/.well-known/oauth-protected-resource${resource.pathname}`;
}

const setDiscoveryHeaders: RequestHandler = (_request, response, next) => {
  response.set({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  });
  next();
};

export function createMcpProtectedResourceMetadataRouter(
  config: McpProtectedResourceMetadataConfig,
): Router {
  const router = Router();
  router.use(setDiscoveryHeaders);
  router.get("/", (_request, response) => {
    response.json({
      authorization_servers: [config.authorizationServer],
      bearer_methods_supported: ["header"],
      resource: config.resourceUrl,
      resource_name: "Application Tracker MCP",
      scopes_supported: [config.requiredScope],
    });
  });
  router.options("/", (_request, response) => {
    response.sendStatus(204);
  });
  router.all("/", (_request, response) => {
    response.status(405).json({ error: { code: "method_not_allowed" } });
  });
  return router;
}
