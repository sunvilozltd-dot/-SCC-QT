import crypto from 'crypto';
import type Database from 'better-sqlite3';
import {
  AuthUser,
  BuildingProfile,
  ComplaintStatus,
  COMPLAINT_STATUSES,
  CustomerProfile,
  OrderComplaintRecord,
  OrderRecord,
  OrderWorkerAssignment,
  PaidByRole,
  PaymentMethod,
  PAYMENT_METHODS,
  QuotationStatus,
  QuotationStatusHistoryEntry,
  ScheduleConflictItem,
  SettlementStatus,
  SupervisorBuildingSummary,
  SupervisorSettlementEntry,
  WorkerPaymentHistoryRecord,
  WorkerRecord,
} from '../src/types/order.ts';
import {
  bnToEnDigits,
  computeEndTime24,
  getNowDhakaTimestamp,
  getTodayDhakaIso,
  isValidIsoDate,
  normalizeBangladeshPhone,
  normalizeComplaintStatus,
  normalizeExpenseCategory,
  normalizeLeadChannel,
  normalizeLeadSource,
  normalizeLeadStage,
  normalizeOptionalContactPhone,
  normalizeOrderStatus,
  normalizeQuotationStatus,
  normalizeSettlementStatus,
  timeToMinutes,
  translatePaymentMethodToEnglish,
  translateServiceToEnglish,
  validateSafeExternalUrl,
} from '../src/utils/dateAndPhone.ts';

function makeUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;
}

function ensureCol(db: Database.Database, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function parseNonNegInt(raw: unknown, label: string): number {
  const str = bnToEnDigits(String(raw ?? '0')).trim();
  if (!str) return 0;
  const n = Number(str);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) {
    throw new Error(`${label} must be a valid non-negative number.`);
  }
  return Math.round(n);
}

function parseOptionalPosInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(bnToEnDigits(String(raw)).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function initExtendedSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      customer_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone_display TEXT NOT NULL,
      phone_e164 TEXT NOT NULL,
      lead_source TEXT NOT NULL DEFAULT 'Not Specified',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS buildings (
      building_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT '',
      maps_url TEXT NOT NULL DEFAULT '',
      access_instructions TEXT NOT NULL DEFAULT '',
      overhead_tank_qty INTEGER NOT NULL DEFAULT 0,
      overhead_tank_capacity_litres INTEGER,
      overhead_tank_material TEXT NOT NULL DEFAULT 'Concrete',
      reserve_tank_qty INTEGER NOT NULL DEFAULT 0,
      reserve_tank_capacity_litres INTEGER,
      reserve_tank_material TEXT NOT NULL DEFAULT 'Concrete',
      tank_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workers (
      worker_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone_display TEXT NOT NULL DEFAULT '',
      phone_e164 TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_workers (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      worker_name TEXT NOT NULL,
      agreed_pay_bdt INTEGER NOT NULL DEFAULT 0,
      confirmed_worked INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'Unpaid',
      paid_amount_bdt INTEGER NOT NULL DEFAULT 0,
      payment_date TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '',
      paid_by_role TEXT NOT NULL DEFAULT '',
      payment_reference TEXT NOT NULL DEFAULT '',
      payment_note TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT '',
      paid_by_name TEXT NOT NULL DEFAULT '',
      submission_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(order_id, worker_id)
    );

    CREATE TABLE IF NOT EXISTS worker_payment_history (
      history_id TEXT PRIMARY KEY,
      order_worker_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      worker_name TEXT NOT NULL,
      action TEXT NOT NULL,
      amount_bdt INTEGER NOT NULL DEFAULT 0,
      payment_date TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '',
      paid_by_role TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supervisor_settlement_entries (
      entry_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      supervisor_id TEXT NOT NULL DEFAULT '',
      supervisor_name TEXT NOT NULL DEFAULT '',
      entry_type TEXT NOT NULL CHECK(entry_type IN ('deposit_received', 'reimbursement_paid')),
      amount_bdt INTEGER NOT NULL,
      entry_datetime TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'Cash',
      reference TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      submission_key TEXT NOT NULL DEFAULT '',
      recorded_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_complaints (
      complaint_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      complaint_date TEXT NOT NULL,
      issue TEXT NOT NULL,
      action_taken TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Open',
      return_visit_order_id TEXT NOT NULL DEFAULT '',
      is_no_charge INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_buildings_customer ON buildings(customer_id);
    CREATE INDEX IF NOT EXISTS idx_order_workers_order ON order_workers(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_workers_worker ON order_workers(worker_id);
    CREATE INDEX IF NOT EXISTS idx_settlement_entries_order ON supervisor_settlement_entries(order_id);
    CREATE INDEX IF NOT EXISTS idx_complaints_order ON order_complaints(order_id);
  `);

  // Additive columns on orders
  ensureCol(db, 'orders', 'customer_id', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'building_id', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'building_name', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'estimated_duration_mins', 'INTEGER NOT NULL DEFAULT 120');
  ensureCol(db, 'orders', 'scheduled_end_time', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'lead_source', "TEXT NOT NULL DEFAULT 'Not Specified'");
  ensureCol(db, 'orders', 'referral_contact_type', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'referral_contact_name', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'referral_contact_phone', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'parent_order_id', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'is_return_visit', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'orders', 'is_no_charge_visit', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'orders', 'complaint_id', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'previous_work_date', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'followup_converted_order_id', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'orders', 'worker_pay_total', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'orders', 'supervisor_paid_worker_total', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'orders', 'return_visit_expenses_total', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'orders', 'settlement_actual_total', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'orders', 'settlement_remaining', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'orders', 'submission_key', "TEXT NOT NULL DEFAULT ''");

  // Additive columns on quotations
  ensureCol(db, 'quotations', 'customer_id', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'building_id', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'lead_source', "TEXT NOT NULL DEFAULT 'Not Specified'");
  ensureCol(db, 'quotations', 'referral_contact_type', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'referral_contact_name', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'referral_contact_phone', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'status_changed_at', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'status_history_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureCol(db, 'quotations', 'followup_date', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'followup_note', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'followup_done', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'quotations', 'followup_done_at', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'share_url', "TEXT NOT NULL DEFAULT ''");
  ensureCol(db, 'quotations', 'discount_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'quotations', 'discount_type', "TEXT NOT NULL DEFAULT 'amount'");
  ensureCol(db, 'quotations', 'discount_value', 'REAL NOT NULL DEFAULT 0');
  ensureCol(db, 'quotations', 'vat_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'quotations', 'vat_type', "TEXT NOT NULL DEFAULT 'percent'");
  ensureCol(db, 'quotations', 'vat_value', 'REAL NOT NULL DEFAULT 0');
  ensureCol(db, 'quotations', 'vat_base', "TEXT NOT NULL DEFAULT 'after_discount'");
  ensureCol(db, 'quotations', 'vat_bdt', 'REAL NOT NULL DEFAULT 0');
  ensureCol(db, 'quotations', 'tax_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureCol(db, 'quotations', 'tax_type', "TEXT NOT NULL DEFAULT 'percent'");
  ensureCol(db, 'quotations', 'tax_value', 'REAL NOT NULL DEFAULT 0');
  ensureCol(db, 'quotations', 'tax_base', "TEXT NOT NULL DEFAULT 'after_discount'");
  ensureCol(db, 'quotations', 'tax_bdt', 'REAL NOT NULL DEFAULT 0');

  // Preserve legacy issued quotations that had discount_bdt > 0
  db.prepare(
    `UPDATE quotations
     SET discount_enabled = 1, discount_type = 'amount', discount_value = discount_bdt
     WHERE discount_bdt > 0 AND discount_enabled = 0 AND discount_value = 0`
  ).run();

  // Additive columns on leads
  ensureCol(db, 'leads', 'referral_contact_type', "TEXT NOT NULL DEFAULT ''");

  // Default setting for schedule conflict buffer
  const now = getNowDhakaTimestamp();
  db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
    'schedule_conflict_buffer_mins',
    '60',
    now
  );

  // Safe idempotent migration: normalize legacy Bengali statuses/categories to English
  // without altering customer names, addresses, notes, dates, or issued PDFs.
  normalizeLegacyEnumRows(db);
  backfillCustomersFromOrders(db);
}

function normalizeLegacyEnumRows(db: Database.Database): void {
  const tx = db.transaction(() => {
    const orderRows = db
      .prepare('SELECT order_id, status, settlement_status, lead_source, scheduled_time, estimated_duration_mins, scheduled_end_time FROM orders')
      .all() as Array<Record<string, unknown>>;
    const updOrder = db.prepare(
      'UPDATE orders SET status = ?, settlement_status = ?, lead_source = ?, scheduled_end_time = ? WHERE order_id = ?'
    );
    for (const r of orderRows) {
      const nextStatus = normalizeOrderStatus(String(r.status || ''));
      const nextSett = normalizeSettlementStatus(String(r.settlement_status || ''));
      const nextSource = normalizeLeadSource(String(r.lead_source || ''));
      const endTime =
        String(r.scheduled_end_time || '').trim() ||
        computeEndTime24(
          String(r.scheduled_time || '10:00'),
          Number(r.estimated_duration_mins || 120)
        );
      if (
        nextStatus !== r.status ||
        nextSett !== r.settlement_status ||
        nextSource !== r.lead_source ||
        endTime !== r.scheduled_end_time
      ) {
        updOrder.run(nextStatus, nextSett, nextSource, endTime, String(r.order_id));
      }
    }

    const qRows = db
      .prepare('SELECT quotation_id, status, lead_source, status_changed_at, created_at FROM quotations')
      .all() as Array<Record<string, unknown>>;
    const updQ = db.prepare(
      'UPDATE quotations SET status = ?, lead_source = ?, status_changed_at = ? WHERE quotation_id = ?'
    );
    for (const r of qRows) {
      const nextStatus = normalizeQuotationStatus(String(r.status || ''));
      const nextSource = normalizeLeadSource(String(r.lead_source || ''));
      const changedAt = String(r.status_changed_at || '') || String(r.created_at || '');
      if (nextStatus !== r.status || nextSource !== r.lead_source || changedAt !== r.status_changed_at) {
        updQ.run(nextStatus, nextSource, changedAt, String(r.quotation_id));
      }
    }

    const lRows = db
      .prepare('SELECT lead_id, stage, lead_source FROM leads')
      .all() as Array<Record<string, unknown>>;
    const updL = db.prepare('UPDATE leads SET stage = ?, lead_source = ? WHERE lead_id = ?');
    for (const r of lRows) {
      const nextStage = normalizeLeadStage(String(r.stage || ''));
      const nextSource = normalizeLeadSource(String(r.lead_source || ''));
      if (nextStage !== r.stage || nextSource !== r.lead_source) {
        updL.run(nextStage, nextSource, String(r.lead_id));
      }
    }

    const lnRows = db.prepare('SELECT note_id, channel FROM lead_notes').all() as Array<
      Record<string, unknown>
    >;
    const updLn = db.prepare('UPDATE lead_notes SET channel = ? WHERE note_id = ?');
    for (const r of lnRows) {
      const ch = normalizeLeadChannel(String(r.channel || ''));
      if (ch !== r.channel) updLn.run(ch, String(r.note_id));
    }

    const recRows = db.prepare('SELECT receipt_id, payment_method FROM receipts').all() as Array<
      Record<string, unknown>
    >;
    const updRec = db.prepare('UPDATE receipts SET payment_method = ? WHERE receipt_id = ?');
    for (const r of recRows) {
      const pm = translatePaymentMethodToEnglish(String(r.payment_method || ''));
      if (pm !== r.payment_method) updRec.run(pm, String(r.receipt_id));
    }

    const ovRows = db.prepare('SELECT id, category FROM overhead_expenses').all() as Array<
      Record<string, unknown>
    >;
    const updOv = db.prepare('UPDATE overhead_expenses SET category = ? WHERE id = ?');
    for (const r of ovRows) {
      const cat = normalizeExpenseCategory(String(r.category || ''));
      if (cat !== r.category) updOv.run(cat, String(r.id));
    }
  });
  tx();
}

function backfillCustomersFromOrders(db: Database.Database): void {
  const unlinkedOrders = db
    .prepare(
      "SELECT order_id, customer_name, phone_display, phone_e164, address, area, lead_source, created_at FROM orders WHERE customer_id = '' ORDER BY created_at ASC"
    )
    .all() as Array<Record<string, unknown>>;
  if (unlinkedOrders.length === 0) return;

  const tx = db.transaction(() => {
    const findCustByPhone = db.prepare('SELECT customer_id FROM customers WHERE phone_e164 = ? OR phone_display = ? LIMIT 1');
    const insertCust = db.prepare(
      `INSERT INTO customers (customer_id, name, phone_display, phone_e164, lead_source, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?)`
    );
    const findBuilding = db.prepare(
      'SELECT building_id, name FROM buildings WHERE customer_id = ? AND lower(address) = lower(?) LIMIT 1'
    );
    const insertBuilding = db.prepare(
      `INSERT INTO buildings (
        building_id, customer_id, name, address, area, maps_url, access_instructions,
        overhead_tank_qty, overhead_tank_capacity_litres, overhead_tank_material,
        reserve_tank_qty, reserve_tank_capacity_litres, reserve_tank_material, tank_notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', '', 1, NULL, 'Concrete', 1, NULL, 'Concrete', '', ?, ?)`
    );
    const linkOrder = db.prepare(
      'UPDATE orders SET customer_id = ?, building_id = ?, building_name = ? WHERE order_id = ?'
    );

    for (const o of unlinkedOrders) {
      const phoneDisplay = String(o.phone_display || '');
      const phoneE164 = String(o.phone_e164 || '');
      const now = String(o.created_at || getNowDhakaTimestamp());
      let existingCust = findCustByPhone.get(phoneE164, phoneDisplay) as
        | { customer_id: string }
        | undefined;
      let customerId = existingCust?.customer_id || '';
      if (!customerId) {
        customerId = makeUid('CUS');
        insertCust.run(
          customerId,
          String(o.customer_name || 'Customer'),
          phoneDisplay,
          phoneE164,
          normalizeLeadSource(String(o.lead_source || '')),
          now,
          now
        );
      }

      const addr = String(o.address || '').trim();
      const area = String(o.area || '').trim();
      let bld = findBuilding.get(customerId, addr) as
        | { building_id: string; name: string }
        | undefined;
      let buildingId = bld?.building_id || '';
      let buildingName = bld?.name || '';
      if (!buildingId && addr) {
        buildingId = makeUid('BLD');
        buildingName = area ? `${area} Property` : 'Primary Building';
        insertBuilding.run(buildingId, customerId, buildingName, addr, area, now, now);
      }
      linkOrder.run(customerId, buildingId, buildingName, String(o.order_id));
    }
  });
  tx();
}

// ============================================================================
// CUSTOMERS & BUILDING / WATER TANK PROFILES
// ============================================================================

export function listCustomers(db: Database.Database): CustomerProfile[] {
  const rows = db.prepare('SELECT * FROM customers ORDER BY updated_at DESC, name ASC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    customer_id: String(r.customer_id),
    name: String(r.name || ''),
    phone_display: String(r.phone_display || ''),
    phone_e164: String(r.phone_e164 || ''),
    lead_source: normalizeLeadSource(String(r.lead_source || '')),
    notes: String(r.notes || ''),
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
  }));
}

export function listBuildings(db: Database.Database): BuildingProfile[] {
  const rows = db.prepare('SELECT * FROM buildings ORDER BY updated_at DESC, name ASC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(mapBuildingRow);
}

function mapBuildingRow(r: Record<string, unknown>): BuildingProfile {
  return {
    building_id: String(r.building_id),
    customer_id: String(r.customer_id),
    name: String(r.name || ''),
    address: String(r.address || ''),
    area: String(r.area || ''),
    maps_url: String(r.maps_url || ''),
    access_instructions: String(r.access_instructions || ''),
    overhead_tank_qty: Number(r.overhead_tank_qty || 0),
    overhead_tank_capacity_litres:
      r.overhead_tank_capacity_litres === null || r.overhead_tank_capacity_litres === undefined
        ? null
        : Number(r.overhead_tank_capacity_litres),
    overhead_tank_material: String(r.overhead_tank_material || 'Concrete'),
    reserve_tank_qty: Number(r.reserve_tank_qty || 0),
    reserve_tank_capacity_litres:
      r.reserve_tank_capacity_litres === null || r.reserve_tank_capacity_litres === undefined
        ? null
        : Number(r.reserve_tank_capacity_litres),
    reserve_tank_material: String(r.reserve_tank_material || 'Concrete'),
    tank_notes: String(r.tank_notes || ''),
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
  };
}

export function getBuildingSummaryForSupervisor(
  db: Database.Database,
  buildingId: string
): SupervisorBuildingSummary | null {
  if (!buildingId) return null;
  const row = db
    .prepare('SELECT * FROM buildings WHERE building_id = ?')
    .get(buildingId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const b = mapBuildingRow(row);
  return {
    building_id: b.building_id,
    name: b.name,
    address: b.address,
    area: b.area,
    maps_url: b.maps_url,
    access_instructions: b.access_instructions,
    overhead_tank_qty: b.overhead_tank_qty,
    overhead_tank_capacity_litres: b.overhead_tank_capacity_litres,
    overhead_tank_material: b.overhead_tank_material,
    reserve_tank_qty: b.reserve_tank_qty,
    reserve_tank_capacity_litres: b.reserve_tank_capacity_litres,
    reserve_tank_material: b.reserve_tank_material,
    tank_notes: b.tank_notes,
  };
}

export function ensureCustomerForOrder(
  db: Database.Database,
  params: {
    customer_id?: string;
    name: string;
    phone_display: string;
    phone_e164: string;
    lead_source?: string;
  }
): string {
  if (params.customer_id) {
    const found = db
      .prepare('SELECT customer_id FROM customers WHERE customer_id = ?')
      .get(params.customer_id) as { customer_id: string } | undefined;
    if (found) return found.customer_id;
  }
  const byPhone = db
    .prepare('SELECT customer_id FROM customers WHERE phone_e164 = ? OR phone_display = ? LIMIT 1')
    .get(params.phone_e164, params.phone_display) as { customer_id: string } | undefined;
  if (byPhone) return byPhone.customer_id;

  const id = makeUid('CUS');
  const now = getNowDhakaTimestamp();
  db.prepare(
    `INSERT INTO customers (customer_id, name, phone_display, phone_e164, lead_source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?)`
  ).run(
    id,
    params.name.trim(),
    params.phone_display,
    params.phone_e164,
    normalizeLeadSource(params.lead_source || ''),
    now,
    now
  );
  return id;
}

export function createCustomerTx(
  db: Database.Database,
  payload: { name: string; phone: string; lead_source?: string; notes?: string }
): CustomerProfile {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Customer name is required.');
  const phone = normalizeBangladeshPhone(payload.phone || '');
  if (!phone) throw new Error('Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX).');

  const existing = db
    .prepare('SELECT customer_id FROM customers WHERE phone_e164 = ?')
    .get(phone.e164) as { customer_id: string } | undefined;
  if (existing) {
    throw new Error('A customer with this phone number already exists.');
  }

  const id = makeUid('CUS');
  const now = getNowDhakaTimestamp();
  db.prepare(
    `INSERT INTO customers (customer_id, name, phone_display, phone_e164, lead_source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    phone.display,
    phone.e164,
    normalizeLeadSource(payload.lead_source || ''),
    String(payload.notes || '').trim(),
    now,
    now
  );
  return listCustomers(db).find((c) => c.customer_id === id)!;
}

export function updateCustomerTx(
  db: Database.Database,
  customerId: string,
  payload: { name: string; phone: string; lead_source?: string; notes?: string }
): CustomerProfile {
  const existing = db
    .prepare('SELECT customer_id FROM customers WHERE customer_id = ?')
    .get(customerId);
  if (!existing) throw new Error('Customer not found.');
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Customer name is required.');
  const phone = normalizeBangladeshPhone(payload.phone || '');
  if (!phone) throw new Error('Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX).');
  const now = getNowDhakaTimestamp();
  db.prepare(
    `UPDATE customers SET name = ?, phone_display = ?, phone_e164 = ?, lead_source = ?, notes = ?, updated_at = ?
     WHERE customer_id = ?`
  ).run(
    name,
    phone.display,
    phone.e164,
    normalizeLeadSource(payload.lead_source || ''),
    String(payload.notes || '').trim(),
    now,
    customerId
  );
  return listCustomers(db).find((c) => c.customer_id === customerId)!;
}

export function createBuildingTx(
  db: Database.Database,
  payload: {
    customer_id: string;
    name: string;
    address: string;
    area?: string;
    maps_url?: string;
    access_instructions?: string;
    overhead_tank_qty?: number | string;
    overhead_tank_capacity_litres?: number | string | null;
    overhead_tank_material?: string;
    reserve_tank_qty?: number | string;
    reserve_tank_capacity_litres?: number | string | null;
    reserve_tank_material?: string;
    tank_notes?: string;
  }
): BuildingProfile {
  const cust = db
    .prepare('SELECT customer_id FROM customers WHERE customer_id = ?')
    .get(payload.customer_id);
  if (!cust) throw new Error('Selected customer not found.');
  const name = String(payload.name || '').trim();
  const address = String(payload.address || '').trim();
  if (!name) throw new Error('Building or property name is required.');
  if (!address) throw new Error('Building address is required.');

  const rawMap = String(payload.maps_url || '').trim();
  const safeMap = rawMap ? validateSafeExternalUrl(rawMap) : '';
  if (rawMap && !safeMap) {
    throw new Error('Google Maps link must be a valid https:// or http:// URL.');
  }

  const id = makeUid('BLD');
  const now = getNowDhakaTimestamp();
  db.prepare(
    `INSERT INTO buildings (
      building_id, customer_id, name, address, area, maps_url, access_instructions,
      overhead_tank_qty, overhead_tank_capacity_litres, overhead_tank_material,
      reserve_tank_qty, reserve_tank_capacity_litres, reserve_tank_material, tank_notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    payload.customer_id,
    name,
    address,
    String(payload.area || '').trim(),
    safeMap,
    String(payload.access_instructions || '').trim(),
    parseNonNegInt(payload.overhead_tank_qty ?? 0, 'Overhead tank quantity'),
    parseOptionalPosInt(payload.overhead_tank_capacity_litres),
    String(payload.overhead_tank_material || 'Concrete').trim() || 'Concrete',
    parseNonNegInt(payload.reserve_tank_qty ?? 0, 'Reserve tank quantity'),
    parseOptionalPosInt(payload.reserve_tank_capacity_litres),
    String(payload.reserve_tank_material || 'Concrete').trim() || 'Concrete',
    String(payload.tank_notes || '').trim(),
    now,
    now
  );

  const row = db
    .prepare('SELECT * FROM buildings WHERE building_id = ?')
    .get(id) as Record<string, unknown>;
  return mapBuildingRow(row);
}

export function updateBuildingTx(
  db: Database.Database,
  buildingId: string,
  payload: {
    name: string;
    address: string;
    area?: string;
    maps_url?: string;
    access_instructions?: string;
    overhead_tank_qty?: number | string;
    overhead_tank_capacity_litres?: number | string | null;
    overhead_tank_material?: string;
    reserve_tank_qty?: number | string;
    reserve_tank_capacity_litres?: number | string | null;
    reserve_tank_material?: string;
    tank_notes?: string;
  }
): BuildingProfile {
  const existing = db
    .prepare('SELECT building_id FROM buildings WHERE building_id = ?')
    .get(buildingId);
  if (!existing) throw new Error('Building profile not found.');

  const name = String(payload.name || '').trim();
  const address = String(payload.address || '').trim();
  if (!name) throw new Error('Building or property name is required.');
  if (!address) throw new Error('Building address is required.');

  const rawMap = String(payload.maps_url || '').trim();
  const safeMap = rawMap ? validateSafeExternalUrl(rawMap) : '';
  if (rawMap && !safeMap) {
    throw new Error('Google Maps link must be a valid https:// or http:// URL.');
  }

  const now = getNowDhakaTimestamp();
  db.prepare(
    `UPDATE buildings SET
      name = ?, address = ?, area = ?, maps_url = ?, access_instructions = ?,
      overhead_tank_qty = ?, overhead_tank_capacity_litres = ?, overhead_tank_material = ?,
      reserve_tank_qty = ?, reserve_tank_capacity_litres = ?, reserve_tank_material = ?,
      tank_notes = ?, updated_at = ?
     WHERE building_id = ?`
  ).run(
    name,
    address,
    String(payload.area || '').trim(),
    safeMap,
    String(payload.access_instructions || '').trim(),
    parseNonNegInt(payload.overhead_tank_qty ?? 0, 'Overhead tank quantity'),
    parseOptionalPosInt(payload.overhead_tank_capacity_litres),
    String(payload.overhead_tank_material || 'Concrete').trim() || 'Concrete',
    parseNonNegInt(payload.reserve_tank_qty ?? 0, 'Reserve tank quantity'),
    parseOptionalPosInt(payload.reserve_tank_capacity_litres),
    String(payload.reserve_tank_material || 'Concrete').trim() || 'Concrete',
    String(payload.tank_notes || '').trim(),
    now,
    buildingId
  );

  const row = db
    .prepare('SELECT * FROM buildings WHERE building_id = ?')
    .get(buildingId) as Record<string, unknown>;
  return mapBuildingRow(row);
}

export function deleteBuildingTx(db: Database.Database, buildingId: string): void {
  const used = db
    .prepare('SELECT COUNT(*) as c FROM orders WHERE building_id = ?')
    .get(buildingId) as { c: number };
  if (used.c > 0) {
    throw new Error('This building is linked to existing orders and cannot be deleted.');
  }
  db.prepare('DELETE FROM buildings WHERE building_id = ?').run(buildingId);
}

// ============================================================================
// BOOKING SCHEDULE CONFLICT CHECK
// ============================================================================

export function checkScheduleConflicts(
  db: Database.Database,
  params: {
    supervisor_id: string;
    scheduled_date: string;
    scheduled_time: string;
    estimated_duration_mins?: number;
    scheduled_end_time?: string;
    exclude_order_id?: string;
  }
): ScheduleConflictItem[] {
  const supId = String(params.supervisor_id || '').trim();
  const date = String(params.scheduled_date || '').trim();
  const startStr = String(params.scheduled_time || '').trim();
  if (!supId || !isValidIsoDate(date) || !startStr) return [];

  const startMins = timeToMinutes(startStr);
  if (startMins === null) return [];

  const bufferRow = db
    .prepare("SELECT value FROM settings WHERE key = 'schedule_conflict_buffer_mins'")
    .get() as { value: string } | undefined;
  const bufferMins = Math.max(0, Math.min(360, Number(bufferRow?.value || 60) || 60));

  const explicitEnd = params.scheduled_end_time
    ? timeToMinutes(params.scheduled_end_time)
    : null;
  const dur = Number(params.estimated_duration_mins || 0);
  const hasRange = (explicitEnd !== null && explicitEnd > startMins) || dur > 0;
  const endMins =
    explicitEnd !== null && explicitEnd > startMins
      ? explicitEnd
      : dur > 0
      ? startMins + dur
      : startMins;

  const rows = db
    .prepare(
      `SELECT order_id, customer_name, area, scheduled_date, scheduled_time, scheduled_end_time, estimated_duration_mins, status
       FROM orders
       WHERE assigned_supervisor_id = ?
         AND scheduled_date = ?
         AND status NOT IN ('Cancelled', 'বাতিল')
         AND order_id != ?
       ORDER BY scheduled_time ASC`
    )
    .all(supId, date, String(params.exclude_order_id || '')) as Array<Record<string, unknown>>;

  const conflicts: ScheduleConflictItem[] = [];

  for (const r of rows) {
    const otherStart = timeToMinutes(String(r.scheduled_time || ''));
    if (otherStart === null) continue;
    const otherEndRaw = timeToMinutes(String(r.scheduled_end_time || ''));
    const otherDur = Number(r.estimated_duration_mins || 0);
    const otherHasRange = (otherEndRaw !== null && otherEndRaw > otherStart) || otherDur > 0;
    const otherEnd =
      otherEndRaw !== null && otherEndRaw > otherStart
        ? otherEndRaw
        : otherDur > 0
        ? otherStart + otherDur
        : otherStart;

    let reason = '';
    if (otherStart === startMins) {
      reason = 'Identical start time for the same supervisor';
    } else if (hasRange && otherHasRange) {
      if (startMins < otherEnd && otherStart < endMins) {
        reason = 'Overlapping scheduled work duration';
      }
    } else if (Math.abs(startMins - otherStart) <= bufferMins) {
      reason = `Within ${bufferMins}-minute scheduling buffer`;
    }

    if (reason) {
      conflicts.push({
        order_id: String(r.order_id),
        customer_name: String(r.customer_name || ''),
        area: String(r.area || ''),
        scheduled_date: String(r.scheduled_date || ''),
        scheduled_time: String(r.scheduled_time || ''),
        scheduled_end_time: String(r.scheduled_end_time || ''),
        estimated_duration_mins: Number(r.estimated_duration_mins || 0),
        status: normalizeOrderStatus(String(r.status || '')),
        reason,
      });
    }
  }

  return conflicts;
}

// ============================================================================
// WORKERS, PER-JOB PAY & ONE-CLICK MARK AS PAID
// ============================================================================

export function listWorkers(db: Database.Database): WorkerRecord[] {
  const rows = db.prepare('SELECT * FROM workers ORDER BY is_active DESC, name ASC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    worker_id: String(r.worker_id),
    name: String(r.name || ''),
    phone_display: String(r.phone_display || ''),
    phone_e164: String(r.phone_e164 || ''),
    is_active: Number(r.is_active || 0) === 1,
    notes: String(r.notes || ''),
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
  }));
}

export function createWorkerTx(
  db: Database.Database,
  payload: { name: string; phone?: string; is_active?: boolean; notes?: string }
): WorkerRecord {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Worker name is required.');
  const phone = normalizeOptionalContactPhone(payload.phone || '');
  const id = makeUid('WRK');
  const now = getNowDhakaTimestamp();
  db.prepare(
    `INSERT INTO workers (worker_id, name, phone_display, phone_e164, is_active, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    phone.display,
    phone.e164,
    payload.is_active === false ? 0 : 1,
    String(payload.notes || '').trim(),
    now,
    now
  );
  return listWorkers(db).find((w) => w.worker_id === id)!;
}

export function updateWorkerTx(
  db: Database.Database,
  workerId: string,
  payload: { name?: string; phone?: string; is_active?: boolean; notes?: string }
): WorkerRecord {
  const existing = listWorkers(db).find((w) => w.worker_id === workerId);
  if (!existing) throw new Error('Worker not found.');
  const name = payload.name !== undefined ? String(payload.name).trim() : existing.name;
  if (!name) throw new Error('Worker name is required.');
  const phone =
    payload.phone !== undefined
      ? normalizeOptionalContactPhone(payload.phone)
      : { display: existing.phone_display, e164: existing.phone_e164 };
  const isActive = payload.is_active !== undefined ? payload.is_active : existing.is_active;
  const notes = payload.notes !== undefined ? String(payload.notes).trim() : existing.notes;
  const now = getNowDhakaTimestamp();

  db.prepare(
    `UPDATE workers SET name = ?, phone_display = ?, phone_e164 = ?, is_active = ?, notes = ?, updated_at = ?
     WHERE worker_id = ?`
  ).run(name, phone.display, phone.e164, isActive ? 1 : 0, notes, now, workerId);

  return listWorkers(db).find((w) => w.worker_id === workerId)!;
}

function mapOrderWorkerRow(r: Record<string, unknown>): OrderWorkerAssignment {
  return {
    id: String(r.id),
    order_id: String(r.order_id),
    worker_id: String(r.worker_id),
    worker_name: String(r.worker_name || ''),
    agreed_pay_bdt: Number(r.agreed_pay_bdt || 0),
    confirmed_worked: Number(r.confirmed_worked || 0) === 1,
    payment_status: String(r.payment_status) === 'Paid' ? 'Paid' : 'Unpaid',
    paid_amount_bdt: Number(r.paid_amount_bdt || 0),
    payment_date: String(r.payment_date || ''),
    payment_method: String(r.payment_method || ''),
    paid_by_role: (String(r.paid_by_role || '') as PaidByRole),
    payment_reference: String(r.payment_reference || ''),
    payment_note: String(r.payment_note || ''),
    paid_at: String(r.paid_at || ''),
    paid_by_name: String(r.paid_by_name || ''),
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
  };
}

export function getOrderWorkersForOrder(
  db: Database.Database,
  orderId: string
): OrderWorkerAssignment[] {
  const rows = db
    .prepare('SELECT * FROM order_workers WHERE order_id = ? ORDER BY created_at ASC')
    .all(orderId) as Array<Record<string, unknown>>;
  return rows.map(mapOrderWorkerRow);
}

export function getAllOrderWorkersMap(
  db: Database.Database
): Map<string, OrderWorkerAssignment[]> {
  const rows = db
    .prepare('SELECT * FROM order_workers ORDER BY created_at ASC')
    .all() as Array<Record<string, unknown>>;
  const map = new Map<string, OrderWorkerAssignment[]>();
  for (const r of rows) {
    const item = mapOrderWorkerRow(r);
    const list = map.get(item.order_id) || [];
    list.push(item);
    map.set(item.order_id, list);
  }
  return map;
}

export function listWorkerPaymentHistory(db: Database.Database): WorkerPaymentHistoryRecord[] {
  const rows = db
    .prepare('SELECT * FROM worker_payment_history ORDER BY changed_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    history_id: String(r.history_id),
    order_worker_id: String(r.order_worker_id),
    order_id: String(r.order_id),
    worker_id: String(r.worker_id),
    worker_name: String(r.worker_name || ''),
    action: String(r.action || 'MARK_PAID') as WorkerPaymentHistoryRecord['action'],
    amount_bdt: Number(r.amount_bdt || 0),
    payment_date: String(r.payment_date || ''),
    payment_method: String(r.payment_method || ''),
    paid_by_role: String(r.paid_by_role || '') as PaidByRole,
    reference: String(r.reference || ''),
    reason: String(r.reason || ''),
    changed_by: String(r.changed_by || ''),
    changed_at: String(r.changed_at || ''),
  }));
}

export function syncOrderWorkersOnSave(
  db: Database.Database,
  orderId: string,
  assignments: Array<{ worker_id: string; agreed_pay_bdt: number | string; confirmed_worked?: boolean }>,
  orderCompleted: boolean
): void {
  const now = getNowDhakaTimestamp();
  const existing = getOrderWorkersForOrder(db, orderId);
  const existingByWorker = new Map(existing.map((e) => [e.worker_id, e]));
  const keepWorkerIds = new Set<string>();

  for (const item of assignments) {
    const wId = String(item.worker_id || '').trim();
    if (!wId) continue;
    const workerRow = db
      .prepare('SELECT worker_id, name FROM workers WHERE worker_id = ?')
      .get(wId) as { worker_id: string; name: string } | undefined;
    if (!workerRow) continue;

    keepWorkerIds.add(wId);
    const pay = parseNonNegInt(item.agreed_pay_bdt ?? 0, 'Pay for This Job');
    const prev = existingByWorker.get(wId);

    if (prev) {
      const nextConfirmed =
        item.confirmed_worked !== undefined
          ? item.confirmed_worked
            ? 1
            : 0
          : prev.confirmed_worked
          ? 1
          : 0;
      db.prepare(
        `UPDATE order_workers SET worker_name = ?, agreed_pay_bdt = ?, confirmed_worked = ?, updated_at = ?
         WHERE id = ?`
      ).run(workerRow.name, pay, nextConfirmed, now, prev.id);
    } else {
      const confirmed = orderCompleted ? (item.confirmed_worked ? 1 : 0) : 0;
      db.prepare(
        `INSERT INTO order_workers (
          id, order_id, worker_id, worker_name, agreed_pay_bdt, confirmed_worked,
          payment_status, paid_amount_bdt, payment_date, payment_method, paid_by_role,
          payment_reference, payment_note, paid_at, paid_by_name, submission_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'Unpaid', 0, '', '', '', '', '', '', '', '', ?, ?)`
      ).run(makeUid('OWK'), orderId, wId, workerRow.name, pay, confirmed, now, now);
    }
  }

  for (const prev of existing) {
    if (!keepWorkerIds.has(prev.worker_id)) {
      if (prev.payment_status === 'Paid') {
        throw new Error(
          `Cannot remove worker "${prev.worker_name}" because their payment is already marked as Paid. Correct the payment status first.`
        );
      }
      db.prepare('DELETE FROM order_workers WHERE id = ?').run(prev.id);
    }
  }
}

export function confirmOrderWorkersOnCompletion(
  db: Database.Database,
  orderId: string,
  confirmedWorkerIds: string[] | undefined
): string[] {
  const existing = getOrderWorkersForOrder(db, orderId);
  if (existing.length === 0) return [];

  const confirmedSet =
    confirmedWorkerIds === undefined
      ? new Set(existing.map((e) => e.worker_id))
      : new Set(confirmedWorkerIds.map(String));

  const now = getNowDhakaTimestamp();
  const confirmedNames: string[] = [];
  for (const row of existing) {
    const worked = confirmedSet.has(row.worker_id) ? 1 : 0;
    if (worked === 1) confirmedNames.push(row.worker_name);
    db.prepare('UPDATE order_workers SET confirmed_worked = ?, updated_at = ? WHERE id = ?').run(
      worked,
      now,
      row.id
    );
  }
  return confirmedNames;
}

export function markOrderWorkerPaidTx(
  db: Database.Database,
  orderId: string,
  orderWorkerId: string,
  payload: {
    payment_date?: string;
    payment_method?: string;
    paid_by_role: 'admin' | 'supervisor';
    reference?: string;
    note?: string;
    submission_key?: string;
  },
  actor: AuthUser
): OrderWorkerAssignment {
  const orderRow = db
    .prepare('SELECT order_id, status FROM orders WHERE order_id = ?')
    .get(orderId) as { order_id: string; status: string } | undefined;
  if (!orderRow) throw new Error('Order not found.');
  if (normalizeOrderStatus(orderRow.status) !== 'Completed') {
    throw new Error('Worker payments can only be recorded for Completed orders.');
  }

  const owRow = db
    .prepare('SELECT * FROM order_workers WHERE id = ? AND order_id = ?')
    .get(orderWorkerId, orderId) as Record<string, unknown> | undefined;
  if (!owRow) throw new Error('Assigned worker record not found on this order.');
  const ow = mapOrderWorkerRow(owRow);

  if (!ow.confirmed_worked) {
    throw new Error('Only workers confirmed as participating at completion can be marked as paid.');
  }

  const subKey = String(payload.submission_key || '').trim();
  if (subKey && String(owRow.submission_key || '') === subKey) {
    return ow; // Idempotent retry guard
  }
  if (ow.payment_status === 'Paid') {
    throw new Error(`Payment for ${ow.worker_name} is already marked as Paid.`);
  }

  const paymentDate =
    payload.payment_date && isValidIsoDate(payload.payment_date)
      ? payload.payment_date
      : getTodayDhakaIso();
  const paymentMethod = translatePaymentMethodToEnglish(payload.payment_method || 'Cash');
  const paidByRole: PaidByRole = payload.paid_by_role === 'supervisor' ? 'supervisor' : 'admin';
  const reference = String(payload.reference || '').trim().slice(0, 120);
  const note = String(payload.note || '').trim().slice(0, 300);
  const now = getNowDhakaTimestamp();

  db.prepare(
    `UPDATE order_workers SET
      payment_status = 'Paid',
      paid_amount_bdt = agreed_pay_bdt,
      payment_date = ?,
      payment_method = ?,
      paid_by_role = ?,
      payment_reference = ?,
      payment_note = ?,
      paid_at = ?,
      paid_by_name = ?,
      submission_key = ?,
      updated_at = ?
     WHERE id = ? AND payment_status = 'Unpaid'`
  ).run(
    paymentDate,
    paymentMethod,
    paidByRole,
    reference,
    note,
    now,
    actor.name,
    subKey,
    now,
    ow.id
  );

  db.prepare(
    `INSERT INTO worker_payment_history (
      history_id, order_worker_id, order_id, worker_id, worker_name, action,
      amount_bdt, payment_date, payment_method, paid_by_role, reference, reason, changed_by, changed_at
    ) VALUES (?, ?, ?, ?, ?, 'MARK_PAID', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    makeUid('WPH'),
    ow.id,
    orderId,
    ow.worker_id,
    ow.worker_name,
    ow.agreed_pay_bdt,
    paymentDate,
    paymentMethod,
    paidByRole,
    reference,
    note || `Marked as Paid (${paidByRole === 'supervisor' ? 'Paid by Supervisor from Job Cash' : 'Paid Directly by Admin'})`,
    actor.name,
    now
  );

  recomputeOrderFinancialsAndSettlement(db, orderId);

  const updated = db
    .prepare('SELECT * FROM order_workers WHERE id = ?')
    .get(ow.id) as Record<string, unknown>;
  return mapOrderWorkerRow(updated);
}

export function correctOrderWorkerPaymentTx(
  db: Database.Database,
  orderId: string,
  orderWorkerId: string,
  payload: {
    action: 'CORRECTED' | 'MARK_UNPAID';
    agreed_pay_bdt?: number | string;
    payment_date?: string;
    payment_method?: string;
    paid_by_role?: 'admin' | 'supervisor';
    reference?: string;
    reason: string;
  },
  actor: AuthUser
): OrderWorkerAssignment {
  const reason = String(payload.reason || '').trim();
  if (!reason) throw new Error('Please provide a reason for correcting this worker payment.');

  const owRow = db
    .prepare('SELECT * FROM order_workers WHERE id = ? AND order_id = ?')
    .get(orderWorkerId, orderId) as Record<string, unknown> | undefined;
  if (!owRow) throw new Error('Assigned worker record not found.');
  const ow = mapOrderWorkerRow(owRow);
  const now = getNowDhakaTimestamp();

  const nextPay =
    payload.agreed_pay_bdt !== undefined
      ? parseNonNegInt(payload.agreed_pay_bdt, 'Pay for This Job')
      : ow.agreed_pay_bdt;

  if (payload.action === 'MARK_UNPAID') {
    db.prepare(
      `UPDATE order_workers SET
        agreed_pay_bdt = ?,
        payment_status = 'Unpaid',
        paid_amount_bdt = 0,
        payment_date = '',
        payment_method = '',
        paid_by_role = '',
        payment_reference = '',
        payment_note = '',
        paid_at = '',
        paid_by_name = '',
        submission_key = '',
        updated_at = ?
       WHERE id = ?`
    ).run(nextPay, now, ow.id);

    db.prepare(
      `INSERT INTO worker_payment_history (
        history_id, order_worker_id, order_id, worker_id, worker_name, action,
        amount_bdt, payment_date, payment_method, paid_by_role, reference, reason, changed_by, changed_at
      ) VALUES (?, ?, ?, ?, ?, 'MARK_UNPAID', 0, '', '', '', '', ?, ?, ?)`
    ).run(makeUid('WPH'), ow.id, orderId, ow.worker_id, ow.worker_name, reason, actor.name, now);
  } else {
    const paymentDate =
      payload.payment_date && isValidIsoDate(payload.payment_date)
        ? payload.payment_date
        : ow.payment_date || getTodayDhakaIso();
    const paymentMethod = translatePaymentMethodToEnglish(
      payload.payment_method || ow.payment_method || 'Cash'
    );
    const paidByRole: PaidByRole =
      payload.paid_by_role === 'supervisor'
        ? 'supervisor'
        : payload.paid_by_role === 'admin'
        ? 'admin'
        : ow.paid_by_role || 'admin';
    const reference =
      payload.reference !== undefined ? String(payload.reference).trim() : ow.payment_reference;

    const isPaid = ow.payment_status === 'Paid';
    db.prepare(
      `UPDATE order_workers SET
        agreed_pay_bdt = ?,
        paid_amount_bdt = ?,
        payment_date = ?,
        payment_method = ?,
        paid_by_role = ?,
        payment_reference = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      nextPay,
      isPaid ? nextPay : 0,
      isPaid ? paymentDate : '',
      isPaid ? paymentMethod : '',
      isPaid ? paidByRole : '',
      isPaid ? reference : '',
      now,
      ow.id
    );

    db.prepare(
      `INSERT INTO worker_payment_history (
        history_id, order_worker_id, order_id, worker_id, worker_name, action,
        amount_bdt, payment_date, payment_method, paid_by_role, reference, reason, changed_by, changed_at
      ) VALUES (?, ?, ?, ?, ?, 'CORRECTED', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      makeUid('WPH'),
      ow.id,
      orderId,
      ow.worker_id,
      ow.worker_name,
      isPaid ? nextPay : 0,
      isPaid ? paymentDate : '',
      isPaid ? paymentMethod : '',
      isPaid ? paidByRole : '',
      reference,
      reason,
      actor.name,
      now
    );
  }

  recomputeOrderFinancialsAndSettlement(db, orderId);

  const updated = db
    .prepare('SELECT * FROM order_workers WHERE id = ?')
    .get(ow.id) as Record<string, unknown>;
  return mapOrderWorkerRow(updated);
}

// ============================================================================
// SUPERVISOR SETTLEMENT VERIFICATION ENTRIES
// ============================================================================

export function listAllSettlementEntries(db: Database.Database): SupervisorSettlementEntry[] {
  const rows = db
    .prepare('SELECT * FROM supervisor_settlement_entries ORDER BY entry_datetime DESC, created_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    entry_id: String(r.entry_id),
    order_id: String(r.order_id),
    supervisor_id: String(r.supervisor_id || ''),
    supervisor_name: String(r.supervisor_name || ''),
    entry_type:
      String(r.entry_type) === 'reimbursement_paid' ? 'reimbursement_paid' : 'deposit_received',
    amount_bdt: Number(r.amount_bdt || 0),
    entry_datetime: String(r.entry_datetime || ''),
    entry_date: String(r.entry_date || ''),
    payment_method: translatePaymentMethodToEnglish(String(r.payment_method || 'Cash')),
    reference: String(r.reference || ''),
    note: String(r.note || ''),
    recorded_by: String(r.recorded_by || ''),
    created_at: String(r.created_at || ''),
  }));
}

export function recordSettlementEntryTx(
  db: Database.Database,
  orderId: string,
  payload: {
    amount_bdt: number | string;
    entry_datetime?: string;
    payment_method?: PaymentMethod | string;
    reference?: string;
    note?: string;
    submission_key?: string;
  },
  actor: AuthUser
): SupervisorSettlementEntry {
  // First recompute to ensure expected settlement is 100% up to date
  recomputeOrderFinancialsAndSettlement(db, orderId);

  const row = db
    .prepare(
      `SELECT order_id, status, assigned_supervisor_id, assigned_supervisor_name,
              advance_supervisor_id, advance_supervisor_name,
              supervisor_settlement, settlement_actual_total, settlement_remaining
       FROM orders WHERE order_id = ?`
    )
    .get(orderId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Order not found.');
  if (normalizeOrderStatus(String(row.status || '')) !== 'Completed') {
    throw new Error('Supervisor settlement entries can only be recorded for Completed orders.');
  }

  const subKey = String(payload.submission_key || '').trim();
  if (subKey) {
    const dup = db
      .prepare('SELECT * FROM supervisor_settlement_entries WHERE order_id = ? AND submission_key = ?')
      .get(orderId, subKey) as Record<string, unknown> | undefined;
    if (dup) {
      return listAllSettlementEntries(db).find((e) => e.entry_id === String(dup.entry_id))!;
    }
  }

  const expected = Number(row.supervisor_settlement || 0);
  if (expected === 0) {
    throw new Error('Supervisor settlement is Balanced (BDT 0). No deposit or reimbursement entry is needed.');
  }

  const remaining = Number(row.settlement_remaining || 0);
  if (remaining <= 0) {
    throw new Error('This order settlement is already fully Settled.');
  }

  const amount = parseNonNegInt(payload.amount_bdt, 'Settlement amount');
  if (amount <= 0) {
    throw new Error('Settlement amount must be greater than BDT 0.');
  }
  if (amount > remaining) {
    throw new Error(
      `Amount exceeds the remaining balance of BDT ${remaining.toLocaleString('en-US')}.`
    );
  }

  const entryType = expected > 0 ? 'deposit_received' : 'reimbursement_paid';
  const supId =
    String(row.assigned_supervisor_id || '') || String(row.advance_supervisor_id || '');
  const supName =
    String(row.assigned_supervisor_name || '') ||
    String(row.advance_supervisor_name || '') ||
    'Supervisor';

  const now = getNowDhakaTimestamp();
  const entryDatetime = String(payload.entry_datetime || '').trim() || now;
  const entryDate = isValidIsoDate(entryDatetime.slice(0, 10))
    ? entryDatetime.slice(0, 10)
    : getTodayDhakaIso();
  const paymentMethod = translatePaymentMethodToEnglish(String(payload.payment_method || 'Cash'));
  const reference = String(payload.reference || '').trim().slice(0, 120);
  const note = String(payload.note || '').trim().slice(0, 300);

  const entryId = makeUid('SET');
  db.prepare(
    `INSERT INTO supervisor_settlement_entries (
      entry_id, order_id, supervisor_id, supervisor_name, entry_type, amount_bdt,
      entry_datetime, entry_date, payment_method, reference, note, submission_key, recorded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entryId,
    orderId,
    supId,
    supName,
    entryType,
    amount,
    entryDatetime,
    entryDate,
    paymentMethod,
    reference,
    note,
    subKey,
    actor.name,
    now
  );

  recomputeOrderFinancialsAndSettlement(db, orderId, actor.name);

  return listAllSettlementEntries(db).find((e) => e.entry_id === entryId)!;
}

// ============================================================================
// SINGLE-SOURCE-OF-TRUTH ORDER FINANCIAL & SETTLEMENT RECOMPUTATION
// ============================================================================

export function recomputeOrderFinancialsAndSettlement(
  db: Database.Database,
  orderId: string,
  settlerName?: string
): void {
  const row = db
    .prepare(
      `SELECT order_id, status, price_bdt, advance_given, full_bill_collected,
              transport_cost, meals_cost, other_expenses_total,
              parent_order_id, is_no_charge_visit, settlement_confirmed_at, settlement_confirmed_by
       FROM orders WHERE order_id = ?`
    )
    .get(orderId) as Record<string, unknown> | undefined;
  if (!row) return;

  const status = normalizeOrderStatus(String(row.status || ''));
  const isNoCharge = Number(row.is_no_charge_visit || 0) === 1;
  const price = isNoCharge ? 0 : Math.max(0, Number(row.price_bdt || 0));
  const advance = Math.max(0, Number(row.advance_given || 0));
  const transport = Math.max(0, Number(row.transport_cost || 0));
  const meals = Math.max(0, Number(row.meals_cost || 0));
  const otherTotal = Math.max(0, Number(row.other_expenses_total || 0));
  const collected = Number(row.full_bill_collected || 0) === 1;

  // Worker labour cost: counted ONCE from confirmed participating workers
  const workerAgg = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN confirmed_worked = 1 THEN agreed_pay_bdt ELSE 0 END), 0) AS worker_pay_total,
         COALESCE(SUM(CASE WHEN confirmed_worked = 1 AND payment_status = 'Paid' AND paid_by_role = 'supervisor' THEN paid_amount_bdt ELSE 0 END), 0) AS sup_paid_total
       FROM order_workers
       WHERE order_id = ?`
    )
    .get(orderId) as { worker_pay_total: number; sup_paid_total: number };

  const workerPayTotal = Math.max(0, Number(workerAgg?.worker_pay_total || 0));
  const supPaidWorkerTotal = Math.max(0, Number(workerAgg?.sup_paid_total || 0));

  // Linked completed no-charge return visits actual expenses counted ONCE in original job profit
  const rvAgg = db
    .prepare(
      `SELECT COALESCE(SUM(actual_expenses), 0) AS rv_total
       FROM orders
       WHERE parent_order_id = ? AND is_no_charge_visit = 1 AND status IN ('Completed', 'সম্পন্ন')`
    )
    .get(orderId) as { rv_total: number };
  const returnVisitExpensesTotal = isNoCharge ? 0 : Math.max(0, Number(rvAgg?.rv_total || 0));

  const actualExpenses = transport + meals + otherTotal + workerPayTotal;

  // Supervisor cash settlement: bill (if collected and not no-charge) + advance - (direct expenses + supervisor-paid workers)
  const billCollectedCash = !isNoCharge && collected ? price : 0;
  const supervisorCashOut = transport + meals + otherTotal + supPaidWorkerTotal;
  const expectedSettlement =
    status === 'Completed' ? billCollectedCash + advance - supervisorCashOut : 0;

  // Job profit/loss: counts worker pay once and linked no-charge return visit expenses once
  const jobProfitOrLoss =
    status === 'Completed'
      ? isNoCharge
        ? -actualExpenses
        : price - actualExpenses - returnVisitExpensesTotal
      : 0;

  // Supervisor settlement entries matching expected direction
  let actualSettled = 0;
  let remaining = 0;
  let settlementStatus: SettlementStatus = 'Not Applicable';

  if (status === 'Completed') {
    if (expectedSettlement === 0) {
      settlementStatus = 'Balanced';
      actualSettled = 0;
      remaining = 0;
    } else {
      const targetType = expectedSettlement > 0 ? 'deposit_received' : 'reimbursement_paid';
      const entryAgg = db
        .prepare(
          `SELECT COALESCE(SUM(amount_bdt), 0) AS total
           FROM supervisor_settlement_entries
           WHERE order_id = ? AND entry_type = ?`
        )
        .get(orderId, targetType) as { total: number };
      actualSettled = Math.max(0, Number(entryAgg?.total || 0));
      remaining = Math.max(0, Math.abs(expectedSettlement) - actualSettled);
      settlementStatus = remaining === 0 ? 'Settled' : 'Pending';
    }
  }

  const now = getNowDhakaTimestamp();
  const confirmedAt =
    settlementStatus === 'Settled' || settlementStatus === 'Balanced'
      ? String(row.settlement_confirmed_at || '') || now
      : '';
  const confirmedBy =
    settlementStatus === 'Settled' || settlementStatus === 'Balanced'
      ? String(row.settlement_confirmed_by || '') || settlerName || ''
      : '';

  db.prepare(
    `UPDATE orders SET
      worker_pay_total = ?,
      supervisor_paid_worker_total = ?,
      return_visit_expenses_total = ?,
      actual_expenses = ?,
      supervisor_settlement = ?,
      job_profit_or_loss = ?,
      settlement_actual_total = ?,
      settlement_remaining = ?,
      settlement_status = ?,
      settlement_confirmed_at = ?,
      settlement_confirmed_by = ?,
      updated_at = ?
     WHERE order_id = ?`
  ).run(
    workerPayTotal,
    supPaidWorkerTotal,
    returnVisitExpensesTotal,
    actualExpenses,
    expectedSettlement,
    jobProfitOrLoss,
    actualSettled,
    remaining,
    settlementStatus,
    confirmedAt,
    confirmedBy,
    now,
    orderId
  );

  // If this order is a no-charge return visit, update the parent order's profitability once
  const parentOrderId = String(row.parent_order_id || '');
  if (isNoCharge && parentOrderId) {
    recomputeOrderFinancialsAndSettlement(db, parentOrderId);
  }
}

// ============================================================================
// COMPLAINTS & RETURN VISITS
// ============================================================================

export function listAllComplaints(db: Database.Database): OrderComplaintRecord[] {
  const rows = db
    .prepare('SELECT * FROM order_complaints ORDER BY complaint_date DESC, created_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    complaint_id: String(r.complaint_id),
    order_id: String(r.order_id),
    complaint_date: String(r.complaint_date || ''),
    issue: String(r.issue || ''),
    action_taken: String(r.action_taken || ''),
    notes: String(r.notes || ''),
    status: normalizeComplaintStatus(String(r.status || 'Open')),
    return_visit_order_id: String(r.return_visit_order_id || ''),
    is_no_charge: Number(r.is_no_charge || 0) === 1,
    created_by: String(r.created_by || ''),
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
  }));
}

export function createComplaintTx(
  db: Database.Database,
  orderId: string,
  payload: {
    complaint_date?: string;
    issue: string;
    action_taken?: string;
    notes?: string;
    status?: ComplaintStatus;
  },
  actor: AuthUser
): OrderComplaintRecord {
  const orderRow = db
    .prepare('SELECT order_id, status FROM orders WHERE order_id = ?')
    .get(orderId) as { order_id: string; status: string } | undefined;
  if (!orderRow) throw new Error('Order not found.');
  if (normalizeOrderStatus(orderRow.status) !== 'Completed') {
    throw new Error('Complaints can only be recorded on Completed orders.');
  }
  const issue = String(payload.issue || '').trim();
  if (!issue) throw new Error('Please describe the complaint issue.');
  const complaintDate =
    payload.complaint_date && isValidIsoDate(payload.complaint_date)
      ? payload.complaint_date
      : getTodayDhakaIso();
  const status: ComplaintStatus =
    payload.status && COMPLAINT_STATUSES.includes(payload.status) ? payload.status : 'Open';
  const id = makeUid('CMP');
  const now = getNowDhakaTimestamp();

  db.prepare(
    `INSERT INTO order_complaints (
      complaint_id, order_id, complaint_date, issue, action_taken, notes, status,
      return_visit_order_id, is_no_charge, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?, ?)`
  ).run(
    id,
    orderId,
    complaintDate,
    issue,
    String(payload.action_taken || '').trim(),
    String(payload.notes || '').trim(),
    status,
    actor.name,
    now,
    now
  );

  return listAllComplaints(db).find((c) => c.complaint_id === id)!;
}

export function updateComplaintTx(
  db: Database.Database,
  complaintId: string,
  payload: {
    issue?: string;
    action_taken?: string;
    notes?: string;
    status?: ComplaintStatus;
  }
): OrderComplaintRecord {
  const existing = listAllComplaints(db).find((c) => c.complaint_id === complaintId);
  if (!existing) throw new Error('Complaint record not found.');
  const issue = payload.issue !== undefined ? String(payload.issue).trim() : existing.issue;
  if (!issue) throw new Error('Complaint issue cannot be empty.');
  const status: ComplaintStatus =
    payload.status && COMPLAINT_STATUSES.includes(payload.status)
      ? payload.status
      : existing.status;
  const now = getNowDhakaTimestamp();

  db.prepare(
    `UPDATE order_complaints SET issue = ?, action_taken = ?, notes = ?, status = ?, updated_at = ?
     WHERE complaint_id = ?`
  ).run(
    issue,
    payload.action_taken !== undefined ? String(payload.action_taken).trim() : existing.action_taken,
    payload.notes !== undefined ? String(payload.notes).trim() : existing.notes,
    status,
    now,
    complaintId
  );

  return listAllComplaints(db).find((c) => c.complaint_id === complaintId)!;
}

// ============================================================================
// QUOTATION STATUS & FOLLOW-UP UPDATES
// ============================================================================

export function updateQuotationFollowupTx(
  db: Database.Database,
  quotationId: string,
  payload: {
    status?: QuotationStatus;
    followup_date?: string;
    followup_note?: string;
    followup_done?: boolean;
    share_url?: string;
  },
  actor: AuthUser
): void {
  const row = db
    .prepare('SELECT * FROM quotations WHERE quotation_id = ?')
    .get(quotationId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Quotation not found.');

  const prevStatus = normalizeQuotationStatus(String(row.status || 'Draft'));
  const nextStatus = payload.status ? normalizeQuotationStatus(payload.status) : prevStatus;
  const now = getNowDhakaTimestamp();

  let history: QuotationStatusHistoryEntry[] = [];
  try {
    const parsed = JSON.parse(String(row.status_history_json || '[]'));
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    history = [];
  }

  let statusChangedAt = String(row.status_changed_at || '') || String(row.created_at || now);
  if (nextStatus !== prevStatus) {
    statusChangedAt = now;
    history.push({
      status: nextStatus,
      changed_at: now,
      changed_by: actor.name,
      note: String(payload.followup_note || '').trim() || undefined,
    });
  }

  const nextFollowupDate =
    payload.followup_date !== undefined
      ? payload.followup_date && isValidIsoDate(payload.followup_date)
        ? payload.followup_date
        : ''
      : String(row.followup_date || '');

  const nextFollowupNote =
    payload.followup_note !== undefined
      ? String(payload.followup_note).trim()
      : String(row.followup_note || '');

  // Auto-close quotation follow-up when Accepted or Cancelled
  let nextDone =
    payload.followup_done !== undefined
      ? payload.followup_done
        ? 1
        : 0
      : Number(row.followup_done || 0);
  if (nextStatus === 'Accepted' || nextStatus === 'Cancelled') {
    nextDone = 1;
  } else if (payload.followup_date && payload.followup_done === undefined) {
    nextDone = 0;
  }

  const doneAt = nextDone === 1 ? String(row.followup_done_at || '') || now : '';

  const rawShare = payload.share_url !== undefined ? String(payload.share_url).trim() : String(row.share_url || '');
  const safeShare = rawShare ? validateSafeExternalUrl(rawShare) : '';
  if (rawShare && !safeShare) {
    throw new Error('Quotation share link must be a valid https:// or http:// URL.');
  }

  db.prepare(
    `UPDATE quotations SET
      status = ?,
      status_changed_at = ?,
      status_history_json = ?,
      followup_date = ?,
      followup_note = ?,
      followup_done = ?,
      followup_done_at = ?,
      share_url = ?,
      updated_at = ?
     WHERE quotation_id = ?`
  ).run(
    nextStatus,
    statusChangedAt,
    JSON.stringify(history),
    nextFollowupDate,
    nextFollowupNote,
    nextDone,
    doneAt,
    safeShare,
    now,
    quotationId
  );
}

// ============================================================================
// EXTENDED BACKUP & ATOMIC RESTORE HELPERS (BOTH GOOGLE DRIVE ACCOUNTS)
// ============================================================================

export function getExtendedBackupTables(db: Database.Database) {
  return {
    customers: listCustomers(db),
    buildings: listBuildings(db),
    workers: listWorkers(db),
    order_workers: Array.from(getAllOrderWorkersMap(db).values()).flat(),
    worker_payment_history: listWorkerPaymentHistory(db),
    settlement_entries: listAllSettlementEntries(db),
    complaints: listAllComplaints(db),
  };
}

export function restoreExtendedBackupTablesTx(
  db: Database.Database,
  backup: Record<string, unknown>
): void {
  const now = getNowDhakaTimestamp();

  db.prepare('DELETE FROM order_complaints').run();
  db.prepare('DELETE FROM supervisor_settlement_entries').run();
  db.prepare('DELETE FROM worker_payment_history').run();
  db.prepare('DELETE FROM order_workers').run();
  db.prepare('DELETE FROM workers').run();
  db.prepare('DELETE FROM buildings').run();
  db.prepare('DELETE FROM customers').run();

  if (Array.isArray(backup.customers)) {
    const ins = db.prepare(
      `INSERT INTO customers (customer_id, name, phone_display, phone_e164, lead_source, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const raw of backup.customers) {
      const c = raw as Record<string, unknown>;
      if (!c.customer_id) continue;
      ins.run(
        String(c.customer_id),
        String(c.name || ''),
        String(c.phone_display || ''),
        String(c.phone_e164 || ''),
        normalizeLeadSource(String(c.lead_source || '')),
        String(c.notes || ''),
        String(c.created_at || now),
        String(c.updated_at || now)
      );
    }
  }

  if (Array.isArray(backup.buildings)) {
    const ins = db.prepare(
      `INSERT INTO buildings (
        building_id, customer_id, name, address, area, maps_url, access_instructions,
        overhead_tank_qty, overhead_tank_capacity_litres, overhead_tank_material,
        reserve_tank_qty, reserve_tank_capacity_litres, reserve_tank_material, tank_notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const raw of backup.buildings) {
      const b = raw as Record<string, unknown>;
      if (!b.building_id || !b.customer_id) continue;
      ins.run(
        String(b.building_id),
        String(b.customer_id),
        String(b.name || ''),
        String(b.address || ''),
        String(b.area || ''),
        validateSafeExternalUrl(String(b.maps_url || '')),
        String(b.access_instructions || ''),
        Number(b.overhead_tank_qty || 0),
        b.overhead_tank_capacity_litres === null || b.overhead_tank_capacity_litres === undefined
          ? null
          : Number(b.overhead_tank_capacity_litres),
        String(b.overhead_tank_material || 'Concrete'),
        Number(b.reserve_tank_qty || 0),
        b.reserve_tank_capacity_litres === null || b.reserve_tank_capacity_litres === undefined
          ? null
          : Number(b.reserve_tank_capacity_litres),
        String(b.reserve_tank_material || 'Concrete'),
        String(b.tank_notes || ''),
        String(b.created_at || now),
        String(b.updated_at || now)
      );
    }
  }

  if (Array.isArray(backup.workers)) {
    const ins = db.prepare(
      `INSERT INTO workers (worker_id, name, phone_display, phone_e164, is_active, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const raw of backup.workers) {
      const w = raw as Record<string, unknown>;
      if (!w.worker_id) continue;
      ins.run(
        String(w.worker_id),
        String(w.name || ''),
        String(w.phone_display || ''),
        String(w.phone_e164 || ''),
        w.is_active === false || Number(w.is_active) === 0 ? 0 : 1,
        String(w.notes || ''),
        String(w.created_at || now),
        String(w.updated_at || now)
      );
    }
  }

  if (Array.isArray(backup.order_workers)) {
    const ins = db.prepare(
      `INSERT OR REPLACE INTO order_workers (
        id, order_id, worker_id, worker_name, agreed_pay_bdt, confirmed_worked,
        payment_status, paid_amount_bdt, payment_date, payment_method, paid_by_role,
        payment_reference, payment_note, paid_at, paid_by_name, submission_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
    );
    for (const raw of backup.order_workers) {
      const ow = raw as Record<string, unknown>;
      if (!ow.id || !ow.order_id || !ow.worker_id) continue;
      ins.run(
        String(ow.id),
        String(ow.order_id),
        String(ow.worker_id),
        String(ow.worker_name || ''),
        Number(ow.agreed_pay_bdt || 0),
        ow.confirmed_worked === true || Number(ow.confirmed_worked) === 1 ? 1 : 0,
        String(ow.payment_status) === 'Paid' ? 'Paid' : 'Unpaid',
        Number(ow.paid_amount_bdt || 0),
        String(ow.payment_date || ''),
        String(ow.payment_method || ''),
        String(ow.paid_by_role || ''),
        String(ow.payment_reference || ''),
        String(ow.payment_note || ''),
        String(ow.paid_at || ''),
        String(ow.paid_by_name || ''),
        String(ow.created_at || now),
        String(ow.updated_at || now)
      );
    }
  }

  if (Array.isArray(backup.worker_payment_history)) {
    const ins = db.prepare(
      `INSERT INTO worker_payment_history (
        history_id, order_worker_id, order_id, worker_id, worker_name, action,
        amount_bdt, payment_date, payment_method, paid_by_role, reference, reason, changed_by, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const raw of backup.worker_payment_history) {
      const h = raw as Record<string, unknown>;
      if (!h.history_id) continue;
      ins.run(
        String(h.history_id),
        String(h.order_worker_id || ''),
        String(h.order_id || ''),
        String(h.worker_id || ''),
        String(h.worker_name || ''),
        String(h.action || 'MARK_PAID'),
        Number(h.amount_bdt || 0),
        String(h.payment_date || ''),
        String(h.payment_method || ''),
        String(h.paid_by_role || ''),
        String(h.reference || ''),
        String(h.reason || ''),
        String(h.changed_by || ''),
        String(h.changed_at || now)
      );
    }
  }

  if (Array.isArray(backup.settlement_entries)) {
    const ins = db.prepare(
      `INSERT INTO supervisor_settlement_entries (
        entry_id, order_id, supervisor_id, supervisor_name, entry_type, amount_bdt,
        entry_datetime, entry_date, payment_method, reference, note, submission_key, recorded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
    );
    for (const raw of backup.settlement_entries) {
      const s = raw as Record<string, unknown>;
      if (!s.entry_id || !s.order_id) continue;
      ins.run(
        String(s.entry_id),
        String(s.order_id),
        String(s.supervisor_id || ''),
        String(s.supervisor_name || ''),
        String(s.entry_type) === 'reimbursement_paid' ? 'reimbursement_paid' : 'deposit_received',
        Number(s.amount_bdt || 0),
        String(s.entry_datetime || now),
        String(s.entry_date || String(s.entry_datetime || now).slice(0, 10)),
        translatePaymentMethodToEnglish(String(s.payment_method || 'Cash')),
        String(s.reference || ''),
        String(s.note || ''),
        String(s.recorded_by || ''),
        String(s.created_at || now)
      );
    }
  }

  if (Array.isArray(backup.complaints)) {
    const ins = db.prepare(
      `INSERT INTO order_complaints (
        complaint_id, order_id, complaint_date, issue, action_taken, notes, status,
        return_visit_order_id, is_no_charge, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const raw of backup.complaints) {
      const c = raw as Record<string, unknown>;
      if (!c.complaint_id || !c.order_id) continue;
      ins.run(
        String(c.complaint_id),
        String(c.order_id),
        String(c.complaint_date || getTodayDhakaIso()),
        String(c.issue || ''),
        String(c.action_taken || ''),
        String(c.notes || ''),
        normalizeComplaintStatus(String(c.status || 'Open')),
        String(c.return_visit_order_id || ''),
        c.is_no_charge === false || Number(c.is_no_charge) === 0 ? 0 : 1,
        String(c.created_by || ''),
        String(c.created_at || now),
        String(c.updated_at || now)
      );
    }
  }

  backfillCustomersFromOrders(db);
}

// Re-export helpers needed by server.ts / excelExport.ts
export { translateServiceToEnglish };
