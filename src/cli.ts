import { handleInit, loadConfiguration } from "./config.js";
import { handleUpdate } from "./git.js";
import { handleLink } from "./links.js";
import { handleStatus } from "./status.js";
import { logError, printHelp } from "./ui.js";

/**
 * Loads configuration, dispatches the requested CLI command, and records a
 * failing process exit code when the command reports failure.
 *
 * The command handlers return booleans instead of exiting directly so the CLI
 * flow has a single place responsible for process-level side effects.
 */
export function main(args: string[] = process.argv.slice(2)): void {
  const config = loadConfiguration();
  const command = args[0]?.toLowerCase();

  let ok = true;
  switch (command) {
    case "init":
      ok = handleInit();
      break;
    case "status":
      ok = handleStatus(config);
      break;
    case "link":
      ok = handleLink(config);
      break;
    case "update": {
      const msg = args.slice(1).join(" ");
      ok = handleUpdate(config, msg || undefined);
      break;
    }
    case "help":
    case "-h":
    case "--help":
    case undefined:
      printHelp();
      break;
    default:
      logError(`Unknown command: "${args[0]}"`);
      printHelp();
      ok = false;
  }

  if (!ok) {
    process.exitCode = 1;
  }
}
