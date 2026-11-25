/**
 * SUNVILOZ Clean Care — Backup, Verification & Safe Idempotent Restore (BackupRestore.gs)
 *
 * Security & durability guarantees:
 * - Backup packages include business records, user IDs & role mappings, document pads,
 *   company logo, issued PDFs, and reminder history.
 * - Backup packages STRICTLY EXCLUDE passwords, password hashes, session tokens,
 *   and authorization secrets.
 * - Restore validates integrity + SHA-256 checksum BEFORE writing, preserves existing
 *   data on any validation error, avoids duplicate records on retry, and supports
 *   admin account relinking & password reset after recovery while preserving job assignments.
 */

var BACKUP_EXPORT_SHEETS = [
  'Orders', 'StatusHistory', 'Customers', 'Buildings', 'Leads', 'LeadNotes',
  'Quotations', 'Receipts', 'Workers', 'OrderWorkers', 'WorkerPayHistory',
  'SettlementEntries', 'Complaints', 'OverheadExpenses', 'DocumentPads',
  'IssuedPdfs', 'ReminderLog'
];

var SAFE_SETTINGS_KEYS = [
  'default_followup_value', 'default_followup_unit', 'reminder_email',
  'daily_reminder_hour', 'order_sequence', 'quotation_sequence',
  'receipt_sequence', 'lead_sequence', 'company_logo_file_name',
  'company_logo_mime_type', 'secondary_drive_folder_name'
];

function stripPrivateRowFields_(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var copy = {};
    var keys = Object.keys(rows[i]);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (key === '_rowIndex') continue;
      if (
        key === 'password_hash' ||
        key === 'token_version' ||
        key === 'code_verifier' ||
        key.indexOf('secret') !== -1 ||
        key.indexOf('token') !== -1
      ) {
        continue;
      }
      copy[key] = rows[i][key];
    }
    out.push(copy);
  }
  return out;
}

function buildSanitizedBackupPackage_(ss, actorName) {
  var accounts = readSheetObjects_(ss, 'Accounts');
  var userMappings = [];
  for (var i = 0; i < accounts.length; i++) {
    userMappings.push({
      id: String(accounts[i].id || ''),
      role: String(accounts[i].role || 'supervisor'),
      name: String(accounts[i].name || ''),
      username: String(accounts[i].username || ''),
      phone_display: String(accounts[i].phone_display || ''),
      is_active: String(accounts[i].is_active) === '1' || accounts[i].is_active === true || accounts[i].is_active === 1,
      created_at: String(accounts[i].created_at || ''),
      updated_at: String(accounts[i].updated_at || '')
      // password_hash and token_version intentionally excluded
    });
  }

  var tables = {};
  var counts = { users: userMappings.length };
  for (var s = 0; s < BACKUP_EXPORT_SHEETS.length; s++) {
    var name = BACKUP_EXPORT_SHEETS[s];
    var cleaned = stripPrivateRowFields_(readSheetObjects_(ss, name));
    tables[name] = cleaned;
    counts[name] = cleaned.length;
  }

  var settings = getSettingsMap_(ss);
  var safeSettings = {};
  for (var sk = 0; sk < SAFE_SETTINGS_KEYS.length; sk++) {
    var key = SAFE_SETTINGS_KEYS[sk];
    safeSettings[key] = settings[key] || '';
  }

  // Embed actual binary assets (logo, document pads, issued PDFs) as base64 so
  // restore works on a brand-new Google account without access to the original primary Drive.
  var assets = {
    logo: settings.company_logo_file_id ? {
      file_name: settings.company_logo_file_name || 'company-logo.png',
      mime_type: settings.company_logo_mime_type || 'image/png',
      data_url: readDriveFileAsDataUrl_(settings.company_logo_file_id, settings.company_logo_mime_type)
    } : null,
    document_pads: [],
    issued_pdfs: []
  };

  var pads = tables.DocumentPads || [];
  for (var p = 0; p < pads.length; p++) {
    var padDataUrl = pads[p].drive_file_id ? readDriveFileAsDataUrl_(pads[p].drive_file_id, pads[p].mime_type) : '';
    assets.document_pads.push({
      pad_type: pads[p].pad_type,
      file_name: pads[p].file_name,
      mime_type: pads[p].mime_type,
      data_url: padDataUrl
    });
  }

  var pdfs = tables.IssuedPdfs || [];
  for (var f = 0; f < pdfs.length; f++) {
    var pdfDataUrl = pdfs[f].drive_file_id ? readDriveFileAsDataUrl_(pdfs[f].drive_file_id, 'application/pdf') : '';
    assets.issued_pdfs.push({
      pdf_id: pdfs[f].pdf_id,
      doc_type: pdfs[f].doc_type,
      doc_id: pdfs[f].doc_id,
      doc_number: pdfs[f].doc_number,
      file_name: pdfs[f].file_name,
      data_url: pdfDataUrl
    });
  }

  var body = {
    schema_version: 3,
    app: 'SUNVILOZ Clean Care',
    created_at: getNowDhakaTimestamp_(),
    created_by: String(actorName || 'System'),
    timezone: SUNVILOZ_CONFIG.TIMEZONE,
    counts: counts,
    user_mappings: userMappings,
    settings: safeSettings,
    tables: tables,
    assets: assets
  };

  var canonical = JSON.stringify(body);
  var checksum = computeSha256Hex_(canonical);

  return {
    backup_format: 'sunviloz_clean_care_backup_v3',
    checksum_sha256: checksum,
    payload: body
  };
}

function validateBackupPackageGas_(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    throw new Error('Backup file is empty or unreadable.');
  }
  if (pkg.backup_format !== 'sunviloz_clean_care_backup_v3' || !pkg.payload || !pkg.checksum_sha256) {
    throw new Error('Unrecognized backup format. Expected SUNVILOZ Clean Care backup v3.');
  }
  var computed = computeSha256Hex_(JSON.stringify(pkg.payload));
  if (!constantTimeEqual_(computed, String(pkg.checksum_sha256))) {
    throw new Error('Backup integrity check failed (SHA-256 mismatch). Existing data was NOT modified.');
  }
  var p = pkg.payload;
  var tables = p.tables || {};
  var assets = p.assets || {};
  return {
    valid: true,
    created_at: String(p.created_at || ''),
    created_by: String(p.created_by || ''),
    checksum_sha256: computed,
    counts: {
      users: Array.isArray(p.user_mappings) ? p.user_mappings.length : 0,
      orders: Array.isArray(tables.Orders) ? tables.Orders.length : 0,
      customers: Array.isArray(tables.Customers) ? tables.Customers.length : 0,
      buildings: Array.isArray(tables.Buildings) ? tables.Buildings.length : 0,
      leads: Array.isArray(tables.Leads) ? tables.Leads.length : 0,
      quotations: Array.isArray(tables.Quotations) ? tables.Quotations.length : 0,
      receipts: Array.isArray(tables.Receipts) ? tables.Receipts.length : 0,
      workers: Array.isArray(tables.Workers) ? tables.Workers.length : 0,
      overhead_expenses: Array.isArray(tables.OverheadExpenses) ? tables.OverheadExpenses.length : 0,
      reminder_logs: Array.isArray(tables.ReminderLog) ? tables.ReminderLog.length : 0,
      document_pads: Array.isArray(assets.document_pads) ? assets.document_pads.length : 0,
      issued_pdfs: Array.isArray(assets.issued_pdfs) ? assets.issued_pdfs.length : 0,
      has_logo: Boolean(assets.logo && assets.logo.data_url)
    }
  };
}

function restoreBackupPackageGas_(ss, actor, pkg) {
  // Step 1: Validate completely BEFORE mutating a single row (preserves existing data on failure)
  var summary = validateBackupPackageGas_(pkg);
  var p = pkg.payload;
  var tables = p.tables || {};
  var assets = p.assets || {};
  var folders = getPrivateDriveFolders_();
  var now = getNowDhakaTimestamp_();

  // Step 2: Restore Drive assets into THIS primary Drive so stable IDs belong to the current account
  var restoredLogoFileId = '';
  if (assets.logo && assets.logo.data_url) {
    var savedLogo = saveBase64FileToDrive_(
      folders.logo,
      assets.logo.file_name || 'company-logo.png',
      assets.logo.mime_type || 'image/png',
      assets.logo.data_url,
      ''
    );
    restoredLogoFileId = savedLogo.file_id;
  }

  var padDriveMap = {};
  if (Array.isArray(assets.document_pads)) {
    for (var pi = 0; pi < assets.document_pads.length; pi++) {
      var pa = assets.document_pads[pi];
      if (pa && pa.data_url) {
        var savedPad = saveBase64FileToDrive_(folders.pads, pa.file_name || (pa.pad_type + '.png'), pa.mime_type || 'image/png', pa.data_url, '');
        padDriveMap[pa.pad_type] = savedPad.file_id;
      }
    }
  }

  var pdfDriveMap = {};
  if (Array.isArray(assets.issued_pdfs)) {
    for (var fi = 0; fi < assets.issued_pdfs.length; fi++) {
      var fa = assets.issued_pdfs[fi];
      if (fa && fa.data_url) {
        var savedPdf = saveBase64FileToDrive_(folders.pdfs, fa.file_name || (fa.pdf_id + '.pdf'), 'application/pdf', fa.data_url, '');
        pdfDriveMap[fa.pdf_id] = savedPdf.file_id;
      }
    }
  }

  // Step 3: Replace business tables cleanly (idempotent on retries — never creates duplicates)
  for (var s = 0; s < BACKUP_EXPORT_SHEETS.length; s++) {
    var sheetName = BACKUP_EXPORT_SHEETS[s];
    var rows = Array.isArray(tables[sheetName]) ? tables[sheetName].slice() : [];
    if (sheetName === 'DocumentPads') {
      for (var d = 0; d < rows.length; d++) {
        if (padDriveMap[rows[d].pad_type]) rows[d].drive_file_id = padDriveMap[rows[d].pad_type];
      }
    }
    if (sheetName === 'IssuedPdfs') {
      for (var ip = 0; ip < rows.length; ip++) {
        if (pdfDriveMap[rows[ip].pdf_id]) rows[ip].drive_file_id = pdfDriveMap[rows[ip].pdf_id];
      }
    }
    replaceSheetRows_(ss, sheetName, rows);
  }

  // Step 4: Relink supervisor IDs & role mappings WITHOUT overwriting existing admin password hash.
  // Supervisors restored without password_hash are marked inactive until admin resets their password,
  // while preserving their exact ID so all assigned orders remain linked!
  var existingAccounts = readSheetObjects_(ss, 'Accounts');
  var existingById = {};
  for (var ea = 0; ea < existingAccounts.length; ea++) {
    existingById[String(existingAccounts[ea].id)] = existingAccounts[ea];
  }
  var mappings = Array.isArray(p.user_mappings) ? p.user_mappings : [];
  var supervisorsNeedingReset = [];
  for (var m = 0; m < mappings.length; m++) {
    var um = mappings[m];
    if (String(um.role) === 'admin') {
      // Preserve current active admin password hash & session while keeping ADM-PRIMARY intact
      continue;
    }
    if (!existingById[String(um.id)]) {
      appendSheetObject_(ss, 'Accounts', {
        id: String(um.id),
        role: 'supervisor',
        name: String(um.name || ''),
        username: normalizeUsername_(um.username),
        phone_display: String(um.phone_display || ''),
        password_hash: '', // Admin must assign a fresh password post-restore
        is_active: 0,
        token_version: 1,
        created_at: String(um.created_at || now),
        updated_at: now
      });
      supervisorsNeedingReset.push({ id: String(um.id), name: String(um.name), username: String(um.username) });
    }
  }

  // Step 5: Restore safe settings and pause reminders until admin verifies after restore
  var restoredSettings = p.settings || {};
  for (var sk = 0; sk < SAFE_SETTINGS_KEYS.length; sk++) {
    var k = SAFE_SETTINGS_KEYS[sk];
    if (restoredSettings[k] !== undefined) {
      setSetting_(ss, k, restoredSettings[k]);
    }
  }
  if (restoredLogoFileId) {
    setSetting_(ss, 'company_logo_file_id', restoredLogoFileId);
  }
  setSetting_(ss, 'reminders_paused_after_restore', '1');
  bumpSyncRevision_(ss);

  return {
    restored: true,
    summary: summary,
    supervisors_needing_password_reset: supervisorsNeedingReset,
    message: 'Backup restored successfully. Existing job assignments were preserved. ' +
      (supervisorsNeedingReset.length > 0
        ? 'Reset passwords for restored supervisor accounts in Supervisors before they sign in.'
        : 'All records verified.')
  };
}

function recordBackupHistoryGas_(ss, rec) {
  var now = getNowDhakaTimestamp_();
  var entry = {
    backup_id: makeUid_('BKP'),
    source: String(rec.source || 'secondary_drive'),
    status: rec.status === 'verified' ? 'verified' : 'failed',
    file_name: String(rec.file_name || ''),
    drive_file_id: String(rec.drive_file_id || ''),
    drive_account_email: String(rec.drive_account_email || ''),
    folder_name: String(rec.folder_name || 'SUNVILOZ Clean Care Backups'),
    size_bytes: Number(rec.size_bytes || 0),
    checksum_sha256: String(rec.checksum_sha256 || ''),
    error_message: String(rec.error_message || ''),
    created_by: String(rec.created_by || 'Admin'),
    created_at: now
  };
  appendSheetObject_(ss, 'BackupHistory', entry);

  // Only update last_verified_* on verified success; preserve last verified copy on failure!
  if (entry.status === 'verified') {
    setSetting_(ss, 'last_verified_backup_at', now);
    setSetting_(ss, 'last_verified_backup_file', entry.file_name);
    setSetting_(ss, 'last_backup_error', '');
  } else {
    setSetting_(ss, 'last_backup_error', entry.error_message || 'Backup failed');
  }
  return entry;
}

/**
 * Configures the Secondary Google Drive Apps Script bridge credentials in Script Properties
 * (server-only storage; NEVER sent to the APK or included in backups).
 */
function configureSecondaryBackupBridge_(ss, secondaryEmail, webappUrl, sharedSecret, autoEnabled, autoHour) {
  var primaryOwner = String(getSettingsMap_(ss).primary_owner_google_email || getEffectiveOwnerEmail_() || '').trim().toLowerCase();
  var secEmail = String(secondaryEmail || '').trim().toLowerCase();
  if (secEmail && primaryOwner && secEmail === primaryOwner) {
    throw new Error('The primary Google account cannot be used as the secondary backup destination. Choose a different Google account.');
  }
  if (secEmail) setSetting_(ss, 'secondary_drive_email', secEmail);
  var props = PropertiesService.getScriptProperties();
  if (webappUrl !== undefined) props.setProperty('SECONDARY_BACKUP_WEBAPP_URL', String(webappUrl || '').trim());
  if (sharedSecret !== undefined && String(sharedSecret || '').trim().length > 0) {
    props.setProperty('SECONDARY_BACKUP_SECRET', String(sharedSecret).trim());
  }
  if (autoEnabled !== undefined) setSetting_(ss, 'auto_backup_enabled', autoEnabled ? '1' : '0');
  if (autoHour !== undefined) setSetting_(ss, 'auto_backup_hour', String(parseInt(String(autoHour), 10) || 2));
}

function executeScheduledSecondaryBackupGas_(ss, triggeredBy) {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('SECONDARY_BACKUP_WEBAPP_URL') || '').trim();
  var secret = String(props.getProperty('SECONDARY_BACKUP_SECRET') || '').trim();
  var settings = getSettingsMap_(ss);

  if (!url || !secret) {
    return recordBackupHistoryGas_(ss, {
      source: 'scheduled_secondary_drive',
      status: 'failed',
      file_name: '',
      drive_account_email: settings.secondary_drive_email || '',
      error_message: 'Secondary Drive backup bridge URL or secret is not configured in Apps Script.',
      created_by: triggeredBy || 'Daily Scheduler'
    });
  }

  try {
    var pkg = buildSanitizedBackupPackage_(ss, triggeredBy || 'Daily Scheduler');
    var stamp = Utilities.formatDate(new Date(), SUNVILOZ_CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmmss');
    var fileName = 'sunviloz_backup_' + stamp + '.json';

    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'save_secondary_backup',
        secret: secret,
        payload: {
          folder_name: settings.secondary_drive_folder_name || 'SUNVILOZ Clean Care Backups',
          file_name: fileName,
          expected_checksum_sha256: pkg.checksum_sha256,
          backup: pkg
        }
      }),
      muteHttpExceptions: true
    });

    var parsed = JSON.parse(resp.getContentText() || '{}');
    if (resp.getResponseCode() !== 200 || !parsed.ok || !parsed.data || !parsed.data.file_id) {
      throw new Error(parsed.error || ('Secondary Drive bridge returned HTTP ' + resp.getResponseCode()));
    }

    var primaryOwner = String(settings.primary_owner_google_email || getEffectiveOwnerEmail_() || '').trim().toLowerCase();
    var returnedEmail = String(parsed.data.account_email || settings.secondary_drive_email || '').trim().toLowerCase();
    if (primaryOwner && returnedEmail && returnedEmail === primaryOwner) {
      throw new Error('Rejected backup: secondary bridge is deployed under the same primary Google account.');
    }

    if (parsed.data.verified_checksum && !constantTimeEqual_(parsed.data.verified_checksum, pkg.checksum_sha256)) {
      throw new Error('Secondary Drive checksum verification failed after upload.');
    }

    if (returnedEmail) setSetting_(ss, 'secondary_drive_email', returnedEmail);
    setSetting_(ss, 'last_auto_backup_date', getTodayDhakaIso_());

    return recordBackupHistoryGas_(ss, {
      source: 'scheduled_secondary_drive',
      status: 'verified',
      file_name: parsed.data.file_name || fileName,
      drive_file_id: parsed.data.file_id,
      drive_account_email: returnedEmail,
      folder_name: parsed.data.folder_name || settings.secondary_drive_folder_name,
      size_bytes: Number(parsed.data.size_bytes || 0),
      checksum_sha256: pkg.checksum_sha256,
      created_by: triggeredBy || 'Daily Scheduler'
    });
  } catch (err) {
    return recordBackupHistoryGas_(ss, {
      source: 'scheduled_secondary_drive',
      status: 'failed',
      file_name: '',
      drive_account_email: settings.secondary_drive_email || '',
      error_message: err && err.message ? err.message : String(err),
      created_by: triggeredBy || 'Daily Scheduler'
    });
  }
}
