import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const jobEmailSkillPath =
  ".agents/skills/application-tracker-job-email/SKILL.md";
export const jobEmailContractPath =
  ".agents/skills/application-tracker-job-email/references/current-mcp-contract.md";

const alwaysMonitoredPaths = new Set([
  "src/application/mcp.ts",
  "src/client/App.tsx",
  "src/server/mcp_server.ts",
]);
const monitoredBasenamePattern =
  /(activity|application|attention|contact|data_quality|deleted|document|duplicate|email|evidence|event|job|merge|posting|provenance|reconciliation|reference_value|restore|salary|work_arrangement)/i;
const testFilePattern = /\.(?:spec|test)\.[cm]?[jt]sx?$/i;
const notApplicableCheckboxPattern =
  /-\s*\[[xX]\]\s*Job-email skill update is not applicable\./;
const reviewReasonPattern = /^Job-email skill review reason:\s*(.*)$/im;
const nextSectionPattern = /\n##\s/;

function normalizedPath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function meaningfulReviewReason(pullRequestBody) {
  const match = pullRequestBody.match(reviewReasonPattern);
  if (!match) return null;
  const followingText = pullRequestBody
    .slice((match.index ?? 0) + match[0].length)
    .split(nextSectionPattern, 1)[0];
  const reason = `${match[1]}\n${followingText}`.trim();
  if (reason.includes("<!--") || reason.includes("-->")) return null;
  return reason.length >= 12 ? reason : null;
}

export function isJobEmailSensitivePath(filePath) {
  const normalized = normalizedPath(filePath);
  if (
    normalized === jobEmailSkillPath ||
    normalized === jobEmailContractPath ||
    testFilePattern.test(normalized)
  ) {
    return false;
  }
  if (alwaysMonitoredPaths.has(normalized)) return true;
  if (!normalized.startsWith("src/")) return false;
  return monitoredBasenamePattern.test(basename(normalized));
}

export function evaluateJobEmailSkillImpact(
  changedFiles,
  pullRequestBody = "",
) {
  const normalizedFiles = changedFiles.map(normalizedPath);
  const sensitiveFiles = normalizedFiles.filter(isJobEmailSensitivePath);
  if (sensitiveFiles.length === 0) {
    return {
      outcome: "not_triggered",
      reason: "No monitored job-email workflow files changed.",
      sensitiveFiles,
    };
  }

  const changed = new Set(normalizedFiles);
  const skillChanged = changed.has(jobEmailSkillPath);
  const contractChanged = changed.has(jobEmailContractPath);
  if (skillChanged && contractChanged) {
    return {
      outcome: "updated",
      reason:
        "The job-email skill instructions and MCP contract reference both changed.",
      sensitiveFiles,
    };
  }

  if (skillChanged !== contractChanged) {
    throw new Error(
      `A monitored job-email workflow changed, but only one required document was updated. Update both ${jobEmailSkillPath} and ${jobEmailContractPath}.`,
    );
  }

  const reviewReason = meaningfulReviewReason(pullRequestBody);
  if (
    notApplicableCheckboxPattern.test(pullRequestBody) &&
    reviewReason !== null
  ) {
    return {
      outcome: "reviewed_not_applicable",
      reason: reviewReason,
      sensitiveFiles,
    };
  }

  throw new Error(
    [
      "A monitored job-email workflow changed without a completed skill-impact review.",
      `Update both ${jobEmailSkillPath} and ${jobEmailContractPath}, or select the pull-request template's not-applicable option and provide a concrete review reason.`,
    ].join(" "),
  );
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function changedFilesBetween(base, head) {
  const output = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      "-z",
      `${base}...${head}`,
      "--",
    ],
    { encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

async function pullRequestBody() {
  const eventFile = argumentValue("--event-file");
  if (eventFile) {
    const event = JSON.parse(await readFile(eventFile, "utf8"));
    return event.pull_request?.body ?? "";
  }
  const bodyFile = argumentValue("--body-file");
  return bodyFile ? readFile(bodyFile, "utf8") : "";
}

async function run() {
  const base = argumentValue("--base");
  const head = argumentValue("--head");
  if (!base || !head) {
    throw new Error(
      "Usage: node scripts/check-job-email-skill-impact.mjs --base <git-ref> --head <git-ref> [--event-file <path> | --body-file <path>]",
    );
  }

  const result = evaluateJobEmailSkillImpact(
    changedFilesBetween(base, head),
    await pullRequestBody(),
  );
  console.log(`Job-email skill impact: ${result.outcome}. ${result.reason}`);
  if (result.sensitiveFiles.length > 0) {
    console.log(`Monitored files:\n${result.sensitiveFiles.join("\n")}`);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
