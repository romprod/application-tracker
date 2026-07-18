export type DatabaseMaintenanceRequest =
  | { command: "backup"; output?: string }
  | { command: "verify"; input: string }
  | { command: "restore"; input: string; output: string };

function options(arguments_: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name !== "--input" && name !== "--output") {
      throw new Error(`Unknown option: ${name ?? "(missing)"}`);
    }
    if (parsed.has(name)) throw new Error(`Duplicate option: ${name}`);
    if (!value || value.startsWith("--")) {
      throw new Error(`Expected a value after ${name}`);
    }
    parsed.set(name, value);
  }
  return parsed;
}

export function parseDatabaseMaintenanceArguments(
  arguments_: string[],
): DatabaseMaintenanceRequest {
  const [command, ...optionArguments] = arguments_;
  if (command !== "backup" && command !== "verify" && command !== "restore") {
    throw new Error("Expected backup, verify, or restore");
  }
  const parsed = options(optionArguments);
  const input = parsed.get("--input");
  const output = parsed.get("--output");

  if (command === "backup") {
    if (input) throw new Error("The backup command does not accept --input");
    return { command, ...(output ? { output } : {}) };
  }
  if (command === "verify") {
    if (output) throw new Error("The verify command does not accept --output");
    if (!input) throw new Error("The verify command requires --input");
    return { command, input };
  }
  if (!input || !output) {
    throw new Error("The restore command requires --input and --output");
  }
  return { command, input, output };
}
