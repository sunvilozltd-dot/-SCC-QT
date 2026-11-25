# SUNVILOZ Clean Care — Native Android & Google Apps Script Setup Guide

This project delivers:
1. **Google Apps Script Backend (`/gas/`)** — Uses **only** the owner's private Google Sheet, private Google Drive folders, Gmail triggers, and Google Apps Script (no external servers, databases, auth services, or schedulers).
2. **Native Android Studio Project (`/android/`)** — Built in **Kotlin + Jetpack Compose (Material 3)** with Android Keystore session storage, native `BiometricPrompt` unlock (fingerprint / phone screen lock + app-password fallback), Room offline retry queue, native A4 Quotation & Money Receipt PDF generation, Monthly Jobs & Income `.xlsx` export, and Secondary Google Drive Backup & Restore.
3. **Web Preview Bridge (`/server.ts` & `/src/`)** — Can point to the exact same `APPS_SCRIPT_WEBAPP_URL` as Android.

---

## Step 1: Deploy the Primary Google Apps Script Backend

Sign in to your **Primary Google Account** (the owner's account that will privately hold the Sheet and Drive files):

1. Open [https://script.google.com](https://script.google.com) and click **New Project**. Name it **SUNVILOZ Clean Care Backend**.
2. In **Project Settings**, check **Show "appsscript.json" manifest file in editor**.
3. Copy each file from `/gas/` into the Apps Script project:
   - `appsscript.json` (replace the manifest)
   - `Database.gs`
   - `Auth.gs`
   - `BusinessLogic.gs`
   - `BackupRestore.gs`
   - `Triggers.gs`
   - `Code.gs` (replace default `Code.gs`)
4. **Provision the Private Sheet, Drive Folders & Daily Triggers**:
   - In the Apps Script Editor toolbar, select `provisionWorkspaceAndTriggers` and click **Run**.
   - Grant the requested Google permissions (Sheets, Drive, **Gmail**, Triggers) under your Primary Google Account.
   - This creates the private Google Sheet (`SUNVILOZ Clean Care — Master Database (Private)`), private Drive folders (`Logo`, `DocumentPads`, `IssuedPDFs`, `Backups`), and daily `Asia/Dhaka` triggers for Gmail follow-up reminders (9:00 AM) and daily secondary Drive backup (2:00 AM).
5. **Authorize & Verify Live Email Delivery to `sunvilozltd@gmail.com`**:
   - In the Apps Script Editor toolbar, select `testRecoveryEmailDelivery` and click **Run**.
   - Confirm that the `gmail.send` authorization succeeds and that the verification email arrives in `sunvilozltd@gmail.com`. This ensures first-time admin setup codes and Forgot Password recovery codes can be delivered live.
6. **Deploy as a Web App**:
   - Click **Deploy → New deployment → Web app**.
   - **Execute as:** `Me` (your Primary Google Account).
   - **Who has access:** `Anyone` (authentication, one-time codes, and admin/supervisor roles are strictly enforced inside `Code.gs`).
   - Copy the resulting **Web App URL** (`https://script.google.com/macros/s/.../exec`).
7. **Complete First-Time Admin Setup Inside the Android App**:
   - Open the Android app, paste the Web App URL under **Configure Backend URL**, and tap **Set Up Admin Account** (visible only while the admin password has never been initialized).
   - Keep `scc@gmail.com` or edit the Admin Username, enter **New Password** and **Confirm Password** (no Current Password is shown), tap **Send Verification Code to sunvilozltd@gmail.com**, enter the 6-digit code, and save.
   - Once saved, first-time setup is permanently disabled and existing orders/admin ID (`ADM-PRIMARY`) are preserved.
   - To update username or password later, use **Settings → Account & Security** (requires Current Password and revokes all previous admin sessions). If you ever forget the admin password, use **Forgot Password?** on the Sign-In screen to receive a 10-minute one-time recovery code at `sunvilozltd@gmail.com`.

---

## Step 2: Deploy the Secondary Google Drive Daily Backup Bridge

Sign in to your **SECOND (independent) Google Account** (must be different from the Primary account):

1. Open [https://script.google.com](https://script.google.com) → **New Project** → name it **SUNVILOZ Secondary Backup Bridge**.
2. Paste `/gas/SecondaryBackupDrive.gs` into `Code.gs`.
3. Run a one-time helper in the Editor to store a strong shared secret (min 12 characters) in Script Properties, then delete the helper:
   ```javascript
   function runOnceSetSecret() {
     setBackupSecret('YOUR_STRONG_BRIDGE_SECRET_12_PLUS');
   }
   ```
4. Click **Deploy → New deployment → Web app** → **Execute as:** `Me` → **Who has access:** `Anyone`.
5. Copy this Secondary Web App URL and secret into the Android app under **Settings → Backup & Restore → Daily Unattended Scheduled Backup**.

---

## Step 3: Build & Install the Native Android App (`/android/`)

1. Open `/android` in **Android Studio (Ladybug / 2024.2+)** with JDK 17 and Android SDK 35.
2. Copy `/android/local.properties.example` to `/android/local.properties`, set `sdk.dir`, and optionally set `APPS_SCRIPT_WEBAPP_URL` (or paste it inside the app via **Configure Backend URL** on first launch). Never put passwords or secrets in `local.properties`.
3. **For Secondary Google Drive OAuth from Android**:
   - In Google Cloud Console (for your project), enable the **Google Drive API**.
   - Create an **Android OAuth 2.0 Client ID** with package name `com.sunviloz.cleancare` and your debug/release signing **SHA-1** fingerprint (`./gradlew signingReport`).
4. Build the installable APK:
   - Debug APK: `./gradlew assembleDebug` → output in `/android/app/build/outputs/apk/debug/app-debug.apk`
   - Release APK: `./gradlew assembleRelease` (configure your keystore in Android Studio → **Build → Generate Signed Bundle / APK**).
5. Install the APK on your Android phone, open the app, paste your Primary Apps Script Web App URL (if not pre-configured), and tap **Set Up Admin Account** to verify via email code (`sunvilozltd@gmail.com`) and set your initial credentials.

---

## Step 4: Physical Android Phone Verification Checklist

Before production rollout, verify on a real Android phone:
1. **First-Time Admin Setup**: Verify **Set Up Admin Account** appears only before initialization, shows Admin Username (prefilled with `scc@gmail.com`, editable), New Password, and Confirm Password (no Current Password), sends a 6-digit code to `sunvilozltd@gmail.com`, saves credentials while preserving `ADM-PRIMARY` and existing orders, and permanently hides setup afterward.
2. **Sign In & Device Unlock**: Sign in with the saved admin credentials (verify wrong passwords return `"Invalid username or password."`), close and reopen the app, verify Fingerprint / Screen Lock (`BiometricPrompt`) unlocks the session, and verify `"Sign in with App Password Instead"` works.
3. **Settings → Account & Security**: Verify saved username is prefilled, wrong Current Password is rejected, blank New Password keeps the existing password, Confirm New Password is required when changing password, and saving revokes all previous admin sessions and returns to Sign In.
4. **Forgot Password**: Tap **Forgot Password?**, enter the current Admin Username, verify the recovery code arrives at `sunvilozltd@gmail.com`, verify expired/reused codes fail, reset the password while preserving the username and orders, and confirm the old password fails immediately.
5. **Orders & Offline Sync**: Create an order, verify `"Saved to Google Sheets"`, toggle Airplane Mode, submit another form, verify `"Not Saved"` / `"Pending Sync"` keeps the form open, reconnect, tap **Retry**, and verify no duplicate order is created.
6. **Status Lock & Supervisor Scope**: Complete an order with full bill collected → verify status permanently locks (`Completed · Locked`); sign in on a second device with a Supervisor account → verify only assigned jobs for today through today + 6 days appear.
7. **Secondary Google Drive Backup & Restore**: Verify connecting the primary Google account is rejected, connecting a second Google account succeeds, **Back Up Now** creates an actual private JSON file in the second Drive (excluding passwords, hashes, codes, and sessions), and **Preview & Restore** validates and restores cleanly into a fresh Sheet.
