// Manage SSH: key generation, ~/.ssh/config, known_hosts.
import { execFileSync } from "node:child_process";
import {
  existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync,
  chmodSync, statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Path home untuk SSH.
//
// Windows punya 2 home: %USERPROFILE% (C:\Users\X) dan home MSYS (/home/X).
// `which ssh` di environment ini = /usr/bin/ssh (MSYS OpenSSH) -> baca
// ~/.ssh dari home MSYS. Jadi $HOME dari sh adalah path yang benar.
function detectSshHome() {
  // Ada 2 ssh di environment ini:
  //   /usr/bin/ssh                        (MSYS OpenSSH, baca /home/Jhopan/.ssh - fake home)
  //   C:\Windows\System32\OpenSSH\ssh.exe (native, baca %USERPROFILE%\.ssh)
  //
  // Yang dipakai `git push` = native Windows OpenSSH -> %USERPROFILE%\.ssh
  // Jadi semua file SSH harus di %USERPROFILE%\.ssh supaya sinkron.
  const envHome = process.env.USERPROFILE;
  if (envHome && /^[A-Za-z]:/.test(envHome)) return envHome;
  return homedir();
}

// Binary SSH yang dipakai `git push` = Windows OpenSSH native.
export const SSH_BIN = findSshBin();

function findSshBin() {
  const candidates = [
    "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
    "/c/Windows/System32/OpenSSH/ssh.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "ssh";
}

export const SSH_SCAN_BIN = findScanBin();

function findScanBin() {
  const candidates = [
    "C:\\Windows\\System32\\OpenSSH\\ssh-keyscan.exe",
    "/c/Windows/System32/OpenSSH/ssh-keyscan.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "ssh-keyscan";
}

export const SSH_HOME = detectSshHome();
export const SSH_DIR = join(SSH_HOME, ".ssh");
export const SSH_CONFIG = join(SSH_DIR, "config");
export const KNOWN_HOSTS = join(SSH_DIR, "known_hosts");

// Path utama = %USERPROFILE%\.ssh (dipakai native OpenSSH + git push).
// Path MSYS fake home juga ditulis supaya `ssh` versi MSYS tetap jalan.
export const MSYS_SSH_DIR = join("/home", process.env.USERNAME || "Jhopan", ".ssh");

export const KNOWN_HOSTS_PATHS = [
  join(SSH_DIR, "known_hosts"),
  join(MSYS_SSH_DIR, "known_hosts"),
];

export const SSH_CONFIG_PATHS = [
  join(SSH_DIR, "config"),
  join(MSYS_SSH_DIR, "config"),
];

// Sidik jari resmi GitHub (dari docs.github.com)
export const GITHUB_FINGERPRINTS = [
  "SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s", // Ed25519
  "SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM", // RSA
  "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU", // ECDSA
];

export function ensureSshDir() {
  if (!existsSync(SSH_DIR)) {
    mkdirSync(SSH_DIR, { recursive: true });
    try { chmodSync(SSH_DIR, 0o700); } catch {}
  }
}

export function keyExists(keyPath) {
  return existsSync(expandHome(keyPath));
}

export function expandHome(p) {
  if (!p) return p;
  if (p.startsWith("~/")) return join(SSH_HOME, p.slice(2));
  if (p.startsWith("~" + String.fromCharCode(92))) return join(SSH_HOME, p.slice(2));
  return p;
}

/**
 * Path untuk argumen ssh.exe native.
 * Windows OpenSSH tidak paham path MSYS (/c/Users/...), harus C:/Users/...
 */
export function toNativePath(p) {
  const full = expandHome(p);
  const m = full.match(/^\/cygdrive\/([a-z])\/(.*)$/i);
  if (m) return `${m[1].toUpperCase()}:/${m[2].replace(/\//g, "/")}`;
  return full.replace(/\\/g, "/");
}

export function readPubKey(keyPath) {
  const pub = expandHome(keyPath) + ".pub";
  if (!existsSync(pub)) return null;
  return readFileSync(pub, "utf-8").trim();
}

export function keyFingerprint(keyPath) {
  const pub = expandHome(keyPath) + ".pub";
  if (!existsSync(pub)) return null;
  try {
    const out = execFileSync("ssh-keygen", ["-lf", pub], { encoding: "utf-8" });
    return out.trim();
  } catch {
    return null;
  }
}

/**
 * Generate SSH key kalau belum ada.
 * @returns {{created:boolean, path:string, pubKey:string|null}}
 */
export function ensureKey(keyPath, comment) {
  ensureSshDir();
  const full = expandHome(keyPath);
  if (existsSync(full)) {
    return { created: false, path: full, pubKey: readPubKey(keyPath) };
  }
  execFileSync(
    "ssh-keygen",
    ["-t", "ed25519", "-C", comment || "gh-manager", "-f", full, "-N", ""],
    { stdio: "ignore" }
  );
  try { chmodSync(full, 0o600); } catch {}
  return { created: true, path: full, pubKey: readPubKey(keyPath) };
}

/**
 * Tambah/remove blok host di ~/.ssh/config. Idempotent.
 */
export function upsertSshHost(alias, { keyPath, user = "git" } = {}) {
  ensureSshDir();
  for (const cfgPath of SSH_CONFIG_PATHS) {
    try {
      mkdirSync(join(cfgPath, ".."), { recursive: true });
      writeSshHostTo(cfgPath, alias, { keyPath, user });
    } catch {}
  }
  return SSH_CONFIG;
}

function writeSshHostTo(cfgPath, alias, { keyPath, user = "git" } = {}) {
  let content = existsSync(cfgPath) ? readFileSync(cfgPath, "utf-8") : "";

  // Hapus blok lama dengan alias yang sama
  const blockRe = new RegExp(
    `\\n?#[\\s\\S]*?Host\\s+${escapeRe(alias)}\\s*\\n(?:[ \\t]+.*\\n)*`,
    "g"
  );
  content = content.replace(blockRe, "\n");

  const lines = [
    `# GitHub - managed by gh-manager (${alias})`,
    `Host ${alias}`,
    `    HostName github.com`,
    `    User ${user}`,
    `    IdentityFile ${toNativePath(keyPath)}`,
    `    IdentitiesOnly yes`,
    "",
  ];
  content = content.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n\n" + lines.join("\n");
  writeFileSync(cfgPath, content, "utf-8");
  return content;
}

export function removeSshHost(alias) {
  let removed = false;
  for (const cfgPath of SSH_CONFIG_PATHS) {
    if (!existsSync(cfgPath)) continue;
    const content = readFileSync(cfgPath, "utf-8");
    const blockRe = new RegExp(
      `\\n?#[\\s\\S]*?Host\\s+${escapeRe(alias)}\\s*\\n(?:[ \\t]+.*\\n)*`,
      "g"
    );
    const next = content.replace(blockRe, "\n");
    if (next !== content) {
      writeFileSync(cfgPath, next.replace(/\n{3,}/g, "\n\n"), "utf-8");
      removed = true;
    }
  }
  return removed;
}

export function hasSshHost(alias) {
  return SSH_CONFIG_PATHS.some((p) => {
    if (!existsSync(p)) return false;
    const content = readFileSync(p, "utf-8");
    return new RegExp(`^\\s*Host\\s+${escapeRe(alias)}\\s*$`, "m").test(content);
  });
}

export function listManagedHosts() {
  const out = [];
  const seen = new Set();
  for (const cfgPath of SSH_CONFIG_PATHS) {
    if (!existsSync(cfgPath)) continue;
    const content = readFileSync(cfgPath, "utf-8");
    const re = /Host\s+(\S+)\s*\n((?:[ \t]+.*\n)*)/g;
    let m;
    while ((m = re.exec(content))) {
      if (!m[0].includes("managed by gh-manager")) continue;
      const alias = m[1];
      if (seen.has(alias)) continue;
      seen.add(alias);
      const body = m[2] || "";
      out.push({
        alias,
        keyPath: (body.match(/IdentityFile\s+(.+)/) || [])[1]?.trim() || null,
      });
    }
  }
  return out;
}

/**
 * Test koneksi SSH ke GitHub pakai alias.
 * @returns {{ok:boolean, message:string}}
 */
export function testSsh(alias) {
  try {
    const out = execFileSync(
      SSH_BIN,
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-T", alias],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return { ok: true, message: (out || "").trim() };
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || "").toString().trim();
    if (/Host key verification failed/i.test(msg)) {
      return { ok: false, message: "known_hosts belum accept. Jalankan: gh-manager doctor" };
    }
    if (/Permission denied/i.test(msg)) {
      return { ok: false, message: "Key belum terdaftar di GitHub atau alias salah" };
    }
    return { ok: false, message: msg.split("\n")[0] || "gagal" };
  }
}

/**
 * Accept host key GitHub (tambah ke known_hosts).
 */
export function acceptGithubHost() {
  ensureSshDir();
  for (const p of KNOWN_HOSTS_PATHS) {
    try {
      mkdirSync(join(p, ".."), { recursive: true });
      if (!existsSync(p)) writeFileSync(p, "", "utf-8");
    } catch {}
  }

  let scan = "";
  try {
    scan = execFileSync(
      SSH_SCAN_BIN,
      ["-t", "rsa,ecdsa,ed25519", "github.com"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch {
    return false;
  }
  if (!scan || !scan.trim()) return false;

  const scanLines = scan.trim().split(/\r?\n/);

  // Tulis ke SEMUA lokasi known_hosts (buang entri github lama supaya
  // rotasi key GitHub tidak ketemu key basi)
  for (const p of KNOWN_HOSTS_PATHS) {
    try {
      const existing = existsSync(p)
        ? readFileSync(p, "utf-8")
            .split(/\r?\n/)
            .filter((l) => l && !/\bgithub\.com\b/.test(l))
        : [];
      writeFileSync(p, [...existing, ...scanLines, ""].join("\n"), "utf-8");
    } catch {}
  }
  return true;
}

export function knownHostsHasGithub() {
  return KNOWN_HOSTS_PATHS.some((p) => {
    if (!existsSync(p)) return false;
    return /github\.com/.test(readFileSync(p, "utf-8"));
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
