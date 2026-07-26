import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { DomUtils, parseDocument } from "htmlparser2";

const clientRoot = new URL("../dist/client/", import.meta.url);
const index = await readFile(new URL("index.html", clientRoot), "utf8");
const document = parseDocument(index);
const entryScript = DomUtils.findOne(
  ({ attribs, name }) =>
    name === "script" &&
    attribs.type === "module" &&
    typeof attribs.src === "string",
  document.children,
);
const entryPath = entryScript?.attribs.src;

if (!entryPath) {
  throw new Error("The built client entry script could not be resolved");
}

const entryUrl = new URL(entryPath.replace(/^\//, ""), clientRoot);
const entry = await readFile(entryUrl);
const maximumEntryBytes = 500_000;
const maximumEntryGzipBytes = 150_000;
const gzipBytes = gzipSync(entry).byteLength;

if (entry.byteLength > maximumEntryBytes || gzipBytes > maximumEntryGzipBytes) {
  throw new Error(
    [
      "The client entry bundle exceeds its mobile budget.",
      `Entry: ${entry.byteLength.toLocaleString()} bytes (maximum ${maximumEntryBytes.toLocaleString()}).`,
      `Gzip: ${gzipBytes.toLocaleString()} bytes (maximum ${maximumEntryGzipBytes.toLocaleString()}).`,
    ].join(" "),
  );
}

console.log(
  `Client entry bundle: ${entry.byteLength.toLocaleString()} bytes, ${gzipBytes.toLocaleString()} bytes gzip.`,
);
