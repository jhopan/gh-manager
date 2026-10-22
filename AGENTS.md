# AGENTS.md — gh-manager

Multi-akun GitHub manager. Node.js, nol dependency.

## Source of truth

| Data | Lokasi |
|---|---|
| Registry akun | `accounts.json` (metadata saja, TANPA secret) |
| Token | Windows Credential Manager (dikelola `gh auth`) |
| SSH private key | `C:/Users/ACER/.ssh/sshkey_github`, `sshkey_gh_<user>` |
| SSH config | `C:/Users/ACER/.ssh/config` (alias per akun) |

## Perintah

```bash
node gh-manager.js list                                    # list akun + status
node gh-manager.js login <user> [--ssh] [--token T] [--web] [--email E] [--role R]
node gh-manager.js use <user>                              # switch akun aktif gh CLI
node gh-manager.js check [user]                            # health check
node gh-manager.js doctor                                  # fix known_hosts + ssh config
node gh-manager.js remove <user> [--keep-key]
node gh-manager.js docs                                    # quick reference
```

## Aturan wajib untuk AI agent

1. Sebelum `git push`, cek `node gh-manager.js list` — tahu remote milik akun mana.
2. **Jangan** commit `.env`, token, atau private key.
3. Repo milik akun X → remote pakai alias SSH milik X.
   Contoh: `git@github-bot:cfvpn-bot/repo.git`
4. **Jangan** ubah `~/.gitconfig` global untuk hal yang bersifat lokal. Pakai `git config` per-repo.
5. `sshkey` (bukan `sshkey_github`) dipakai 5+ VPS — **jangan** daftarkan ke GitHub.
6. Secret GitHub Actions disimpan di repo (Settings → Secrets), bukan file.
7. Alias `github-<user>` di `~/.ssh/config` wajib punya `IdentitiesOnly yes`.

## Environment quirk (Windows/MSYS)

- Dua stack SSH. `git push` memakai `C:\Windows\System32\OpenSSH\ssh.exe` → baca `C:\Users\ACER\.ssh\`.
- `ssh.exe` native **tolak** path MSYS (`/c/Users/...`). Selalu pass `C:/Users/...`.
- `os.homedir()` = `C:\Users\ACER`; `sh -c 'echo $HOME'` = `/cygdrive/c/Users/ACER` (path berbeda, tapi satu folder fisik).
- MSYS OpenSSH baca `C:\Program Files\Git\home\Jhopan\.ssh\` (fake home). `gh-manager` menulis ke kedua lokasi.

## Verifikasi

Setelah ubah apa pun: `node gh-manager.js check` harus Show all green sebelum dipakai push.
