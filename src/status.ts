import { printGitRepositoryStatus } from "./git.js";
import { checkJunction } from "./links.js";
import { bold, green, header, red, yellow } from "./ui.js";

import type { AppConfig } from "./types.js";

/**
 * Prints the health of configured system links and the git status of the
 * dotfiles repository.
 *
 * The returned boolean is suitable for process exit-code decisions: `false`
 * means at least one configured link is unhealthy or repository status could
 * not be queried.
 */
export function handleStatus({ dotfilesDir, links }: AppConfig): boolean {
  console.log(header("System Links Status"));

  let ok = true;
  for (const link of links) {
    const result = checkJunction(link);
    if (result.linked) {
      console.log(
        `  ${green("[✔ ]")} ${bold(`${link.name}:`)} ${result.message}`,
      );
    } else {
      ok = false;
      console.log(
        `  ${red("[✘ ]")} ${bold(`${link.name}:`)} ${yellow(result.message)}`,
      );
    }
  }

  console.log(header("Git Repository Status (dotfiles)"));
  return printGitRepositoryStatus(dotfilesDir) && ok;
}
