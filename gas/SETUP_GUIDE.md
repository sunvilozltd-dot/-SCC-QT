# Google Apps Script Web App Deployment Guide (`/gas/`)

See the root `/SETUP_GUIDE.md` for complete instructions including `npm run build:gas`, SQLite migration (`npm run export:sqlite`), and browser Add to Home Screen setup.

## Quick Deployment Checklist
1. Run `npm run build:gas` to generate the self-contained `/gas/Index.html` bundle from the React UI.
2. Copy `appsscript.json`, `Code.gs`, `Database.gs`, `Auth.gs`, `BusinessLogic.gs`, `BackupRestore.gs`, `Triggers.gs`, and `Index.html` (as an **HTML** file named `Index`) into a new Apps Script project owned by your **Primary Google Account** (`sunvilozltd@gmail.com`).
3. Run `provisionWorkspaceAndTriggers()` once from `Triggers.gs` to create the private Google Sheet, private Drive folders (`Logo`, `DocumentPads`, `IssuedPDFs`, `Backups`), and daily `Asia/Dhaka` triggers.
4. Run `testRecoveryEmailDelivery()` once from `Auth.gs` to grant `gmail.send` permission and verify live email delivery to `sunvilozltd@gmail.com`.
5. Click **Deploy → New deployment → Web app** (**Execute as: Me**, **Who has access: Anyone**).
6. Open the single `/exec` Web App URL in any phone or desktop browser and complete **First-Time Admin Account Setup** (using the 6-digit email code sent to `sunvilozltd@gmail.com`, or by running `setupInitialAdmin('your-password')` once in the Editor).
7. Optional Secondary Backup: deploy `SecondaryBackupDrive.gs` in a separate Apps Script project under your **Second Google Account**, run `setBackupSecret('your-12-char-secret')` once, deploy as Web App, and save the URL + secret under **Settings → Backup & Restore**.
