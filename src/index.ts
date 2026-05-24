#!/usr/bin/env node
import { spawnSync } from "child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "fs";
import { homedir } from "os";
import { join, normalize, resolve } from "path";

// Color utilities using ANSI escape codes for professional output styling
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function logInfo(msg: string): void {
  console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`);
}

function logSuccess(msg: string): void {
  console.log(`${colors.green}✔${colors.reset} ${msg}`);
}

function logWarning(msg: string): void {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function logError(msg: string): void {
  console.error(
    `${colors.red}✘${colors.reset} ${colors.bold}Error:${colors.reset} ${msg}`,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

// Safely execute a system command and return structured result
function runCmd(args: string[], cwd?: string): CommandResult {
  const command = args[0];
  const commandArgs = args.slice(1);
  const proc = spawnSync(command, commandArgs, {
    cwd: cwd,
    env: process.env,
    encoding: "utf-8",
  });

  return {
    success: proc.status === 0,
    stdout: proc.stdout?.trim() ?? "",
    stderr: proc.stderr?.trim() ?? "",
  };
}

interface DotfileLink {
  name: string;
  systemPath:
    | string
    | {
        windows?: string;
        macos?: string;
        linux?: string;
      };
}

interface DotConfig {
  dotfilesDir?: string;
  links?: DotfileLink[];
}

interface ResolvedLink {
  name: string;
  repoPath: string; // Absolute path inside our central dotfiles repository
  systemPath: string; // Target path in the system where the link should sit
}

interface AppConfig {
  dotfilesDir: string;
  links: ResolvedLink[];
}

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

function normalizePath(p: string): string {
  return resolve(normalize(expandPath(p)));
}

const PLATFORM_KEY: Record<string, "windows" | "macos" | "linux"> = {
  win32: "windows",
  darwin: "macos",
  linux: "linux",
};

function resolveSystemPath(
  pathSpec: string | { windows?: string; macos?: string; linux?: string },
): string | undefined {
  if (typeof pathSpec === "string") {
    return pathSpec;
  }
  const key = PLATFORM_KEY[process.platform];
  return key ? pathSpec[key] : undefined;
}

// Strips single-line (//) and multi-line (/* ... */) comments and trailing commas from JSONC string
function stripComments(content: string): string {
  let stripped = content.replace(
    /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
    (m, g) => (g ? "" : m),
  );
  // Remove trailing commas before } or ] (valid in JSONC, invalid in JSON)
  stripped = stripped.replace(/,\s*([}\]])/g, "$1");
  return stripped;
}

function isSystemPathSpec(
  value: unknown,
): value is string | { windows?: string; macos?: string; linux?: string } {
  if (typeof value === "string") return true;
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  return keys.every((k) => {
    if (k !== "windows" && k !== "macos" && k !== "linux") return false;
    return typeof obj[k] === "string";
  });
}

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
    config.links = obj.links.map((link: unknown, i: number) => {
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
      return entry as unknown as DotfileLink;
    });
  }

  return config;
}

function loadConfiguration(): AppConfig {
  const configPaths = [
    join(homedir(), ".config", "dot", "config.jsonc"),
    join(homedir(), ".config", "dot", "config.json"),
    join(homedir(), ".dotrc.jsonc"),
    join(homedir(), ".dotrc.json"),
  ];

  let configContent: string | null = null;
  let loadedPath: string | null = null;

  for (const path of configPaths) {
    if (existsSync(path)) {
      try {
        configContent = readFileSync(path, "utf-8");
        loadedPath = path;
        break;
      } catch (err) {
        logWarning(
          `Found config file at ${path} but failed to read it: ${errorMessage(err)}`,
        );
      }
    }
  }

  let configData: DotConfig = {};
  if (configContent) {
    try {
      const cleanJson = stripComments(configContent);
      configData = validateConfig(JSON.parse(cleanJson));
      logInfo(`Loaded configuration from: ${loadedPath}`);
    } catch (err) {
      logError(
        `Failed to parse config from ${loadedPath}: ${errorMessage(err)}`,
      );
    }
  } else {
    logWarning(
      `No configuration file found. Create one at ~/.config/dot/config.jsonc`,
    );
    logInfo(`See: https://github.com/Rayzerrek/dot-cli#configuration`);
  }

  // 1. Resolve Dotfiles directory
  let dotfilesDir: string;
  if (configData.dotfilesDir) {
    dotfilesDir = normalizePath(configData.dotfilesDir);
  } else if (process.env.DOTFILES_DIR) {
    dotfilesDir = normalizePath(process.env.DOTFILES_DIR);
  } else {
    dotfilesDir = normalizePath("~/dotfiles");
  }

  // 2. Resolve links
  const rawLinks = configData.links ?? [];
  const links: ResolvedLink[] = [];

  for (const link of rawLinks) {
    const sysPathRaw = resolveSystemPath(link.systemPath);
    if (!sysPathRaw) {
      continue;
    }

    links.push({
      name: link.name,
      repoPath: join(dotfilesDir, link.name),
      systemPath: normalizePath(sysPathRaw),
    });
  }

  return { dotfilesDir, links };
}

// Verify if a directory link is set up correctly
function checkJunction(config: ResolvedLink): {
  linked: boolean;
  message: string;
} {
  if (!existsSync(config.systemPath)) {
    return { linked: false, message: "Directory does not exist in system" };
  }

  try {
    const stat = lstatSync(config.systemPath);
    if (!stat.isSymbolicLink()) {
      return {
        linked: false,
        message: "Physical directory exists, but is not a link",
      };
    }

    const target = readlinkSync(config.systemPath);
    const normTarget = normalizePath(target);
    const normRepo = normalizePath(config.repoPath);

    if (normTarget === normRepo) {
      return { linked: true, message: "Correct" };
    } else {
      return {
        linked: false,
        message: `Points to incorrect target: ${target}`,
      };
    }
  } catch (err: unknown) {
    return {
      linked: false,
      message: `Error reading link: ${errorMessage(err)}`,
    };
  }
}

function handleStatus({ dotfilesDir, links }: AppConfig): boolean {
  console.log(`\n${colors.bold}--- System Links Status ---${colors.reset}`);

  let ok = true;
  for (const link of links) {
    const result = checkJunction(link);
    if (result.linked) {
      console.log(
        `  ${colors.green}[✔ ]${colors.reset} ${colors.bold}${link.name}:${colors.reset} ${result.message}`,
      );
    } else {
      ok = false;
      console.log(
        `  ${colors.red}[✘ ]${colors.reset} ${colors.bold}${link.name}:${colors.reset} ${colors.yellow}${result.message}${colors.reset}`,
      );
    }
  }

  console.log(
    `\n${colors.bold}--- Git Repository Status (dotfiles) ---${colors.reset}`,
  );
  if (!existsSync(dotfilesDir)) {
    logError(`Dotfiles repository directory does not exist at: ${dotfilesDir}`);
    return false;
  }

  const gitStatus = runCmd(["git", "status", "-s"], dotfilesDir);
  if (gitStatus.success) {
    if (gitStatus.stdout) {
      console.log(
        `${colors.yellow}Uncommitted changes detected in repository:${colors.reset}`,
      );
      console.log(
        gitStatus.stdout
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n"),
      );
    } else {
      logSuccess("Dotfiles repository is clean (nothing to commit).");
    }
  } else {
    logError(`Failed to run git status: ${gitStatus.stderr}`);
    return false;
  }

  return ok;
}

function handleLink({ links }: AppConfig): boolean {
  console.log(
    `\n${colors.bold}--- Restoring Dotfiles Links ---${colors.reset}`,
  );

  let ok = true;
  for (const link of links) {
    console.log(`\nProcessing ${colors.bold}${link.name}${colors.reset}...`);

    // 1. Verify source folder exists in the dotfiles repo
    if (!existsSync(link.repoPath)) {
      logError(
        `Source directory in repository does not exist: ${link.repoPath}. Skipping.`,
      );
      ok = false;
      continue;
    }

    const check = checkJunction(link);
    if (check.linked) {
      logSuccess(`Link for ${link.name} is already correct. Skipping.`);
      continue;
    }

    // 2. If directory exists physically but is not a link, back it up natively
    if (existsSync(link.systemPath)) {
      const stat = lstatSync(link.systemPath);
      if (!stat.isSymbolicLink()) {
        const backupPath = `${link.systemPath}_backup_${Date.now()}`;
        logWarning(
          `Physical folder detected at ${link.systemPath}. Creating backup at: ${backupPath}...`,
        );

        try {
          renameSync(link.systemPath, backupPath);
          logSuccess(`Backup created successfully!`);
        } catch (err: unknown) {
          logError(`Failed to create backup: ${errorMessage(err)}`);
          ok = false;
          continue;
        }
      } else {
        logInfo(`Removing invalid or incorrect link at ${link.systemPath}...`);
        try {
          rmSync(link.systemPath);
        } catch (err: unknown) {
          logError(`Failed to remove old link: ${errorMessage(err)}`);
          ok = false;
          continue;
        }
      }
    }

    // 3. Create the new link natively
    logInfo(`Creating link from '${link.systemPath}' to '${link.repoPath}'...`);
    try {
      const type = process.platform === "win32" ? "junction" : "dir";
      symlinkSync(link.repoPath, link.systemPath, type);
      logSuccess(`Successfully linked ${link.name}!`);
    } catch (err: unknown) {
      logError(`Error creating link: ${errorMessage(err)}`);
      ok = false;
    }
  }

  return ok;
}

function handleUpdate(
  { dotfilesDir, links }: AppConfig,
  commitMessage?: string,
): boolean {
  console.log(`\n${colors.bold}--- Updating Dotfiles ---${colors.reset}`);

  if (!existsSync(dotfilesDir)) {
    logError(`Dotfiles repository directory does not exist at: ${dotfilesDir}`);
    return false;
  }

  // 1. Check for changes
  logInfo("Checking changes in dotfiles...");
  const statusRes = runCmd(["git", "status", "--porcelain"], dotfilesDir);
  if (!statusRes.success) {
    logError(`Failed to check git status: ${statusRes.stderr}`);
    return false;
  }

  if (!statusRes.stdout) {
    logSuccess("No changes to update.");
    return true;
  }

  // Display changes
  console.log(`\n${colors.bold}Detected changes to push:${colors.reset}`);
  const lines = statusRes.stdout.split("\n");
  for (const line of lines) {
    console.log(`  ${colors.gray}${line}${colors.reset}`);
  }
  console.log("");

  // 2. Build the commit message dynamically based on configs
  let finalMsg = commitMessage;
  if (!finalMsg) {
    const changedConfigs = new Set<string>();
    for (const line of lines) {
      const file = line.slice(3);
      let matched = false;
      for (const link of links) {
        const relRepoPath = link.repoPath
          .substring(dotfilesDir.length + 1)
          .replace(/\\/g, "/");
        if (file.startsWith(relRepoPath + "/") || file === relRepoPath) {
          changedConfigs.add(link.name);
          matched = true;
          break;
        }
      }
      if (!matched) {
        changedConfigs.add("general");
      }
    }
    const dateStr = new Date().toISOString().split("T")[0];
    finalMsg = `update: ${Array.from(changedConfigs).join(", ")} config (${dateStr})`;
  }

  // 3. Stage changes
  logInfo("Staging changes (git add)...");
  const addRes = runCmd(["git", "add", "-A"], dotfilesDir);
  if (!addRes.success) {
    logError(`Failed to stage changes: ${addRes.stderr}`);
    return false;
  }

  // 4. Create the commit
  logInfo(`Creating commit: "${finalMsg}"...`);
  const commitRes = runCmd(["git", "commit", "-m", finalMsg], dotfilesDir);

  if (!commitRes.success) {
    logError(`Failed to create commit: ${commitRes.stderr}`);
    return false;
  }
  logSuccess("Commit created successfully!");

  // 5. Retrieve active branch name and push
  logInfo("Retrieving active branch name...");
  const branchRes = runCmd(["git", "branch", "--show-current"], dotfilesDir);
  const branch =
    branchRes.success && branchRes.stdout ? branchRes.stdout : "master";

  logInfo(
    `Pushing changes to remote repository (git push origin ${branch})...`,
  );
  const pushRes = runCmd(["git", "push", "origin", branch], dotfilesDir);

  if (pushRes.success) {
    logSuccess("Dotfiles successfully updated and pushed to GitHub!");
    return true;
  } else {
    logWarning(
      `Changes committed locally, but failed to push to remote repository:`,
    );
    console.log(`  ${colors.red}${pushRes.stderr}${colors.reset}`);
    logWarning(
      `You can try to push manually later using: git -C "${dotfilesDir}" push origin ${branch}`,
    );
    return false;
  }
}

function printHelp(): void {
  console.log(`
${colors.cyan}${colors.bold}Dotfiles CLI Manager${colors.reset}

A lightweight CLI manager to keep system configurations (dotfiles) in sync.

${colors.bold}USAGE:${colors.reset}
  dot <command> [options]

${colors.bold}COMMANDS:${colors.reset}
  ${colors.green}update [message]${colors.reset}  Stage, commit, and push dotfiles changes to GitHub.
                          If no commit message is provided, one will be auto-generated.
  ${colors.green}status${colors.reset}             Check the state of system links and the git repository.
  ${colors.green}link${colors.reset}               Restore or recreate missing system links dynamically.
  ${colors.green}help${colors.reset}               Display this help message.
`);
}

function main(): void {
  const config = loadConfiguration();

  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  let ok = true;
  switch (command) {
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
