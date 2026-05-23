import { existsSync, lstatSync, rmSync, readlinkSync, readFileSync, symlinkSync, renameSync } from "fs";
import { join, resolve, normalize } from "path";
import { homedir } from "os";

// Color utilities using ANSI escape codes for professional output styling
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
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
  console.error(`${colors.red}✘${colors.reset} ${colors.bold}Error:${colors.reset} ${msg}`);
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Safely execute a system command and return structured result
function runCmd(args: string[], cwd?: string): CommandResult {
  const proc = Bun.spawnSync(args, {
    cwd: cwd,
    env: process.env,
  });

  return {
    success: proc.exitCode === 0,
    stdout: proc.stdout ? proc.stdout.toString().trim() : "",
    stderr: proc.stderr ? proc.stderr.toString().trim() : "",
    exitCode: proc.exitCode
  };
}

interface DotfileLink {
  name: string;
  systemPath: string | {
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
  repoPath: string;    // Absolute path inside our central dotfiles repository
  systemPath: string;  // Target path in the system where the link should sit
}

const DEFAULT_LINKS: DotfileLink[] = [
  {
    name: ".agents",
    systemPath: {
      windows: "~/.agents",
      macos: "~/.agents",
      linux: "~/.agents"
    }
  },
  {
    name: "nvim",
    systemPath: {
      windows: "~/AppData/Local/nvim",
      macos: "~/.config/nvim",
      linux: "~/.config/nvim"
    }
  },
  {
    name: ".vscode",
    systemPath: {
      windows: "~/AppData/Roaming/Code/User",
      macos: "~/Library/Application Support/Code/User",
      linux: "~/.config/Code/User"
    }
  }
];

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

function normalizePath(p: string): string {
  return resolve(normalize(expandPath(p)));
}

function resolveSystemPath(pathSpec: string | { windows?: string; macos?: string; linux?: string }): string | undefined {
  if (typeof pathSpec === "string") {
    return pathSpec;
  }
  const platform = process.platform;
  if (platform === "win32") return pathSpec.windows;
  if (platform === "darwin") return pathSpec.macos;
  if (platform === "linux") return pathSpec.linux;
  return undefined;
}

let DOTFILES_DIR = normalizePath(process.env.DOTFILES_DIR || "~/dotfiles");
let resolvedConfigs: ResolvedLink[] = [];

function loadConfiguration(): void {
  const configPaths = [
    join(homedir(), ".config", "dot", "config.json"),
    join(homedir(), ".dotrc.json")
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
        logWarning(`Found config file at ${path} but failed to read it: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  let configData: DotConfig = {};
  if (configContent) {
    try {
      configData = JSON.parse(configContent);
      logInfo(`Loaded configuration from: ${loadedPath}`);
    } catch (err) {
      logError(`Failed to parse JSON config from ${loadedPath}: ${err instanceof Error ? err.message : String(err)}. Using defaults.`);
    }
  }

  // 1. Resolve Dotfiles directory
  if (configData.dotfilesDir) {
    DOTFILES_DIR = normalizePath(configData.dotfilesDir);
  } else if (process.env.DOTFILES_DIR) {
    DOTFILES_DIR = normalizePath(process.env.DOTFILES_DIR);
  }

  // 2. Resolve links
  const rawLinks = configData.links || DEFAULT_LINKS;
  resolvedConfigs = [];

  for (const link of rawLinks) {
    const sysPathRaw = resolveSystemPath(link.systemPath);
    if (!sysPathRaw) {
      continue;
    }

    resolvedConfigs.push({
      name: link.name,
      repoPath: join(DOTFILES_DIR, link.name),
      systemPath: normalizePath(sysPathRaw)
    });
  }
}

// Verify if a directory link is set up correctly
function checkJunction(config: ResolvedLink): { linked: boolean; message: string } {
  if (!existsSync(config.systemPath)) {
    return { linked: false, message: "Directory does not exist in system" };
  }

  try {
    const stat = lstatSync(config.systemPath);
    if (!stat.isSymbolicLink()) {
      return { linked: false, message: "Physical directory exists, but is not a link" };
    }

    const target = readlinkSync(config.systemPath);
    const normTarget = normalizePath(target);
    const normRepo = normalizePath(config.repoPath);

    if (normTarget === normRepo) {
      return { linked: true, message: "Correct" };
    } else {
      return { linked: false, message: `Points to incorrect target: ${target}` };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { linked: false, message: `Error reading link: ${errorMsg}` };
  }
}

function handleStatus(): void {
  console.log(`\n${colors.bold}--- System Links Status ---${colors.reset}`);
  
  let allLinked = true;
  for (const config of resolvedConfigs) {
    const result = checkJunction(config);
    if (result.linked) {
      console.log(`  ${colors.green}[✔ ]${colors.reset} ${colors.bold}${config.name}:${colors.reset} ${result.message}`);
    } else {
      allLinked = false;
      console.log(`  ${colors.red}[✘ ]${colors.reset} ${colors.bold}${config.name}:${colors.reset} ${colors.yellow}${result.message}${colors.reset}`);
    }
  }

  console.log(`\n${colors.bold}--- Git Repository Status (dotfiles) ---${colors.reset}`);
  if (!existsSync(DOTFILES_DIR)) {
    logError(`Dotfiles repository directory does not exist at: ${DOTFILES_DIR}`);
    return;
  }

  const gitStatus = runCmd(["git", "status", "-s"], DOTFILES_DIR);
  if (gitStatus.success) {
    if (gitStatus.stdout) {
      console.log(`${colors.yellow}Uncommitted changes detected in repository:${colors.reset}`);
      console.log(gitStatus.stdout.split("\n").map(line => `  ${line}`).join("\n"));
    } else {
      logSuccess("Dotfiles repository is clean (nothing to commit).");
    }
  } else {
    logError(`Failed to run git status: ${gitStatus.stderr}`);
  }
}

function handleLink(): void {
  console.log(`\n${colors.bold}--- Restoring Dotfiles Links ---${colors.reset}`);

  for (const config of resolvedConfigs) {
    console.log(`\nProcessing ${colors.bold}${config.name}${colors.reset}...`);
    
    // 1. Verify source folder exists in the dotfiles repo
    if (!existsSync(config.repoPath)) {
      logError(`Source directory in repository does not exist: ${config.repoPath}. Skipping.`);
      continue;
    }

    const check = checkJunction(config);
    if (check.linked) {
      logSuccess(`Link for ${config.name} is already correct. Skipping.`);
      continue;
    }

    // 2. If directory exists physically but is not a link, back it up natively
    if (existsSync(config.systemPath)) {
      const stat = lstatSync(config.systemPath);
      if (!stat.isSymbolicLink()) {
        const backupPath = `${config.systemPath}_backup_${Date.now()}`;
        logWarning(`Physical folder detected at ${config.systemPath}. Creating backup at: ${backupPath}...`);
        
        try {
          renameSync(config.systemPath, backupPath);
          logSuccess(`Backup created successfully!`);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logError(`Failed to create backup: ${errMsg}`);
          continue;
        }
      } else {
        logInfo(`Removing invalid or incorrect link at ${config.systemPath}...`);
        try {
          rmSync(config.systemPath, { recursive: true, force: true });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logError(`Failed to remove old link: ${errMsg}`);
          continue;
        }
      }
    }

    // 3. Create the new link natively
    logInfo(`Creating link from '${config.systemPath}' to '${config.repoPath}'...`);
    try {
      const type = process.platform === "win32" ? "junction" : "dir";
      symlinkSync(config.repoPath, config.systemPath, type);
      logSuccess(`Successfully linked ${config.name}!`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`Error creating link: ${errMsg}`);
    }
  }
}

function handleUpdate(commitMessage?: string): void {
  console.log(`\n${colors.bold}--- Updating Dotfiles ---${colors.reset}`);

  if (!existsSync(DOTFILES_DIR)) {
    logError(`Dotfiles repository directory does not exist at: ${DOTFILES_DIR}`);
    return;
  }

  // 1. Check for changes
  logInfo("Checking changes in dotfiles...");
  const statusRes = runCmd(["git", "status", "--porcelain"], DOTFILES_DIR);
  if (!statusRes.success) {
    logError(`Failed to check git status: ${statusRes.stderr}`);
    return;
  }

  if (!statusRes.stdout) {
    logSuccess("No changes to update.");
    return;
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
      const file = line.trim().slice(3);
      let matched = false;
      for (const config of resolvedConfigs) {
        const relRepoPath = config.repoPath.substring(DOTFILES_DIR.length + 1).replace(/\\/g, "/");
        if (file.startsWith(relRepoPath + "/") || file === relRepoPath) {
          changedConfigs.add(config.name);
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
  const addRes = runCmd(["git", "add", "-A"], DOTFILES_DIR);
  if (!addRes.success) {
    logError(`Failed to stage changes: ${addRes.stderr}`);
    return;
  }

  // 4. Create the commit
  logInfo(`Creating commit: "${finalMsg}"...`);
  const commitRes = runCmd(["git", "commit", "-m", finalMsg], DOTFILES_DIR);
  if (!commitRes.success) {
    logError(`Failed to create commit: ${commitRes.stderr}`);
    return;
  }
  logSuccess("Commit created successfully!");

  // 5. Retrieve active branch name and push
  logInfo("Retrieving active branch name...");
  const branchRes = runCmd(["git", "branch", "--show-current"], DOTFILES_DIR);
  const branch = branchRes.success && branchRes.stdout.trim() ? branchRes.stdout.trim() : "master";

  logInfo(`Pushing changes to remote repository (git push origin ${branch})...`);
  const pushRes = runCmd(["git", "push", "origin", branch], DOTFILES_DIR);
  
  if (pushRes.success) {
    logSuccess("Dotfiles successfully updated and pushed to GitHub!");
  } else {
    logWarning(`Changes committed locally, but failed to push to remote repository:`);
    console.log(`  ${colors.red}${pushRes.stderr}${colors.reset}`);
    logWarning(`You can try to push manually later using: git -C "${DOTFILES_DIR}" push origin ${branch}`);
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
  loadConfiguration();
  
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  switch (command) {
    case "status":
      handleStatus();
      break;
    case "link":
      handleLink();
      break;
    case "update":
      const commitMessage = args.slice(1).join(" ");
      handleUpdate(commitMessage || undefined);
      break;
    case "help":
    case "-h":
    case "--help":
    case undefined:
      printHelp();
      break;
    default:
      logError(`Unknown command: "${args[0]}"`);
      printHelp();
      process.exit(1);
  }
}

main();
