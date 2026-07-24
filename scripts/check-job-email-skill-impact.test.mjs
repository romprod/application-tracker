import { describe, expect, it } from "vitest";

import {
  evaluateJobEmailSkillImpact,
  isJobEmailSensitivePath,
  jobEmailContractPath,
  jobEmailSkillPath,
} from "./check-job-email-skill-impact.mjs";

describe("job-email skill impact guard", () => {
  it("ignores unrelated and test-only changes", () => {
    expect(isJobEmailSensitivePath("src/client/styles.css")).toBe(false);
    expect(
      isJobEmailSensitivePath(
        "src/application/job_email_reconciliation.test.ts",
      ),
    ).toBe(false);
    expect(
      evaluateJobEmailSkillImpact([
        "src/client/styles.css",
        "src/application/job_email_reconciliation.test.ts",
      ]),
    ).toMatchObject({ outcome: "not_triggered" });
  });

  it("monitors workflow contracts and relevant migrations", () => {
    expect(isJobEmailSensitivePath("src/application/mcp.ts")).toBe(true);
    expect(
      isJobEmailSensitivePath(
        "src/infrastructure/database/migrations/026_application_merges.ts",
      ),
    ).toBe(true);
    expect(
      isJobEmailSensitivePath("src/client/application_workspace.tsx"),
    ).toBe(true);
    expect(
      isJobEmailSensitivePath("src/application/data_quality_queue.ts"),
    ).toBe(true);
    expect(isJobEmailSensitivePath("src/domain/evidence.ts")).toBe(true);
  });

  it("passes when the skill and contract reference change", () => {
    expect(
      evaluateJobEmailSkillImpact([
        "src/application/job_email_reconciliation.ts",
        jobEmailSkillPath,
        jobEmailContractPath,
      ]),
    ).toMatchObject({ outcome: "updated" });
  });

  it("rejects an update to only one required document", () => {
    expect(() =>
      evaluateJobEmailSkillImpact([
        "src/application/job_email_reconciliation.ts",
        jobEmailSkillPath,
      ]),
    ).toThrow("only one required document was updated");
  });

  it("accepts an explicit not-applicable review with a reason", () => {
    expect(
      evaluateJobEmailSkillImpact(
        ["src/server/mcp_server.ts"],
        [
          "- [x] Job-email skill update is not applicable.",
          "",
          "Job-email skill review reason: The change only adjusts OAuth diagnostics.",
        ].join("\n"),
      ),
    ).toMatchObject({
      outcome: "reviewed_not_applicable",
      reason: "The change only adjusts OAuth diagnostics.",
    });
    expect(
      evaluateJobEmailSkillImpact(
        ["src/server/mcp_server.ts"],
        [
          "- [x] Job-email skill update is not applicable.",
          "",
          "Job-email skill review reason:",
          "This only adjusts OAuth diagnostics and leaves tool contracts unchanged.",
        ].join("\n"),
      ),
    ).toMatchObject({
      outcome: "reviewed_not_applicable",
      reason:
        "This only adjusts OAuth diagnostics and leaves tool contracts unchanged.",
    });
  });

  it("rejects an unchecked or unexplained exception", () => {
    expect(() =>
      evaluateJobEmailSkillImpact(
        ["src/server/mcp_server.ts"],
        "Job-email skill review reason: The change only adjusts OAuth diagnostics.",
      ),
    ).toThrow("without a completed skill-impact review");
    expect(() =>
      evaluateJobEmailSkillImpact(
        ["src/server/mcp_server.ts"],
        [
          "- [x] Job-email skill update is not applicable.",
          "",
          "Job-email skill review reason: <!-- explain -->",
        ].join("\n"),
      ),
    ).toThrow("without a completed skill-impact review");
  });
});
