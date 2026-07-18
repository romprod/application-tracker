import { describe, expect, it } from "vitest";

import { parseDatabaseMaintenanceArguments } from "./database_maintenance_arguments.js";

describe("parseDatabaseMaintenanceArguments", () => {
  it("accepts backup, verify, and restore commands", () => {
    expect(parseDatabaseMaintenanceArguments(["backup"])).toEqual({
      command: "backup",
    });
    expect(
      parseDatabaseMaintenanceArguments([
        "backup",
        "--output",
        "backups/snapshot.sqlite",
      ]),
    ).toEqual({
      command: "backup",
      output: "backups/snapshot.sqlite",
    });
    expect(
      parseDatabaseMaintenanceArguments([
        "verify",
        "--input",
        "backups/snapshot.sqlite",
      ]),
    ).toEqual({
      command: "verify",
      input: "backups/snapshot.sqlite",
    });
    expect(
      parseDatabaseMaintenanceArguments([
        "restore",
        "--input",
        "backups/snapshot.sqlite",
        "--output",
        "restore/application-tracker.sqlite",
      ]),
    ).toEqual({
      command: "restore",
      input: "backups/snapshot.sqlite",
      output: "restore/application-tracker.sqlite",
    });
  });

  it("rejects missing values, duplicate options, and irrelevant options", () => {
    expect(() => parseDatabaseMaintenanceArguments([])).toThrow(
      "Expected backup, verify, or restore",
    );
    expect(() =>
      parseDatabaseMaintenanceArguments(["verify", "--input"]),
    ).toThrow("Expected a value after --input");
    expect(() =>
      parseDatabaseMaintenanceArguments([
        "verify",
        "--input",
        "one.sqlite",
        "--input",
        "two.sqlite",
      ]),
    ).toThrow("Duplicate option: --input");
    expect(() =>
      parseDatabaseMaintenanceArguments([
        "backup",
        "--input",
        "snapshot.sqlite",
      ]),
    ).toThrow("The backup command does not accept --input");
    expect(() =>
      parseDatabaseMaintenanceArguments(["restore", "--input", "one.sqlite"]),
    ).toThrow("The restore command requires --input and --output");
  });
});
