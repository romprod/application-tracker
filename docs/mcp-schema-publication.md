# MCP schema versioning and optional publication

Application Tracker treats its MCP tool metadata as a versioned public
contract. Direct MCP clients discover that contract from the running server.
Schema changes do not require Application Tracker to be registered or
published as a plugin.

OpenAI-managed publication is an optional, separate distribution channel. Use
the publication workflow in this document only when the user or project owner
explicitly requests that outcome. A schema version change, manifest drift,
skill update, or ordinary production deployment is not authorization to submit
or publish anything externally.

## Schema status tool

`get_connector_schema_status` is a read-only, audited diagnostic. It returns:

- the live schema version, SHA-256 digest, tool count, and per-tool digests;
- the last schema version, digest, and tool count explicitly marked as
  published;
- `current` or `update_available`;
- `publicationRequired: false`;
- the available `scan_submit_publish` workflow; and
- `selfRefreshSupported: false`, because the server cannot replace OpenAI's
  reviewed plugin snapshot.

The tool's own input and output shapes are stable. Its values can change after a
server-only deployment without changing the published contract.

## Development guard

The generated
[`mcp_schema_manifest.ts`](../src/application/mcp_schema_manifest.ts) records
the live contract's overall digest and one digest per tool. The digest includes
tool names, titles, descriptions, input and output schemas, annotations,
execution metadata, and tool `_meta`.

When a tool contract changes:

1. Increment `applicationMcpSchemaVersion` in
   [`mcp.ts`](../src/application/mcp.ts).
2. Run:

   ```sh
   npm run mcp:schema:generate
   ```

3. Review and commit the generated manifest.

`npm run check` regenerates the contract in memory and fails when the committed
manifest is stale. Generation also fails when a contract changes without a
version increment, or when the version changes without a contract change.

## Direct MCP releases

Direct MCP releases require the normal quality gates, including the generated
manifest check:

```sh
npm run check
```

Existing clients may need to reconnect or start a fresh task to rediscover new
tools. They do not need a plugin registration or an external publication step.

`npm run mcp:schema:release-check` reports whether the live contract differs
from [`mcp_published_schema.ts`](../src/application/mcp_published_schema.ts),
but that drift is informational and does not block a direct MCP release.

## Optional OpenAI-managed distribution

If this distribution channel was explicitly requested, run the strict check:

```sh
npm run mcp:schema:publication-check
```

The strict command exits non-zero while the last marked publication differs
from the live schema. This failure applies only to the explicitly requested
managed-distribution release.

For a planned backward-compatible metadata change:

1. Keep every previously published tool and field compatible.
2. Deploy the server so OpenAI can reach the updated MCP endpoint.
3. In the OpenAI plugin submission portal, create or update the draft, select
   **Scan Tools**, verify the expected contract, submit it, and publish it after
   approval.
4. Start a fresh connector task and verify the published tools and schemas.
5. Mark the exact live digest as published:

   ```sh
   npm run mcp:schema:mark-published -- \
     --confirm-published <live-schema-sha256>
   ```

6. Review and commit the updated published-schema marker, then deploy that
   server-only status change.
7. Run `npm run mcp:schema:publication-check` again and require a successful
   exit for that optional distribution release.

Never mark a digest as published before the portal shows that exact metadata
version as live. The marker is evidence for the release guard; it does not call
OpenAI or refresh plugin metadata.
