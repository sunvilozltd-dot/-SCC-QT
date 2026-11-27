/**
 * SUNVILOZ Clean Care — Database, Drive Storage, Locks & Helpers (Database.gs)
 *
 * Authoritative backend storage using ONLY the owner's private Google Sheet and
 * private Google Drive folders under the primary Google account.
 * All business dates use Asia/Dhaka (UTC+6); all currency amounts are BDT.
 */

var SUNVILOZ_CONFIG = {
  TIMEZONE: 'Asia/Dhaka',
  SPREADSHEET_NAME: 'SUNVILOZ Clean Care — Master Database (Private)',
  DRIVE_ROOT_FOLDER: 'SUNVILOZ Clean Care — Private Storage',
  SUBFOLDER_LOGO: 'Logo',
  SUBFOLDER_PADS: 'DocumentPads',
  SUBFOLDER_PDFS: 'IssuedPDFs',
  SUBFOLDER_BACKUPS: 'Backups',
  INITIAL_ADMIN_ID: 'ADM-PRIMARY',
  INITIAL_ADMIN_USERNAME: 'scc@gmail.com',
  FIXED_RECOVERY_EMAIL: 'sunvilozltd@gmail.com',
  DEFAULT_SERVICES: [
    'Overhead Tank Cleaning',
    'Reserve Tank Cleaning',
    'Overhead & Reserve Tank Cleaning',
    'Pipeline Cleaning',
    'Full Package'
  ]
};

/**
 * Additive-only schema definitions: existing columns stay in their original positions
 * so pre-existing SUNVILOZ Google Sheets remain 100% compatible without data loss.
 */
var SHEET_SCHEMAS = {
  Accounts: [
    'id', 'role', 'name', 'username', 'phone_display', 'password_hash',
    'is_active', 'token_version', 'created_at', 'updated_at'
  ],
  Sessions: [
    'session_id', 'user_id', 'device_id', 'device_label', 'token_version',
    'created_at', 'last_seen_at', 'expires_at', 'revoked_at', 'revoked_reason'
  ],
  AuthCodes: [
    'code_id', 'purpose', 'target_account_id', 'recipient_email', 'code_verifier',
    'expires_at_ms', 'attempt_count', 'max_attempts', 'used_at', 'invalidated_at',
    'created_at_ms', 'created_at'
  ],
  RequestLocks: [
    'request_id', 'actor_id', 'action', 'status_code', 'response_json', 'created_at'
  ],
  Orders: [
    'order_id', 'booking_date', 'lead_id', 'customer_id', 'building_id',
    'customer_name', 'phone_display', 'phone_e164', 'address', 'area',
    'service_type', 'price_bdt', 'scheduled_date', 'scheduled_time',
    'status', 'status_locked', 'status_locked_at',
    'assigned_supervisor_id', 'assigned_supervisor_name',
    'advance_given', 'advance_supervisor_id', 'advance_supervisor_name', 'advance_given_at',
    'completion_date', 'completed_at', 'completed_by_user_id', 'completed_by_name',
    'full_bill_collected', 'payment_collected_at', 'collected_by_name',
    'transport_cost', 'meals_cost', 'other_expenses_json', 'other_expenses_total',
    'worker_pay_total', 'actual_expenses', 'job_profit', 'supervisor_settlement',
    'settlement_confirmed', 'settlement_confirmed_at', 'settlement_confirmed_by',
    'followup_date', 'followup_rule_note', 'followup_version',
    'reminder_sent', 'reminder_sent_at', 'reminder_sent_for_date', 'reminder_sent_version',
    'followup_done', 'followup_done_at',
    'is_no_charge_visit', 'parent_order_id', 'complaint_id', 'return_visit_reason',
    'notes', 'created_at', 'updated_at',
    // Additive v3.2 web parity columns
    'quotation_id', 'receipt_id', 'previous_order_id', 'previous_work_date',
    'followup_converted_order_id', 'building_name', 'services_json',
    'estimated_duration_mins', 'scheduled_end_time', 'instructions',
    'lead_source', 'referral_contact_type', 'referral_contact_name', 'referral_contact_phone',
    'is_return_visit', 'supervisor_paid_worker_total', 'return_visit_expenses_total',
    'settlement_actual_total', 'settlement_remaining', 'settlement_status', 'settlement_note'
  ],
  StatusHistory: [
    'history_id', 'order_id', 'from_status', 'to_status', 'note', 'actor_name', 'created_at'
  ],
  Customers: [
    'customer_id', 'name', 'phone_display', 'phone_e164', 'alt_phone',
    'address', 'area', 'notes', 'created_at', 'updated_at',
    // Additive v3.2
    'lead_source'
  ],
  Buildings: [
    'building_id', 'customer_id', 'name', 'address', 'area',
    'overhead_tank_count', 'overhead_tank_capacity_liters',
    'reserve_tank_count', 'reserve_tank_capacity_liters',
    'floors', 'caretaker_name', 'caretaker_phone', 'access_notes',
    'created_at', 'updated_at',
    // Additive v3.2
    'maps_url', 'access_instructions', 'overhead_tank_qty', 'overhead_tank_capacity_litres',
    'overhead_tank_material', 'reserve_tank_qty', 'reserve_tank_capacity_litres',
    'reserve_tank_material', 'tank_notes'
  ],
  Leads: [
    'lead_id', 'customer_name', 'phone_display', 'phone_e164', 'address', 'area',
    'service_type', 'quoted_price_bdt', 'channel', 'stage',
    'followup_date', 'followup_done', 'followup_done_at',
    'agent_name', 'agent_phone_display', 'agent_note',
    'caretaker_name', 'caretaker_phone_display', 'caretaker_note',
    'converted_order_id', 'notes', 'created_at', 'updated_at',
    // Additive v3.2
    'building_org', 'contact_role', 'interested_services_json', 'lead_source',
    'referral_contact_type', 'followup_version', 'reminder_sent', 'reminder_sent_at',
    'reminder_sent_for_date', 'reminder_sent_version', 'linked_quotation_id',
    'agent_phone_e164', 'caretaker_phone_e164'
  ],
  LeadNotes: [
    'note_id', 'lead_id', 'note', 'actor_name', 'created_at',
    // Additive v3.2
    'channel'
  ],
  Quotations: [
    'quotation_id', 'quotation_number', 'lead_id', 'customer_id', 'building_id',
    'customer_name', 'phone_display', 'address', 'area',
    'items_json', 'subtotal_bdt', 'discount_bdt', 'total_bdt',
    'valid_until', 'followup_date', 'status', 'converted_order_id',
    'notes', 'pdf_file_id', 'created_at', 'updated_at',
    // Additive v3.2
    'phone_e164', 'quotation_date', 'discount_enabled', 'discount_type', 'discount_value',
    'vat_enabled', 'vat_type', 'vat_value', 'vat_base', 'vat_bdt',
    'tax_enabled', 'tax_type', 'tax_value', 'tax_base', 'tax_bdt',
    'terms', 'lead_source', 'referral_contact_type', 'referral_contact_name',
    'referral_contact_phone', 'status_changed_at', 'status_history_json',
    'followup_note', 'followup_done', 'followup_done_at', 'share_url', 'pad_snapshot_json'
  ],
  Receipts: [
    'receipt_id', 'receipt_number', 'order_id', 'customer_name', 'phone_display',
    'address', 'service_type', 'amount_bdt', 'payment_method', 'payment_date',
    'received_by', 'notes', 'pdf_file_id', 'created_at',
    // Additive v3.2
    'transaction_ref', 'pad_snapshot_json'
  ],
  Workers: [
    'worker_id', 'name', 'phone_display', 'role_label', 'default_daily_wage_bdt',
    'is_active', 'notes', 'created_at', 'updated_at',
    // Additive v3.2
    'phone_e164'
  ],
  OrderWorkers: [
    'assignment_id', 'order_id', 'worker_id', 'worker_name',
    'wage_bdt', 'confirmed', 'paid', 'paid_at', 'paid_by', 'payment_note',
    'created_at', 'updated_at',
    // Additive v3.2
    'paid_amount_bdt', 'payment_date', 'payment_method', 'paid_by_role', 'payment_reference'
  ],
  WorkerPayHistory: [
    'pay_history_id', 'assignment_id', 'order_id', 'worker_id', 'worker_name',
    'amount_bdt', 'action_type', 'note', 'actor_name', 'created_at',
    // Additive v3.2
    'payment_date', 'payment_method', 'paid_by_role', 'reference'
  ],
  SettlementEntries: [
    'entry_id', 'order_id', 'supervisor_id', 'supervisor_name',
    'amount_bdt', 'direction', 'payment_method', 'entry_date',
    'note', 'recorded_by', 'created_at',
    // Additive v3.2
    'entry_type', 'entry_datetime', 'reference'
  ],
  Complaints: [
    'complaint_id', 'order_id', 'customer_name', 'phone_display',
    'description', 'status', 'return_visit_order_id', 'resolution_note',
    'created_at', 'updated_at',
    // Additive v3.2
    'complaint_date', 'action_taken', 'is_no_charge', 'created_by'
  ],
  OverheadExpenses: [
    'expense_id', 'expense_date', 'category', 'description', 'amount_bdt',
    'payment_method', 'recorded_by', 'created_at', 'updated_at'
  ],
  DocumentPads: [
    'pad_type', 'file_name', 'mime_type', 'drive_file_id',
    'fields_json', 'updated_by', 'updated_at',
    // Additive v3.2
    'version', 'page_width_mm', 'page_height_mm'
  ],
  IssuedPdfs: [
    'pdf_id', 'doc_type', 'doc_id', 'doc_number', 'file_name',
    'drive_file_id', 'size_bytes', 'issued_by', 'created_at'
  ],
  ReminderLog: [
    'log_id', 'order_id', 'followup_date', 'followup_version', 'recipient_email',
    'status', 'error_message', 'sent_at',
    // Additive v3.2
    'dedupe_key', 'customer_name', 'phone_display', 'services_text', 'completion_date', 'send_type'
  ],
  BackupHistory: [
    'backup_id', 'source', 'status', 'file_name', 'drive_file_id',
    'drive_account_email', 'folder_name', 'size_bytes', 'checksum_sha256',
    'error_message', 'created_by', 'created_at'
  ],
  Settings: [
    'key', 'value', 'updated_at'
  ]
};

function getNowDhakaTimestamp_() {
  return Utilities.formatDate(new Date(), SUNVILOZ_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function getTodayDhakaIso_() {
  return Utilities.formatDate(new Date(), SUNVILOZ_CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function addDaysIso_(isoDate, days) {
  var parts = String(isoDate || '').split('-');
  if (parts.length !== 3) return getTodayDhakaIso_();
  var d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function addCalendarMonthsIso_(isoDate, months) {
  var parts = String(isoDate || '').split('-');
  if (parts.length !== 3) return getTodayDhakaIso_();
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10) - 1;
  var day = parseInt(parts[2], 10);
  var targetMonthTotal = y * 12 + m + Number(months || 0);
  var targetYear = Math.floor(targetMonthTotal / 12);
  var targetMonth = targetMonthTotal - targetYear * 12;
  var lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  var clampedDay = Math.min(day, lastDay);
  var d = new Date(Date.UTC(targetYear, targetMonth, clampedDay));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function isValidIsoDate_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function makeUid_(prefix) {
  var raw = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  return prefix + '-' + raw;
}

function normalizePhoneBD_(raw) {
  var digits = String(raw || '').replace(/[^\d+]/g, '');
  var clean = digits.replace(/^\+/, '');
  if (clean.indexOf('880') === 0 && clean.length === 13) {
    return { display: '0' + clean.slice(3), e164: '+' + clean };
  }
  if (clean.indexOf('01') === 0 && clean.length === 11) {
    return { display: clean, e164: '+88' + clean };
  }
  return { display: String(raw || '').trim(), e164: digits ? (digits.charAt(0) === '+' ? digits : '+' + digits) : '' };
}

function parseNonNegativeAmount_(value, label) {
  var num = Number(value);
  if (!isFinite(num) || num < 0) {
    throw new Error((label || 'Amount') + ' must be a valid non-negative number.');
  }
  return Math.round(num * 100) / 100;
}

function getEffectiveOwnerEmail_() {
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (err) {
    return '';
  }
}

function getOrCreatePrivateFolder_(name, parentFolder) {
  var iter = parentFolder ? parentFolder.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  while (iter.hasNext()) {
    var folder = iter.next();
    if (!folder.isTrashed()) {
      return folder;
    }
  }
  var created = parentFolder ? parentFolder.createFolder(name) : DriveApp.createFolder(name);
  try {
    created.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (err) {
    // Folder defaults to private in owner's Drive
  }
  return created;
}

function getPrivateDriveFolders_() {
  var props = PropertiesService.getScriptProperties();
  var rootId = props.getProperty('DRIVE_ROOT_FOLDER_ID');
  var root = null;
  if (rootId) {
    try {
      root = DriveApp.getFolderById(rootId);
      if (root.isTrashed()) root = null;
    } catch (err) {
      root = null;
    }
  }
  if (!root) {
    root = getOrCreatePrivateFolder_(SUNVILOZ_CONFIG.DRIVE_ROOT_FOLDER, null);
    props.setProperty('DRIVE_ROOT_FOLDER_ID', root.getId());
  }

  var logo = getOrCreatePrivateFolder_(SUNVILOZ_CONFIG.SUBFOLDER_LOGO, root);
  var pads = getOrCreatePrivateFolder_(SUNVILOZ_CONFIG.SUBFOLDER_PADS, root);
  var pdfs = getOrCreatePrivateFolder_(SUNVILOZ_CONFIG.SUBFOLDER_PDFS, root);
  var backups = getOrCreatePrivateFolder_(SUNVILOZ_CONFIG.SUBFOLDER_BACKUPS, root);

  return {
    root: root,
    logo: logo,
    pads: pads,
    pdfs: pdfs,
    backups: backups
  };
}

function enforcePrivateSharing_(fileOrFolder) {
  try {
    fileOrFolder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (err) {
    // Files and folders created in My Drive default to private
  }
}

function isCompatibleSunvilozSpreadsheet_(ss) {
  if (!ss) return false;
  var hasAccounts = !!ss.getSheetByName('Accounts');
  var hasOrders = !!ss.getSheetByName('Orders');
  var hasSettings = !!ss.getSheetByName('Settings');
  return hasAccounts || hasOrders || hasSettings;
}

function findExistingCompatibleSpreadsheet_(folders) {
  var fallbackSs = null;

  var folderFiles = folders.root.getFilesByName(SUNVILOZ_CONFIG.SPREADSHEET_NAME);
  while (folderFiles.hasNext()) {
    var f = folderFiles.next();
    if (f.isTrashed && f.isTrashed()) continue;
    try {
      var candidate = SpreadsheetApp.openById(f.getId());
      if (isCompatibleSunvilozSpreadsheet_(candidate)) {
        enforcePrivateSharing_(f);
        return candidate;
      }
      if (!fallbackSs) fallbackSs = candidate;
    } catch (err) {}
  }

  if (typeof DriveApp.getFilesByName === 'function') {
    var allFiles = DriveApp.getFilesByName(SUNVILOZ_CONFIG.SPREADSHEET_NAME);
    while (allFiles.hasNext()) {
      var df = allFiles.next();
      if (df.isTrashed && df.isTrashed()) continue;
      try {
        var mime = df.getMimeType ? df.getMimeType() : '';
        if (mime && mime !== 'application/vnd.google-apps.spreadsheet') continue;
        var driveCandidate = SpreadsheetApp.openById(df.getId());
        if (isCompatibleSunvilozSpreadsheet_(driveCandidate)) {
          enforcePrivateSharing_(df);
          return driveCandidate;
        }
        if (!fallbackSs) fallbackSs = driveCandidate;
      } catch (err2) {}
    }
  }

  return fallbackSs;
}

var SCHEMA_VERIFIED_VERSION_ = '3.2';

var DATE_ONLY_COLUMNS_ = {
  booking_date: true,
  scheduled_date: true,
  completion_date: true,
  followup_date: true,
  entry_date: true,
  valid_until: true,
  expense_date: true,
  payment_date: true,
  reminder_sent_for_date: true,
  quotation_date: true,
  complaint_date: true,
  previous_work_date: true
};

var TIME_ONLY_COLUMNS_ = {
  scheduled_time: true,
  scheduled_end_time: true
};

var PHONE_DISPLAY_COLUMNS_ = {
  phone_display: true,
  caretaker_phone: true,
  agent_phone_display: true,
  caretaker_phone_display: true,
  referral_contact_phone: true
};

var PHONE_E164_COLUMNS_ = {
  phone_e164: true,
  agent_phone_e164: true,
  caretaker_phone_e164: true
};

function escapeSheetCellValue_(val) {
  if (val === undefined || val === null) return '';
  if (typeof val !== 'string') return val;
  if (val === '') return '';
  var ch = val.charAt(0);
  if (
    ch === "'" || ch === '=' || ch === '+' || ch === '-' || ch === '@' ||
    (ch >= '0' && ch <= '9') ||
    /^(true|false)$/i.test(val)
  ) {
    return "'" + val;
  }
  return val;
}

function normalizeReadCellValue_(key, val) {
  if (val === undefined || val === null) return '';
  if (val instanceof Date || Object.prototype.toString.call(val) === '[object Date]') {
    if (DATE_ONLY_COLUMNS_[key]) {
      return Utilities.formatDate(val, SUNVILOZ_CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
    if (TIME_ONLY_COLUMNS_[key]) {
      return Utilities.formatDate(val, SUNVILOZ_CONFIG.TIMEZONE, 'HH:mm');
    }
    return Utilities.formatDate(val, SUNVILOZ_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  }
  if (PHONE_DISPLAY_COLUMNS_[key]) {
    var ps = String(val).trim();
    if (ps === '') return '';
    if (/^1[3-9]\d{8}$/.test(ps)) {
      return '0' + ps;
    }
    return ps;
  }
  if (PHONE_E164_COLUMNS_[key]) {
    var pe = String(val).trim();
    if (pe === '') return '';
    if (/^8801[3-9]\d{8}$/.test(pe)) {
      return '+' + pe;
    }
    return pe;
  }
  if (DATE_ONLY_COLUMNS_[key] && typeof val === 'string' && val.length > 10 && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    return val.slice(0, 10);
  }
  return val;
}

function getOrCreateSpreadsheet_(forceEnsureSchema) {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('MASTER_SPREADSHEET_ID');
  var schemaVerified = props.getProperty('SCHEMA_VERIFIED_VERSION') === SCHEMA_VERIFIED_VERSION_;
  var ss = null;

  if (ssId && !forceEnsureSchema && schemaVerified) {
    try {
      return SpreadsheetApp.openById(ssId);
    } catch (fastErr) {
      ss = null;
    }
  }

  if (ssId) {
    try {
      var existingFile = DriveApp.getFileById(ssId);
      if (!existingFile.isTrashed || !existingFile.isTrashed()) {
        ss = SpreadsheetApp.openById(ssId);
        enforcePrivateSharing_(existingFile);
      }
    } catch (err) {
      ss = null;
    }
  }
  if (!ss) {
    var folders = getPrivateDriveFolders_();
    ss = findExistingCompatibleSpreadsheet_(folders);
    if (!ss) {
      ss = SpreadsheetApp.create(SUNVILOZ_CONFIG.SPREADSHEET_NAME);
      ss.setSpreadsheetTimeZone(SUNVILOZ_CONFIG.TIMEZONE);
      var file = DriveApp.getFileById(ss.getId());
      enforcePrivateSharing_(file);
      try {
        folders.root.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      } catch (err2) {
        try { file.moveTo(folders.root); } catch (err3) {}
      }
    }
    props.setProperty('MASTER_SPREADSHEET_ID', ss.getId());
  }
  ensureAllSheets_(ss);
  props.setProperty('SCHEMA_VERIFIED_VERSION', SCHEMA_VERIFIED_VERSION_);
  return ss;
}

function ensureAllSheets_(ss) {
  var names = Object.keys(SHEET_SCHEMAS);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var headers = SHEET_SCHEMAS[name];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else {
      var lastCol = Math.max(sheet.getLastColumn(), 1);
      var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var missing = [];
      for (var c = 0; c < headers.length; c++) {
        if (existingHeaders.indexOf(headers[c]) === -1) {
          missing.push(headers[c]);
        }
      }
      if (missing.length > 0) {
        var startCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
        if (ss._headerCache) delete ss._headerCache[name];
      }
    }
  }
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    try { ss.deleteSheet(defaultSheet); } catch (err) {}
  }
}

function readSheetObjects_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var result = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var empty = true;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || '').trim();
      if (!key) continue;
      var val = row[c];
      if (val !== '' && val !== null && val !== undefined) empty = false;
      obj[key] = normalizeReadCellValue_(key, val);
    }
    if (!empty) {
      obj._rowIndex = r + 1;
      result.push(obj);
    }
  }
  return result;
}

function getSheetHeadersFast_(ss, sheet, sheetName) {
  if (!ss._headerCache) ss._headerCache = {};
  if (ss._headerCache[sheetName]) return ss._headerCache[sheetName];
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    : (SHEET_SCHEMAS[sheetName] || []);
  ss._headerCache[sheetName] = headers;
  return headers;
}

function appendSheetObject_(ss, sheetName, obj) {
  var sheet = ss.getSheetByName(sheetName);
  var headers = getSheetHeadersFast_(ss, sheet, sheetName);
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i] || '').trim();
    var val = obj[key];
    row.push(escapeSheetCellValue_(val));
  }
  sheet.appendRow(row);
  return obj;
}

function updateSheetObjectByKey_(ss, sheetName, keyColumn, keyValue, patchObj) {
  var sheet = ss.getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return null;
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var keyIdx = headers.indexOf(keyColumn);
  if (keyIdx === -1) return null;

  var target = String(keyValue);
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][keyIdx]) === target) {
      var nextRow = [];
      var updatedObj = {};
      for (var c = 0; c < headers.length; c++) {
        var colName = String(headers[c] || '').trim();
        var rawVal;
        if (Object.prototype.hasOwnProperty.call(patchObj, colName)) {
          rawVal = patchObj[colName] === undefined || patchObj[colName] === null ? '' : patchObj[colName];
          nextRow.push(escapeSheetCellValue_(rawVal));
        } else {
          rawVal = normalizeReadCellValue_(colName, values[r][c]);
          nextRow.push(escapeSheetCellValue_(rawVal));
        }
        updatedObj[colName] = rawVal;
      }
      sheet.getRange(r + 1, 1, 1, headers.length).setValues([nextRow]);
      return updatedObj;
    }
  }
  return null;
}

function deleteSheetRowsByKey_(ss, sheetName, keyColumn, keyValue) {
  var sheet = ss.getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return 0;
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var keyIdx = headers.indexOf(keyColumn);
  if (keyIdx === -1) return 0;

  var target = String(keyValue);
  var deleted = 0;
  for (var r = values.length - 1; r >= 1; r--) {
    if (String(values[r][keyIdx]) === target) {
      sheet.deleteRow(r + 1);
      deleted++;
    }
  }
  return deleted;
}

function replaceSheetRows_(ss, sheetName, rowsArray) {
  var sheet = ss.getSheetByName(sheetName);
  var headers = SHEET_SCHEMAS[sheetName];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  if (ss._headerCache) ss._headerCache[sheetName] = headers;
  if (!rowsArray || rowsArray.length === 0) return;
  var matrix = [];
  for (var i = 0; i < rowsArray.length; i++) {
    var rec = rowsArray[i];
    var row = [];
    for (var c = 0; c < headers.length; c++) {
      var val = rec[headers[c]];
      row.push(escapeSheetCellValue_(val));
    }
    matrix.push(row);
  }
  sheet.getRange(2, 1, matrix.length, headers.length).setValues(matrix);
}

function getSettingsMap_(ss) {
  var rows = readSheetObjects_(ss, 'Settings');
  var map = {
    admin_password_initialized: '0',
    default_followup_value: '6',
    default_followup_unit: 'months',
    reminder_email: SUNVILOZ_CONFIG.FIXED_RECOVERY_EMAIL,
    primary_owner_google_email: getEffectiveOwnerEmail_() || SUNVILOZ_CONFIG.FIXED_RECOVERY_EMAIL,
    daily_reminder_hour: '9',
    schedule_conflict_buffer_mins: '30',
    order_sequence: '0',
    quotation_sequence: '0',
    receipt_sequence: '0',
    lead_sequence: '0',
    sync_revision: '1',
    reminder_trigger_status: 'Not Configured',
    reminders_paused_after_restore: '0',
    company_logo_file_id: '',
    company_logo_file_name: '',
    company_logo_mime_type: '',
    company_logo_updated_at: '',
    secondary_drive_email: '',
    secondary_drive_folder_name: 'SUNVILOZ Clean Care Backups',
    auto_backup_enabled: '0',
    auto_backup_hour: '2',
    last_verified_backup_at: '',
    last_verified_backup_file: '',
    last_backup_error: '',
    last_auto_backup_date: '',
    primary_drive_last_snapshot_at: '',
    primary_drive_last_snapshot_file_id: '',
    primary_drive_last_checksum: ''
  };
  for (var i = 0; i < rows.length; i++) {
    var k = String(rows[i].key || '').trim();
    if (k) map[k] = String(rows[i].value === undefined || rows[i].value === null ? '' : rows[i].value);
  }
  return map;
}

function setSetting_(ss, key, value) {
  var now = getNowDhakaTimestamp_();
  var valStr = String(value === undefined || value === null ? '' : value);
  var updated = updateSheetObjectByKey_(ss, 'Settings', 'key', key, {
    key: key,
    value: valStr,
    updated_at: now
  });
  if (!updated) {
    appendSheetObject_(ss, 'Settings', {
      key: key,
      value: valStr,
      updated_at: now
    });
  }
}

function incrementSequence_(ss, settingKey) {
  var settings = getSettingsMap_(ss);
  var next = (parseInt(settings[settingKey] || '0', 10) || 0) + 1;
  setSetting_(ss, settingKey, String(next));
  return next;
}

function incrementSequenceAndSync_(ss, settingKey) {
  var sheet = ss.getSheetByName('Settings');
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 3);
  var values = lastRow >= 2 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [['key', 'value', 'updated_at']];
  var headers = values[0];
  var keyIdx = headers.indexOf('key');
  var valIdx = headers.indexOf('value');
  var now = getNowDhakaTimestamp_();

  var seqRowIdx = -1;
  var syncRowIdx = -1;
  var curSeq = 0;
  var curSync = 1;

  for (var r = 1; r < values.length; r++) {
    var k = String(values[r][keyIdx] || '').trim();
    if (k === settingKey) {
      seqRowIdx = r;
      curSeq = parseInt(String(values[r][valIdx] || '0'), 10) || 0;
    } else if (k === 'sync_revision') {
      syncRowIdx = r;
      curSync = parseInt(String(values[r][valIdx] || '1'), 10) || 1;
    }
  }

  var nextSeq = curSeq + 1;
  var nextSync = curSync + 1;

  if (seqRowIdx >= 0) {
    sheet.getRange(seqRowIdx + 1, 1, 1, 3).setValues([[settingKey, escapeSheetCellValue_(String(nextSeq)), escapeSheetCellValue_(now)]]);
  } else {
    sheet.appendRow([settingKey, escapeSheetCellValue_(String(nextSeq)), escapeSheetCellValue_(now)]);
  }

  if (syncRowIdx >= 0) {
    sheet.getRange(syncRowIdx + 1, 1, 1, 3).setValues([['sync_revision', escapeSheetCellValue_(String(nextSync)), escapeSheetCellValue_(now)]]);
  } else {
    sheet.appendRow(['sync_revision', escapeSheetCellValue_(String(nextSync)), escapeSheetCellValue_(now)]);
  }

  return nextSeq;
}

function bumpSyncRevision_(ss) {
  var settings = getSettingsMap_(ss);
  var next = (parseInt(settings.sync_revision || '1', 10) || 1) + 1;
  setSetting_(ss, 'sync_revision', String(next));
  return next;
}

function saveBase64FileToDrive_(folder, fileName, mimeType, base64Data, previousFileId) {
  var cleanBase64 = String(base64Data || '').replace(/^data:[^;]+;base64,/, '');
  var bytes = Utilities.base64Decode(cleanBase64);
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName);
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (err) {}
  if (previousFileId) {
    try {
      DriveApp.getFileById(previousFileId).setTrashed(true);
    } catch (err2) {}
  }
  return {
    file_id: file.getId(),
    file_name: file.getName(),
    size_bytes: file.getSize()
  };
}

function readDriveFileAsBase64_(fileId) {
  if (!fileId) return '';
  try {
    var file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) return '';
    return Utilities.base64Encode(file.getBlob().getBytes());
  } catch (err) {
    return '';
  }
}

function readDriveFileAsDataUrl_(fileId, fallbackMime) {
  if (!fileId) return '';
  var cacheKey = 'DRIVE_DATAURL_' + String(fileId);
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      var cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) return cached;
    }
  } catch (cacheErr) {}
  try {
    var file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) return '';
    var blob = file.getBlob();
    var mime = blob.getContentType() || fallbackMime || 'application/octet-stream';
    var b64 = Utilities.base64Encode(blob.getBytes());
    var dataUrl = 'data:' + mime + ';base64,' + b64;
    try {
      if (dataUrl.length < 95000 && typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
        CacheService.getScriptCache().put(cacheKey, dataUrl, 21600);
      }
    } catch (cachePutErr) {}
    return dataUrl;
  } catch (err) {
    return '';
  }
}

function getIdempotentResponse_(ss, requestId, actorId, action) {
  if (!requestId) return null;
  var rows = readSheetObjects_(ss, 'RequestLocks');
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (String(r.request_id) === String(requestId) &&
        String(r.actor_id) === String(actorId) &&
        String(r.action) === String(action)) {
      try {
        return {
          statusCode: Number(r.status_code || 200),
          body: JSON.parse(String(r.response_json || '{}'))
        };
      } catch (err) {
        return null;
      }
    }
  }
  return null;
}

function storeIdempotentResponse_(ss, requestId, actorId, action, statusCode, bodyObj) {
  if (!requestId) return;
  // Avoid exceeding Google Sheets 50,000-char cell limit by storing a compact cached copy
  var toStore = bodyObj;
  try {
    var serialized = JSON.stringify(bodyObj || {});
    if (serialized.length > 45000 && bodyObj && bodyObj.data && bodyObj.data.bootstrap) {
      var shallowData = {};
      var keys = Object.keys(bodyObj.data);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k] !== 'bootstrap') shallowData[keys[k]] = bodyObj.data[keys[k]];
      }
      shallowData._bootstrapOmitted = true;
      toStore = { ok: bodyObj.ok, data: shallowData };
      serialized = JSON.stringify(toStore);
    }
    if (serialized.length > 45000) {
      serialized = JSON.stringify({ ok: Boolean(bodyObj && bodyObj.ok), data: { message: 'Action completed.' } });
    }
    appendSheetObject_(ss, 'RequestLocks', {
      request_id: String(requestId).slice(0, 120),
      actor_id: String(actorId || 'anon'),
      action: String(action || ''),
      status_code: Number(statusCode || 200),
      response_json: serialized,
      created_at: getNowDhakaTimestamp_()
    });
  } catch (err) {}
}

function computeSha256Hex_(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || ''), Utilities.Charset.UTF_8);
  return bytesToHex_(digest);
}

function bytesToHex_(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] + 256) % 256;
    var h = v.toString(16);
    out.push(h.length === 1 ? '0' + h : h);
  }
  return out.join('');
}

function hexToBytes_(hex) {
  var clean = String(hex || '').trim();
  var out = [];
  for (var i = 0; i < clean.length; i += 2) {
    var b = parseInt(clean.slice(i, i + 2), 16);
    out.push(b > 127 ? b - 256 : b);
  }
  return out;
}

function stringToUtf8Bytes_(str) {
  return Utilities.newBlob(String(str), 'text/plain', 'p').getBytes();
}

function constantTimeEqual_(a, b) {
  var sa = String(a || '');
  var sb = String(b || '');
  var diff = sa.length ^ sb.length;
  var len = Math.max(sa.length, sb.length);
  for (var i = 0; i < len; i++) {
    var ca = i < sa.length ? sa.charCodeAt(i) : 0;
    var cb = i < sb.length ? sb.charCodeAt(i) : 0;
    diff |= (ca ^ cb);
  }
  return diff === 0;
}
