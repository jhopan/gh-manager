#!/usr/bin/env node
/**
 * gh-manager - multi-akun GitHub manager.
 *
 *   node gh-manager.js list
 *   node gh-manager.js login <username> [--ssh] [--token TOKEN] [--web]
 *   node gh-manager.js use <username>
 *   node gh-manager.js check [username]
 *   node gh-manager.js doctor
 *   node gh-manager.js remove <username> [--keep-key]
 *   node gh-manager.js docs
 */

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { list, find, upsert, remove, load } from "./lib/store.js";
import {
  ensureKey, readPubKey, keyFingerprint, upsertSshHost, removeSshHost,
  hasSshHost, testSsh, acceptGithubHost, knownHostsHasGithub, keyExists,
  expandHome, listManagedHosts, SSH_HOME, SSH_DIR, SSH_CONFIG,
} from "./lib/ssh.js";
import { authStatus, login, switchAccount, logout, activeAccount, ghAvailable } from "./lib/ghauth.js";
import { setGlobalConfig, getGlobalConfig } from "./lib/gitcfg.js";

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
};

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function defaultKeyPath(username) {
  return join(SSH_DIR, `sshkey_gh_${username.replace(/[^a-z0-9_-]/gi, "")}`);
}

function defaultAlias(username) {
  return `github-${username.replace(/[^a-z0-9_-]/gi, "")}`;
}

function defaultEmail(username) {
  return `${username}@users.noreply.github.com`;
}

function header() {
  console.log(C.bold(C.cyan("\n╔══════════════════════════════════════════╗")));
  console.log(C.bold(C.cyan("║       🔑 gh-manager - GitHub Accounts      ║")));
  console.log(C.bold(C.cyan("╚══════════════════════════════════════════╝")));
}

// ---------------------------------------------------------------- list
function cmdList() {
  header();
  const accounts = list();
  const st = authStatus();
  const ghUsers = new Map(st.accounts.map((a) => [a.username.toLowerCase(), a]));

  if (!accounts.length) {
    console.log(C.yellow("\n   Belum ada akun terdaftar.\n"));
    console.log(C.dim("   Tambah: node gh-manager.js login <username>\n"));
    return;
  }

  console.log(C.bold("\n📋 Akun terdaftar:\n"));
  const ghActive = activeAccount();

  for (const acc of accounts) {
    const gh = ghUsers.get(acc.username.toLowerCase());
    const isActive = ghActive && ghActive.username.toLowerCase() === acc.username.toLowerCase();
    const badge = isActive ? C.green(" [AKTIF]") : "";
    const role = acc.role ? C.dim(` (${acc.role})`) : "";

    console.log(`   ${C.bold(acc.username)}${badge}${role}`);
    console.log(C.dim(`      protokol   : ${acc.protocol || "?"}`));
    console.log(C.dim(`      email      : ${acc.email || "-"}`));
    if (acc.sshAlias) {
      console.log(C.dim(`      ssh alias  : ${acc.sshAlias}`));
      console.log(C.dim(`      ssh key    : ${acc.sshKey || "-"}`));
    }
    console.log(C.dim(`      gh auth    : ${gh ? C.green("login") : C.yellow("belum login")}`));
    console.log(C.dim(`      ditambahkan: ${acc.addedAt || "-"}`));
    console.log("");
  }

  console.log(C.dim(`   Total: ${accounts.length} akun\n`));
}

// ---------------------------------------------------------------- login
function cmdLogin(args) {
  const username = args._[1];
  if (!username) {
    console.log(C.red("   Usage: node gh-manager.js login <username> [--ssh] [--token TOKEN] [--web] [--email EMAIL]"));
    return;
  }
  const useSsh = Boolean(args.flags.ssh);
  const token = typeof args.flags.token === "string" ? args.flags.token : null;
  const web = Boolean(args.flags.web);
  const email = typeof args.flags.email === "string" ? args.flags.email : defaultEmail(username);

  header();
  console.log(C.bold(`\n🔐 Setup akun: ${C.cyan(username)}\n`));

  if (!ghAvailable()) {
    console.log(C.red("   gh CLI tidak ditemukan. Install: winget install GitHub.cli\n"));
    return;
  }

  // 1. gh auth
  console.log(C.dim("   [1/4] gh auth login..."));
  const res = login({ token, protocol: useSsh ? "ssh" : "https", web });
  if (!res.ok) {
    console.log(C.red(`   Gagal: ${res.error || "auth login ditolak"}`));
    return;
  }
  console.log(C.green("   ✓ gh auth OK"));

  // 2. SSH key
  let alias = null;
  let keyPath = null;
  if (useSsh) {
    alias = defaultAlias(username);
    keyPath = defaultKeyPath(username);
    console.log(C.dim(`   [2/4] SSH key: ${keyPath}`));
    const k = ensureKey(keyPath, `${username}@gh-manager`);
    console.log(C.green(k.created ? "   ✓ key dibuat" : "   ✓ key sudah ada"));
    console.log(C.dim(`      fingerprint: ${keyFingerprint(keyPath) || "?"}`));
    console.log(C.dim(`      daftarkan pubkey ini di GitHub > Settings > SSH keys:`));
    console.log(C.cyan(`      ${readPubKey(keyPath)}`));

    // 3. ssh config
    console.log(C.dim("   [3/4] ~/.ssh/config..."));
    upsertSshHost(alias, { keyPath });
    console.log(C.green(`   ✓ alias ${alias} ditambahkan`));
  } else {
    console.log(C.dim("   [2/4] SSH key: dilewati (mode HTTPS)"));
    console.log(C.dim("   [3/4] ~/.ssh/config: dilewati"));
  }

  // 4. registry
  console.log(C.dim("   [4/4] Simpan ke registry..."));
  upsert({
    username,
    role: args.flags.role ? String(args.flags.role) : "secondary",
    protocol: useSsh ? "ssh" : "https",
    sshAlias: alias,
    sshKey: keyPath,
    email,
    addedAt: new Date().toISOString().slice(0, 10),
  });
  console.log(C.green("   ✓ tersimpan di accounts.json"));

  // global git identity default
  if (!getGlobalConfig("user.name")) setGlobalConfig("user.name", username);
  if (!getGlobalConfig("user.email")) setGlobalConfig("user.email", email);

  console.log(C.bold(C.green("\n   Selesai.\n")));
  if (useSsh) {
    console.log(C.dim("   Langkah manual: daftarkan pubkey di GitHub akun tsb, lalu:"));
    console.log(C.cyan(`   node gh-manager.js check ${username}\n`));
  }
}

// ---------------------------------------------------------------- use
function cmdUse(args) {
  const username = args._[1];
  if (!username) {
    console.log(C.red("   Usage: node gh-manager.js use <username>"));
    return;
  }
  const acc = find(username);
  if (!acc) {
    console.log(C.red(`   Akun "${username}" tidak terdaftar.`));
    console.log(C.dim("   Lihat daftar: node gh-manager.js list"));
    return;
  }
  header();
  const res = switchAccount(acc.username);
  if (!res.ok) {
    console.log(C.red(`   Gagal switch: ${res.error}`));
    return;
  }
  console.log(C.green(`\n   ✓ gh auth switch -> ${acc.username}\n`));
  console.log(C.dim(`   Repo yang pakai remote SSH alias "${acc.sshAlias}" akan otomatis ke akun ini.\n`));
}

// ---------------------------------------------------------------- check
function cmdCheck(args) {
  header();
  const target = args._[1];
  const accounts = target ? [find(target)].filter(Boolean) : list();

  if (!accounts.length) {
    console.log(C.yellow("   Tidak ada akun untuk dicek.\n"));
    return;
  }

  const st = authStatus();
  console.log(C.bold("\n🔍 Health check:\n"));

  for (const acc of accounts) {
    const gh = st.accounts.find((a) => a.username.toLowerCase() === acc.username.toLowerCase());
    console.log(`   ${C.bold(acc.username)}`);

    console.log(
      `      gh auth   : ${gh ? C.green("✓ login") : C.red("✗ belum login")}` +
      (gh ? C.dim(` (${gh.protocol})`) : "")
    );

    if (acc.sshAlias) {
      const hasAlias = hasSshHost(acc.sshAlias);
      const hasKey = keyExists(acc.sshKey);
      const t = hasAlias && hasKey ? testSsh(acc.sshAlias) : { ok: false, message: "alias/key belum lengkap" };
      console.log(`      ssh config: ${hasAlias ? C.green("✓ ada") : C.red("✗ tidak ada")}`);
      console.log(`      ssh key   : ${hasKey ? C.green("✓ ada") : C.red("✗ tidak ada")} ${C.dim(acc.sshKey || "")}`);
      console.log(`      ssh test  : ${t.ok ? C.green("✓ " + t.message) : C.yellow("✗ " + t.message)}`);
    } else {
      console.log(C.dim("      ssh       : - (mode HTTPS)"));
    }
    console.log("");
  }
}

// ---------------------------------------------------------------- doctor
function cmdDoctor() {
  header();
  console.log(C.bold("\n🩺 Doctor:\n"));

  // gh CLI
  console.log(`   gh CLI       : ${ghAvailable() ? C.green("✓ ada") : C.red("✗ tidak ada")}`);

  // known_hosts
  const kh = knownHostsHasGithub();
  console.log(`   known_hosts  : ${kh ? C.green("✓ ada entri github.com") : C.yellow("✗ entri github.com belum ada")}`);
  if (!kh) {
    const ok = acceptGithubHost();
    console.log(ok ? C.green("   ✓ known_hosts diperbaiki (ssh-keyscan)") : C.red("   ✗ gagal accept host key"));
  }

  // ssh config
  console.log(C.dim(`   ssh home     : ${SSH_HOME}`));
  console.log(C.dim(`   ssh config   : ${SSH_CONFIG}`));
  const managed = listManagedHosts();
  console.log(`   ssh hosts    : ${managed.length} alias ter-manage` + (managed.length ? C.dim(` (${managed.map((m) => m.alias).join(", ")})`) : ""));

  // registry consistency
  const accounts = list();
  let issues = 0;
  for (const acc of accounts) {
    if (acc.sshAlias && !hasSshHost(acc.sshAlias)) {
      console.log(C.yellow(`   ! ${acc.username}: alias ${acc.sshAlias} hilang dari ssh config`));
      if (acc.sshKey) {
        upsertSshHost(acc.sshAlias, { keyPath: acc.sshKey });
        console.log(C.green(`     ✓ dipulihkan`));
      }
      issues++;
    }
    if (acc.sshKey && !keyExists(acc.sshKey)) {
      console.log(C.yellow(`   ! ${acc.username}: key ${acc.sshKey} hilang`));
      issues++;
    }
  }
  if (!issues) console.log(C.green("   registry     : ✓ semua konsisten"));

  // gh auth
  const st = authStatus();
  console.log(`   gh accounts  : ${st.accounts.length}` + (st.accounts.length ? C.dim(` (${st.accounts.map((a) => a.username).join(", ")})`) : ""));
  const active = activeAccount();
  if (active) console.log(C.dim(`   gh aktif     : ${active.username}`));

  console.log("");
}

// ---------------------------------------------------------------- remove
function cmdRemove(args) {
  const username = args._[1];
  if (!username) {
    console.log(C.red("   Usage: node gh-manager.js remove <username> [--keep-key]"));
    return;
  }
  const acc = find(username);
  if (!acc) {
    console.log(C.red(`   Akun "${username}" tidak terdaftar.`));
    return;
  }
  header();
  if (acc.sshAlias) {
    removeSshHost(acc.sshAlias);
    console.log(C.green(`   ✓ alias ${acc.sshAlias} dihapus dari ssh config`));
  }
  if (!args.flags["keep-key"]) {
    console.log(C.dim(`   key ${acc.sshKey} TIDAK dihapus (hapus manual bila perlu)`));
  }
  const ok = remove(username);
  console.log(ok ? C.green(`   ✓ ${username} dihapus dari registry\n`) : C.red("   gagal hapus\n"));
  console.log(C.dim("   Untuk logout juga: gh auth logout --user " + username + "\n"));
}

// ---------------------------------------------------------------- docs
function cmdDocs() {
  console.log(`
${C.bold("gh-manager - quick reference (untuk AI agent)")}

${C.bold("SOURCE OF TRUTH")}  accounts.json (metadata, tanpa secret)
${C.bold("TOKEN")}              Windows Credential Manager (lewat \`gh auth\`)
${C.bold("SSH KEY")}            ~/.ssh/sshkey_gh_<user>

${C.bold("PERINTAH")}
  node gh-manager.js list                 list semua akun + status
  node gh-manager.js login <user> [--ssh] [--token T] [--web] [--email E]
  node gh-manager.js use <user>           switch akun aktif gh CLI
  node gh-manager.js check [user]         health check per akun
  node gh-manager.js doctor               perbaiki known_hosts / ssh config
  node gh-manager.js remove <user>        hapus dari registry
  node gh-manager.js docs                 tampilkan teks ini

${C.bold("ATURAN WAJIB")}
  1. Sebelum git push, cek: node gh-manager.js list
  2. Jangan commit .env, token, atau private key
  3. Repo milik akun X -> remote pakai alias SSH milik X
     contoh: git@github-cfvpn-bot:cfvpn-bot/repo.git
  4. Jangan ubah ~/.gitconfig global untuk hal lokal
  5. Secret GitHub Actions disimpan di repo (Settings > Secrets), bukan file
`);
}

function cmdHelp() {
  console.log(`
${C.bold("gh-manager")} - multi-akun GitHub manager

  node gh-manager.js list
  node gh-manager.js login <username> [--ssh] [--token TOKEN] [--web] [--email EMAIL] [--role ROLE]
  node gh-manager.js use <username>
  node gh-manager.js check [username]
  node gh-manager.js doctor
  node gh-manager.js remove <username> [--keep-key]
  node gh-manager.js docs
`);
}

// ---------------------------------------------------------------- main
function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  switch (cmd) {
    case "list": case "ls": return cmdList();
    case "login": return cmdLogin(args);
    case "use": case "switch": return cmdUse(args);
    case "check": return cmdCheck(args);
    case "doctor": case "fix": return cmdDoctor();
    case "remove": case "rm": return cmdRemove(args);
    case "docs": return cmdDocs();
    case "help": case undefined: return cmdHelp();
    default:
      console.log(C.red(`   Perintah tidak dikenal: ${cmd}`));
      cmdHelp();
  }
}

main();
