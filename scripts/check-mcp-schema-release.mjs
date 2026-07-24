import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const applicationModule = await import(
  pathToFileURL(resolve("dist/server/application/mcp.js")).href
);
const live = applicationModule.applicationMcpSchemaManifest;
const published = applicationModule.applicationMcpPublishedSchema;
const current =
  live.schemaSha256 === published.schemaSha256 &&
  live.schemaVersion === published.schemaVersion &&
  live.toolCount === published.toolCount;

if (!current) {
  console.error(
    [
      "MCP plugin publication required.",
      `Live contract: v${String(live.schemaVersion)}, ${String(live.toolCount)} tools, ${live.schemaSha256}`,
      `Published contract: v${String(published.schemaVersion)}, ${String(published.toolCount)} tools, ${published.schemaSha256}`,
      "Deploy the compatible server, scan its MCP endpoint in the OpenAI plugin submission portal, submit and publish the new metadata version, then run:",
      `npm run mcp:schema:mark-published -- --confirm-published ${live.schemaSha256}`,
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(
    `MCP plugin metadata is current at schema v${String(live.schemaVersion)} (${live.schemaSha256}).`,
  );
}
