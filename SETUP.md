# Scigen Payroll – setup

Same idea as the sinentefksi app: no server and no extra service.

- **`scigen-payroll`** (public repository) – this code, served by GitHub Pages.
- **`scigen-payroll-data`** (private repository) – one file, `data.json`, encrypted with AES-256.
  Only a GitHub token with access to this repository can read or write it.
- **`auth.json`** (in the public repository, written by the app) – the GitHub token and the data key,
  locked with each account's password. This is what lets everyone sign in with **just account name +
  password** on any device. Nothing in it is readable without a password, but because the file is
  public, use long passwords (the app requires at least 12 characters).
- **Two accounts**, each with its own password. Every change becomes a commit in the data repository,
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
   use Settings → Sign-in → **Replace the GitHub token**).
3. Repository access: **Only select repositories** → choose **both** `scigen-payroll-data` and `scigen-payroll`.
4. Permissions → **Add permissions** → tick **Contents** → set it to **Read and write**.
   (Metadata: Read-only is added automatically.)
5. **Generate token** and copy it (`github_pat_…`). GitHub shows it only once; keep it in your password manager.

Only you need the token, and only once. The second person never needs it.

**Already made a token with only `scigen-payroll-data`?** Open
https://github.com/settings/personal-access-tokens, click the token → **Edit** → Repository access →
add `scigen-payroll` → **Update**. Then in the site: Settings → Sign-in → **Try again**.

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

1. Open the site, type an account name (e.g. `theodore`) and a password (at least 12 characters), press **Sign in**.
2. The first time, it says password-only sign-in is not set up yet and asks for the **GitHub token**. Paste it.
3. Since `data.json` does not exist yet, confirm the password and press **Create database**.
4. The app writes `auth.json` to the public repository. Settings → Sign-in shows
   “Password-only sign-in is on”. From now on: name + password only, on any device.

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

1. **Settings → Accounts → Add an account**: name + password (at least 12 characters).
2. Tell that person the site address, the name and the password. They just sign in. No token.

## Everyday use

- Sign in with account name + password. The session lasts until the tab is closed or you press **Sign out**.
- Both accounts can edit at the same time. A save always re-reads the latest data first, and GitHub
  rejects a stale write, which the app retries, so nobody overwrites the other.
- Open tabs refresh when you come back to them and every 2 minutes.

## When something changes

| Situation | What to do |
|---|---|
| Rate goes up | Settings → Hourly rate → **+ Add rate change** with the month it starts |
| Token expires or you make a new one | Settings → Sign-in → **Replace the GitHub token**. If you can't sign in anymore: on the sign-in screen use **Sign in with a GitHub token** with the new token |
| Change your own password | Settings → Accounts → **Change my password** (works everywhere right away) |
| The other person forgot their password | Settings → Accounts → **Set password** next to their name |
| Someone should lose access | Settings → Accounts → **Remove**. If they ever saw the token, also replace the token |
| Backup | Settings → Data → **Download full backup (JSON)** (also importable) |

## Preview locally (optional)

```sh
npm run serve
```
Then open http://localhost:5173/?demo – the real app against a fake GitHub kept in the browser,
with the imported sheet (account `demo`, password `demo-password-1`). Nothing is sent to GitHub.

## Tests

```sh
npm test
```
