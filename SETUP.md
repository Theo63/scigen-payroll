# Scigen Payroll – setup

Same idea as the sinentefksi app: no server and no extra service.

- **`scigen-payroll`** (public repository) – this code, served by GitHub Pages.
- **`scigen-payroll-data`** (private repository) – one file, `data.json`, encrypted with AES-256.
  Only a GitHub token with access to this repository can read or write it.
- **Two accounts**, each with its own password. A password unlocks the encryption key for the data
  and the GitHub token saved in that browser. Every change becomes a commit in the data repository,
  so you get a full history for free.

Takes about 15 minutes, once.

---

## 1. Create the private data repository

1. Open https://github.com/new
2. Repository name: `scigen-payroll-data`
3. Visibility: **Private**
4. Tick **Add a README file** (the repository must not be empty).
5. **Create repository**.

## 2. Create a GitHub token for the site

1. Open https://github.com/settings/personal-access-tokens/new (Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens** → Generate new token).
2. Token name: `scigen-payroll`. Expiration: the longest you are comfortable with (when it expires,
   you just make a new one and use “Set up this device” again).
3. Repository access: **Only select repositories** → choose `scigen-payroll-data` only.
4. Permissions → Repository permissions → **Contents: Read and write**. (Metadata: Read-only is added automatically.)
5. **Generate token** and copy it (`github_pat_…`). GitHub shows it only once; keep it in your password manager.

Tip: you can instead edit the token you already use for sinentefksi and add `scigen-payroll-data`
to its repositories. Either way works.

The second account needs a token too. Either give them the same token, or (better) create a second
token the same way, so you can revoke one without affecting the other.

## 3. Publish the site

1. Open https://github.com/new
2. Repository name: `scigen-payroll`, Visibility: **Public** (Pages on a free account needs a public
   repository; it contains only code, no data). Do **not** add a README, .gitignore or license.
3. In Terminal:
   ```sh
   cd ~/Code/scigen-payroll
   git remote add origin https://github.com/Theo63/scigen-payroll.git
   git push -u origin main
   ```
4. On GitHub: repository → **Settings** → **Pages** → Build and deployment → Source: **Deploy from a branch**
   → Branch: `main`, folder `/ (root)` → **Save**.
5. After about a minute the site is at **https://theo63.github.io/scigen-payroll/**

## 4. First sign-in creates the database

1. Open the site. It shows **Set up this device**.
2. Paste the token, choose an account name (e.g. `theodore`) and a password (at least 8 characters).
3. Press **Continue**. Since `data.json` does not exist yet, it asks you to confirm the password and
   press **Create database**.

## 5. Import the Google Sheet history

1. Make sure the sheet export is in `~/Downloads/Scigen Time Records 2nd year/` (it already is).
2. In Terminal:
   ```sh
   cd ~/Code/scigen-payroll
   npm install
   npm run parse-sheet
   ```
   The report must end with `Total 7355.48 / Paid 6960 / Remaining 395.48`.
   It writes `data/seed.json`, which is git-ignored and never pushed.
3. On the site: **Settings → Data → Import** → choose `data/seed.json` → **Import**.
4. The dashboard shows **€7,355.48 earned / €6,960.00 paid / €395.48 remaining**.
5. Work log → **⚠ Flagged** lists the rows the import could not read cleanly (odd dates, rows with no
   duration). Open each one, fix it if needed, tick “Clear this flag”.

## 6. Add the second account

1. **Settings → Accounts → Add an account**: name + password.
2. The other person opens the site, clicks **Set up this device for another account**, and enters a
   token (step 2), that name and that password.

## Everyday use

- Each browser asks for the token only once. After that it is just account + password.
- The session lasts until the tab is closed or you press **Sign out**.
- Both accounts can edit at the same time. A save always re-reads the latest data first, and GitHub
  rejects a stale write, which the app retries, so nobody overwrites the other.
- Open tabs refresh when you come back to them and every 2 minutes.

## When something changes

| Situation | What to do |
|---|---|
| Rate goes up | Settings → Hourly rate → **+ Add rate change** with the month it starts |
| Token expired or revoked | Make a new token (step 2) → on the login screen, **Set up this device** |
| Changed your password | Other browsers: **Set up this device** with the new password |
| Lost a password | The other account removes it in Settings → Accounts and adds it again |
| Backup | Settings → Data → **Download full backup (JSON)** (also importable) |
| Someone else's computer | Settings → This device → **Forget this device** when done |

## Preview locally (optional)

```sh
npm run serve
```
Then open http://localhost:5173/?demo – the real app against a fake GitHub kept in the browser,
with the imported sheet (account `demo`, password `demo1234`). Nothing is sent to GitHub.

## Tests

```sh
npm test
```
