// Manage `gh` CLI auth (multi-akun).
import { execFileSync, spawnSync } from "node:child_process";

export function ghAvailable() {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse output `gh auth status`.
 * @returns {{accounts:Array<{username:string,active:boolean,protocol:string,scopes:string}>, ok:boolean}}
 */
export function authStatus() {
  try {
    const out = execFileSync("gh", ["auth", "status"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { accounts: parseAuthStatus(out), ok: true, raw: out };
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "");
    const accounts = parseAuthStatus(out);
    return { accounts, ok: accounts.length > 0, raw: out };
  }
}

function parseAuthStatus(text) {
  const accounts = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const m = line.match(/Logged in to github\.com account (\S+)/);
    if (m) {
      current = { username: m[1], active: false, protocol: "?", scopes: "" };
      accounts.push(current);
      continue;
    }
    if (!current) continue;
    if (/Active account:\s*true/i.test(line)) current.active = true;
    if (/Git operations protocol:\s*(\S+)/i.test(line)) current.protocol = line.match(/Git operations protocol:\s*(\S+)/i)[1];
    const sc = line.match(/Token scopes:\s*'([^']+)'/);
    if (sc) current.scopes = sc[1];
  }
  return accounts;
}

/**
 * Login akun baru.
 * @param {{username?:string, token?:string, protocol?:string, web?:boolean}} opts
 */
export function login({ username, token, protocol = "https", web = false } = {}) {
  const args = ["auth", "login", "--hostname", "github.com", "--git-protocol", protocol];
  if (web) {
    args.push("--web");
    const res = spawnSync("gh", args, { stdio: "inherit" });
    return { ok: res.status === 0 };
  }
  if (token) {
    const res = spawnSync("gh", ["auth", "login", "--hostname", "github.com", "--with-token"], {
      input: token + "\n",
      encoding: "utf-8",
    });
    if (res.status !== 0) {
      return { ok: false, error: (res.stderr || "login gagal").trim() };
    }
    return { ok: true };
  }
  const res = spawnSync("gh", args, { stdio: "inherit" });
  return { ok: res.status === 0 };
}

/** Ganti akun aktif untuk gh CLI. */
export function switchAccount(username) {
  const res = spawnSync(
    "gh",
    ["auth", "switch", "--hostname", "github.com", "--user", username],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) return { ok: false, error: (res.stderr || res.stdout || "gagal").trim() };
  return { ok: true };
}

/** Logout akun (opsional hapus dari credential manager). */
export function logout(username) {
  const args = ["auth", "logout", "--hostname", "github.com"];
  if (username) args.push("--user", username);
  const res = spawnSync("gh", args, { encoding: "utf-8" });
  return { ok: res.status === 0, error: res.status !== 0 ? (res.stderr || "").trim() : null };
}

/** Akun yang sedang aktif. */
export function activeAccount() {
  const st = authStatus();
  return st.accounts.find((a) => a.active) || null;
}
