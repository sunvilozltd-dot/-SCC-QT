# SUNVILOZ Clean Care — Web App & Google Apps Script Deployment Guide

SUNVILOZ Clean Care runs in production as a **web-only application** hosted directly on **Google Apps Script (HTML Service + `google.script.run`)**, using your private **Google Sheet** for business records and private **Google Drive** folders for logos, quotation/receipt pads, issued PDFs, and backups.

- **No separate Node/Express server or SQLite database is required in production.**
- **Users open one web app URL** on phone or desktop and never enter a backend URL into the app.
- **Browser installation (Add to Home Screen)** works on Android Chrome, iPhone/iPad Safari, and desktop browsers.

---

## Step 1: Build the Self-Contained Web App Bundle (`gas/Index.html`)

Whenever you update the React UI, rebuild the single-file Apps Script HTML bundle:

```bash
npm run build:gas
```

This compiles the English React/Vite UI into `/gas/Index.html` with all CSS and JS inlined for Google Apps Script `HtmlService`.

---

## Step 2: Deploy the Primary Google Apps Script Web App

Sign in to your **Primary Google Account** (`sunvilozltd@gmail.com`, which will privately own the Google Sheet and Drive folders):

1. Open [https://script.google.com](https://script.google.com) and click **New Project**. Name it **SUNVILOZ Clean Care Web App**.
2. Go to **Project Settings (⚙️)** and check **Show "appsscript.json" manifest file in editor**.
3. Return to **Editor (< >)** and copy all **8 files** from `/gas/` into the project:
   - `appsscript.json` (replace manifest contents)
   - `Code.gs` (replace default `Code.gs`)
   - `Database.gs` (**Files (+) → Script → Database**)
   - `Auth.gs` (**Files (+) → Script → Auth**)
   - `BusinessLogic.gs` (**Files (+) → Script → BusinessLogic**)
   - `BackupRestore.gs` (**Files (+) → Script → BackupRestore**)
   - `Triggers.gs` (**Files (+) → Script → Triggers**)
   - `Index.html` (**Files (+) → HTML → Index**, paste generated `/gas/Index.html`)
   - *Do NOT paste `SecondaryBackupDrive.gs` into this primary project.*
4. **Provision the Private Sheet, Drive Folders & Daily Triggers**:
   - Open `Triggers.gs`, select `provisionWorkspaceAndTriggers`, and click **Run**.
   - Grant Google permissions (Sheets, Drive, Gmail, Triggers) under your Primary Google Account.
   - This creates the private Google Sheet (`SUNVILOZ Clean Care — Master Database (Private)`), private Drive folders (`Logo`, `DocumentPads`, `IssuedPDFs`, `Backups`), and daily `Asia/Dhaka` triggers for 9:00 AM follow-up reminders and 2:00 AM backups.
5. **Verify Live Email Delivery**:
   - Open `Auth.gs`, select `testRecoveryEmailDelivery`, and click **Run** to confirm Gmail delivery to `sunvilozltd@gmail.com`.
6. **Deploy as a Web App**:
   - Click **Deploy → New deployment → Web app**.
   - **Execute as:** `Me` (your Primary Google Account).
   - **Who has access:** `Anyone` (sign-in, session tokens, one-time codes, and Admin vs. Supervisor permissions are strictly enforced inside `Code.gs` and `Auth.gs`).
   - Click **Deploy** and bookmark/share the resulting **Web App URL** (`https://script.google.com/macros/s/.../exec`).
7. **Complete First-Time Admin Setup**:
   - Open the `/exec` Web App URL in your browser.
   - Complete the one-time **First-Time Admin Account Setup** using the 6-digit verification code sent to `sunvilozltd@gmail.com` (or run `setupInitialAdmin('your-strong-password')` once in the Apps Script Editor).
   - First-time setup disables automatically once saved. Future password or username changes are done inside **Settings → Account & Security**, and forgotten admin passwords can be recovered via **Change Password → Forgot Admin Password?**.

---

## Step 3: Optional Secondary Google Drive Daily Backup Bridge

Sign in to a **SECOND (independent) Google Account** (must differ from the Primary account):

1. Open [https://script.google.com](https://script.google.com) → **New Project** → name it **SUNVILOZ Secondary Backup Bridge**.
2. Paste `/gas/SecondaryBackupDrive.gs` into `Code.gs`.
3. Run a one-time helper in the Editor to store a strong shared secret (12+ characters) in Script Properties, then delete the helper:
   ```javascript
   function runOnceSetSecret() {
     setBackupSecret('YOUR_STRONG_BRIDGE_SECRET_12_PLUS');
   }
   ```
4. Click **Deploy → New deployment → Web app** → **Execute as:** `Me` → **Who has access:** `Anyone`.
5. In the SUNVILOZ web app, go to **Settings → Backup & Restore**, enter the Secondary Web App URL and secret (stored privately in Primary Apps Script **Script Properties**), and save.

---

## Step 4: Optional Non-Destructive Migration from Existing SQLite Data

If you previously saved records in a local SQLite database (`data/sunviloz.db`):

1. Run the read-only export script (your existing SQLite file is never modified or deleted):
   ```bash
   npm run export:sqlite
   ```
2. Check the printed per-table record counts and the generated verified JSON file in `data/sunviloz-sqlite-export-YYYY-MM-DD.json`.
3. Open your deployed Google Apps Script web app as Admin → **Settings → Backup & Restore → Upload Backup to Restore** → select the exported JSON file → verify the preview record counts match → type `RESTORE` to import atomically into Google Sheets.

---

## Step 5: Add to Home Screen (Phone & Desktop)

- **Android Phone (Chrome / Edge):** Open your `/exec` Web App URL → tap **⋮ Menu** → **Add to Home screen** (or **Install app**).
- **iPhone / iPad (Safari):** Open your `/exec` Web App URL → tap **Share** → **Add to Home Screen**.
- **Desktop (Chrome / Edge):** Bookmark the `/exec` URL or use **Menu → Cast, save, and share → Install page as app**.
