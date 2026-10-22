// Registry akun GitHub. Metadata saja - TIDAK berisi secret.
// Token disimpan di Windows Credential Manager oleh `gh auth login`.
// SSH private key ada di ~/.ssh/, bukan di repo ini.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
const FILE = resolve(ROOT, "accounts.json");

const EMPTY = { accounts: [] };

export function load() {
  if (!existsSync(FILE)) return structuredClone(EMPTY);
  try {
    const data = JSON.parse(readFileSync(FILE, "utf-8"));
    if (!Array.isArray(data.accounts)) return structuredClone(EMPTY);
    return data;
  } catch {
    return structuredClone(EMPTY);
  }
}

export function save(data) {
  writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
  return data;
}

export function find(username) {
  const key = username.toLowerCase();
  return load().accounts.find((a) => a.username.toLowerCase() === key) || null;
}

export function upsert(account) {
  const data = load();
  const key = account.username.toLowerCase();
  const idx = data.accounts.findIndex((a) => a.username.toLowerCase() === key);
  if (idx === -1) {
    data.accounts.push(account);
  } else {
    data.accounts[idx] = { ...data.accounts[idx], ...account };
  }
  return save(data);
}

export function remove(username) {
  const data = load();
  const key = username.toLowerCase();
  const before = data.accounts.length;
  data.accounts = data.accounts.filter((a) => a.username.toLowerCase() !== key);
  save(data);
  return before !== data.accounts.length;
}

export function list() {
  return load().accounts;
}
