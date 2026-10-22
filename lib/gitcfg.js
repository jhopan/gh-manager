// Manage git config per-repo + remote routing per akun.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function isGitRepo(dir) {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function gitCmd(args, dir) {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Set user.name / user.email untuk repo ini saja (bukan global). */
export function setRepoIdentity(dir, { name, email }) {
  if (name) gitCmd(["config", "user.name", name], dir);
  if (email) gitCmd(["config", "user.email", email], dir);
}

/** Set remote URL (SSH alias atau HTTPS). */
export function setRemote(dir, remoteName, url) {
  const existing = gitCmd(["remote"], dir).split(/\r?\n/).filter(Boolean);
  if (existing.includes(remoteName)) {
    gitCmd(["remote", "set-url", remoteName, url], dir);
  } else {
    gitCmd(["remote", "add", remoteName, url], dir);
  }
}

export function getRemotes(dir) {
  const out = {};
  const names = gitCmd(["remote"], dir).split(/\r?\n/).filter(Boolean);
  for (const n of names) {
    out[n] = gitCmd(["remote", "get-url", n], dir);
  }
  return out;
}

export function removeRemote(dir, remoteName) {
  try {
    gitCmd(["remote", "remove", remoteName], dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Global includeIf rule: repo di path ini -> identity + remote rewrite.
 */
export function setGlobalIncludeIf(pathPattern, { name, email, insteadOf } = {}) {
  const args = ["config", "--global", `includeIf.gitdir:${pathPattern}.user.name`, name];
  execFileSync("git", args, { stdio: "ignore" });
  execFileSync(
    "git",
    ["config", "--global", `includeIf.gitdir:${pathPattern}.user.email`, email],
    { stdio: "ignore" }
  );
  if (insteadOf) {
    execFileSync(
      "git",
      ["config", "--global", `includeIf.gitdir:${pathPattern}.url.${insteadOf}.insteadOf`, "git@github.com:"],
      { stdio: "ignore" }
    );
  }
}

export function getGlobalConfig(key) {
  try {
    return gitCmd(["config", "--global", "--get", key], process.cwd());
  } catch {
    return null;
  }
}

/** Set global config. */
export function setGlobalConfig(key, value) {
  execFileSync("git", ["config", "--global", key, value], { stdio: "ignore" });
}

/**
 * Cek remote sebuah repo -> akun mana yang dipakai.
 * Parse URL SSH alias / HTTPS username.
 */
export function detectAccountFromRemote(url) {
  if (!url) return null;
  // git@github-alias:user/repo.git
  const sshAlias = url.match(/^git@([^:]+):/);
  if (sshAlias) return { type: "ssh", host: sshAlias[1] };
  // https://github.com/user/repo.git
  const https = url.match(/^https?:\/\/([^/]+)\/([^/]+)\//);
  if (https) return { type: "https", host: https[1], user: https[2] };
  return null;
}
