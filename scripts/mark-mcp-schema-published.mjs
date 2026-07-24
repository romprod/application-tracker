import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { format } from "prettier";

const confirmationFlag = process.argv.indexOf("--confirm-published");
const confirmedHash = process.argv[confirmationFlag + 1];
const applicationModule = await import(
  pathToFileURL(resolve("dist/server/application/mcp.js")).href
);
const live = applicationModule.applicationMcpSchemaManifest;

if (
  confirmationFlag < 0 ||
  !confirmedHash ||
  confirmedHash !== live.schemaSha256
) {
  console.error(
    `Confirm the exact schema published by OpenAI with --confirm-published ${live.schemaSha256}`,
  );
  process.exitCode = 1;
} else {
  const outputPath = resolve("src/application/mcp_published_schema.ts");
  const source = await format(
    `// Update only after OpenAI has published the matching plugin metadata version.\nexport const applicationMcpPublishedSchema = ${JSON.stringify(
      {
        schemaSha256: live.schemaSha256,
        schemaVersion: live.schemaVersion,
        toolCount: live.toolCount,
      },
      null,
      2,
    )} as const;\n`,
    { filepath: outputPath },
  );
  await writeFile(outputPath, source);
  console.log(
    `Marked MCP schema v${String(live.schemaVersion)} (${live.schemaSha256}) as published. Commit and deploy this server-only status update.`,
  );
}
