# Scigen Payroll

Work log, monthly pay and expenses for Scigen, replacing the "Scigen Time Records" Google Sheet.

- Log date, task, start, finish → minutes and hours are computed.
- Each month: hours worked × hourly rate = pay (manual "hours to be paid" or rate per month when needed).
- Expenses are subtracted: **earned − paid = remaining**.
- Two accounts that sign in with just name + password; data encrypted in a private GitHub repository.

Static site (plain HTML/CSS/JS, no build step) hosted on GitHub Pages. See **[SETUP.md](SETUP.md)**.

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | the site |
| `js/calc.js` | all pay math (pure, tested) |
| `js/store.js`, `js/crypto.js`, `js/github.js`, `js/session.js` | encrypted storage in the private repo, login |
| `scripts/parse-sheet.mjs` | converts the Google Sheet HTML export into `data/seed.json` for import |
| `tests/` | `npm test` |
