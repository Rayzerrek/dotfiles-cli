import { existsSync } from "fs";

import { runCmd } from "./system.js";
import type { AppConfig, ResolvedLink } from "./types.js";
import {
  bold,
  gray,
  header,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  red,
  yellow,
} from "./ui.js";

/**
 * Prints the short git status for the configured dotfiles repository.
 *
 * This is intentionally read-only. Mutating git workflows live in
 * {@link handleUpdate}.
 */
export function printGitRepositoryStatus(dotfilesDir: string): boolean {
  if (!existsSync(dotfilesDir)) {
    logError(`Dotfiles repository directory does not exist at: ${dotfilesDir}`);
    return false;
  }

  const gitStatus = runCmd(["git", "status", "-s"], dotfilesDir);
  if (!gitStatus.success) {
    logError(`Failed to run git status: ${gitStatus.stderr}`);
    return false;
  }

  if (gitStatus.stdout) {
    console.log(yellow("Uncommitted changes detected in repository:"));
    for (const line of gitStatus.stdout.split(/\r?\n/)) {
      console.log(`  ${line}`);
    }
  } else {
    logSuccess("Dotfiles repository is clean (nothing to commit).");
  }

  return true;
}

/**
 * Builds the default commit message for a dotfiles update.
 *
 * Git porcelain paths are grouped by configured link names when possible, with
 * unmatched files grouped under `general`. This keeps automatic commits useful
 * without requiring the CLI to understand the full repository layout.
 */
export function buildCommitMessage(
  statusLines: string[],
  links: ResolvedLink[],
): string {
  const changedConfigs = new Set<string>();

  for (const line of statusLines) {
    const file = line.slice(3).replace(/\\/g, "/");
    const match = links.find(
      (link) => file === link.name || file.startsWith(link.name + "/"),
    );
    changedConfigs.add(match ? match.name : "general");
  }

  const dateStr = new Date().toISOString().split("T")[0];
  return `update: ${[...changedConfigs].join(", ")} config (${dateStr})`;
}

/**
 * Stages, commits, and pushes current changes from the dotfiles repository.
 *
 * If no commit message is provided, one is generated from porcelain status
 * lines using {@link buildCommitMessage}. A successful no-op status is treated
 * as success.
 */
export function handleUpdate(
  { dotfilesDir, links }: AppConfig,
  commitMessage?: string,
): boolean {
  console.log(header("Updating Dotfiles"));

  if (!existsSync(dotfilesDir)) {
    logError(`Dotfiles repository directory does not exist at: ${dotfilesDir}`);
    return false;
  }

  const git = (...args: string[]) => runCmd(["git", ...args], dotfilesDir);

  logInfo("Checking changes in dotfiles...");
  const statusRes = git("status", "--porcelain");
  if (!statusRes.success) {
    logError(`Failed to check git status: ${statusRes.stderr}`);
    return false;
  }
  if (!statusRes.stdout) {
    logSuccess("No changes to update.");
    return true;
  }

  const lines = statusRes.stdout.split(/\r?\n/);

  // Display changes to be pushed
  console.log(`\n${bold("Detected changes to push:")}`);
  for (const line of lines) {
    console.log(`  ${gray(line)}`);
  }
  console.log("");

  // Prepare commit message
  const finalMsg = commitMessage ?? buildCommitMessage(lines, links);

  logInfo("Staging changes (git add)...");
  const addRes = git("add", "-A");
  if (!addRes.success) {
    logError(`Failed to stage changes: ${addRes.stderr}`);
    return false;
  }

  logInfo(`Creating commit: "${finalMsg}"...`);
  const commitRes = git("commit", "-m", finalMsg);
  if (!commitRes.success) {
    logError(`Failed to create commit: ${commitRes.stderr}`);
    return false;
  }
  logSuccess("Commit created successfully!");

  const branchRes = git("branch", "--show-current");
  if (!branchRes.success || !branchRes.stdout) {
    logError(
      `Could not determine current branch: ${branchRes.stderr || "empty result"}`,
    );
    logWarning(
      `Commit was created locally. Push manually with: git -C "${dotfilesDir}" push origin <branch>`,
    );
    return false;
  }
  const branch = branchRes.stdout;

  logInfo(`Pushing changes to remote (git push origin ${branch})...`);
  const pushRes = git("push", "origin", branch);
  if (pushRes.success) {
    logSuccess("Dotfiles successfully updated and pushed to GitHub!");
    return true;
  }

  logWarning(
    "Changes committed locally, but failed to push to remote repository:",
  );
  console.log(`  ${red(pushRes.stderr)}`);
  logWarning(
    `You can try to push manually later using: git -C "${dotfilesDir}" push origin ${branch}`,
  );
  return false;
}
