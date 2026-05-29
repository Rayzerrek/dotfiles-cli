import { handleInit, loadConfiguration } from "./config.js";
import { handleUpdate } from "./git.js";
import { handleLink } from "./links.js";
import { handleStatus } from "./status.js";
import { logError, printHelp } from "./ui.js";

/**
 * Dispatches the requested CLI command, loading configuration only for commands
 * that need it, and records a failing process exit code when the command reports failure.
 *
 * The command handlers return booleans instead of exiting directly so the CLI
 * flow has a single place responsible for process-level side effects.
 */
export function main(args: string[] = process.argv.slice(2)): void {
  const command = args[0]?.toLowerCase();

  let ok = true;
  switch (command) {
    case "init":
      ok = handleInit();
      break;
    case "status": {
      const result = loadConfiguration();
      if (!result.ok) {
        logError(result.error);
        ok = false;
        break;
      }
      ok = handleStatus(result.config);
      break;
    }
    case "link": {
      const result = loadConfiguration();
      if (!result.ok) {
        logError(result.error);
        ok = false;
        break;
      }
      ok = handleLink(result.config);
      break;
    }
    case "update": {
      const result = loadConfiguration();
      if (!result.ok) {
        logError(result.error);
        ok = false;
        break;
      }
      const msg = args.slice(1).join(" ");
      ok = handleUpdate(result.config, msg || undefined);
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
