# gh-manager

Multi-akun GitHub manager untuk 1 laptop. Kelola `gh` auth, SSH key, dan routing `git remote` per akun.

```bash
node gh-manager.js list      # list akun + status
node gh-manager.js doctor    # perbaiki known_hosts / ssh config
```

Nol dependency. Node.js >= 18.

## Kenapa butuh

Satu laptop, beberapa akun GitHub. Tiap akun punya:
- **token** sendiri (Windows Credential Manager, lewat `gh auth`)
- **SSH key** sendiri (`:Users\ACER\.ssh\sshkey_github` untuk primary, `sshkey_gh_<user>` untuk lain)
- **SSH alias** sendiri di `~/.ssh/config` (`github-<user>`)

Remote per repo diarahkan lewat alias, jadi `git push` otomatis ke akun yang benar tanpa `git config` per-push.

## Install

```bash
cd Documents/Project/gh-manager
node gh-manager.js doctor
```

`doctor` akan:
1. Cek `gh` CLI ada
2. Accept host key GitHub ke `known_hosts` (kalau belum)
3. Cek registry konsisten dengan `~/.ssh/config`
4. Laporan status tiap akun

## Tambah akun

```bash
# mode HTTPS (paling simple)
node gh-manager.js login cfvpn-bot --token ghp_xxx --email bot@example.com

# mode SSH (recommended untuk pemisahan key)
node gh-manager.js login cfvpn-bot --ssh --token ghp_xxx
```

Output:

```txt
   [1/4] gh auth login...
   ✓ gh auth OK
   [2/4] SSH key: C:\Users\ACER\.ssh\sshkey_gh_cfvpn-bot
   ✓ key dibuat
      fingerprint: SHA256:xxxx...
      daftarkan pubkey ini di GitHub > Settings > SSH keys:
      ssh-ed25519 AAAA... cfvpn-bot@gh-manager
   [3/4] ~/.ssh/config...
   ✓ alias github-cfvpn-bot ditambahkan
   [4/4] Simpan ke registry...
   ✓ tersimpan di accounts.json
```

**Langkah manual**: copy pubkey yang ditampilkan → paste di GitHub akun tsb → `Settings → SSH and GPG keys → New SSH key`.

Lalu verifikasi:

```bash
node gh-manager.js check cfvpn-bot
```

## Pakai

```bash
# Bikin repo di akun lain
node gh-manager.js use cfvpn-bot
gh repo create proxy-checker --public --source=. --remote=origin-bot
git remote set-url origin-bot git@github-cfvpn-bot:cfvpn-bot/proxy-checker.git
git push origin-bot main
```

## accounts.json

Metadata saja, aman di-commit. TIDAK ada token atau private key.

```json
{
  "accounts": [
    {
      "username": "jhopan",
      "role": "primary",
      "protocol": "https",
      "email": "user@example.com",
      "addedAt": "2026-10-21"
    }
  ]
}
```

## Catatan Windows

Environment ini punya **dua stack SSH**:

| Stack | Binary | Config dibaca dari |
|---|---|---|
| Native (dipakai `git push`) | `C:\Windows\System32\OpenSSH\ssh.exe` | `C:\Users\ACER\.ssh\` |
| MSYS (dipakai dari bash) | `C:\Program Files\Git\usr\bin\ssh.exe` | `C:\Program Files\Git\home\Jhopan\.ssh\` |

`gh-manager` menulis ke **kedua** lokasi biar konsisten. `ssh.exe` native menolak path MSYS (`/c/Users/...`), jadi `~/.ssh/config` ditulis dengan path native `C:/Users/...`.

## Author

**jhopanstore**
