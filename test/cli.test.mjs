import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createDirectorySymlinkOrSkip,
  createTempHome,
  runCli,
  skipWhenGitUnavailable,
  writeConfig,
} from "./support/helpers.mjs";

test("CLI help prints usage and exits successfully without loading config", (t) => {
  const { env } = createTempHome(t);
  const result = runCli(["help"], env);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dotfiles CLI Manager/);
  assert.match(result.stdout, /dot <command> \[options\]/);
  assert.match(result.stdout, /status/);
  assert.doesNotMatch(result.stdout, /No configuration file found/);
});

test("CLI status succeeds when configured link points to the repository path", (t) => {
  if (skipWhenGitUnavailable(t)) {
    return;
  }

  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const repoPath = join(dotfilesDir, "nvim");
  const systemParent = join(root, "system");
  const systemPath = join(systemParent, "nvim");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(systemParent, { recursive: true });

  const gitInit = spawnSync("git", ["init"], {
    cwd: dotfilesDir,
    encoding: "utf-8",
  });
  assert.equal(gitInit.status, 0, gitInit.stderr);

  if (!createDirectorySymlinkOrSkip(t, repoPath, systemPath)) {
    return;
  }

  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "nvim", systemPath }] }),
  );

  const result = runCli(["status"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /nvim:/);
  assert.match(result.stdout, /Correct/);
  assert.match(result.stdout, /Git Repository Status/);
});

test("CLI link migrates a local directory, backs it up, and replaces it with a link", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const systemPath = join(root, "system", "tool");
  mkdirSync(dotfilesDir, { recursive: true });
  mkdirSync(systemPath, { recursive: true });
  writeFileSync(join(systemPath, "settings.json"), "{}\n");

  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "tool", systemPath }] }),
  );

  const result = runCli(["link"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(dotfilesDir, "tool", "settings.json"), "utf-8"), "{}\n");
  assert.equal(lstatSync(systemPath).isSymbolicLink(), true);
  assert.equal(
    readdirSync(join(root, "system")).some((entry) =>
      entry.startsWith("tool_backup_"),
    ),
    true,
  );
  assert.match(result.stdout, /Successfully migrated files/);
  assert.match(result.stdout, /Successfully linked tool/);
});

test("CLI link creates the system path parent directory before linking", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const repoPath = join(dotfilesDir, "tool");
  const systemPath = join(root, "missing-parent", "tool");
  mkdirSync(repoPath, { recursive: true });

  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "tool", systemPath }] }),
  );

  const result = runCli(["link"], env);

  if (result.status !== 0 && /EPERM|EACCES|privilege|permission/i.test(result.stderr)) {
    t.skip(`symlink creation is unavailable in this environment: ${result.stderr}`);
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.equal(lstatSync(systemPath).isSymbolicLink(), true);
  assert.match(result.stdout, /Successfully linked tool/);
});

test("CLI link fails when the config cannot be parsed", (t) => {
  const { root, env } = createTempHome(t);
  writeConfig(root, "{ invalid");

  const result = runCli(["link"], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Failed to parse config/);
  assert.doesNotMatch(result.stdout, /Restoring Dotfiles Links/);
});

test("CLI link rejects link names that escape the dotfiles directory", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  mkdirSync(dotfilesDir, { recursive: true });
  writeConfig(
    root,
    JSON.stringify({
      dotfilesDir,
      links: [{ name: "../outside", systemPath: join(root, "outside") }],
    }),
  );

  const result = runCli(["link"], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /links\[0\]\.name/);
});
