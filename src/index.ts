#!/usr/bin/env node
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  readSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join, normalize, resolve } from "path";

// ANSI color helpers - small wrappers to keep call sites concise
const RESET = "\x1b[0m";
const wrap = (code: string) => (s: string) => `${code}${s}${RESET}`;
const bold = wrap("\x1b[1m");
const green = wrap("\x1b[32m");
const red = wrap("\x1b[31m");
const yellow = wrap("\x1b[33m");
const cyan = wrap("\x1b[36m");
const gray = wrap("\x1b[90m");
const header = (title: string) => `\n${bold(`--- ${title} ---`)}`;

function logInfo(msg: string): void {
  console.log(`${cyan("ℹ")} ${msg}`);
}

function logSuccess(msg: string): void {
  console.log(`${green("✔")} ${msg}`);
}

function logWarning(msg: string): void {
  console.log(`${yellow("⚠")} ${msg}`);
}

function logError(msg: string): void {
  console.error(`${red("✘")} ${bold("Error:")} ${msg}`);
}

function promptInput(question: string): string {
  writeSync(process.stdout.fd, question);
  const buffer = Buffer.alloc(1024);
  const bytesRead = readSync(process.stdin.fd, buffer, 0, buffer.length, null);
  return buffer.toString("utf-8", 0, bytesRead).trim();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Safely retrieves the filesystem `lstat` stats for a given path.
 * Replaces the double-syscall existsSync + lstatSync pattern with a single try-catch check.
 *
 * @param path - The absolute file or directory path.
 * @returns The `Stats` object, or `null` if the path does not exist or is unreadable.
 */
function safeLstat(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Executes a system command synchronously and returns a structured result.
 *
 * @param args - The command name and arguments.
 * @param cwd - The working directory in which to execute the command.
 * @returns The command execution status, stdout, and stderr.
 */
function runCmd(args: string[], cwd?: string): CommandResult {
  const proc = spawnSync(args[0], args.slice(1), {
    cwd,
    env: process.env,
    encoding: "utf-8",
  });
  return {
    success: proc.status === 0,
    stdout: proc.stdout?.trim() ?? "",
    stderr: proc.stderr?.trim() ?? "",
  };
}

// Platform keys used in config systemPath maps.
const PLATFORM_KEYS = ["windows", "macos", "linux"] as const;
type PlatformKey = (typeof PLATFORM_KEYS)[number];
type SystemPathSpec = string | Partial<Record<PlatformKey, string>>;

const PLATFORM_KEY: Record<string, PlatformKey> = {
  win32: "windows",
  darwin: "macos",
  linux: "linux",
};

interface DotfileLink {
  name: string;
  systemPath: SystemPathSpec;
}

interface DotConfig {
  dotfilesDir?: string;
  links?: DotfileLink[];
}

interface ResolvedLink {
  name: string;
  repoPath: string; // Absolute path inside the central dotfiles repository
  systemPath: string; // Target path in the system where the link should sit
}

interface AppConfig {
  dotfilesDir: string;
  links: ResolvedLink[];
}

/**
 * Resolves and normalizes a system path, expanding home directory shortcuts (~).
 *
 * @param p - The raw path to normalize.
 * @returns The absolute, normalized path.
 */
function normalizePath(p: string): string {
  const expanded = p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
  return resolve(normalize(expanded));
}

/**
 * Resolves a system path specification to a single path string for the current platform.
 *
 * @param pathSpec - A string path or a platform-specific mapping object.
 * @returns The resolved system path, or `undefined` if the current platform is unsupported.
 */
function resolveSystemPath(pathSpec: SystemPathSpec): string | undefined {
  if (typeof pathSpec === "string") return pathSpec;
  const key = PLATFORM_KEY[process.platform];
  return key ? pathSpec[key] : undefined;
}

/**
 * Strips single-line (`//`) and multi-line (`/* ... *\/`) comments,
 * and trailing commas from a JSONC string to make it valid JSON.
 *
 * @param content - The raw JSONC content.
 * @returns A standard JSON-compliant string.
 */
function stripComments(content: string): string {
  let stripped = content.replace(
    /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
    (m, g) => (g ? "" : m),
  );
  // Remove trailing commas before } or ] (valid in JSONC, invalid in JSON)
  stripped = stripped.replace(/,\s*([}\]])/g, "$1");
  return stripped;
}

/**
 * Validates whether a value is a valid SystemPathSpec.
 *
 * @param value - The value to check.
 * @returns `true` if valid, otherwise `false`.
 */
function isSystemPathSpec(value: unknown): value is SystemPathSpec {
  if (typeof value === "string") return true;
  if (typeof value !== "object" || value === null) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    entries.length > 0 &&
    entries.every(
      ([k, v]) =>
        PLATFORM_KEYS.includes(k as PlatformKey) && typeof v === "string",
    )
  );
}

/**
 * Validates a single dotfile link entry.
 *
 * @param link - The raw link object to validate.
 * @param i - The index of the link in the array (used for error reporting).
 * @returns A validated `DotfileLink` object.
 * @throws An error if the link format is invalid.
 */
function validateLink(link: unknown, i: number): DotfileLink {
  if (typeof link !== "object" || link === null) {
    throw new Error(`links[${i}] must be an object`);
  }
  const entry = link as Record<string, unknown>;
  if (typeof entry.name !== "string") {
    throw new Error(`links[${i}].name must be a string`);
  }
  if (!("systemPath" in entry) || !isSystemPathSpec(entry.systemPath)) {
    throw new Error(
      `links[${i}].systemPath must be a string or { windows?, macos?, linux? }`,
    );
  }
  return { name: entry.name, systemPath: entry.systemPath };
}

/**
 * Validates the raw configuration object.
 *
 * @param raw - The raw configuration object.
 * @returns A validated `DotConfig` object.
 * @throws An error if the configuration has an invalid schema.
 */
function validateConfig(raw: unknown): DotConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Config must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const config: DotConfig = {};

  if ("dotfilesDir" in obj) {
    if (typeof obj.dotfilesDir !== "string") {
      throw new Error(`"dotfilesDir" must be a string`);
    }
    config.dotfilesDir = obj.dotfilesDir;
  }

  if ("links" in obj) {
    if (!Array.isArray(obj.links)) {
      throw new Error(`"links" must be an array`);
    }
    config.links = obj.links.map(validateLink);
  }

  return config;
}

// Default location for config + cache files (~/.config/dot)
const DOT_DIR = join(homedir(), ".config", "dot");
const DEFAULT_CONFIG_PATH = join(DOT_DIR, "config.jsonc");

/**
 * Searches for the first existing configuration file in the conventional candidates list.
 *
 * @returns An object containing the config content and its absolute path, or `null` if none found.
 */
function findConfigFile(): { content: string; path: string } | null {
  const candidates = [
    DEFAULT_CONFIG_PATH,
    join(DOT_DIR, "config.json"),
    join(homedir(), ".dotrc.jsonc"),
    join(homedir(), ".dotrc.json"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return { content: readFileSync(path, "utf-8"), path };
    } catch (err) {
      logWarning(
        `Found config file at ${path} but failed to read it: ${errorMessage(err)}`,
      );
    }
  }
  return null;
}

/**
 * Detects if the configuration content has changed since the last execution and logs a notice.
 * Stores an MD5 hash of the config in `~/.config/dot/.config-hash`.
 *
 * @param content - The current config file content.
 * @param path - The path to the config file.
 */
function notifyOnConfigChange(content: string, path: string): void {
  const hashFile = join(DOT_DIR, ".config-hash");
  const currentHash = createHash("md5").update(content).digest("hex");
  let previousHash = "";
  try {
    previousHash = readFileSync(hashFile, "utf-8").trim();
  } catch {}
  if (previousHash && previousHash !== currentHash) {
    logInfo(`Configuration changed (${path})`);
  }
  try {
    mkdirSync(DOT_DIR, { recursive: true });
    writeFileSync(hashFile, currentHash);
  } catch {}
}

/**
 * Loads, parses, and validates the application configuration.
 * Resolves target system paths and repository paths for the current platform.
 *
 * @returns The resolved application configuration.
 */
function loadConfiguration(): AppConfig {
  const found = findConfigFile();

  let configData: DotConfig = {};
  if (found) {
    try {
      configData = validateConfig(JSON.parse(stripComments(found.content)));
      notifyOnConfigChange(found.content, found.path);
    } catch (err) {
      logError(
        `Failed to parse config from ${found.path}: ${errorMessage(err)}`,
      );
    }
  } else {
    logWarning(
      `No configuration file found. Create one at ${DEFAULT_CONFIG_PATH}`,
    );
    logInfo(`See: https://github.com/Rayzerrek/dot-cli#configuration`);
  }

  // Resolve dotfiles directory (config > env > default)
  const dotfilesDir = normalizePath(
    configData.dotfilesDir ?? process.env.DOTFILES_DIR ?? "~/dotfiles",
  );

  // Resolve links for the current platform
  const links: ResolvedLink[] = [];
  for (const link of configData.links ?? []) {
    const sysPathRaw = resolveSystemPath(link.systemPath);
    if (!sysPathRaw) continue;
    links.push({
      name: link.name,
      repoPath: join(dotfilesDir, link.name),
      systemPath: normalizePath(sysPathRaw),
    });
  }

  return { dotfilesDir, links };
}

function buildInitialConfigContent(dotfilesDir: string): string {
  return [
    "{",
    '  // Created by dot init. Add entries to links, then run "dot link".',
    `  "dotfilesDir": ${JSON.stringify(dotfilesDir)},`,
    '  "links": []',
    "}",
    "",
  ].join("\n");
}

/**
 * Handles the "init" command, creating the default configuration file if missing.
 *
 * @returns `true` when a config already exists or was created successfully; `false` otherwise.
 */
function handleInit(): boolean {
  console.log(header("Initialize Dotfiles Configuration"));

  const existing = findConfigFile();
  if (existing) {
    logInfo(`Configuration already exists at: ${existing.path}`);
    return true;
  }

  const answer = promptInput(`Dotfiles repository directory ${gray("[~/dotfiles]")}: `);
  const dotfilesDir = answer || "~/dotfiles";

  try {
    mkdirSync(DOT_DIR, { recursive: true });
    const fd = openSync(DEFAULT_CONFIG_PATH, "wx");
    try {
      writeSync(fd, buildInitialConfigContent(dotfilesDir));
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    logError(`Failed to create config at ${DEFAULT_CONFIG_PATH}: ${errorMessage(err)}`);
    return false;
  }

  logSuccess(`Created configuration at: ${DEFAULT_CONFIG_PATH}`);
  logInfo("Edit links in the config, then run: dot link");
  return true;
}

/**
 * Verifies if a symbolic link or junction at the system path points correctly to the repository path.
 *
 * @param config - The resolved link metadata.
 * @returns Verification result with `linked` status and a descriptive message.
 */
function checkJunction(config: ResolvedLink): {
  linked: boolean;
  message: string;
} {
  const stat = safeLstat(config.systemPath);
  if (!stat) {
    return { linked: false, message: "Directory does not exist in system" };
  }
  if (!stat.isSymbolicLink()) {
    return {
      linked: false,
      message: "Physical directory exists, but is not a link",
    };
  }
  try {
    const target = readlinkSync(config.systemPath);
    if (normalizePath(target) === normalizePath(config.repoPath)) {
      return { linked: true, message: "Correct" };
    }
    return { linked: false, message: `Points to incorrect target: ${target}` };
  } catch (err) {
    return {
      linked: false,
      message: `Error reading link: ${errorMessage(err)}`,
    };
  }
}

/**
 * Handles the "status" command, printing the health of all symlinks
 * and the git repository status of the dotfiles folder.
 *
 * @param config - The active application configuration.
 * @returns `true` if all links are healthy and repository status was queried successfully; `false` otherwise.
 */
function handleStatus({ dotfilesDir, links }: AppConfig): boolean {
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

  return ok;
}

/**
 * Generates platform-specific conventional system locations where a dotfile link might reside.
 * Since the CLI is state-free and does not track the original link location, it probes
 * standard paths. Customized paths (e.g. VSCode's AppData subfolders) are not cleaned here.
 *
 * @param name - The name of the dotfile entry.
 * @returns An array of candidate paths to check.
 */
function staleLinkCandidates(name: string): string[] {
  const home = homedir();
  const candidates = [join(home, name), join(home, ".config", name)];
  if (process.platform === "win32") {
    candidates.push(
      join(home, "AppData", "Local", name),
      join(home, "AppData", "Roaming", name),
    );
  }
  return candidates;
}

/**
 * Removes system links pointing to dotfile directories that have been removed from the active config.
 * This prevents orphaned links in the system from continuing to write to the dotfiles repository.
 *
 * @param config - The active application configuration.
 * @returns `true` if no errors occurred during cleanup; `false` otherwise.
 */
function cleanStaleLinks({ dotfilesDir, links }: AppConfig): boolean {
  if (!existsSync(dotfilesDir)) return true;

  let dotfileNames: string[];
  try {
    dotfileNames = readdirSync(dotfilesDir, { withFileTypes: true })
      // Skip git metadata; other dotfiles/directories are valid candidates
      .filter((e) => e.isDirectory() && e.name !== ".git")
      .map((e) => e.name);
  } catch (err) {
    logWarning(
      `Could not scan dotfiles directory for stale links (${dotfilesDir}): ${errorMessage(err)}`,
    );
    return false;
  }

  const activeNames = new Set(links.map((l) => l.name));
  const staleNames = dotfileNames.filter((n) => !activeNames.has(n));
  if (staleNames.length === 0) return true;

  // Render the section header lazily to stay silent when there is nothing to clean up
  let printedHeader = false;
  const ensureHeader = () => {
    if (printedHeader) return;
    console.log(header("Cleaning Stale Links"));
    printedHeader = true;
  };

  let ok = true;
  for (const name of staleNames) {
    const repoPath = join(dotfilesDir, name);
    const normalizedRepoPath = normalizePath(repoPath);

    for (const candidate of staleLinkCandidates(name)) {
      const stat = safeLstat(candidate);
      if (!stat || !stat.isSymbolicLink()) continue;

      let target: string;
      try {
        target = readlinkSync(candidate);
      } catch (err) {
        ensureHeader();
        logWarning(
          `Could not read link target at ${candidate}: ${errorMessage(err)}`,
        );
        ok = false;
        continue;
      }

      if (normalizePath(target) !== normalizedRepoPath) continue;

      try {
        // unlinkSync safely removes the link entry without risk of deleting target files.
        // On Windows, Bun's rmSync fails with EFAULT on junctions, so unlinkSync is required.
        unlinkSync(candidate);
        ensureHeader();
        logSuccess(`Removed stale link: ${candidate} → ${repoPath}`);
      } catch (err) {
        ensureHeader();
        logError(
          `Failed to remove stale link at ${candidate}: ${errorMessage(err)}`,
        );
        ok = false;
      }
    }
  }

  return ok;
}

/**
 * Handles the "link" command, restoring or recreating missing symlinks/junctions
 * and migrating files if the source doesn't exist in the repository yet.
 *
 * @param config - The active application configuration.
 * @returns `true` if all links were successfully restored/processed; `false` otherwise.
 */
function handleLink(config: AppConfig): boolean {
  let ok = cleanStaleLinks(config);

  const { links } = config;
  console.log(header("Restoring Dotfiles Links"));

  for (const link of links) {
    console.log(`\nProcessing ${bold(link.name)}...`);

    // Ensure source directory exists; migrate local system files if missing from repository
    if (!existsSync(link.repoPath)) {
      const localStat = safeLstat(link.systemPath);
      if (!localStat || localStat.isSymbolicLink()) {
        logError(
          `Source directory does not exist in repository: ${link.repoPath}. Skipping.`,
        );
        ok = false;
        continue;
      }
      logInfo(
        `Migrating local configuration from ${link.systemPath} to ${link.repoPath}...`,
      );
      try {
        cpSync(link.systemPath, link.repoPath, { recursive: true });
        logSuccess(`Successfully migrated files to ${link.repoPath}!`);
      } catch (err) {
        logError(`Failed to migrate files: ${errorMessage(err)}`);
        ok = false;
        continue;
      }
    }

    if (checkJunction(link).linked) {
      logSuccess(`Link for ${link.name} is already correct. Skipping.`);
      continue;
    }

    // Handle existing target by creating a backup (if physical folder) or removing the invalid link
    const stat = safeLstat(link.systemPath);
    if (stat) {
      if (!stat.isSymbolicLink()) {
        const backupPath = `${link.systemPath}_backup_${Date.now()}`;
        logWarning(
          `Physical folder detected at ${link.systemPath}. Creating backup at: ${backupPath}...`,
        );
        try {
          renameSync(link.systemPath, backupPath);
          logSuccess(`Backup created successfully!`);
        } catch (err) {
          logError(`Failed to create backup: ${errorMessage(err)}`);
          ok = false;
          continue;
        }
      } else {
        logInfo(`Removing invalid or incorrect link at ${link.systemPath}...`);
        try {
          // unlinkSync is required for Windows/Bun junction support
          unlinkSync(link.systemPath);
        } catch (err) {
          logError(`Failed to remove old link: ${errorMessage(err)}`);
          ok = false;
          continue;
        }
      }
    }

    // Create new symbolic link or junction natively
    logInfo(`Creating link from '${link.systemPath}' to '${link.repoPath}'...`);
    try {
      const type = process.platform === "win32" ? "junction" : "dir";
      symlinkSync(link.repoPath, link.systemPath, type);
      logSuccess(`Successfully linked ${link.name}!`);
    } catch (err) {
      logError(`Error creating link: ${errorMessage(err)}`);
      ok = false;
    }
  }

  return ok;
}

/**
 * Dynamically generates a git commit message based on porcelain status lines.
 * Groups changes by their config link names or falls back to "general".
 *
 * @param statusLines - Raw porcelain git status lines.
 * @param links - The active resolved links.
 * @param dotfilesDir - Absolute path to the dotfiles directory.
 * @returns A formatted commit message string.
 */
function buildCommitMessage(
  statusLines: string[],
  links: ResolvedLink[],
): string {
  const changedConfigs = new Set<string>();

  for (const line of statusLines) {
    const file = line.slice(3).replace(/\\/g, "/");
    const match = links.find(
      (l) => file === l.name || file.startsWith(l.name + "/"),
    );
    changedConfigs.add(match ? match.name : "general");
  }

  const dateStr = new Date().toISOString().split("T")[0];
  return `update: ${[...changedConfigs].join(", ")} config (${dateStr})`;
}

/**
 * Handles the "update" command, staging changes, creating a commit,
 * and pushing updates to the remote origin branch.
 *
 * @param config - The active application configuration.
 * @param commitMessage - Optional custom commit message.
 * @returns `true` if the update completed successfully (with or without changes); `false` otherwise.
 */
function handleUpdate(
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
  const finalMsg =
    commitMessage ?? buildCommitMessage(lines, links);

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

/**
 * Prints the command-line interface usage guide and available commands.
 */
function printHelp(): void {
  console.log(`
${cyan(bold("Dotfiles CLI Manager"))}

A lightweight CLI manager to keep system configurations (dotfiles) in sync.

${bold("USAGE:")}
  dot <command> [options]

${bold("COMMANDS:")}
  ${green("init")}               Create the default configuration file.
  ${green("update [message]")}  Stage, commit, and push dotfiles changes to GitHub.
                          If no commit message is provided, one will be auto-generated.
  ${green("status")}             Check the state of system links and the git repository.
  ${green("link")}               Restore or recreate missing system links dynamically.
  ${green("help")}               Display this help message.
`);
}

/**
 * Application entry point. Loads configuration and dispatches the specified CLI command.
 */
function main(): void {
  const config = loadConfiguration();

  const args = process.argv.slice(2);
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

main();
