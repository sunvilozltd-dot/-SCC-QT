# Google Apps Script Backend Deployment Guide (`/gas/`)

Refer to the root `/SETUP_GUIDE.md` for full end-to-end instructions covering both Apps Script and the native Android app (`/android/`).

## Quick Apps Script Checklist
1. Copy `appsscript.json`, `Database.gs`, `Auth.gs`, `BusinessLogic.gs`, `BackupRestore.gs`, `Triggers.gs`, and `Code.gs` into a new Apps Script project owned by your **Primary Google Account**.
2. Run `provisionWorkspaceAndTriggers()` once from the Editor to create the private Google Sheet (`Accounts`, `Sessions`, `AuthCodes`, `Settings`, and business tables), private Drive folders, and daily `Asia/Dhaka` triggers.
3. Run `testRecoveryEmailDelivery()` once from the Editor to grant Gmail sending permission (`gmail.send`) and confirm live email delivery to `sunvilozltd@gmail.com`.
4. Deploy as a Web App (**Execute as: Me**, **Who has access: Anyone**).
5. Open the Android app, connect the Web App URL, and complete **Set Up Admin Account** using the 6-digit verification code sent to `sunvilozltd@gmail.com` (first-time setup disables automatically once saved).
6. For future credential changes, use **Settings → Account & Security** inside the app. For forgotten admin passwords, use **Forgot Password?** on the Sign-In screen (sends a separate 10-minute one-time recovery code only to `sunvilozltd@gmail.com`).
7. Deploy `SecondaryBackupDrive.gs` in a separate Apps Script project under your **Second Google Account**, run `setBackupSecret('your-12-char-secret')` once, deploy as Web App, and save the URL + secret in Admin **Settings → Backup & Restore**.
