import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CamoufoxJobPostingBrowserFallback } from "../application/job_posting_browser_fallback.js";
import {
  type JobPostingInspectionResult,
  JobPostingInspectionService,
} from "../application/job_posting_inspection.js";
import { jobPostingInspectionInputSchema } from "../domain/job_postings.js";
import { parseRuntimeConfig } from "./config.js";

function canaryUrls(arguments_: string[]): string[] {
  const urls: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--url" || !arguments_[index + 1]) {
      throw new Error(
        "Usage: npm run job-posting:camoufox:canary -- --url <canonical-url> [--url <canonical-url>]",
      );
    }
    urls.push(arguments_[index + 1]!);
    index += 1;
  }
  if (urls.length < 1 || urls.length > 5) {
    throw new Error("The Camoufox canary requires between one and five URLs");
  }
  return urls.map((url) => jobPostingInspectionInputSchema.parse({ url }).url);
}

async function run(): Promise<void> {
  const environmentPath = resolve(process.cwd(), ".env");
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);
  const config = parseRuntimeConfig(process.env);
  if (!config.jobPostingBrowserFallback.enabled) {
    throw new Error(
      "CAMOUFOX_FALLBACK_ENABLED must be true for the explicit canary command",
    );
  }
  const fallback = new CamoufoxJobPostingBrowserFallback(
    config.jobPostingBrowserFallback,
    fetch,
    Date.now,
    (event) => {
      console.error(
        JSON.stringify({
          event: "job_posting_camoufox_canary",
          ...event,
        }),
      );
    },
  );
  const inspector = new JobPostingInspectionService(
    undefined,
    undefined,
    undefined,
    undefined,
    fallback,
  );
  const results: JobPostingInspectionResult[] = [];
  for (const url of canaryUrls(process.argv.slice(2))) {
    results.push(await inspector.inspectBrowserCanary({ url }));
  }
  console.log(
    JSON.stringify({ results, verification: { trackerRead: false } }),
  );
  if (results.some(({ status }) => status !== "available")) {
    process.exitCode = 1;
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Canary failed");
  process.exitCode = 1;
});
