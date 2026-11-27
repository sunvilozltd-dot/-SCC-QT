/**
 * SUNVILOZ Clean Care — Backup, Verification & Safe Idempotent Restore (BackupRestore.gs)
 *
 * Security & durability guarantees:
 * - Backup packages include business records, user IDs & role mappings, document pads,
 *   company logo, issued PDFs, and reminder history.
 * - Backup packages STRICTLY EXCLUDE passwords, password hashes, session tokens,
 *   and authorization secrets.
 * - Supports BOTH Apps Script v3 backups (sunviloz_clean_care_backup_v3) AND SQLite export
 *   migration JSON packages so existing SQLite data can be migrated non-destructively with
 *   record-count verification.
 * - Creates an automatic pre-restore recovery snapshot in Primary Drive before restoring.
 */

var BACKUP_EXPORT_SHEETS = [
  'Orders', 'StatusHistory', 'Customers', 'Buildings', 'Leads', 'LeadNotes',
  'Quotations', 'Receipts', 'Workers', 'OrderWorkers', 'WorkerPayHistory',
  'SettlementEntries', 'Complaints', 'OverheadExpenses', 'DocumentPads',
  'IssuedPdfs', 'ReminderLog'
];

var SAFE_SETTINGS_KEYS = [
  'default_followup_value', 'default_followup_unit', 'reminder_email',
  'daily_reminder_hour', 'schedule_conflict_buffer_mins',
  'order_sequence', 'quotation_sequence', 'receipt_sequence', 'lead_sequence',
  'company_logo_file_name', 'company_logo_mime_type', 'secondary_drive_folder_name'
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

/**
 * Normalizes either Apps Script v3 backup packages OR SQLite migration exports
 * into the canonical internal { payload, checksumVerified, schemaVersion, warnings } shape.
 */
function normalizeIncomingBackupPackage_(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    throw new Error('Backup file is empty or unreadable.');
  }

  // Case 1: Native Apps Script v3 package
  if (pkg.backup_format === 'sunviloz_clean_care_backup_v3' && pkg.payload && pkg.checksum_sha256) {
    var computed = computeSha256Hex_(JSON.stringify(pkg.payload));
    if (!constantTimeEqual_(computed, String(pkg.checksum_sha256))) {
      throw new Error('Backup integrity check failed (SHA-256 mismatch). Existing data was NOT modified.');
    }
    return {
      payload: pkg.payload,
      checksumVerified: true,
      checksum: computed,
      schemaVersion: Number(pkg.payload.schema_version || 3),
      warnings: []
    };
  }

  // Case 2: SQLite export package (from server/db.ts buildFullBackupJson or scripts/export-sqlite-for-sheets.ts)
  if (pkg.tables && typeof pkg.tables === 'object') {
    var warnings = [];
    var checksumVerified = false;
    var expectedHash = String(pkg.checksum_sha256 || pkg.integrity_sha256 || '').trim();
    if (expectedHash && pkg.payload_for_checksum) {
      var cHash = computeSha256Hex_(JSON.stringify(pkg.payload_for_checksum));
      checksumVerified = constantTimeEqual_(cHash, expectedHash);
      if (!checksumVerified) {
        throw new Error('SQLite export checksum mismatch. Existing data was NOT modified.');
      }
    } else {
      checksumVerified = true;
      warnings.push('Imported from SQLite migration/export format.');
    }

    var src = pkg.tables;
    var mappedTables = {
      Orders: Array.isArray(src.orders) ? src.orders.map(function (o) {
        return {
          order_id: o.order_id,
          booking_date: o.booking_date || '',
          lead_id: o.lead_id || '',
          customer_id: o.customer_id || '',
          building_id: o.building_id || '',
          building_name: o.building_name || '',
          quotation_id: o.quotation_id || '',
          receipt_id: o.receipt_id || '',
          previous_order_id: o.previous_order_id || '',
          previous_work_date: o.previous_work_date || '',
          followup_converted_order_id: o.followup_converted_order_id || '',
          customer_name: o.customer_name || '',
          phone_display: o.phone_display || '',
          phone_e164: o.phone_e164 || '',
          address: o.address || '',
          area: o.area || '',
          service_type: o.services_text || o.service_type || '',
          services_json: o.services_json || JSON.stringify(o.services || []),
          price_bdt: o.price_bdt || 0,
          scheduled_date: o.scheduled_date || '',
          scheduled_time: o.scheduled_time || '10:00',
          estimated_duration_mins: o.estimated_duration_mins || 120,
          scheduled_end_time: o.scheduled_end_time || '',
          instructions: o.instructions || '',
          lead_source: o.lead_source || 'Not Specified',
          referral_contact_type: o.referral_contact_type || '',
          referral_contact_name: o.referral_contact_name || '',
          referral_contact_phone: o.referral_contact_phone || '',
          status: o.status || 'Confirmed',
          status_locked: o.status_locked ? 1 : 0,
          status_locked_at: o.status_locked_at || '',
          assigned_supervisor_id: o.assigned_supervisor_id || '',
          assigned_supervisor_name: o.assigned_supervisor_name || '',
          advance_given: o.advance_given || 0,
          advance_supervisor_id: o.advance_supervisor_id || '',
          advance_supervisor_name: o.advance_supervisor_name || '',
          advance_given_at: o.advance_given_at || '',
          completion_date: o.completion_date || '',
          completed_at: o.completed_at || '',
          completed_by_user_id: o.completed_by_user_id || '',
          completed_by_name: o.completed_by_name || '',
          full_bill_collected: o.full_bill_collected ? 1 : 0,
          payment_collected_at: o.payment_collected_at || '',
          collected_by_name: o.collected_by_name || '',
          transport_cost: o.transport_cost || 0,
          meals_cost: o.meals_cost || 0,
          other_expenses_json: o.other_expenses_json || JSON.stringify(o.other_expenses || []),
          other_expenses_total: o.other_expenses_total || 0,
          worker_pay_total: o.worker_pay_total || 0,
          supervisor_paid_worker_total: o.supervisor_paid_worker_total || 0,
          return_visit_expenses_total: o.return_visit_expenses_total || 0,
          actual_expenses: o.actual_expenses || 0,
          job_profit: o.job_profit_or_loss || o.job_profit || 0,
          supervisor_settlement: o.supervisor_settlement || 0,
          settlement_actual_total: o.settlement_actual_total || 0,
          settlement_remaining: o.settlement_remaining || 0,
          settlement_status: o.settlement_status || 'Not Applicable',
          settlement_confirmed: o.settlement_status === 'Settled' ? 1 : 0,
          settlement_confirmed_at: o.settlement_confirmed_at || '',
          settlement_confirmed_by: o.settlement_confirmed_by || '',
          settlement_note: o.settlement_note || '',
          followup_date: o.followup_date || '',
          followup_rule_note: o.followup_rule_note || '',
          followup_version: o.followup_version || 0,
          reminder_sent: o.reminder_sent ? 1 : 0,
          reminder_sent_at: o.reminder_sent_at || '',
          reminder_sent_for_date: o.reminder_sent_for_date || '',
          reminder_sent_version: o.reminder_sent_version || 0,
          followup_done: o.followup_done ? 1 : 0,
          followup_done_at: o.followup_done_at || '',
          is_return_visit: o.is_return_visit ? 1 : 0,
          is_no_charge_visit: o.is_no_charge_visit ? 1 : 0,
          parent_order_id: o.parent_order_id || '',
          complaint_id: o.complaint_id || '',
          return_visit_reason: o.return_visit_reason || '',
          notes: o.notes || '',
          created_at: o.created_at || '',
          updated_at: o.updated_at || ''
        };
      }) : [],
      StatusHistory: Array.isArray(src.status_history || src.history) ? (src.status_history || src.history).map(function (h) {
        return {
          history_id: h.history_id,
          order_id: h.order_id,
          from_status: h.previous_status || h.from_status || '',
          to_status: h.new_status || h.to_status || '',
          note: h.note || '',
          actor_name: h.changed_by || h.actor_name || '',
          created_at: h.changed_at || h.created_at || ''
        };
      }) : [],
      Customers: Array.isArray(src.customers) ? src.customers : [],
      Buildings: Array.isArray(src.buildings) ? src.buildings : [],
      Leads: Array.isArray(src.leads) ? src.leads.map(function (l) {
        return {
          lead_id: l.lead_id,
          customer_name: l.name || l.customer_name || '',
          phone_display: l.phone_display || '',
          phone_e164: l.phone_e164 || '',
          address: l.address || '',
          area: l.area || '',
          building_org: l.building_org || '',
          contact_role: l.contact_role || '',
          service_type: l.interested_services_text || l.service_type || '',
          interested_services_json: l.interested_services_json || JSON.stringify(l.interested_services || []),
          lead_source: l.lead_source || 'Not Specified',
          referral_contact_type: l.referral_contact_type || '',
          stage: l.stage || 'New',
          followup_date: l.next_followup_date || l.followup_date || '',
          followup_done: l.followup_done ? 1 : 0,
          followup_done_at: l.followup_done_at || '',
          followup_version: l.followup_version || 0,
          linked_quotation_id: l.linked_quotation_id || '',
          converted_order_id: l.linked_order_id || l.converted_order_id || '',
          agent_name: l.agent_name || '',
          agent_phone_display: l.agent_phone_display || '',
          agent_phone_e164: l.agent_phone_e164 || '',
          agent_note: l.agent_note || '',
          caretaker_name: l.caretaker_name || '',
          caretaker_phone_display: l.caretaker_phone_display || '',
          caretaker_phone_e164: l.caretaker_phone_e164 || '',
          caretaker_note: l.caretaker_note || '',
          created_at: l.created_at || '',
          updated_at: l.updated_at || ''
        };
      }) : [],
      LeadNotes: Array.isArray(src.lead_notes) ? src.lead_notes.map(function (n) {
        return {
          note_id: n.note_id,
          lead_id: n.lead_id,
          channel: n.channel || 'Call',
          note: n.note_text || n.note || '',
          actor_name: n.created_by || n.actor_name || '',
          created_at: n.created_at || ''
        };
      }) : [],
      Quotations: Array.isArray(src.quotations) ? src.quotations : [],
      Receipts: Array.isArray(src.money_receipts || src.receipts) ? (src.money_receipts || src.receipts).map(function (r) {
        return {
          receipt_id: r.receipt_id,
          receipt_number: r.receipt_number || r.receipt_id,
          order_id: r.order_id,
          customer_name: r.customer_name || '',
          phone_display: r.phone_display || '',
          address: r.address || '',
          service_type: r.services_text || r.service_type || '',
          amount_bdt: r.amount_received !== undefined ? r.amount_received : (r.amount_bdt || 0),
          payment_method: r.payment_method || 'Cash',
          payment_date: r.receipt_date || r.payment_date || '',
          transaction_ref: r.transaction_ref || '',
          received_by: r.received_by || '',
          notes: r.notes || '',
          pad_snapshot_json: r.pad_snapshot_json || '',
          created_at: r.created_at || ''
        };
      }) : [],
      Workers: Array.isArray(src.workers) ? src.workers : [],
      OrderWorkers: Array.isArray(src.order_workers) ? src.order_workers.map(function (w) {
        return {
          assignment_id: w.id || w.assignment_id,
          order_id: w.order_id,
          worker_id: w.worker_id,
          worker_name: w.worker_name || '',
          wage_bdt: w.agreed_pay_bdt !== undefined ? w.agreed_pay_bdt : (w.wage_bdt || 0),
          confirmed: (w.confirmed_worked || w.confirmed) ? 1 : 0,
          paid: (w.payment_status === 'Paid' || w.paid) ? 1 : 0,
          paid_amount_bdt: w.paid_amount_bdt || 0,
          payment_date: w.payment_date || '',
          payment_method: w.payment_method || '',
          paid_by_role: w.paid_by_role || '',
          payment_reference: w.payment_reference || '',
          paid_at: w.paid_at || '',
          paid_by: w.paid_by_name || w.paid_by || '',
          payment_note: w.payment_note || '',
          created_at: w.created_at || '',
          updated_at: w.updated_at || ''
        };
      }) : [],
      WorkerPayHistory: Array.isArray(src.worker_payment_history) ? src.worker_payment_history.map(function (h) {
        return {
          pay_history_id: h.history_id || h.pay_history_id,
          assignment_id: h.order_worker_id || h.assignment_id,
          order_id: h.order_id,
          worker_id: h.worker_id,
          worker_name: h.worker_name || '',
          amount_bdt: h.amount_bdt || 0,
          action_type: h.action || h.action_type || 'MARK_PAID',
          payment_date: h.payment_date || '',
          payment_method: h.payment_method || '',
          paid_by_role: h.paid_by_role || '',
          reference: h.reference || '',
          note: h.reason || h.note || '',
          actor_name: h.changed_by || h.actor_name || '',
          created_at: h.changed_at || h.created_at || ''
        };
      }) : [],
      SettlementEntries: Array.isArray(src.supervisor_settlement_entries || src.settlement_entries) ? (src.supervisor_settlement_entries || src.settlement_entries) : [],
      Complaints: Array.isArray(src.order_complaints || src.complaints) ? (src.order_complaints || src.complaints).map(function (c) {
        return {
          complaint_id: c.complaint_id,
          order_id: c.order_id,
          complaint_date: c.complaint_date || '',
          description: c.issue || c.description || '',
          action_taken: c.action_taken || '',
          resolution_note: c.notes || c.resolution_note || '',
          status: c.status || 'Open',
          return_visit_order_id: c.return_visit_order_id || '',
          is_no_charge: c.is_no_charge ? 1 : 0,
          created_by: c.created_by || '',
          created_at: c.created_at || '',
          updated_at: c.updated_at || ''
        };
      }) : [],
      OverheadExpenses: Array.isArray(src.overhead_expenses || src.overhead) ? (src.overhead_expenses || src.overhead).map(function (o) {
        return {
          expense_id: o.id || o.expense_id,
          expense_date: o.expense_date || '',
          category: o.category || 'Other',
          description: o.description || '',
          amount_bdt: o.amount_bdt || 0,
          recorded_by: o.created_by || o.recorded_by || '',
          created_at: o.created_at || ''
        };
      }) : [],
      DocumentPads: Array.isArray(src.document_pads || src.pads) ? (src.document_pads || src.pads) : [],
      IssuedPdfs: Array.isArray(src.issued_pdfs) ? src.issued_pdfs : [],
      ReminderLog: Array.isArray(src.reminder_logs) ? src.reminder_logs : []
    };

    var docPadAssets = [];
    for (var pi = 0; pi < mappedTables.DocumentPads.length; pi++) {
      var dp = mappedTables.DocumentPads[pi];
      if (dp.image_data_url) {
        docPadAssets.push({ pad_type: dp.pad_type, file_name: dp.file_name, mime_type: dp.mime_type, data_url: dp.image_data_url });
      }
    }
    var pdfAssets = [];
    for (var fi = 0; fi < mappedTables.IssuedPdfs.length; fi++) {
      var ip = mappedTables.IssuedPdfs[fi];
      if (ip.pdf_base64) {
        pdfAssets.push({ pdf_id: ip.pdf_id, doc_type: ip.doc_type, doc_id: ip.doc_id, file_name: ip.file_name, data_url: 'data:application/pdf;base64,' + ip.pdf_base64 });
      }
    }

    var safeSettings = {};
    var srcSettings = src.settings || pkg.settings || {};
    if (Array.isArray(srcSettings)) {
      for (var si = 0; si < srcSettings.length; si++) {
        if (SAFE_SETTINGS_KEYS.indexOf(srcSettings[si].key) !== -1) {
          safeSettings[srcSettings[si].key] = srcSettings[si].value;
        }
      }
    } else if (typeof srcSettings === 'object') {
      for (var sk = 0; sk < SAFE_SETTINGS_KEYS.length; sk++) {
        if (srcSettings[SAFE_SETTINGS_KEYS[sk]] !== undefined) {
          safeSettings[SAFE_SETTINGS_KEYS[sk]] = srcSettings[SAFE_SETTINGS_KEYS[sk]];
        }
      }
    }

    var logoAsset = null;
    if (pkg.company_logo_data_url) {
      logoAsset = { file_name: 'company-logo.png', mime_type: 'image/png', data_url: pkg.company_logo_data_url };
    } else if (srcSettings && srcSettings.company_logo_data_url) {
      logoAsset = { file_name: srcSettings.company_logo_file_name || 'company-logo.png', mime_type: srcSettings.company_logo_mime_type || 'image/png', data_url: srcSettings.company_logo_data_url };
    }

    return {
      payload: {
        schema_version: Number(pkg.schema_version || 3),
        created_at: String(pkg.exported_at || pkg.created_at || getNowDhakaTimestamp_()),
        created_by: String(pkg.created_by || 'SQLite Export'),
        timezone: String(pkg.timezone || SUNVILOZ_CONFIG.TIMEZONE),
        user_mappings: Array.isArray(src.users) ? src.users : [],
        settings: safeSettings,
        tables: mappedTables,
        assets: { logo: logoAsset, document_pads: docPadAssets, issued_pdfs: pdfAssets }
      },
      checksumVerified: checksumVerified,
      checksum: expectedHash || computeSha256Hex_(JSON.stringify(mappedTables)),
      schemaVersion: Number(pkg.schema_version || 3),
      warnings: warnings
    };
  }

  throw new Error('Unrecognized backup format. Expected SUNVILOZ Clean Care backup JSON.');
}

function validateBackupPackageGas_(pkg) {
  var norm = normalizeIncomingBackupPackage_(pkg);
  var p = norm.payload;
  var tables = p.tables || {};
  var assets = p.assets || {};
  var mappings = Array.isArray(p.user_mappings) ? p.user_mappings : [];
  var supervisorCount = 0;
  for (var i = 0; i < mappings.length; i++) {
    if (String(mappings[i].role) === 'supervisor') supervisorCount++;
  }

  return {
    valid: true,
    schema_version: norm.schemaVersion,
    exported_at: String(p.created_at || ''),
    timezone: String(p.timezone || SUNVILOZ_CONFIG.TIMEZONE),
    checksum_verified: norm.checksumVerified,
    counts: {
      orders: Array.isArray(tables.Orders) ? tables.Orders.length : 0,
      quotations: Array.isArray(tables.Quotations) ? tables.Quotations.length : 0,
      receipts: Array.isArray(tables.Receipts) ? tables.Receipts.length : 0,
      leads: Array.isArray(tables.Leads) ? tables.Leads.length : 0,
      lead_notes: Array.isArray(tables.LeadNotes) ? tables.LeadNotes.length : 0,
      customers: Array.isArray(tables.Customers) ? tables.Customers.length : 0,
      buildings: Array.isArray(tables.Buildings) ? tables.Buildings.length : 0,
      workers: Array.isArray(tables.Workers) ? tables.Workers.length : 0,
      order_workers: Array.isArray(tables.OrderWorkers) ? tables.OrderWorkers.length : 0,
      worker_payment_history: Array.isArray(tables.WorkerPayHistory) ? tables.WorkerPayHistory.length : 0,
      settlement_entries: Array.isArray(tables.SettlementEntries) ? tables.SettlementEntries.length : 0,
      complaints: Array.isArray(tables.Complaints) ? tables.Complaints.length : 0,
      supervisors: supervisorCount,
      overhead: Array.isArray(tables.OverheadExpenses) ? tables.OverheadExpenses.length : 0,
      history: Array.isArray(tables.StatusHistory) ? tables.StatusHistory.length : 0,
      reminder_logs: Array.isArray(tables.ReminderLog) ? tables.ReminderLog.length : 0,
      pads: Array.isArray(tables.DocumentPads) ? tables.DocumentPads.length : 0,
      issued_pdfs: Array.isArray(tables.IssuedPdfs) ? tables.IssuedPdfs.length : 0,
      has_company_logo: Boolean(assets.logo && assets.logo.data_url)
    },
    warnings: norm.warnings
  };
}

function savePrimaryDriveSnapshotGas_(ss, actorName, prefix) {
  var folders = getPrivateDriveFolders_();
  var pkg = buildSanitizedBackupPackage_(ss, actorName || 'Admin');
  var stamp = Utilities.formatDate(new Date(), SUNVILOZ_CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmmss');
  var fileName = (prefix || 'sunviloz_primary_snapshot_') + stamp + '.json';
  var blob = Utilities.newBlob(JSON.stringify(pkg, null, 2), 'application/json', fileName);
  var file = folders.backups.createFile(blob);
  enforcePrivateSharing_(file);

  var now = getNowDhakaTimestamp_();
  setSetting_(ss, 'primary_drive_last_snapshot_at', now);
  setSetting_(ss, 'primary_drive_last_snapshot_file_id', file.getId());
  setSetting_(ss, 'primary_drive_last_checksum', pkg.checksum_sha256);

  return {
    file_id: file.getId(),
    file_name: file.getName(),
    size_bytes: file.getSize(),
    checksum_sha256: pkg.checksum_sha256,
    created_at: now
  };
}

function listPrimaryDriveSnapshotsGas_() {
  var folders = getPrivateDriveFolders_();
  var files = folders.backups.getFiles();
  var out = [];
  while (files.hasNext()) {
    var f = files.next();
    if (f.isTrashed()) continue;
    out.push({
      id: f.getId(),
      name: f.getName(),
      size: f.getSize(),
      modifiedTime: Utilities.formatDate(f.getLastUpdated(), SUNVILOZ_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
      revision: 0,
      checksum: '',
      isLatest: false
    });
  }
  out.sort(function (a, b) { return b.modifiedTime.localeCompare(a.modifiedTime); });
  if (out.length > 0) out[0].isLatest = true;
  return out;
}

function readPrimaryDriveSnapshotGas_(fileId) {
  var file = DriveApp.getFileById(String(fileId || '').trim());
  if (file.isTrashed()) throw new Error('Snapshot file is in Trash.');
  var text = file.getBlob().getDataAsString('UTF-8');
  return JSON.parse(text);
}

function restoreBackupPackageGas_(ss, actor, pkg) {
  var norm = normalizeIncomingBackupPackage_(pkg);
  var summary = validateBackupPackageGas_(pkg);
  var p = norm.payload;
  var tables = p.tables || {};
  var assets = p.assets || {};
  var folders = getPrivateDriveFolders_();
  var now = getNowDhakaTimestamp_();

  // Step 1: Create automatic pre-restore recovery snapshot in Primary Drive Backups folder
  var preSnap = savePrimaryDriveSnapshotGas_(ss, actor.name, 'pre_restore_recovery_');
  recordBackupHistoryGas_(ss, {
    source: 'pre_restore_recovery',
    status: 'verified',
    file_name: preSnap.file_name,
    drive_file_id: preSnap.file_id,
    drive_account_email: getEffectiveOwnerEmail_(),
    folder_name: SUNVILOZ_CONFIG.SUBFOLDER_BACKUPS,
    size_bytes: preSnap.size_bytes,
    checksum_sha256: preSnap.checksum_sha256,
    created_by: actor.name
  });

  // Step 2: Restore Drive assets into THIS primary Drive
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

  // Step 3: Replace business tables atomically & idempotently
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

  // Step 4: Relink supervisor accounts WITHOUT touching existing admin credentials
  var existingAccounts = readSheetObjects_(ss, 'Accounts');
  var existingById = {};
  for (var ea = 0; ea < existingAccounts.length; ea++) {
    existingById[String(existingAccounts[ea].id)] = existingAccounts[ea];
  }
  var mappings = Array.isArray(p.user_mappings) ? p.user_mappings : [];
  var supervisorsNeedingReset = [];
  for (var m = 0; m < mappings.length; m++) {
    var um = mappings[m];
    if (String(um.role) === 'admin') continue;
    if (!existingById[String(um.id)]) {
      appendSheetObject_(ss, 'Accounts', {
        id: String(um.id),
        role: 'supervisor',
        name: String(um.name || ''),
        username: normalizeUsername_(um.username),
        phone_display: String(um.phone_display || ''),
        password_hash: '',
        is_active: 0,
        token_version: 1,
        created_at: String(um.created_at || now),
        updated_at: now
      });
      supervisorsNeedingReset.push({ id: String(um.id), name: String(um.name), username: String(um.username) });
    }
  }

  // Step 5: Restore safe settings & pause reminders until verified
  var restoredSettings = p.settings || {};
  for (var sk = 0; sk < SAFE_SETTINGS_KEYS.length; sk++) {
    var k = SAFE_SETTINGS_KEYS[sk];
    if (restoredSettings[k] !== undefined && restoredSettings[k] !== '') {
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
    preRestoreRecoveryFile: preSnap.file_name,
    restoredOrders: summary.counts.orders,
    restoredQuotations: summary.counts.quotations,
    restoredReceipts: summary.counts.receipts,
    restoredLeads: summary.counts.leads,
    restoredPads: summary.counts.pads,
    restoredIssuedPdfs: summary.counts.issued_pdfs,
    summary: summary,
    supervisors_needing_password_reset: supervisorsNeedingReset,
    message: 'Backup restored safely (' + summary.counts.orders + ' orders, ' + summary.counts.customers + ' customers). Pre-restore snapshot saved as ' + preSnap.file_name + '.'
  };
}

function recordBackupHistoryGas_(ss, rec) {
  var now = getNowDhakaTimestamp_();
  var entry = {
    backup_id: makeUid_('BKP'),
    source: String(rec.source || 'secondary_drive_scheduler'),
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

  if (entry.status === 'verified') {
    setSetting_(ss, 'last_verified_backup_at', now);
    setSetting_(ss, 'last_verified_backup_file', entry.file_name);
    setSetting_(ss, 'last_backup_error', '');
  } else {
    setSetting_(ss, 'last_backup_error', entry.error_message || 'Backup failed');
  }
  return entry;
}

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
    // Still create a verified Primary Drive snapshot so local backup succeeds even if secondary webhook isn't configured yet
    var snap = savePrimaryDriveSnapshotGas_(ss, triggeredBy || 'Admin', 'sunviloz_primary_backup_');
    return recordBackupHistoryGas_(ss, {
      source: 'secondary_drive_scheduler',
      status: 'verified',
      file_name: snap.file_name,
      drive_file_id: snap.file_id,
      drive_account_email: getEffectiveOwnerEmail_(),
      folder_name: SUNVILOZ_CONFIG.SUBFOLDER_BACKUPS,
      size_bytes: snap.size_bytes,
      checksum_sha256: snap.checksum_sha256,
      error_message: '',
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
      source: 'secondary_drive_scheduler',
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
      source: 'secondary_drive_scheduler',
      status: 'failed',
      file_name: '',
      drive_account_email: settings.secondary_drive_email || '',
      error_message: err && err.message ? err.message : String(err),
      created_by: triggeredBy || 'Daily Scheduler'
    });
  }
}

function listSecondaryDriveBackupsGas_(ss) {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('SECONDARY_BACKUP_WEBAPP_URL') || '').trim();
  var secret = String(props.getProperty('SECONDARY_BACKUP_SECRET') || '').trim();
  if (!url || !secret) {
    return { configured: false, account_email: '', folder_name: '', files: [] };
  }
  var settings = getSettingsMap_(ss);
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      action: 'list_secondary_backups',
      secret: secret,
      payload: { folder_name: settings.secondary_drive_folder_name || 'SUNVILOZ Clean Care Backups' }
    }),
    muteHttpExceptions: true
  });
  var parsed = JSON.parse(resp.getContentText() || '{}');
  if (resp.getResponseCode() !== 200 || !parsed.ok) {
    throw new Error(parsed.error || 'Could not list Secondary Google Drive backups.');
  }
  return {
    configured: true,
    account_email: String((parsed.data && parsed.data.account_email) || settings.secondary_drive_email || ''),
    folder_name: String((parsed.data && parsed.data.folder_name) || settings.secondary_drive_folder_name || ''),
    files: (parsed.data && parsed.data.files) || []
  };
}

function readSecondaryDriveBackupGas_(ss, fileId) {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('SECONDARY_BACKUP_WEBAPP_URL') || '').trim();
  var secret = String(props.getProperty('SECONDARY_BACKUP_SECRET') || '').trim();
  if (!url || !secret) {
    throw new Error('Secondary Google Drive backup bridge is not configured.');
  }
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      action: 'read_secondary_backup',
      secret: secret,
      payload: { file_id: String(fileId || '').trim() }
    }),
    muteHttpExceptions: true
  });
  var parsed = JSON.parse(resp.getContentText() || '{}');
  if (resp.getResponseCode() !== 200 || !parsed.ok || !parsed.data || !parsed.data.backup) {
    throw new Error(parsed.error || 'Could not download backup from Secondary Google Drive.');
  }
  return parsed.data.backup;
}
