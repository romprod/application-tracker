import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function evaluateMcpPublication(live, published, requirePublication) {
  const current =
    live.schemaSha256 === published.schemaSha256 &&
    live.schemaVersion === published.schemaVersion &&
    live.toolCount === published.toolCount;

  if (current) {
    return {
      exitCode: 0,
      message: `Optional OpenAI-managed metadata is current at MCP schema v${String(live.schemaVersion)} (${live.schemaSha256}).`,
    };
  }

  const comparison = [
    `Live contract: v${String(live.schemaVersion)}, ${String(live.toolCount)} tools, ${live.schemaSha256}`,
    `Last marked publication: v${String(published.schemaVersion)}, ${String(published.toolCount)} tools, ${published.schemaSha256}`,
  ];
  if (!requirePublication) {
    return {
      exitCode: 0,
      message: [
        "Direct MCP deployment is not blocked by optional OpenAI-managed publication drift.",
        ...comparison,
        "Only run the strict publication check when that distribution channel is explicitly in scope.",
      ].join("\n"),
    };
  }

  return {
    exitCode: 1,
    message: [
      "Optional OpenAI-managed metadata publication is incomplete.",
      ...comparison,
      "After the explicitly requested publication is live, mark the exact digest with:",
      `npm run mcp:schema:mark-published -- --confirm-published ${live.schemaSha256}`,
    ].join("\n"),
  };
}

async function run() {
  const applicationModule = await import(
    pathToFileURL(resolve("dist/server/application/mcp.js")).href
  );
  const result = evaluateMcpPublication(
    applicationModule.applicationMcpSchemaManifest,
    applicationModule.applicationMcpPublishedSchema,
    process.argv.includes("--require-publication"),
  );
  const output = result.exitCode === 0 ? console.log : console.error;
  output(result.message);
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await run();
}
