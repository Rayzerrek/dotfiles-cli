import { existsSync, lstatSync, rmSync, readlinkSync } from "fs";
import { join } from "path";

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

interface DotfileConfig {
  name: string;
  repoPath: string;    // Absolute path inside our central dotfiles repository
  systemPath: string;  // Target path in the Windows system where the link should sit
}

const DOTFILES_DIR = "C:\\Users\\kacpe\\dotfiles";

const configs: DotfileConfig[] = [
  {
    name: ".agents",
    repoPath: join(DOTFILES_DIR, ".agents"),
    systemPath: "C:\\Users\\kacpe\\.agents"
  },
  {
    name: "Neovim (nvim)",
    repoPath: join(DOTFILES_DIR, "nvim"),
    systemPath: "C:\\Users\\kacpe\\AppData\\Local\\nvim"
  },
  {
    name: "VS Code (.vscode)",
    repoPath: join(DOTFILES_DIR, ".vscode"),
    systemPath: "C:\\Users\\kacpe\\AppData\\Roaming\\Code\\User"
  }
];

// Verify if a directory junction is set up correctly
function checkJunction(config: DotfileConfig): { linked: boolean; message: string } {
  if (!existsSync(config.systemPath)) {
    return { linked: false, message: "Folder nie istnieje w systemie" };
  }

  try {
    const stat = lstatSync(config.systemPath);
    if (!stat.isSymbolicLink()) {
      return { linked: false, message: "Istnieje fizycznie, ale nie jest skrótem (Junction)" };
    }

    const target = readlinkSync(config.systemPath);
    const normTarget = target.replace(/\//g, "\\").toLowerCase();
    const normRepo = config.repoPath.replace(/\//g, "\\").toLowerCase();

    if (normTarget === normRepo || normTarget.endsWith(normRepo)) {
      return { linked: true, message: `Połączony z: ${target}` };
    } else {
      return { linked: false, message: `Wskazuje na niepoprawny cel: ${target}` };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { linked: false, message: `Błąd odczytu powiązania: ${errorMsg}` };
  }
}

function handleStatus(): void {
  console.log(`\n${colors.bold}--- Status powiązań systemowych (Junctions) ---${colors.reset}`);
  
  let allLinked = true;
  for (const config of configs) {
    const result = checkJunction(config);
    if (result.linked) {
      console.log(`  ${colors.green}[✔]${colors.reset} ${colors.bold}${config.name}:${colors.reset} Poprawnie zlinkowany`);
    } else {
      allLinked = false;
      console.log(`  ${colors.red}[✘]${colors.reset} ${colors.bold}${config.name}:${colors.reset} ${colors.yellow}${result.message}${colors.reset}`);
    }
  }

  console.log(`\n${colors.bold}--- Status repozytorium Git (dotfiles) ---${colors.reset}`);
  if (!existsSync(DOTFILES_DIR)) {
    logError(`Folder repozytorium dotfiles nie istnieje pod ścieżką: ${DOTFILES_DIR}`);
    return;
  }

  const gitStatus = runCmd(["git", "status", "-s"], DOTFILES_DIR);
  if (gitStatus.success) {
    if (gitStatus.stdout) {
      console.log(`${colors.yellow}Wykryto niezatwierdzone zmiany w repozytorium:${colors.reset}`);
      console.log(gitStatus.stdout.split("\n").map(line => `  ${line}`).join("\n"));
    } else {
      logSuccess("Repozytorium dotfiles jest czyste (brak zmian do zatwierdzenia).");
    }
  } else {
    logError(`Nie udało się uruchomić git status: ${gitStatus.stderr}`);
  }
}

function handleLink(): void {
  console.log(`\n${colors.bold}--- Odtwarzanie powiązań dotfiles ---${colors.reset}`);

  for (const config of configs) {
    console.log(`\nPrzetwarzanie ${colors.bold}${config.name}${colors.reset}...`);
    
    // 1. Sprawdź czy plik w repozytorium dotfiles istnieje
    if (!existsSync(config.repoPath)) {
      logError(`Folder źródłowy w repozytorium nie istnieje: ${config.repoPath}. Pomijam.`);
      continue;
    }

    const check = checkJunction(config);
    if (check.linked) {
      logSuccess(`Powiązanie dla ${config.name} jest już prawidłowe. Pomijam.`);
      continue;
    }

    // 2. Jeśli istnieje i jest fizycznym folderem lub uszkodzonym linkiem
    if (existsSync(config.systemPath)) {
      const stat = lstatSync(config.systemPath);
      if (!stat.isSymbolicLink()) {
        const backupPath = `${config.systemPath}_backup_${Date.now()}`;
        logWarning(`Wykryto fizyczny folder w ${config.systemPath}. Tworzę kopię zapasową pod nazwą: ${backupPath}...`);
        
        // Zmień nazwę na kopię bezpieczeństwa
        const backupRes = runCmd(["powershell", "-Command", `Move-Item -Path '${config.systemPath}' -Destination '${backupPath}'`]);
        if (!backupRes.success) {
          logError(`Nie udało się utworzyć kopii zapasowej: ${backupRes.stderr}`);
          continue;
        }
      } else {
        logInfo(`Usuwam uszkodzone lub niepoprawne powiązanie w ${config.systemPath}...`);
        try {
          rmSync(config.systemPath, { recursive: true, force: true });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logError(`Nie udało się usunąć starego linku: ${errMsg}`);
          continue;
        }
      }
    }

    // 3. Utwórz nowe Junction
    logInfo(`Tworzenie skrótu Junction z '${config.systemPath}' do '${config.repoPath}'...`);
    const linkRes = runCmd(["cmd", "/c", `mklink /J "${config.systemPath}" "${config.repoPath}"`]);
    if (linkRes.success) {
      logSuccess(`Pomyślnie zlinkowano ${config.name}!`);
    } else {
      logError(`Błąd przy tworzeniu skrótu Junction: ${linkRes.stderr}`);
    }
  }
}

function handleUpdate(commitMessage?: string): void {
  console.log(`\n${colors.bold}--- Aktualizacja dotfiles ---${colors.reset}`);

  if (!existsSync(DOTFILES_DIR)) {
    logError(`Folder repozytorium dotfiles nie istnieje pod ścieżką: ${DOTFILES_DIR}`);
    return;
  }

  // 1. Sprawdź zmiany
  logInfo("Sprawdzanie zmian w dotfiles...");
  const statusRes = runCmd(["git", "status", "--porcelain"], DOTFILES_DIR);
  if (!statusRes.success) {
    logError(`Błąd git status: ${statusRes.stderr}`);
    return;
  }

  if (!statusRes.stdout) {
    logSuccess("Brak zmian do zaktualizowania.");
    return;
  }

  // Wyświetl zmiany
  console.log(`\n${colors.bold}Wykryte zmiany do wysłania:${colors.reset}`);
  const lines = statusRes.stdout.split("\n");
  for (const line of lines) {
    console.log(`  ${colors.gray}${line}${colors.reset}`);
  }
  console.log("");

  // 2. Sformułuj wiadomość commita
  let finalMsg = commitMessage;
  if (!finalMsg) {
    const changedConfigs = new Set<string>();
    for (const line of lines) {
      const file = line.trim().slice(3);
      if (file.startsWith(".agents/")) changedConfigs.add(".agents");
      else if (file.startsWith("nvim/")) changedConfigs.add("Neovim");
      else if (file.startsWith(".vscode/")) changedConfigs.add("VS Code");
      else changedConfigs.add("general");
    }
    const dateStr = new Date().toISOString().split("T")[0];
    finalMsg = `update: konfiguracja ${Array.from(changedConfigs).join(", ")} (${dateStr})`;
  }

  // 3. Dodaj pliki do staging
  logInfo("Dodawanie zmian do indeksu (git add)...");
  const addRes = runCmd(["git", "add", "-A"], DOTFILES_DIR);
  if (!addRes.success) {
    logError(`Błąd git add: ${addRes.stderr}`);
    return;
  }

  // 4. Utwórz commit
  logInfo(`Tworzenie commita: "${finalMsg}"...`);
  const commitRes = runCmd(["git", "commit", "-m", finalMsg], DOTFILES_DIR);
  if (!commitRes.success) {
    logError(`Błąd git commit: ${commitRes.stderr}`);
    return;
  }
  logSuccess("Commit utworzony pomyślnie!");

  // 5. Pobierz nazwę aktywnej gałęzi i wyślij na zdalny serwer (push)
  logInfo("Pobieranie nazwy aktywnej gałęzi...");
  const branchRes = runCmd(["git", "branch", "--show-current"], DOTFILES_DIR);
  const branch = branchRes.success && branchRes.stdout.trim() ? branchRes.stdout.trim() : "master";

  logInfo(`Wysyłanie zmian na serwer zdalny (git push origin ${branch})...`);
  const pushRes = runCmd(["git", "push", "origin", branch], DOTFILES_DIR);
  
  if (pushRes.success) {
    logSuccess("Dotfiles zostały pomyślnie zaktualizowane i wypchnięte na GitHub!");
  } else {
    logWarning(`Wiadomość została zatwierdzona lokalnie, ale nie udało się jej wypchnąć na serwer zdalny:`);
    console.log(`  ${colors.red}${pushRes.stderr}${colors.reset}`);
    logWarning(`Możesz spróbować wysłać ręcznie później, wpisując: git -C "${DOTFILES_DIR}" push origin ${branch}`);
  }
}

function printHelp(): void {
  console.log(`
${colors.cyan}${colors.bold}Dotfiles CLI Manager${colors.reset}

Narzędzie do łatwego zarządzania konfiguracjami systemowymi (dotfiles).

${colors.bold}UŻYCIE:${colors.reset}
  dot <polecenie> [opcje]

${colors.bold}POLECENIA:${colors.reset}
  ${colors.green}update [wiadomosc]${colors.reset}  Automatycznie dodaje, commituje i wysyła zmiany dotfiles na GitHub.
                          Jeśli nie podasz wiadomości commita, zostanie ona wygenerowana automatycznie.
  ${colors.green}status${colors.reset}             Sprawdza poprawność połączeń systemowych (Junctions) oraz status gita.
  ${colors.green}link${colors.reset}               Odtwarza lub tworzy brakujące Junctions w Twoim systemie dla:
                          .agents, Neovima (nvim) oraz VS Code.
  ${colors.green}help${colors.reset}               Wyświetla tę pomoc.
`);
}

function main(): void {
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
      logError(`Nieznane polecenie: "${args[0]}"`);
      printHelp();
      process.exit(1);
  }
}

main();
