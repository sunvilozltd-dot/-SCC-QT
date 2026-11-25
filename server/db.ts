import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import {
  AdminBootstrapPayload,
  AppSettings,
  AuthUser,
  BackupHistoryRecord,
  BackupValidationSummary,
  DocumentPadConfig,
  FollowupMode,
  FollowupUnit,
  IssuedPdfRecord,
  IssuedPdfSummary,
  LEAD_CHANNELS,
  LEAD_STAGES,
  LeadChannel,
  LeadNoteRecord,
  LeadRecord,
  LeadStage,
  MoneyReceiptRecord,
  OrderRecord,
  OrderStatus,
  OtherExpenseItem,
  OverheadExpenseRecord,
  PadFieldConfig,
  PadType,
  PAYMENT_METHODS,
  PaymentMethod,
  QUOTATION_STATUSES,
  QuotationItem,
  QuotationRecord,
  QuotationStatus,
  ReminderLogRecord,
  SettlementStatus,
  StatusHistoryRecord,
  SupervisorAccount,
  SupervisorJobView,
  VALID_STATUSES,
} from '../src/types/order.ts';
import {
  addCalendarDays,
  addCalendarMonths,
  bnToEnDigits,
  computeEndTime24,
  getNowDhakaTimestamp,
  getTodayDhakaIso,
  isValidIsoDate,
  normalizeBangladeshPhone,
  normalizeExpenseCategory,
  normalizeLeadChannel,
  normalizeLeadSource,
  normalizeLeadStage,
  normalizeOptionalContactPhone,
  normalizeOrderStatus,
  normalizeQuotationStatus,
  normalizeSettlementStatus,
  translatePaymentMethodToEnglish,
  validateSafeExternalUrl,
} from '../src/utils/dateAndPhone.ts';
import { getDefaultPadFields } from '../src/utils/padDefaults.ts';
import {
  AuthUserWithVersion,
  configureSessionSigningSecret,
  hashPassword,
  verifyPassword,
} from './auth.ts';
import {
  bumpSyncRevision,
  consumeWebAuthnChallenge,
  createPersistentSession,
  getIdempotentResponse,
  getOrCreateInternalSigningKey,
  getWebAuthnCredentialById,
  initMobileSecuritySchema,
  isSessionActive,
  listActiveSessionsForUser,
  listEnrolledDevicesForUser,
  listWebAuthnCredentialsForUser,
  listWebAuthnCredentialsForUserAndDevice,
  revokeAllSessionsForUser,
  revokeAllWebAuthnCredentialsForUser,
  revokeSessionById,
  revokeSessionsForDevice,
  revokeWebAuthnCredentialAndSessions,
  saveWebAuthnChallenge,
  saveWebAuthnCredential,
  storeIdempotentResponse,
  touchSession,
  updateWebAuthnCredentialCounter,
  validatePersistentSessionCookie,
} from './mobileSecurityDb.ts';
import {
  checkScheduleConflicts as extCheckScheduleConflicts,
  confirmOrderWorkersOnCompletion,
  correctOrderWorkerPaymentTx as extCorrectOrderWorkerPaymentTx,
  createBuildingTx as extCreateBuildingTx,
  createComplaintTx as extCreateComplaintTx,
  createCustomerTx as extCreateCustomerTx,
  createWorkerTx as extCreateWorkerTx,
  deleteBuildingTx as extDeleteBuildingTx,
  ensureCustomerForOrder,
  getAllOrderWorkersMap,
  getBuildingSummaryForSupervisor,
  getExtendedBackupTables,
  getOrderWorkersForOrder,
  initExtendedSchema,
  listAllComplaints,
  listAllSettlementEntries,
  listBuildings,
  listCustomers,
  listWorkerPaymentHistory,
  listWorkers,
  markOrderWorkerPaidTx as extMarkOrderWorkerPaidTx,
  recomputeOrderFinancialsAndSettlement,
  recordSettlementEntryTx as extRecordSettlementEntryTx,
  restoreExtendedBackupTablesTx,
  syncOrderWorkersOnSave,
  updateBuildingTx as extUpdateBuildingTx,
  updateComplaintTx as extUpdateComplaintTx,
  updateCustomerTx as extUpdateCustomerTx,
  updateQuotationFollowupTx as extUpdateQuotationFollowupTx,
  updateWorkerTx as extUpdateWorkerTx,
} from './dbExtensions.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'sunviloz.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================================
// SCHEMA INITIALIZATION & SAFE MIGRATION
// ============================================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK(role IN ('admin', 'supervisor')),
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    phone_display TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quotations (
    quotation_id TEXT PRIMARY KEY,
    quotation_date TEXT NOT NULL,
    valid_until TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL,
    phone_display TEXT NOT NULL,
    phone_e164 TEXT NOT NULL,
    address TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '',
    items_json TEXT NOT NULL,
    subtotal_bdt INTEGER NOT NULL DEFAULT 0,
    discount_bdt INTEGER NOT NULL DEFAULT 0,
    total_bdt INTEGER NOT NULL DEFAULT 0,
    terms TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'খসড়া',
    converted_order_id TEXT NOT NULL DEFAULT '',
    pad_snapshot_json TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    quotation_id TEXT NOT NULL DEFAULT '',
    receipt_id TEXT NOT NULL DEFAULT '',
    previous_order_id TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL,
    phone_display TEXT NOT NULL,
    phone_e164 TEXT NOT NULL,
    address TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '',
    services_json TEXT NOT NULL,
    services_text TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
    scheduled_time TEXT NOT NULL DEFAULT '10:00',
    price_bdt INTEGER NOT NULL DEFAULT 0,
    instructions TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    assigned_supervisor_id TEXT NOT NULL DEFAULT '',
    assigned_supervisor_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'নতুন',

    advance_given INTEGER NOT NULL DEFAULT 0,
    advance_supervisor_id TEXT NOT NULL DEFAULT '',
    advance_supervisor_name TEXT NOT NULL DEFAULT '',
    advance_given_at TEXT NOT NULL DEFAULT '',

    completion_date TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT '',
    completed_by_user_id TEXT NOT NULL DEFAULT '',
    completed_by_name TEXT NOT NULL DEFAULT '',
    full_bill_collected INTEGER NOT NULL DEFAULT 0,
    status_locked INTEGER NOT NULL DEFAULT 0,
    status_locked_at TEXT NOT NULL DEFAULT '',
    payment_collected_at TEXT NOT NULL DEFAULT '',
    collected_by_name TEXT NOT NULL DEFAULT '',
    transport_cost INTEGER NOT NULL DEFAULT 0,
    meals_cost INTEGER NOT NULL DEFAULT 0,
    other_expenses_json TEXT NOT NULL DEFAULT '[]',
    other_expenses_total INTEGER NOT NULL DEFAULT 0,
    actual_expenses INTEGER NOT NULL DEFAULT 0,
    supervisor_settlement INTEGER NOT NULL DEFAULT 0,
    job_profit_or_loss INTEGER NOT NULL DEFAULT 0,

    settlement_status TEXT NOT NULL DEFAULT 'প্রযোজ্য নয়',
    settlement_confirmed_at TEXT NOT NULL DEFAULT '',
    settlement_confirmed_by TEXT NOT NULL DEFAULT '',
    settlement_note TEXT NOT NULL DEFAULT '',

    followup_date TEXT NOT NULL DEFAULT '',
    followup_rule_note TEXT NOT NULL DEFAULT '',
    followup_version INTEGER NOT NULL DEFAULT 0,
    reminder_sent INTEGER NOT NULL DEFAULT 0,
    reminder_sent_at TEXT NOT NULL DEFAULT '',
    reminder_sent_for_date TEXT NOT NULL DEFAULT '',
    reminder_sent_version INTEGER NOT NULL DEFAULT 0,
    followup_done INTEGER NOT NULL DEFAULT 0,
    followup_done_at TEXT NOT NULL DEFAULT '',

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS receipts (
    receipt_id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    receipt_date TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone_display TEXT NOT NULL,
    address TEXT NOT NULL,
    services_text TEXT NOT NULL,
    amount_received INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    transaction_ref TEXT NOT NULL DEFAULT '',
    received_by TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    pad_snapshot_json TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS overhead_expenses (
    id TEXT PRIMARY KEY,
    expense_date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_bdt INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_pads (
    pad_type TEXT PRIMARY KEY CHECK(pad_type IN ('quotation', 'receipt')),
    version INTEGER NOT NULL DEFAULT 1,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    image_data_url TEXT NOT NULL,
    page_width_mm REAL NOT NULL DEFAULT 210,
    page_height_mm REAL NOT NULL DEFAULT 297,
    fields_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    drive_file_id TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS status_history (
    history_id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    previous_status TEXT NOT NULL DEFAULT '',
    new_status TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    changed_by TEXT NOT NULL DEFAULT '',
    changed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reminder_logs (
    log_id TEXT PRIMARY KEY,
    dedupe_key TEXT NOT NULL,
    order_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone_display TEXT NOT NULL,
    services_text TEXT NOT NULL,
    completion_date TEXT NOT NULL DEFAULT '',
    followup_date TEXT NOT NULL DEFAULT '',
    recipient_email TEXT NOT NULL,
    send_type TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    lead_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone_display TEXT NOT NULL,
    phone_e164 TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '',
    building_org TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    contact_role TEXT NOT NULL DEFAULT '',
    interested_services_json TEXT NOT NULL DEFAULT '[]',
    interested_services_text TEXT NOT NULL DEFAULT '',
    lead_source TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'নতুন',
    next_followup_date TEXT NOT NULL DEFAULT '',
    followup_done INTEGER NOT NULL DEFAULT 0,
    followup_done_at TEXT NOT NULL DEFAULT '',
    followup_version INTEGER NOT NULL DEFAULT 0,
    reminder_sent INTEGER NOT NULL DEFAULT 0,
    reminder_sent_at TEXT NOT NULL DEFAULT '',
    reminder_sent_for_date TEXT NOT NULL DEFAULT '',
    reminder_sent_version INTEGER NOT NULL DEFAULT 0,
    linked_quotation_id TEXT NOT NULL DEFAULT '',
    linked_order_id TEXT NOT NULL DEFAULT '',
    agent_name TEXT NOT NULL DEFAULT '',
    agent_phone_display TEXT NOT NULL DEFAULT '',
    agent_phone_e164 TEXT NOT NULL DEFAULT '',
    agent_note TEXT NOT NULL DEFAULT '',
    caretaker_name TEXT NOT NULL DEFAULT '',
    caretaker_phone_display TEXT NOT NULL DEFAULT '',
    caretaker_phone_e164 TEXT NOT NULL DEFAULT '',
    caretaker_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lead_notes (
    note_id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'কল',
    note_text TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issued_pdfs (
    pdf_id TEXT PRIMARY KEY,
    doc_type TEXT NOT NULL CHECK(doc_type IN ('quotation', 'receipt')),
    doc_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    pdf_base64 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(doc_type, doc_id)
  );

  CREATE TABLE IF NOT EXISTS backup_history (
    backup_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('verified', 'failed')),
    file_name TEXT NOT NULL,
    drive_file_id TEXT NOT NULL DEFAULT '',
    drive_account_email TEXT NOT NULL DEFAULT '',
    folder_name TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    checksum_sha256 TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

// Safe additive column migrations for existing databases (preserves all saved records)
function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('orders', 'booking_date', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'lead_id', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'status_locked', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'status_locked_at', "TEXT NOT NULL DEFAULT ''");
ensureColumn('quotations', 'lead_id', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('leads', 'agent_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('leads', 'agent_phone_display', "TEXT NOT NULL DEFAULT ''");
ensureColumn('leads', 'agent_phone_e164', "TEXT NOT NULL DEFAULT ''");
ensureColumn('leads', 'agent_note', "TEXT NOT NULL DEFAULT ''");
ensureColumn('leads', 'caretaker_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('leads', 'caretaker_phone_display', "TEXT NOT NULL DEFAULT ''");
ensureColumn('leads', 'caretaker_phone_e164', "TEXT NOT NULL DEFAULT ''");
ensureColumn('leads', 'caretaker_note', "TEXT NOT NULL DEFAULT ''");

// Backfill status_locked strictly when BOTH status='Completed' AND full_bill_collected=1
db.exec(`
  UPDATE orders
  SET status_locked = 1,
      status_locked_at = COALESCE(NULLIF(status_locked_at, ''), NULLIF(payment_collected_at, ''), NULLIF(completed_at, ''), updated_at)
  WHERE status IN ('Completed', 'সম্পন্ন') AND full_bill_collected = 1 AND status_locked = 0;

  UPDATE orders
  SET status_locked = 0,
      status_locked_at = ''
  WHERE (status NOT IN ('Completed', 'সম্পন্ন') OR full_bill_collected = 0) AND status_locked != 0;
`);

// Initialize extended schema (customers, buildings, workers, order_workers, settlement entries, complaints, etc.)
initExtendedSchema(db);
// Initialize mobile security schema (revocable sessions, WebAuthn device credentials, idempotency keys)
initMobileSecuritySchema(db);
configureSessionSigningSecret(getOrCreateInternalSigningKey(db));

function makeUid(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function getSettingRaw(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : fallback;
}

export function setSettingRaw(key: string, value: string): void {
  const now = getNowDhakaTimestamp();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
}

export const INITIAL_ADMIN_USERNAME = 'scc@gmail.com';

// Seed default settings safely (preserving any saved settings)
const INITIAL_SETTINGS: Record<string, string> = {
  default_followup_value: '6',
  default_followup_unit: 'months',
  reminder_email: 'sunvilozltd@gmail.com',
  owner_email: INITIAL_ADMIN_USERNAME,
  daily_reminder_hour: '9',
  order_sequence: '0',
  quotation_sequence: '0',
  receipt_sequence: '0',
  lead_sequence: '0',
  google_webapp_url: '',
  google_sync_secret: '',
  last_google_sync_at: '',
  last_google_sync_status: 'idle',
  last_google_sync_error: '',
  last_drive_backup_at: '',
  reminder_trigger_status: 'Setup Pending',
  reminders_paused_after_restore: '0',
  schedule_conflict_buffer_mins: '60',
  company_logo_data_url: '',
  company_logo_file_name: '',
  company_logo_mime_type: '',
  company_logo_updated_at: '',
  primary_drive_email: '',
  primary_drive_folder_label: 'Private App Data Folder (appDataFolder)',
  primary_drive_file_id: '',
  sync_revision: '1',
  primary_drive_last_synced_revision: '0',
  primary_drive_last_synced_at: '',
  primary_drive_last_error: '',
  primary_drive_last_checksum: '',
  secondary_drive_email: '',
  secondary_drive_folder_id: '',
  secondary_drive_folder_name: 'SUNVILOZ Clean Care Backups',
  secondary_drive_webapp_url: '',
  secondary_drive_sync_secret: '',
  auto_backup_enabled: '0',
  auto_backup_hour: '2',
  last_verified_backup_at: '',
  last_verified_backup_file: '',
  last_backup_error: '',
  last_auto_backup_date: '',
};

for (const [k, v] of Object.entries(INITIAL_SETTINGS)) {
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k) === undefined) {
    setSettingRaw(k, v);
  }
}

/**
 * Fixed initial admin initialization:
 * - If no admin account exists yet in SQLite AND server-side ADMIN_PASSWORD is configured (>= 6 chars),
 *   create the initial admin with username strictly set to 'scc@gmail.com' and salted scrypt hash.
 * - If an admin account ALREADY exists in SQLite, preserve its username and password hash across restarts
 *   so explicit changes made in Account Settings are never overwritten.
 * - If no admin exists and ADMIN_PASSWORD is unset, initial setup stays locked so public visitors cannot claim admin.
 */
export function ensureInitialAdminFromEnv(): void {
  const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existingAdmin) {
    return;
  }
  // Treat ADMIN_PASSWORD as an exact value (never trim or mutate symbols/spaces)
  const envAdminPass = String(process.env.ADMIN_PASSWORD || '');
  if (envAdminPass.length >= 6) {
    const now = getNowDhakaTimestamp();
    db.prepare(
      `INSERT OR IGNORE INTO users (
        id, role, name, username, phone_display, password_hash, is_active, token_version, created_at, updated_at
      ) VALUES (?, 'admin', 'SUNVILOZ Admin', ?, '', ?, 1, 1, ?, ?)`
    ).run('ADM-PRIMARY', INITIAL_ADMIN_USERNAME, hashPassword(envAdminPass), now, now);
    setSettingRaw('owner_email', INITIAL_ADMIN_USERNAME);
  }
}

ensureInitialAdminFromEnv();

// ============================================================================
// FINANCIAL & FOLLOW-UP CALCULATIONS (TRUSTED SERVER FORMULAS)
// ============================================================================

export function calculateJobFinancials(params: {
  agreedBill: number;
  advanceGiven: number;
  transportCost: number;
  mealsCost: number;
  otherExpenses: OtherExpenseItem[];
}) {
  const fullJobBill = Math.max(0, Math.round(params.agreedBill));
  const advanceGiven = Math.max(0, Math.round(params.advanceGiven));
  const transport = Math.max(0, Math.round(params.transportCost));
  const meals = Math.max(0, Math.round(params.mealsCost));
  const otherTotal = params.otherExpenses.reduce(
    (sum, item) => sum + Math.max(0, Math.round(item.amount)),
    0
  );

  // Exact required formulas:
  // actualExpenses = transport + meals + otherExpenses
  // supervisorSettlement = fullJobBill + advanceGiven - actualExpenses
  // jobProfitOrLoss = fullJobBill - actualExpenses
  const actualExpenses = transport + meals + otherTotal;
  const supervisorSettlement = fullJobBill + advanceGiven - actualExpenses;
  const jobProfitOrLoss = fullJobBill - actualExpenses;

  return {
    fullJobBill,
    advanceGiven,
    transport,
    meals,
    otherTotal,
    actualExpenses,
    supervisorSettlement,
    jobProfitOrLoss,
  };
}

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseNonNegativeAmount(raw: unknown, fieldLabel: string): number {
  const str = bnToEnDigits(String(raw ?? '0')).trim();
  if (str === '') return 0;
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0 || num > 10000000) {
    throw new Error(`${fieldLabel} must be a valid non-negative number.`);
  }
  return Math.round(num);
}

function parseNonNegativeDecimal(raw: unknown, fieldLabel: string): number {
  const str = bnToEnDigits(String(raw ?? '0')).trim();
  if (str === '') return 0;
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0 || num > 10000000) {
    throw new Error(`${fieldLabel} must be a valid non-negative number.`);
  }
  return roundMoney2(num);
}

function parseOtherExpenses(raw: unknown): OtherExpenseItem[] {
  if (!Array.isArray(raw)) return [];
  const items: OtherExpenseItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as { description?: unknown; amount?: unknown };
    const desc = String(obj.description ?? '').trim().slice(0, 200);
    const amount = parseNonNegativeAmount(obj.amount, 'Other expense');
    if (amount === 0 && !desc) continue;
    if (amount > 0 && !desc) {
      throw new Error('Please enter a description for each other expense item.');
    }
    items.push({ description: desc || 'Other', amount });
  }
  return items;
}

export function computeFollowupForServer(
  input: {
    followup_mode?: FollowupMode;
    custom_value?: number;
    custom_unit?: FollowupUnit;
    followup_date?: string;
  },
  baseDate: string
): { followupDate: string; ruleNote: string } {
  const mode = input.followup_mode || 'default';
  if (mode === 'exact') {
    const exact = String(input.followup_date || '').trim();
    if (!isValidIsoDate(exact)) {
      throw new Error('Please select a valid follow-up date.');
    }
    return { followupDate: exact, ruleNote: 'Exact Date' };
  }

  if (mode === 'custom') {
    const val = parseInt(String(input.custom_value ?? ''), 10);
    const unit = input.custom_unit === 'days' ? 'days' : 'months';
    if (!Number.isInteger(val) || val < 1 || val > 3650) {
      throw new Error('Custom follow-up interval must be between 1 and 3650.');
    }
    const date =
      unit === 'months' ? addCalendarMonths(baseDate, val) : addCalendarDays(baseDate, val);
    return {
      followupDate: date,
      ruleNote: `${val} ${unit === 'months' ? (val === 1 ? 'month' : 'months') : val === 1 ? 'day' : 'days'} (Custom)`,
    };
  }

  const defVal = parseInt(getSettingRaw('default_followup_value', '6'), 10) || 6;
  const defUnit = getSettingRaw('default_followup_unit', 'months') === 'days' ? 'days' : 'months';
  const date =
    defUnit === 'months'
      ? addCalendarMonths(baseDate, defVal)
      : addCalendarDays(baseDate, defVal);
  return {
    followupDate: date,
    ruleNote: `${defVal} ${defUnit === 'months' ? (defVal === 1 ? 'month' : 'months') : defVal === 1 ? 'day' : 'days'} (Default)`,
  };
}

// ============================================================================
// AUTH & USER MANAGEMENT
// ============================================================================

export function hasAdminClaimed(): boolean {
  const row = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  return Boolean(row);
}

export function isEnvAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && String(process.env.ADMIN_PASSWORD).length >= 6);
}

export const AUTHORIZED_GOOGLE_ADMIN_EMAIL = 'sunvilozltd@gmail.com';

/**
 * Returns the verified Primary Google Account Owner email allowed for Admin Google
 * sign-in and Admin password reset (defaults strictly to sunvilozltd@gmail.com).
 * NEVER uses the app username (scc@gmail.com).
 */
export function getAuthorizedGoogleOwnerEmail(): string {
  const envOwner = String(process.env.AUTHORIZED_GOOGLE_OWNER_EMAIL || '')
    .trim()
    .toLowerCase();
  if (envOwner && envOwner.includes('@')) {
    return envOwner;
  }
  const primaryDrive = getSettingRaw('primary_drive_email', '').trim().toLowerCase();
  if (primaryDrive && primaryDrive.includes('@')) {
    return primaryDrive;
  }
  return AUTHORIZED_GOOGLE_ADMIN_EMAIL;
}

/**
 * Owner-only CLI helper (NEVER exposed over HTTP).
 * Preserves ADM-PRIMARY, existing username, and all business data; replaces salted hash
 * and revokes all existing sessions immediately.
 */
export function ownerResetOrInitAdminLocal(newExactPassword: string): AuthUser {
  const exactPass = String(newExactPassword || '');
  if (exactPass.length < 6) {
    throw new Error('Admin password must be at least 6 characters.');
  }
  if (exactPass.length > 128) {
    throw new Error('Admin password must be 128 characters or fewer.');
  }
  const now = getNowDhakaTimestamp();
  const existing = db
    .prepare("SELECT id, username, token_version FROM users WHERE role = 'admin' LIMIT 1")
    .get() as { id: string; username: string; token_version: number } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO users (
        id, role, name, username, phone_display, password_hash, is_active, token_version, created_at, updated_at
      ) VALUES ('ADM-PRIMARY', 'admin', 'SUNVILOZ Admin', ?, '', ?, 1, 1, ?, ?)`
    ).run(INITIAL_ADMIN_USERNAME, hashPassword(exactPass), now, now);
    return getUserById('ADM-PRIMARY')!;
  }

  const nextTv = Number(existing.token_version || 1) + 1;
  db.prepare(
    `UPDATE users
     SET password_hash = ?,
         token_version = ?,
         is_active = 1,
         updated_at = ?
     WHERE id = ?`
  ).run(hashPassword(exactPass), nextTv, now, existing.id);
  revokeAllSessionsForUser(db, existing.id, 'owner_password_reset');
  return getUserById(existing.id)!;
}

export function getUserAuthRecordById(id: string): AuthUserWithVersion | null {
  const row = db
    .prepare(
      'SELECT id, role, name, username, phone_display, is_active, token_version FROM users WHERE id = ?'
    )
    .get(id) as
    | {
        id: string;
        role: 'admin' | 'supervisor';
        name: string;
        username: string;
        phone_display: string;
        is_active: number;
        token_version: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    username: row.username,
    phone_display: row.phone_display,
    is_active: row.is_active === 1,
    token_version: Number(row.token_version || 1),
  };
}

export function getUserTokenVersion(id: string): number {
  const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(id) as
    | { token_version: number }
    | undefined;
  return Number(row?.token_version || 1);
}

export function getUserById(id: string): AuthUser | null {
  const rec = getUserAuthRecordById(id);
  if (!rec) return null;
  const { token_version: _tv, ...safe } = rec;
  return safe;
}

export function claimInitialAdmin(_payload: {
  name: string;
  username: string;
  password: string;
}): AuthUser {
  throw new Error(
    `Access denied. Initial admin setup is locked to prevent unauthorized claiming. Configure server-side ADMIN_PASSWORD to initialize the fixed admin account (${INITIAL_ADMIN_USERNAME}).`
  );
}

export function getAdminAccountEmailHint(): string {
  const admin = db
    .prepare("SELECT username FROM users WHERE role = 'admin' LIMIT 1")
    .get() as { username: string } | undefined;
  return admin?.username || INITIAL_ADMIN_USERNAME;
}

export function authenticateUser(usernameRaw: string, password: string): AuthUser {
  const username = String(usernameRaw || '').trim().toLowerCase();
  if (!username || !password) {
    throw new Error('Username and password are required.');
  }

  // Ensure initial admin is seeded from ADMIN_PASSWORD on a fresh database
  ensureInitialAdminFromEnv();

  const userRow = db
    .prepare('SELECT * FROM users WHERE lower(username) = ?')
    .get(username) as
    | {
        id: string;
        role: 'admin' | 'supervisor';
        name: string;
        username: string;
        phone_display: string;
        password_hash: string;
        is_active: number;
      }
    | undefined;

  if (!userRow) {
    throw new Error('Invalid username or password.');
  }
  if (userRow.is_active !== 1) {
    throw new Error('This account has been deactivated. Please contact the administrator.');
  }
  if (!verifyPassword(password, userRow.password_hash)) {
    throw new Error('Invalid username or password.');
  }

  return {
    id: userRow.id,
    role: userRow.role,
    name: userRow.name,
    username: userRow.username,
    phone_display: userRow.phone_display,
    is_active: true,
  };
}

export function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string
): AuthUser {
  const cur = String(currentPassword || '');
  const next = String(newPassword || '');
  if (!cur) {
    throw new Error('Current password is required.');
  }
  if (next.length < 6) {
    throw new Error('New password must be at least 6 characters.');
  }
  if (next.length > 128) {
    throw new Error('New password must be 128 characters or fewer.');
  }
  if (cur === next) {
    throw new Error('New password must be different from your current password.');
  }

  const userRow = db
    .prepare(
      'SELECT id, role, name, username, phone_display, password_hash, is_active, token_version FROM users WHERE id = ?'
    )
    .get(userId) as
    | {
        id: string;
        role: 'admin' | 'supervisor';
        name: string;
        username: string;
        phone_display: string;
        password_hash: string;
        is_active: number;
        token_version: number;
      }
    | undefined;

  if (!userRow || userRow.is_active !== 1) {
    throw new Error('Account not found or inactive.');
  }

  if (!verifyPassword(cur, userRow.password_hash)) {
    throw new Error('Current password is incorrect.');
  }

  const now = getNowDhakaTimestamp();
  const newHash = hashPassword(next);
  const nextTokenVersion = Number(userRow.token_version || 1) + 1;
  db.prepare(
    `UPDATE users
     SET password_hash = ?,
         token_version = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(newHash, nextTokenVersion, now, userRow.id);

  // Immediately revoke all other sessions; update kept session token_version if present
  revokeAllSessionsForUser(db, userRow.id, 'password_changed', keepSessionId);
  if (keepSessionId) {
    touchSession(db, keepSessionId, nextTokenVersion);
  }

  return getUserById(userRow.id)!;
}

/**
 * Admin-only Account Settings credential update (username and/or password).
 * Always requires re-authentication via current_password.
 * Preserves changes in SQLite across restarts and revokes all other sessions immediately.
 */
export function updateAdminAccountCredentials(
  userId: string,
  payload: {
    current_password: string;
    new_username?: string;
    new_password?: string;
  },
  keepSessionId?: string
): { user: AuthUser; usernameChanged: boolean; passwordChanged: boolean } {
  const cur = String(payload.current_password || '');
  if (!cur) {
    throw new Error('Current password is required to re-authenticate before making account changes.');
  }

  const userRow = db
    .prepare(
      'SELECT id, role, name, username, phone_display, password_hash, is_active, token_version FROM users WHERE id = ?'
    )
    .get(userId) as
    | {
        id: string;
        role: 'admin' | 'supervisor';
        name: string;
        username: string;
        phone_display: string;
        password_hash: string;
        is_active: number;
        token_version: number;
      }
    | undefined;

  if (!userRow || userRow.is_active !== 1) {
    throw new Error('Account not found or inactive.');
  }
  if (userRow.role !== 'admin') {
    throw new Error('Access denied. Only administrators can update the admin username.');
  }
  if (!verifyPassword(cur, userRow.password_hash)) {
    throw new Error('Re-authentication failed: current password is incorrect.');
  }

  const requestedUsername =
    payload.new_username !== undefined ? String(payload.new_username).trim().toLowerCase() : '';
  const requestedPassword =
    payload.new_password !== undefined ? String(payload.new_password) : '';

  let nextUsername = userRow.username;
  let usernameChanged = false;
  if (requestedUsername && requestedUsername !== userRow.username.toLowerCase()) {
    if (requestedUsername.length < 3 || /\s/.test(requestedUsername)) {
      throw new Error('Admin username must be at least 3 characters with no spaces.');
    }
    const conflict = db
      .prepare('SELECT id FROM users WHERE lower(username) = ? AND id != ?')
      .get(requestedUsername, userRow.id);
    if (conflict) {
      throw new Error('That username is already in use by another account.');
    }
    nextUsername = requestedUsername;
    usernameChanged = true;
  }

  let nextHash = userRow.password_hash;
  let passwordChanged = false;
  if (requestedPassword.length > 0) {
    if (requestedPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    if (requestedPassword.length > 128) {
      throw new Error('New password must be 128 characters or fewer.');
    }
    if (requestedPassword === cur) {
      throw new Error('New password must be different from your current password.');
    }
    nextHash = hashPassword(requestedPassword);
    passwordChanged = true;
  }

  if (!usernameChanged && !passwordChanged) {
    throw new Error('Enter a new username or new password to update.');
  }

  const now = getNowDhakaTimestamp();
  const nextTokenVersion = Number(userRow.token_version || 1) + 1;
  db.prepare(
    `UPDATE users
     SET username = ?,
         password_hash = ?,
         token_version = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(nextUsername, nextHash, nextTokenVersion, now, userRow.id);

  if (usernameChanged && nextUsername.includes('@')) {
    setSettingRaw('owner_email', nextUsername);
  }

  revokeAllSessionsForUser(
    db,
    userRow.id,
    passwordChanged ? 'password_changed' : 'username_changed',
    keepSessionId
  );
  if (keepSessionId) {
    touchSession(db, keepSessionId, nextTokenVersion);
  }

  return {
    user: getUserById(userRow.id)!,
    usernameChanged,
    passwordChanged,
  };
}

export function authenticateOrResetAdminByVerifiedEmail(
  verifiedEmailRaw: string,
  newPassword?: string,
  _displayName?: string
): AuthUser {
  const email = String(verifiedEmailRaw || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Verified Google email is required.');
  }

  ensureInitialAdminFromEnv();
  const existingAdmin = db
    .prepare("SELECT id, username, is_active, token_version FROM users WHERE role = 'admin' LIMIT 1")
    .get() as { id: string; username: string; is_active: number; token_version: number } | undefined;

  if (!existingAdmin) {
    throw new Error(
      `Access denied. Initial admin setup is locked. Set ADMIN_PASSWORD on the server to initialize ${INITIAL_ADMIN_USERNAME}.`
    );
  }
  if (existingAdmin.is_active !== 1) {
    throw new Error('Admin account is inactive.');
  }

  const authorizedOwnerEmail = getAuthorizedGoogleOwnerEmail();
  if (!authorizedOwnerEmail) {
    throw new Error(
      'Google Admin password reset is disabled until a Primary Google Account Owner is verified and linked.'
    );
  }
  if (email !== authorizedOwnerEmail) {
    throw new Error(
      `Access denied. Please sign in with the authorized Primary Google account owner (${authorizedOwnerEmail}).`
    );
  }

  const nextPass = typeof newPassword === 'string' && newPassword.length > 0 ? newPassword : '';
  if (nextPass) {
    if (nextPass.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    if (nextPass.length > 128) {
      throw new Error('New password must be 128 characters or fewer.');
    }
    const now = getNowDhakaTimestamp();
    const newHash = hashPassword(nextPass);
    const nextTv = Number(existingAdmin.token_version || 1) + 1;
    db.prepare(
      `UPDATE users
       SET password_hash = ?,
           token_version = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(newHash, nextTv, now, existingAdmin.id);
    revokeAllSessionsForUser(db, existingAdmin.id, 'password_reset');
  }

  return getUserById(existingAdmin.id)!;
}

export function listSupervisors(): SupervisorAccount[] {
  const rows = db
    .prepare(
      "SELECT id, name, username, phone_display, is_active, created_at, updated_at FROM users WHERE role = 'supervisor' ORDER BY created_at DESC"
    )
    .all() as Array<{
    id: string;
    name: string;
    username: string;
    phone_display: string;
    is_active: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username,
    phone_display: r.phone_display,
    is_active: r.is_active === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function createSupervisorAccount(payload: {
  name: string;
  username: string;
  phone: string;
  password: string;
}): SupervisorAccount {
  const name = String(payload.name || '').trim();
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  if (!name) throw new Error('Supervisor name is required.');
  if (!username || username.length < 3 || /\s/.test(username)) {
    throw new Error('Please enter a valid username (at least 3 characters, no spaces).');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  let phoneDisplay = '';
  if (payload.phone && payload.phone.trim()) {
    const norm = normalizeBangladeshPhone(payload.phone);
    if (!norm) {
      throw new Error('Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX).');
    }
    phoneDisplay = norm.display;
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE lower(username) = ?')
    .get(username.toLowerCase());
  if (existing) {
    throw new Error('This username is already taken. Please choose another username.');
  }

  const now = getNowDhakaTimestamp();
  const id = makeUid('SUP');
  db.prepare(
    `INSERT INTO users (id, role, name, username, phone_display, password_hash, is_active, token_version, created_at, updated_at)
     VALUES (?, 'supervisor', ?, ?, ?, ?, 1, 1, ?, ?)`
  ).run(id, name, username, phoneDisplay, hashPassword(password), now, now);

  return listSupervisors().find((s) => s.id === id)!;
}

export function updateSupervisorAccount(
  id: string,
  payload: {
    name?: string;
    phone?: string;
    is_active?: boolean;
    password?: string;
  }
): SupervisorAccount {
  const existing = db
    .prepare("SELECT * FROM users WHERE id = ? AND role = 'supervisor'")
    .get(id) as
    | {
        id: string;
        name: string;
        username: string;
        phone_display: string;
        password_hash: string;
        is_active: number;
        token_version: number;
      }
    | undefined;
  if (!existing) throw new Error('Supervisor account not found.');

  const name = payload.name !== undefined ? String(payload.name).trim() : existing.name;
  if (!name) throw new Error('Supervisor name is required.');

  let phoneDisplay = existing.phone_display;
  if (payload.phone !== undefined) {
    if (!payload.phone.trim()) {
      phoneDisplay = '';
    } else {
      const norm = normalizeBangladeshPhone(payload.phone);
      if (!norm) throw new Error('Please enter a valid Bangladesh mobile number.');
      phoneDisplay = norm.display;
    }
  }

  const isActive =
    payload.is_active !== undefined ? (payload.is_active ? 1 : 0) : existing.is_active;

  let passwordHash = existing.password_hash;
  let passwordChanged = false;
  if (payload.password !== undefined && payload.password.length > 0) {
    if (payload.password.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    passwordHash = hashPassword(payload.password);
    passwordChanged = true;
  }

  // Revoke all existing sessions immediately on password reset OR active-status change!
  const statusChanged = isActive !== existing.is_active;
  const nextTokenVersion =
    passwordChanged || statusChanged
      ? Number(existing.token_version || 1) + 1
      : Number(existing.token_version || 1);

  const now = getNowDhakaTimestamp();
  db.prepare(
    `UPDATE users SET name = ?, phone_display = ?, is_active = ?, password_hash = ?, token_version = ?, updated_at = ? WHERE id = ?`
  ).run(name, phoneDisplay, isActive, passwordHash, nextTokenVersion, now, id);

  if (passwordChanged || statusChanged) {
    revokeAllSessionsForUser(
      db,
      id,
      !isActive ? 'account_deactivated' : 'password_reset'
    );
  }
  if (!isActive) {
    revokeAllWebAuthnCredentialsForUser(db, id);
  }

  // Sync display name onto assigned orders
  if (name !== existing.name) {
    db.prepare('UPDATE orders SET assigned_supervisor_name = ? WHERE assigned_supervisor_id = ?').run(
      name,
      id
    );
  }

  return listSupervisors().find((s) => s.id === id)!;
}

// ============================================================================
// ROW MAPPERS
// ============================================================================

function mapOrderRow(
  row: Record<string, unknown>,
  workersByOrder?: Map<string, ReturnType<typeof getOrderWorkersForOrder>>
): OrderRecord {
  let services: string[] = [];
  try {
    const parsed = JSON.parse(String(row.services_json || '[]'));
    if (Array.isArray(parsed)) services = parsed.map(String);
  } catch {
    services = String(row.services_text || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  let otherExpenses: OtherExpenseItem[] = [];
  try {
    const parsed = JSON.parse(String(row.other_expenses_json || '[]'));
    if (Array.isArray(parsed)) otherExpenses = parsed;
  } catch {
    otherExpenses = [];
  }

  const orderId = String(row.order_id);
  const assignedWorkers = workersByOrder
    ? workersByOrder.get(orderId) || []
    : getOrderWorkersForOrder(db, orderId);

  const scheduledTime = String(row.scheduled_time || '10:00');
  const durationMins = Number(row.estimated_duration_mins || 120);
  const endTime =
    String(row.scheduled_end_time || '').trim() || computeEndTime24(scheduledTime, durationMins);

  return {
    order_id: orderId,
    quotation_id: String(row.quotation_id || ''),
    receipt_id: String(row.receipt_id || ''),
    previous_order_id: String(row.previous_order_id || ''),
    previous_work_date: String(row.previous_work_date || ''),
    lead_id: String(row.lead_id || ''),
    customer_id: String(row.customer_id || ''),
    building_id: String(row.building_id || ''),
    building_name: String(row.building_name || ''),
    customer_name: String(row.customer_name || ''),
    phone_display: String(row.phone_display || ''),
    phone_e164: String(row.phone_e164 || ''),
    address: String(row.address || ''),
    area: String(row.area || ''),
    services,
    services_text: String(row.services_text || services.join(', ')),
    booking_date: String(row.booking_date || ''),
    scheduled_date: String(row.scheduled_date || ''),
    scheduled_time: scheduledTime,
    estimated_duration_mins: durationMins,
    scheduled_end_time: endTime,
    price_bdt: Number(row.price_bdt || 0),
    instructions: String(row.instructions || ''),
    notes: String(row.notes || ''),
    lead_source: normalizeLeadSource(String(row.lead_source || '')),
    referral_contact_type: (String(row.referral_contact_type || '') as OrderRecord['referral_contact_type']),
    referral_contact_name: String(row.referral_contact_name || ''),
    referral_contact_phone: String(row.referral_contact_phone || ''),
    parent_order_id: String(row.parent_order_id || ''),
    is_return_visit: Number(row.is_return_visit || 0) === 1,
    is_no_charge_visit: Number(row.is_no_charge_visit || 0) === 1,
    complaint_id: String(row.complaint_id || ''),
    assigned_supervisor_id: String(row.assigned_supervisor_id || ''),
    assigned_supervisor_name: String(row.assigned_supervisor_name || ''),
    assigned_workers: assignedWorkers,
    status: normalizeOrderStatus(String(row.status || 'New')),
    status_locked:
      normalizeOrderStatus(String(row.status || 'New')) === 'Completed' &&
      Number(row.full_bill_collected || 0) === 1,
    status_locked_at:
      normalizeOrderStatus(String(row.status || 'New')) === 'Completed' &&
      Number(row.full_bill_collected || 0) === 1
        ? String(row.status_locked_at || row.payment_collected_at || row.completed_at || '')
        : '',

    advance_given: Number(row.advance_given || 0),
    advance_supervisor_id: String(row.advance_supervisor_id || ''),
    advance_supervisor_name: String(row.advance_supervisor_name || ''),
    advance_given_at: String(row.advance_given_at || ''),

    completion_date: String(row.completion_date || ''),
    completed_at: String(row.completed_at || ''),
    completed_by_user_id: String(row.completed_by_user_id || ''),
    completed_by_name: String(row.completed_by_name || ''),
    full_bill_collected: Number(row.full_bill_collected || 0) === 1,
    payment_collected_at: String(row.payment_collected_at || ''),
    collected_by_name: String(row.collected_by_name || ''),
    transport_cost: Number(row.transport_cost || 0),
    meals_cost: Number(row.meals_cost || 0),
    other_expenses: otherExpenses,
    other_expenses_total: Number(row.other_expenses_total || 0),
    worker_pay_total: Number(row.worker_pay_total || 0),
    supervisor_paid_worker_total: Number(row.supervisor_paid_worker_total || 0),
    return_visit_expenses_total: Number(row.return_visit_expenses_total || 0),
    actual_expenses: Number(row.actual_expenses || 0),
    supervisor_settlement: Number(row.supervisor_settlement || 0),
    job_profit_or_loss: Number(row.job_profit_or_loss || 0),

    settlement_actual_total: Number(row.settlement_actual_total || 0),
    settlement_remaining: Number(row.settlement_remaining || 0),
    settlement_status: normalizeSettlementStatus(String(row.settlement_status || 'Not Applicable')),
    settlement_confirmed_at: String(row.settlement_confirmed_at || ''),
    settlement_confirmed_by: String(row.settlement_confirmed_by || ''),
    settlement_note: String(row.settlement_note || ''),

    followup_date: String(row.followup_date || ''),
    followup_rule_note: String(row.followup_rule_note || ''),
    followup_version: Number(row.followup_version || 0),
    reminder_sent: Number(row.reminder_sent || 0) === 1,
    reminder_sent_at: String(row.reminder_sent_at || ''),
    reminder_sent_for_date: String(row.reminder_sent_for_date || ''),
    reminder_sent_version: Number(row.reminder_sent_version || 0),
    followup_done: Number(row.followup_done || 0) === 1,
    followup_done_at: String(row.followup_done_at || ''),
    followup_converted_order_id: String(row.followup_converted_order_id || ''),

    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

export function projectSupervisorJob(order: OrderRecord): SupervisorJobView {
  return {
    order_id: order.order_id,
    customer_name: order.customer_name,
    phone_display: order.phone_display,
    phone_e164: order.phone_e164,
    address: order.address,
    area: order.area,
    building_summary: getBuildingSummaryForSupervisor(db, order.building_id),
    services: order.services,
    services_text: order.services_text,
    scheduled_date: order.scheduled_date,
    scheduled_time: order.scheduled_time,
    scheduled_end_time: order.scheduled_end_time,
    estimated_duration_mins: order.estimated_duration_mins,
    instructions: order.instructions,
    price_bdt: order.price_bdt,
    advance_given: order.advance_given,
    is_return_visit: order.is_return_visit,
    is_no_charge_visit: order.is_no_charge_visit,
    parent_order_id: order.parent_order_id,
    assigned_workers: order.assigned_workers.map((w) => ({
      id: w.id,
      worker_id: w.worker_id,
      worker_name: w.worker_name,
      confirmed_worked: w.confirmed_worked,
    })),
    status: order.status,
    status_locked: order.status_locked,
    status_locked_at: order.status_locked_at,
    completion_date: order.completion_date,
    completed_at: order.completed_at,
    full_bill_collected: order.full_bill_collected,
    transport_cost: order.transport_cost,
    meals_cost: order.meals_cost,
    other_expenses: order.other_expenses,
    actual_expenses: order.actual_expenses,
    supervisor_settlement: order.supervisor_settlement,
    settlement_status: order.settlement_status,
  };
}

function mapQuotationRow(row: Record<string, unknown>): QuotationRecord {
  let items: QuotationItem[] = [];
  try {
    items = JSON.parse(String(row.items_json || '[]'));
  } catch {
    items = [];
  }
  let padSnapshot: DocumentPadConfig | null = null;
  if (row.pad_snapshot_json) {
    try {
      padSnapshot = JSON.parse(String(row.pad_snapshot_json));
    } catch {
      padSnapshot = null;
    }
  }
  let statusHistory: QuotationRecord['status_history'] = [];
  try {
    const parsed = JSON.parse(String(row.status_history_json || '[]'));
    if (Array.isArray(parsed)) statusHistory = parsed;
  } catch {
    statusHistory = [];
  }
  return {
    quotation_id: String(row.quotation_id),
    lead_id: String(row.lead_id || ''),
    customer_id: String(row.customer_id || ''),
    building_id: String(row.building_id || ''),
    quotation_date: String(row.quotation_date),
    valid_until: String(row.valid_until || ''),
    customer_name: String(row.customer_name),
    phone_display: String(row.phone_display),
    phone_e164: String(row.phone_e164),
    address: String(row.address),
    area: String(row.area || ''),
    lead_source: normalizeLeadSource(String(row.lead_source || '')),
    referral_contact_type: String(row.referral_contact_type || '') as QuotationRecord['referral_contact_type'],
    referral_contact_name: String(row.referral_contact_name || ''),
    referral_contact_phone: String(row.referral_contact_phone || ''),
    items,
    subtotal_bdt: roundMoney2(Number(row.subtotal_bdt || 0)),
    discount_enabled: Number(row.discount_enabled || 0) === 1,
    discount_type: (String(row.discount_type || 'amount') === 'percent' ? 'percent' : 'amount') as 'amount' | 'percent',
    discount_value: roundMoney2(Number(row.discount_value || 0)),
    discount_bdt: roundMoney2(Number(row.discount_bdt || 0)),
    vat_enabled: Number(row.vat_enabled || 0) === 1,
    vat_type: (String(row.vat_type || 'percent') === 'amount' ? 'amount' : 'percent') as 'amount' | 'percent',
    vat_value: roundMoney2(Number(row.vat_value || 0)),
    vat_base: (String(row.vat_base || 'after_discount') === 'subtotal' ? 'subtotal' : 'after_discount') as 'subtotal' | 'after_discount',
    vat_bdt: roundMoney2(Number(row.vat_bdt || 0)),
    tax_enabled: Number(row.tax_enabled || 0) === 1,
    tax_type: (String(row.tax_type || 'percent') === 'amount' ? 'amount' : 'percent') as 'amount' | 'percent',
    tax_value: roundMoney2(Number(row.tax_value || 0)),
    tax_base: (
      String(row.tax_base || 'after_discount') === 'subtotal'
        ? 'subtotal'
        : String(row.tax_base || 'after_discount') === 'after_discount_and_vat'
        ? 'after_discount_and_vat'
        : 'after_discount'
    ) as 'subtotal' | 'after_discount' | 'after_discount_and_vat',
    tax_bdt: roundMoney2(Number(row.tax_bdt || 0)),
    total_bdt: roundMoney2(Number(row.total_bdt || 0)),
    terms: String(row.terms || ''),
    notes: String(row.notes || ''),
    status: normalizeQuotationStatus(String(row.status || 'Draft')),
    status_changed_at: String(row.status_changed_at || row.created_at || ''),
    status_history: statusHistory,
    followup_date: String(row.followup_date || ''),
    followup_note: String(row.followup_note || ''),
    followup_done: Number(row.followup_done || 0) === 1,
    followup_done_at: String(row.followup_done_at || ''),
    share_url: String(row.share_url || ''),
    converted_order_id: String(row.converted_order_id || ''),
    pad_snapshot: padSnapshot,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapReceiptRow(row: Record<string, unknown>): MoneyReceiptRecord {
  let padSnapshot: DocumentPadConfig | null = null;
  if (row.pad_snapshot_json) {
    try {
      padSnapshot = JSON.parse(String(row.pad_snapshot_json));
    } catch {
      padSnapshot = null;
    }
  }
  return {
    receipt_id: String(row.receipt_id),
    order_id: String(row.order_id),
    receipt_date: String(row.receipt_date),
    customer_name: String(row.customer_name),
    phone_display: String(row.phone_display),
    address: String(row.address),
    services_text: String(row.services_text),
    amount_received: Number(row.amount_received || 0),
    payment_method: translatePaymentMethodToEnglish(String(row.payment_method || 'Cash')),
    transaction_ref: String(row.transaction_ref || ''),
    received_by: String(row.received_by || ''),
    notes: String(row.notes || ''),
    pad_snapshot: padSnapshot,
    created_at: String(row.created_at),
  };
}

function mapPadRow(row: Record<string, unknown>): DocumentPadConfig {
  let fields: PadFieldConfig[] = [];
  try {
    fields = JSON.parse(String(row.fields_json || '[]'));
  } catch {
    fields = getDefaultPadFields(row.pad_type as PadType);
  }
  return {
    pad_type: row.pad_type as PadType,
    version: Number(row.version || 1),
    file_name: String(row.file_name || ''),
    mime_type: String(row.mime_type || ''),
    image_data_url: String(row.image_data_url || ''),
    page_width_mm: Number(row.page_width_mm || 210),
    page_height_mm: Number(row.page_height_mm || 297),
    fields,
    updated_at: String(row.updated_at || ''),
    updated_by: String(row.updated_by || ''),
    drive_file_id: String(row.drive_file_id || ''),
  };
}

// ============================================================================
// SEQUENCE GENERATORS
// ============================================================================

function generateNextId(seqKey: string, prefix: string, table: string, idCol: string): string {
  const year = getTodayDhakaIso().slice(0, 4);
  let seq = (parseInt(getSettingRaw(seqKey, '0'), 10) || 0) + 1;
  let candidate = '';
  while (true) {
    candidate = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE ${idCol} = ?`).get(candidate);
    if (!exists) break;
    seq++;
  }
  setSettingRaw(seqKey, String(seq));
  return candidate;
}

function appendHistory(
  orderId: string,
  prevStatus: string,
  newStatus: string,
  note: string,
  changedBy: string
) {
  db.prepare(
    `INSERT INTO status_history (history_id, order_id, previous_status, new_status, note, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(makeUid('HIS'), orderId, prevStatus, newStatus, note, changedBy, getNowDhakaTimestamp());
}

// ============================================================================
// ORDERS CRUD, ADVANCE, COMPLETION, CORRECTION, REOPENING & SETTLEMENT
// ============================================================================

export function getAllOrders(): OrderRecord[] {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all() as Array<
    Record<string, unknown>
  >;
  const workersMap = getAllOrderWorkersMap(db);
  return rows.map((r) => mapOrderRow(r, workersMap));
}

export function getOrderById(orderId: string): OrderRecord | null {
  const row = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapOrderRow(row) : null;
}

/**
 * Strictly enforces supervisor assignment + today..+6 calendar days (Asia/Dhaka).
 */
export function getSupervisorEligibleJobs(supervisorId: string): {
  todayDhaka: string;
  endDateDhaka: string;
  jobs: SupervisorJobView[];
} {
  const todayDhaka = getTodayDhakaIso();
  const endDateDhaka = addCalendarDays(todayDhaka, 6);
  const rows = db
    .prepare(
      `SELECT * FROM orders
       WHERE assigned_supervisor_id = ?
         AND scheduled_date >= ?
         AND scheduled_date <= ?
         AND status NOT IN ('Cancelled', 'বাতিল')
       ORDER BY scheduled_date ASC, scheduled_time ASC, created_at ASC`
    )
    .all(supervisorId, todayDhaka, endDateDhaka) as Array<Record<string, unknown>>;

  const workersMap = getAllOrderWorkersMap(db);
  return {
    todayDhaka,
    endDateDhaka,
    jobs: rows.map((r) => projectSupervisorJob(mapOrderRow(r, workersMap))),
  };
}

export function assertSupervisorCanAccessOrder(
  supervisorId: string,
  orderId: string
): OrderRecord {
  const order = getOrderById(orderId);
  if (!order) {
    throw new Error('Order not found.');
  }
  const todayDhaka = getTodayDhakaIso();
  const endDateDhaka = addCalendarDays(todayDhaka, 6);
  if (order.assigned_supervisor_id !== supervisorId) {
    throw new Error('Access denied: This job is not assigned to your account.');
  }
  if (
    order.status === 'Cancelled' ||
    order.scheduled_date < todayDhaka ||
    order.scheduled_date > endDateDhaka
  ) {
    throw new Error('Access denied: This job is outside your active 7-day schedule window.');
  }
  return order;
}

export interface CreateOrUpdateOrderInput {
  customer_id?: string;
  building_id?: string;
  building_name?: string;
  customer_name: string;
  phone: string;
  address: string;
  area?: string;
  services: string[];
  booking_date?: string;
  scheduled_date: string;
  scheduled_time?: string;
  estimated_duration_mins?: number | string;
  scheduled_end_time?: string;
  price_bdt: number | string;
  instructions?: string;
  notes?: string;
  lead_source?: string;
  referral_contact_type?: '' | 'agent' | 'caretaker';
  referral_contact_name?: string;
  referral_contact_phone?: string;
  assigned_supervisor_id?: string;
  assigned_workers?: Array<{ worker_id: string; agreed_pay_bdt: number | string; confirmed_worked?: boolean }>;
  advance_given?: number | string;
  status?: OrderStatus;
  quotation_id?: string;
  previous_order_id?: string;
  lead_id?: string;
  parent_order_id?: string;
  is_return_visit?: boolean;
  is_no_charge_visit?: boolean;
  complaint_id?: string;
  submission_key?: string;
}

function resolveSupervisorForOrder(supervisorIdRaw?: string): { id: string; name: string } {
  const cleanId = String(supervisorIdRaw || '').trim();
  if (!cleanId) return { id: '', name: '' };
  const sup = db
    .prepare("SELECT id, name FROM users WHERE id = ? AND role = 'supervisor'")
    .get(cleanId) as { id: string; name: string } | undefined;
  if (!sup) {
    throw new Error('Selected supervisor account was not found.');
  }
  return sup;
}

export const createOrderTx = db.transaction(
  (input: CreateOrUpdateOrderInput, actor: AuthUser): OrderRecord => {
    const subKey = String(input.submission_key || '').trim();
    if (subKey) {
      const dupByKey = db
        .prepare('SELECT order_id FROM orders WHERE submission_key = ?')
        .get(subKey) as { order_id: string } | undefined;
      if (dupByKey) {
        const existingOrder = getOrderById(dupByKey.order_id);
        if (existingOrder) return existingOrder;
      }
    }

    const leadId = String(input.lead_id || '').trim();
    let leadRow: LeadRecord | null = null;
    if (leadId) {
      leadRow = getLeadById(leadId);
      if (leadRow?.linked_order_id) {
        const linkedOrder = getOrderById(leadRow.linked_order_id);
        if (linkedOrder) {
          return linkedOrder;
        }
      }
    }

    const customerName = String(input.customer_name || '').trim();
    if (!customerName) throw new Error('Customer name is required.');

    const phone = normalizeBangladeshPhone(input.phone || '');
    if (!phone) {
      throw new Error('Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX).');
    }

    const address = String(input.address || '').trim();
    if (!address) throw new Error('Service address is required.');

    const area = String(input.area || '').trim();
    const services = Array.from(
      new Set((input.services || []).map((s) => String(s).trim()).filter(Boolean))
    );
    if (services.length === 0) throw new Error('Please select at least one service.');

    const bookingDateRaw = String(input.booking_date ?? '').trim();
    const bookingDate = bookingDateRaw
      ? isValidIsoDate(bookingDateRaw)
        ? bookingDateRaw
        : (() => {
            throw new Error('Please select a valid Order Booking Date.');
          })()
      : getTodayDhakaIso();

    const scheduledDate = String(input.scheduled_date || '').trim();
    if (!isValidIsoDate(scheduledDate)) {
      throw new Error('Please select a valid Scheduled Work Date.');
    }
    const scheduledTime = String(input.scheduled_time || '10:00').trim() || '10:00';
    const durationMins = Math.max(
      15,
      Math.min(720, parseInt(String(input.estimated_duration_mins || 120), 10) || 120)
    );
    const endTime =
      String(input.scheduled_end_time || '').trim() || computeEndTime24(scheduledTime, durationMins);

    const isNoCharge = Boolean(input.is_no_charge_visit);
    const priceBdt = isNoCharge ? 0 : parseNonNegativeAmount(input.price_bdt, 'Agreed Bill');
    const advanceGiven = parseNonNegativeAmount(input.advance_given ?? 0, 'Advance Given');

    const sup = resolveSupervisorForOrder(input.assigned_supervisor_id);
    const requestedStatus = input.status ? normalizeOrderStatus(input.status) : 'New';
    const initialStatus: OrderStatus =
      VALID_STATUSES.includes(requestedStatus) && requestedStatus !== 'Completed'
        ? requestedStatus
        : 'New';

    // Inherit lead source & referral info when creating from lead
    const leadSource = normalizeLeadSource(
      input.lead_source || leadRow?.lead_source || 'Not Specified'
    );
    let refType = String(input.referral_contact_type || leadRow?.referral_contact_type || '').trim();
    let refName = String(input.referral_contact_name || '').trim();
    let refPhone = String(input.referral_contact_phone || '').trim();
    if (!refName && leadRow) {
      if (leadSource === 'Agent Referral' || refType === 'agent') {
        refType = 'agent';
        refName = leadRow.agent_name;
        refPhone = leadRow.agent_phone_display;
      } else if (leadSource === 'Caretaker Referral' || refType === 'caretaker') {
        refType = 'caretaker';
        refName = leadRow.caretaker_name;
        refPhone = leadRow.caretaker_phone_display;
      }
    }

    const customerId = ensureCustomerForOrder(db, {
      customer_id: input.customer_id,
      name: customerName,
      phone_display: phone.display,
      phone_e164: phone.e164,
      lead_source: leadSource,
    });

    const buildingId = String(input.building_id || '').trim();
    let buildingName = String(input.building_name || '').trim();
    if (buildingId && !buildingName) {
      const bRow = db
        .prepare('SELECT name FROM buildings WHERE building_id = ?')
        .get(buildingId) as { name: string } | undefined;
      if (bRow) buildingName = bRow.name;
    }

    const previousOrderId = String(input.previous_order_id || '').trim();
    let previousWorkDate = '';
    if (previousOrderId) {
      const prevOrd = getOrderById(previousOrderId);
      if (prevOrd) {
        previousWorkDate = prevOrd.completion_date || prevOrd.scheduled_date || '';
      }
    }

    const orderId = generateNextId('order_sequence', 'SVZ', 'orders', 'order_id');
    const now = getNowDhakaTimestamp();

    db.prepare(
      `INSERT INTO orders (
        order_id, quotation_id, receipt_id, previous_order_id, previous_work_date, lead_id,
        customer_id, building_id, building_name,
        customer_name, phone_display, phone_e164, address, area,
        services_json, services_text, booking_date, scheduled_date, scheduled_time,
        estimated_duration_mins, scheduled_end_time,
        price_bdt, instructions, notes,
        lead_source, referral_contact_type, referral_contact_name, referral_contact_phone,
        parent_order_id, is_return_visit, is_no_charge_visit, complaint_id,
        assigned_supervisor_id, assigned_supervisor_name, status,
        advance_given, advance_supervisor_id, advance_supervisor_name, advance_given_at,
        settlement_status, submission_key,
        created_at, updated_at
      ) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Not Applicable', ?, ?, ?)`
    ).run(
      orderId,
      String(input.quotation_id || ''),
      previousOrderId,
      previousWorkDate,
      leadId,
      customerId,
      buildingId,
      buildingName,
      customerName,
      phone.display,
      phone.e164,
      address,
      area,
      JSON.stringify(services),
      services.join(', '),
      bookingDate,
      scheduledDate,
      scheduledTime,
      durationMins,
      endTime,
      priceBdt,
      String(input.instructions || '').trim(),
      String(input.notes || '').trim(),
      leadSource,
      refType,
      refName,
      refPhone,
      String(input.parent_order_id || ''),
      input.is_return_visit ? 1 : 0,
      isNoCharge ? 1 : 0,
      String(input.complaint_id || ''),
      sup.id,
      sup.name,
      initialStatus,
      advanceGiven,
      advanceGiven > 0 ? sup.id : '',
      advanceGiven > 0 ? sup.name : '',
      advanceGiven > 0 ? now : '',
      subKey,
      now,
      now
    );

    if (Array.isArray(input.assigned_workers) && input.assigned_workers.length > 0) {
      syncOrderWorkersOnSave(db, orderId, input.assigned_workers, false);
    }

    const historyNote = input.is_return_visit
      ? `${isNoCharge ? 'No-Charge ' : ''}Return Visit created for original order (${input.parent_order_id || ''}).`
      : input.quotation_id
      ? `Order created from quotation (${input.quotation_id}).`
      : leadId
      ? `Order created from prospect (${leadId}).`
      : previousOrderId
      ? `Repeat booking created from previous order (${previousOrderId}${previousWorkDate ? `, Previous Work Date: ${previousWorkDate}` : ''}).`
      : 'New order created.';
    appendHistory(orderId, '', initialStatus, historyNote, actor.name);

    if (sup.name) {
      appendHistory(
        orderId,
        initialStatus,
        initialStatus,
        `Supervisor assigned: ${sup.name}${advanceGiven > 0 ? ` · Advance: BDT ${advanceGiven}` : ''}`,
        actor.name
      );
    }

    // Mark previous order's service follow-up as converted to this repeat booking
    if (previousOrderId) {
      db.prepare(
        `UPDATE orders SET followup_done = 1, followup_done_at = ?, followup_converted_order_id = ?, updated_at = ?
         WHERE order_id = ?`
      ).run(now, orderId, now, previousOrderId);
      appendHistory(
        previousOrderId,
        'Completed',
        'Completed',
        `Service follow-up converted into repeat booking (${orderId}, scheduled ${scheduledDate}).`,
        actor.name
      );
    }

    if (leadId) {
      db.prepare(
        `UPDATE leads SET linked_order_id = ?, stage = 'Confirmed', updated_at = ? WHERE lead_id = ?`
      ).run(orderId, now, leadId);
      db.prepare(
        `INSERT INTO lead_notes (note_id, lead_id, channel, note_text, created_by, created_at)
         VALUES (?, ?, 'Other', ?, ?, ?)`
      ).run(makeUid('LNT'), leadId, `Confirmed order created and linked (${orderId}).`, actor.name, now);
    }

    return getOrderById(orderId)!;
  }
);

export const updateOrderTx = db.transaction(
  (orderId: string, input: CreateOrUpdateOrderInput, actor: AuthUser): OrderRecord => {
    const existing = getOrderById(orderId);
    if (!existing) throw new Error('Order not found.');

    if (
      existing.status_locked &&
      input.status !== undefined &&
      normalizeOrderStatus(input.status) !== existing.status
    ) {
      throw new Error(
        'STATUS_LOCKED: Order status is locked because this order is Completed and full customer payment is confirmed.'
      );
    }

    const customerName = String(input.customer_name || '').trim();
    if (!customerName) throw new Error('Customer name is required.');

    const phone = normalizeBangladeshPhone(input.phone || '');
    if (!phone) {
      throw new Error('Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX).');
    }

    const address = String(input.address || '').trim();
    if (!address) throw new Error('Service address is required.');

    const area = String(input.area ?? existing.area).trim();
    const services = Array.from(
      new Set((input.services || []).map((s) => String(s).trim()).filter(Boolean))
    );
    if (services.length === 0) throw new Error('Please select at least one service.');

    let bookingDate = existing.booking_date;
    if (input.booking_date !== undefined) {
      const rawBooking = String(input.booking_date || '').trim();
      if (rawBooking === '') {
        bookingDate = existing.booking_date;
      } else if (!isValidIsoDate(rawBooking)) {
        throw new Error('Please select a valid Order Booking Date.');
      } else {
        bookingDate = rawBooking;
      }
    }

    const scheduledDate = String(input.scheduled_date || '').trim();
    if (!isValidIsoDate(scheduledDate)) {
      throw new Error('Please select a valid Scheduled Work Date.');
    }
    const scheduledTime = String(input.scheduled_time || existing.scheduled_time || '10:00').trim();
    const durationMins =
      input.estimated_duration_mins !== undefined
        ? Math.max(15, Math.min(720, parseInt(String(input.estimated_duration_mins), 10) || 120))
        : existing.estimated_duration_mins || 120;
    const endTime =
      String(input.scheduled_end_time || '').trim() || computeEndTime24(scheduledTime, durationMins);

    const priceBdt = existing.is_no_charge_visit
      ? 0
      : parseNonNegativeAmount(input.price_bdt, 'Agreed Bill');
    const advanceGiven = parseNonNegativeAmount(
      input.advance_given !== undefined ? input.advance_given : existing.advance_given,
      'Advance Given'
    );

    const sup = resolveSupervisorForOrder(
      input.assigned_supervisor_id !== undefined
        ? input.assigned_supervisor_id
        : existing.assigned_supervisor_id
    );

    const leadSource = normalizeLeadSource(input.lead_source ?? existing.lead_source);
    const refType = String(input.referral_contact_type ?? existing.referral_contact_type).trim();
    const refName = String(input.referral_contact_name ?? existing.referral_contact_name).trim();
    const refPhone = String(input.referral_contact_phone ?? existing.referral_contact_phone).trim();

    const customerId = ensureCustomerForOrder(db, {
      customer_id: input.customer_id || existing.customer_id,
      name: customerName,
      phone_display: phone.display,
      phone_e164: phone.e164,
      lead_source: leadSource,
    });
    const buildingId =
      input.building_id !== undefined ? String(input.building_id || '').trim() : existing.building_id;
    let buildingName =
      input.building_name !== undefined
        ? String(input.building_name || '').trim()
        : existing.building_name;
    if (buildingId && !buildingName) {
      const bRow = db
        .prepare('SELECT name FROM buildings WHERE building_id = ?')
        .get(buildingId) as { name: string } | undefined;
      if (bRow) buildingName = bRow.name;
    }

    const now = getNowDhakaTimestamp();
    const advanceChanged = advanceGiven !== existing.advance_given;
    const supChanged = sup.id !== existing.assigned_supervisor_id;
    const scheduleChanged =
      scheduledDate !== existing.scheduled_date || scheduledTime !== existing.scheduled_time;
    const bookingDateChanged = bookingDate !== existing.booking_date;

    // Preserve advance recipient supervisor on reassignment!
    let advSupId = existing.advance_supervisor_id;
    let advSupName = existing.advance_supervisor_name;
    let advGivenAt = existing.advance_given_at;
    if (advanceGiven === 0) {
      advSupId = '';
      advSupName = '';
      advGivenAt = '';
    } else if (!existing.advance_supervisor_id) {
      advSupId = sup.id;
      advSupName = sup.name;
      advGivenAt = now;
    } else if (advanceChanged) {
      advGivenAt = now;
    }

    db.prepare(
      `UPDATE orders SET
        customer_id = ?, building_id = ?, building_name = ?,
        customer_name = ?, phone_display = ?, phone_e164 = ?, address = ?, area = ?,
        services_json = ?, services_text = ?, booking_date = ?, scheduled_date = ?, scheduled_time = ?,
        estimated_duration_mins = ?, scheduled_end_time = ?,
        price_bdt = ?, instructions = ?, notes = ?,
        lead_source = ?, referral_contact_type = ?, referral_contact_name = ?, referral_contact_phone = ?,
        assigned_supervisor_id = ?, assigned_supervisor_name = ?,
        advance_given = ?,
        advance_supervisor_id = ?, advance_supervisor_name = ?, advance_given_at = ?,
        updated_at = ?
       WHERE order_id = ?`
    ).run(
      customerId,
      buildingId,
      buildingName,
      customerName,
      phone.display,
      phone.e164,
      address,
      area,
      JSON.stringify(services),
      services.join(', '),
      bookingDate,
      scheduledDate,
      scheduledTime,
      durationMins,
      endTime,
      priceBdt,
      String(input.instructions ?? existing.instructions).trim(),
      String(input.notes ?? existing.notes).trim(),
      leadSource,
      refType,
      refName,
      refPhone,
      sup.id,
      sup.name,
      advanceGiven,
      advSupId,
      advSupName,
      advGivenAt,
      now,
      orderId
    );

    if (input.assigned_workers !== undefined) {
      syncOrderWorkersOnSave(db, orderId, input.assigned_workers, existing.status === 'Completed');
    }

    if (existing.status === 'Completed') {
      recomputeOrderFinancialsAndSettlement(db, orderId);
    }

    const changes: string[] = ['Order details updated.'];
    if (bookingDateChanged) {
      changes.push(`Booking Date: ${existing.booking_date || 'Not set'} → ${bookingDate}`);
    }
    if (scheduleChanged) {
      changes.push(
        `Schedule changed: ${existing.scheduled_date} ${existing.scheduled_time} → ${scheduledDate} ${scheduledTime}`
      );
    }
    if (supChanged) {
      changes.push(
        `Supervisor changed: ${existing.assigned_supervisor_name || 'Unassigned'} → ${sup.name || 'Unassigned'}`
      );
      if (existing.advance_given > 0 && existing.advance_supervisor_name) {
        changes.push(
          `(Existing advance of BDT ${existing.advance_given} remains linked to ${existing.advance_supervisor_name})`
        );
      }
    }
    if (advanceChanged) {
      changes.push(`Advance: BDT ${existing.advance_given} → BDT ${advanceGiven}`);
    }
    appendHistory(orderId, existing.status, existing.status, changes.join(' '), actor.name);

    return getOrderById(orderId)!;
  }
);

export const updateOrderAdvanceTx = db.transaction(
  (
    orderId: string,
    params: { advance_given: number | string; supervisor_id?: string },
    actor: AuthUser
  ): OrderRecord => {
    const existing = getOrderById(orderId);
    if (!existing) throw new Error('Order not found.');

    const advanceGiven = parseNonNegativeAmount(params.advance_given, 'Advance Given');
    const sup = resolveSupervisorForOrder(
      params.supervisor_id !== undefined ? params.supervisor_id : existing.assigned_supervisor_id
    );
    const now = getNowDhakaTimestamp();
    const supChanged = sup.id !== existing.assigned_supervisor_id;
    const advanceChanged = advanceGiven !== existing.advance_given;

    // Preserve advance recipient supervisor on reassignment!
    let advSupId = existing.advance_supervisor_id;
    let advSupName = existing.advance_supervisor_name;
    let advGivenAt = existing.advance_given_at;
    if (advanceGiven === 0) {
      advSupId = '';
      advSupName = '';
      advGivenAt = '';
    } else if (!existing.advance_supervisor_id) {
      advSupId = sup.id;
      advSupName = sup.name;
      advGivenAt = now;
    } else if (advanceChanged) {
      advGivenAt = now;
    }

    db.prepare(
      `UPDATE orders SET
        assigned_supervisor_id = ?, assigned_supervisor_name = ?,
        advance_given = ?, advance_supervisor_id = ?, advance_supervisor_name = ?,
        advance_given_at = ?, updated_at = ?
       WHERE order_id = ?`
    ).run(sup.id, sup.name, advanceGiven, advSupId, advSupName, advGivenAt, now, orderId);

    if (existing.status === 'Completed') {
      recomputeOrderFinancialsAndSettlement(db, orderId);
    }

    const noteParts: string[] = [];
    if (supChanged) {
      noteParts.push(
        `Supervisor changed: ${existing.assigned_supervisor_name || 'Unassigned'} → ${sup.name || 'Unassigned'}`
      );
      if (existing.advance_given > 0 && existing.advance_supervisor_name) {
        noteParts.push(
          `(Existing advance of BDT ${existing.advance_given} remains linked to ${existing.advance_supervisor_name})`
        );
      }
    }
    if (advanceChanged || !supChanged) {
      noteParts.push(`Advance: BDT ${advanceGiven}${advSupName ? ` (${advSupName})` : ''}`);
    }

    appendHistory(orderId, existing.status, existing.status, noteParts.join(' · '), actor.name);

    return getOrderById(orderId)!;
  }
);

export interface CompleteOrderPayload {
  completion_date?: string;
  payment_collection_date?: string;
  transport_cost: number | string;
  meals_cost: number | string;
  other_expenses?: OtherExpenseItem[];
  full_bill_collected: boolean;
  confirmed_worker_ids?: string[];
  followup_mode?: FollowupMode;
  custom_value?: number;
  custom_unit?: FollowupUnit;
  followup_date?: string;
}

/**
 * Atomic completion operation for BOTH Supervisor and Admin.
 * Supports standard billable jobs AND No-Charge Return Visits, worker confirmation,
 * and single-source-of-truth financial/settlement recomputation.
 */
export const completeOrderAtomicTx = db.transaction(
  (orderId: string, payload: CompleteOrderPayload, actor: AuthUser): OrderRecord => {
    const rawOrder = getOrderById(orderId);
    if (!rawOrder) throw new Error('Order not found.');
    if (actor.role === 'supervisor' && rawOrder.assigned_supervisor_id !== actor.id) {
      throw new Error('Access denied: This job is not assigned to your account.');
    }
    if (rawOrder.status_locked) {
      throw new Error(
        'STATUS_LOCKED: Order status is locked because this order is Completed and full customer payment is confirmed.'
      );
    }
    const existing =
      actor.role === 'supervisor'
        ? assertSupervisorCanAccessOrder(actor.id, orderId)
        : rawOrder;
    if (existing.status === 'Cancelled') {
      throw new Error('Cancelled orders cannot be completed.');
    }
    if (existing.status === 'Completed') {
      throw new Error('This order has already been marked as Completed (duplicate submission blocked).');
    }
    if (!existing.is_no_charge_visit && payload.full_bill_collected !== true) {
      throw new Error('Please confirm "Full job bill collected" before completing this order.');
    }

    const transportCost = parseNonNegativeAmount(payload.transport_cost ?? 0, 'Transport Cost');
    const mealsCost = parseNonNegativeAmount(payload.meals_cost ?? 0, 'Meals Cost');
    const otherExpenses = parseOtherExpenses(payload.other_expenses);
    const otherTotal = otherExpenses.reduce((sum, i) => sum + i.amount, 0);

    const todayDhaka = getTodayDhakaIso();
    const completionDate =
      actor.role === 'admin' && payload.completion_date && isValidIsoDate(payload.completion_date)
        ? payload.completion_date
        : todayDhaka;

    const followupCalc = existing.is_no_charge_visit
      ? { followupDate: '', ruleNote: 'No-Charge Return Visit' }
      : actor.role === 'admin'
      ? computeFollowupForServer(payload, completionDate)
      : computeFollowupForServer({ followup_mode: 'default' }, completionDate);

    const now = getNowDhakaTimestamp();
    const nowTimePart = now.slice(11) || '00:00:00';
    const collectionDate =
      actor.role === 'admin' &&
      payload.payment_collection_date &&
      isValidIsoDate(payload.payment_collection_date)
        ? payload.payment_collection_date
        : completionDate;
    const isPaidCompletion = !existing.is_no_charge_visit && payload.full_bill_collected === true;
    const paymentCollectedAt = isPaidCompletion ? `${collectionDate} ${nowTimePart}` : '';
    const statusLockedOnComplete = isPaidCompletion ? 1 : 0;
    const statusLockedAtOnComplete = isPaidCompletion ? now : '';
    const nextFollowupVersion = existing.is_no_charge_visit
      ? existing.followup_version || 0
      : (existing.followup_version || 0) + 1;

    const updateRes = db.prepare(
      `UPDATE orders SET
        status = 'Completed',
        completion_date = ?,
        completed_at = ?,
        completed_by_user_id = ?,
        completed_by_name = ?,
        full_bill_collected = ?,
        status_locked = ?,
        status_locked_at = ?,
        payment_collected_at = ?,
        collected_by_name = ?,
        transport_cost = ?,
        meals_cost = ?,
        other_expenses_json = ?,
        other_expenses_total = ?,
        followup_date = ?,
        followup_rule_note = ?,
        followup_version = ?,
        reminder_sent = 0,
        reminder_sent_at = '',
        reminder_sent_for_date = '',
        reminder_sent_version = 0,
        followup_done = ?,
        followup_done_at = '',
        updated_at = ?
       WHERE order_id = ? AND status NOT IN ('Completed', 'সম্পন্ন') AND status_locked = 0`
    ).run(
      completionDate,
      now,
      actor.id,
      actor.name,
      isPaidCompletion ? 1 : 0,
      statusLockedOnComplete,
      statusLockedAtOnComplete,
      paymentCollectedAt,
      isPaidCompletion ? actor.name : '',
      transportCost,
      mealsCost,
      JSON.stringify(otherExpenses),
      otherTotal,
      followupCalc.followupDate,
      followupCalc.ruleNote,
      nextFollowupVersion,
      existing.is_no_charge_visit ? 1 : 0,
      now,
      orderId
    );
    if (updateRes.changes === 0) {
      throw new Error(
        'STATUS_LOCKED: Order status is locked or has already been marked as Completed.'
      );
    }

    const confirmedNames = confirmOrderWorkersOnCompletion(
      db,
      orderId,
      payload.confirmed_worker_ids
    );

    // Recompute worker pay, actual expenses, settlement, and parent job profit (if no-charge return visit)
    recomputeOrderFinancialsAndSettlement(db, orderId);

    // If linked to a complaint, auto-update complaint status to Resolved
    if (existing.complaint_id) {
      db.prepare(
        `UPDATE order_complaints SET status = 'Resolved', updated_at = ? WHERE complaint_id = ?`
      ).run(now, existing.complaint_id);
    }

    const updated = getOrderById(orderId)!;
    const workersSuffix =
      confirmedNames.length > 0 ? ` · Confirmed Workers: ${confirmedNames.join(', ')}` : '';
    const historyMsg = existing.is_no_charge_visit
      ? `No-Charge Return Visit completed (${completionDate}) · Actual Expenses: BDT ${updated.actual_expenses} · Linked to ${existing.parent_order_id}${workersSuffix}`
      : `Job completed (${completionDate}) · Bill Collected: BDT ${updated.price_bdt} · Total Cost: BDT ${updated.actual_expenses} · Expected Settlement: BDT ${updated.supervisor_settlement} · Next Follow-Up: ${followupCalc.followupDate} (${followupCalc.ruleNote})${workersSuffix}`;

    appendHistory(orderId, existing.status, 'Completed', historyMsg, actor.name);

    return updated;
  }
);

/**
 * Admin-only correction of completion expenses / bill without creating duplicate records.
 */
export const correctCompletedOrderFinancialsTx = db.transaction(
  (
    orderId: string,
    payload: {
      completion_date?: string;
      payment_collection_date?: string;
      price_bdt?: number | string;
      advance_given?: number | string;
      transport_cost: number | string;
      meals_cost: number | string;
      other_expenses?: OtherExpenseItem[];
      reason: string;
    },
    actor: AuthUser
  ): OrderRecord => {
    const existing = getOrderById(orderId);
    if (!existing) throw new Error('Order not found.');
    if (existing.status !== 'Completed') {
      throw new Error('Financial adjustments can only be saved for Completed orders.');
    }

    const reason = String(payload.reason || '').trim();
    if (!reason) throw new Error('Please enter a reason for this financial correction.');

    const agreedBill = existing.is_no_charge_visit
      ? 0
      : payload.price_bdt !== undefined
      ? parseNonNegativeAmount(payload.price_bdt, 'Agreed Bill')
      : existing.price_bdt;
    const advanceGiven =
      payload.advance_given !== undefined
        ? parseNonNegativeAmount(payload.advance_given, 'Advance Given')
        : existing.advance_given;
    const transportCost = parseNonNegativeAmount(payload.transport_cost ?? 0, 'Transport Cost');
    const mealsCost = parseNonNegativeAmount(payload.meals_cost ?? 0, 'Meals Cost');
    const otherExpenses = parseOtherExpenses(payload.other_expenses);
    const otherTotal = otherExpenses.reduce((sum, i) => sum + i.amount, 0);
    const completionDate =
      payload.completion_date && isValidIsoDate(payload.completion_date)
        ? payload.completion_date
        : existing.completion_date;

    const now = getNowDhakaTimestamp();
    let nextPaymentCollectedAt = existing.payment_collected_at;
    if (!existing.is_no_charge_visit && existing.full_bill_collected) {
      const timePart = (existing.payment_collected_at || now).slice(11) || now.slice(11) || '00:00:00';
      if (payload.payment_collection_date && isValidIsoDate(payload.payment_collection_date)) {
        nextPaymentCollectedAt = `${payload.payment_collection_date} ${timePart}`;
      } else if (
        completionDate !== existing.completion_date &&
        (!existing.payment_collected_at ||
          existing.payment_collected_at.slice(0, 10) === existing.completion_date)
      ) {
        nextPaymentCollectedAt = `${completionDate} ${timePart}`;
      }
    }

    db.prepare(
      `UPDATE orders SET
        completion_date = ?,
        payment_collected_at = ?,
        price_bdt = ?,
        advance_given = ?,
        transport_cost = ?,
        meals_cost = ?,
        other_expenses_json = ?,
        other_expenses_total = ?,
        updated_at = ?
       WHERE order_id = ?`
    ).run(
      completionDate,
      nextPaymentCollectedAt,
      agreedBill,
      advanceGiven,
      transportCost,
      mealsCost,
      JSON.stringify(otherExpenses),
      otherTotal,
      now,
      orderId
    );

    recomputeOrderFinancialsAndSettlement(db, orderId);
    const updated = getOrderById(orderId)!;

    appendHistory(
      orderId,
      'Completed',
      'Completed',
      `Admin financial correction: Actual Cost BDT ${existing.actual_expenses} → BDT ${updated.actual_expenses}, Expected Settlement BDT ${existing.supervisor_settlement} → BDT ${updated.supervisor_settlement}. Reason: ${reason}`,
      actor.name
    );

    return updated;
  }
);

/**
 * Admin-only team / worker pay edit on a completed order with audit history.
 */
export const adminUpdateCompletedWorkersTx = db.transaction(
  (
    orderId: string,
    payload: {
      assigned_workers: Array<{
        worker_id: string;
        agreed_pay_bdt: number | string;
        confirmed_worked: boolean;
      }>;
      reason?: string;
    },
    actor: AuthUser
  ): OrderRecord => {
    const existing = getOrderById(orderId);
    if (!existing) throw new Error('Order not found.');
    const prevSummary = existing.assigned_workers
      .map((w) => `${w.worker_name}(${w.confirmed_worked ? 'Confirmed' : 'Not Confirmed'}: BDT ${w.agreed_pay_bdt})`)
      .join(', ');

    syncOrderWorkersOnSave(db, orderId, payload.assigned_workers || [], existing.status === 'Completed');
    if (existing.status === 'Completed') {
      recomputeOrderFinancialsAndSettlement(db, orderId);
    }

    const updated = getOrderById(orderId)!;
    const nextSummary = updated.assigned_workers
      .map((w) => `${w.worker_name}(${w.confirmed_worked ? 'Confirmed' : 'Not Confirmed'}: BDT ${w.agreed_pay_bdt})`)
      .join(', ');

    appendHistory(
      orderId,
      existing.status,
      existing.status,
      `Admin updated team assignment: [${prevSummary || 'None'}] → [${nextSummary || 'None'}]${
        payload.reason ? ` · Reason: ${String(payload.reason).trim()}` : ''
      }`,
      actor.name
    );
    return updated;
  }
);

/**
 * Admin-only status update (handles non-completed statuses AND reopening a completed job cleanly).
 */
export const changeOrderStatusNonCompleteTx = db.transaction(
  (
    orderId: string,
    newStatusRaw: OrderStatus,
    note: string,
    actor: AuthUser
  ): OrderRecord => {
    const existing = getOrderById(orderId);
    if (!existing) throw new Error('Order not found.');
    if (existing.status_locked) {
      throw new Error(
        'STATUS_LOCKED: Order status is locked because this order is Completed and full customer payment is confirmed.'
      );
    }
    const newStatus = normalizeOrderStatus(newStatusRaw);
    if (!VALID_STATUSES.includes(newStatus) || newStatus === 'Completed') {
      throw new Error('Invalid status change request.');
    }

    const now = getNowDhakaTimestamp();
    const wasCompleted = existing.status === 'Completed';

    if (wasCompleted) {
      db.prepare(
        `UPDATE orders SET
          status = ?,
          status_locked = 0,
          status_locked_at = '',
          completion_date = '',
          completed_at = '',
          full_bill_collected = 0,
          payment_collected_at = '',
          collected_by_name = '',
          supervisor_settlement = 0,
          job_profit_or_loss = 0,
          settlement_actual_total = 0,
          settlement_remaining = 0,
          settlement_status = 'Not Applicable',
          settlement_confirmed_at = '',
          settlement_confirmed_by = '',
          settlement_note = '',
          followup_date = '',
          followup_rule_note = '',
          followup_done = 0,
          followup_done_at = '',
          reminder_sent = 0,
          updated_at = ?
         WHERE order_id = ? AND status_locked = 0`
      ).run(newStatus, now, orderId);

      if (existing.is_no_charge_visit && existing.parent_order_id) {
        recomputeOrderFinancialsAndSettlement(db, existing.parent_order_id);
      }

      const reopenNote =
        note ||
        (newStatus === 'Cancelled'
          ? 'Completed order cancelled; payment collection, settlement, and follow-up reminder cleared.'
          : `Completed order reopened (${newStatus}); payment collection, settlement, and follow-up reminder reset.`);
      appendHistory(orderId, 'Completed', newStatus, reopenNote, actor.name);
    } else {
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?').run(
        newStatus,
        now,
        orderId
      );
      appendHistory(
        orderId,
        existing.status,
        newStatus,
        note || `Status changed: ${existing.status} → ${newStatus}`,
        actor.name
      );
    }

    return getOrderById(orderId)!;
  }
);

export const confirmSupervisorSettlementTx = db.transaction(
  (orderId: string, note: string, actor: AuthUser): OrderRecord => {
    recomputeOrderFinancialsAndSettlement(db, orderId);
    const existing = getOrderById(orderId);
    if (!existing) throw new Error('Order not found.');
    if (existing.status !== 'Completed') {
      throw new Error('Supervisor settlement can only be confirmed for Completed orders.');
    }

    // If there is a remaining balance, record a full settlement entry so the verification ledger matches 100%
    if (existing.settlement_remaining > 0) {
      extRecordSettlementEntryTx(
        db,
        orderId,
        {
          amount_bdt: existing.settlement_remaining,
          payment_method: 'Cash',
          note: String(note || '').trim() || 'Marked fully settled by Admin',
        },
        actor
      );
    }

    const now = getNowDhakaTimestamp();
    db.prepare(
      `UPDATE orders SET settlement_note = ?, updated_at = ? WHERE order_id = ?`
    ).run(String(note || '').trim(), now, orderId);

    const updated = getOrderById(orderId)!;
    const dir =
      updated.supervisor_settlement > 0
        ? `Deposit Received BDT ${updated.supervisor_settlement}`
        : updated.supervisor_settlement < 0
        ? `Reimbursement Paid BDT ${Math.abs(updated.supervisor_settlement)}`
        : 'Balanced (BDT 0)';

    appendHistory(
      orderId,
      updated.status,
      updated.status,
      `Supervisor settlement confirmed (${dir})${note ? ` · ${note}` : ''}`,
      actor.name
    );

    return updated;
  }
);

export const rescheduleFollowupTx = db.transaction(
  (
    orderId: string,
    payload: {
      followup_mode: FollowupMode;
      base_date?: string;
      custom_value?: number;
      custom_unit?: FollowupUnit;
      followup_date?: string;
    },
    actor: AuthUser
  ): OrderRecord => {
    const existing = getOrderById(orderId);
    if (!existing) throw new Error('Order not found.');
    if (existing.status !== 'Completed') {
      throw new Error('Follow-up date can only be changed for Completed orders.');
    }

    const baseDate =
      payload.base_date && isValidIsoDate(payload.base_date)
        ? payload.base_date
        : existing.completion_date || getTodayDhakaIso();
    const calc = computeFollowupForServer(payload, baseDate);
    const nextVersion = (existing.followup_version || 0) + 1;
    const now = getNowDhakaTimestamp();

    db.prepare(
      `UPDATE orders SET
        followup_date = ?,
        followup_rule_note = ?,
        followup_version = ?,
        reminder_sent = 0,
        reminder_sent_at = '',
        reminder_sent_for_date = '',
        reminder_sent_version = 0,
        followup_done = 0,
        followup_done_at = '',
        updated_at = ?
       WHERE order_id = ?`
    ).run(calc.followupDate, calc.ruleNote, nextVersion, now, orderId);

    appendHistory(
      orderId,
      existing.status,
      existing.status,
      `Follow-up date rescheduled: ${existing.followup_date || 'None'} → ${calc.followupDate} (${calc.ruleNote}). Reminder revision v${nextVersion} active.`,
      actor.name
    );

    return getOrderById(orderId)!;
  }
);

export const toggleFollowupDoneTx = db.transaction(
  (orderId: string, isDone: boolean, actor: AuthUser): OrderRecord => {
    const existing = getOrderById(orderId);
    if (!existing) throw new Error('Order not found.');

    const now = getNowDhakaTimestamp();
    db.prepare(
      'UPDATE orders SET followup_done = ?, followup_done_at = ?, updated_at = ? WHERE order_id = ?'
    ).run(isDone ? 1 : 0, isDone ? now : '', now, orderId);

    appendHistory(
      orderId,
      existing.status,
      existing.status,
      isDone ? 'Service follow-up marked as done.' : 'Service follow-up reopened.',
      actor.name
    );

    return getOrderById(orderId)!;
  }
);

export const scheduleReturnVisitTx = db.transaction(
  (
    complaintId: string,
    payload: {
      scheduled_date: string;
      scheduled_time?: string;
      estimated_duration_mins?: number;
      assigned_supervisor_id?: string;
      assigned_workers?: Array<{ worker_id: string; agreed_pay_bdt: number | string }>;
      is_no_charge?: boolean;
      price_bdt?: number | string;
      instructions?: string;
      submission_key?: string;
    },
    actor: AuthUser
  ): { order: OrderRecord; complaint: ReturnType<typeof listAllComplaints>[number] } => {
    const complaint = listAllComplaints(db).find((c) => c.complaint_id === complaintId);
    if (!complaint) throw new Error('Complaint record not found.');
    const parent = getOrderById(complaint.order_id);
    if (!parent) throw new Error('Original completed order not found.');

    if (complaint.return_visit_order_id) {
      const existingRv = getOrderById(complaint.return_visit_order_id);
      if (existingRv) {
        return { order: existingRv, complaint };
      }
    }

    const isNoCharge = payload.is_no_charge !== false;
    const rvOrder = createOrderTx(
      {
        customer_id: parent.customer_id,
        building_id: parent.building_id,
        building_name: parent.building_name,
        customer_name: parent.customer_name,
        phone: parent.phone_display,
        address: parent.address,
        area: parent.area,
        services: parent.services,
        booking_date: getTodayDhakaIso(),
        scheduled_date: payload.scheduled_date,
        scheduled_time: payload.scheduled_time || '10:00',
        estimated_duration_mins: payload.estimated_duration_mins || 90,
        price_bdt: isNoCharge ? 0 : payload.price_bdt ?? 0,
        instructions:
          payload.instructions ||
          `Return visit for complaint on ${parent.order_id}: ${complaint.issue}`,
        notes: `Linked Complaint: ${complaint.complaint_id}`,
        lead_source: parent.lead_source,
        assigned_supervisor_id: payload.assigned_supervisor_id || parent.assigned_supervisor_id,
        assigned_workers: payload.assigned_workers || [],
        status: 'Confirmed',
        parent_order_id: parent.order_id,
        is_return_visit: true,
        is_no_charge_visit: isNoCharge,
        complaint_id: complaint.complaint_id,
        submission_key: payload.submission_key,
      },
      actor
    );

    const now = getNowDhakaTimestamp();
    db.prepare(
      `UPDATE order_complaints SET
        status = 'Return Visit Scheduled',
        return_visit_order_id = ?,
        is_no_charge = ?,
        updated_at = ?
       WHERE complaint_id = ?`
    ).run(rvOrder.order_id, isNoCharge ? 1 : 0, now, complaint.complaint_id);

    appendHistory(
      parent.order_id,
      parent.status,
      parent.status,
      `${isNoCharge ? 'No-Charge ' : ''}Return Visit scheduled (${rvOrder.order_id} on ${rvOrder.scheduled_date}) for complaint: ${complaint.issue}`,
      actor.name
    );

    const updatedComplaint = listAllComplaints(db).find((c) => c.complaint_id === complaintId)!;
    return { order: rvOrder, complaint: updatedComplaint };
  }
);

// ============================================================================
// QUOTATIONS & QUOTATION-TO-ORDER CONVERSION
// ============================================================================

export function getAllQuotations(): QuotationRecord[] {
  const rows = db.prepare('SELECT * FROM quotations ORDER BY created_at DESC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(mapQuotationRow);
}

export function getQuotationById(id: string): QuotationRecord | null {
  const row = db.prepare('SELECT * FROM quotations WHERE quotation_id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapQuotationRow(row) : null;
}

export const saveQuotationTx = db.transaction(
  (
    payload: {
      quotation_id?: string;
      lead_id?: string;
      customer_id?: string;
      building_id?: string;
      quotation_date?: string;
      valid_until?: string;
      customer_name: string;
      phone: string;
      address: string;
      area?: string;
      lead_source?: string;
      referral_contact_type?: '' | 'agent' | 'caretaker';
      referral_contact_name?: string;
      referral_contact_phone?: string;
      items: QuotationItem[];
      discount_enabled?: boolean;
      discount_type?: 'amount' | 'percent';
      discount_value?: number | string;
      discount_bdt?: number | string;
      vat_enabled?: boolean;
      vat_type?: 'amount' | 'percent';
      vat_value?: number | string;
      vat_base?: 'subtotal' | 'after_discount';
      tax_enabled?: boolean;
      tax_type?: 'amount' | 'percent';
      tax_value?: number | string;
      tax_base?: 'subtotal' | 'after_discount' | 'after_discount_and_vat';
      terms?: string;
      notes?: string;
      status?: QuotationStatus;
      followup_date?: string;
      followup_note?: string;
      share_url?: string;
    },
    actor: AuthUser
  ): QuotationRecord => {
    const leadId = String(payload.lead_id || '').trim();
    let leadRow: LeadRecord | null = null;
    if (leadId) {
      leadRow = getLeadById(leadId);
    }

    if (!payload.quotation_id && leadRow?.linked_quotation_id) {
      const existingQ = getQuotationById(leadRow.linked_quotation_id);
      if (existingQ) {
        return existingQ;
      }
    }

    const customerName = String(payload.customer_name || '').trim();
    if (!customerName) throw new Error('Customer name is required.');

    const phone = normalizeBangladeshPhone(payload.phone || '');
    if (!phone) throw new Error('Please enter a valid Bangladesh mobile number.');

    const address = String(payload.address || '').trim();
    if (!address) throw new Error('Address is required.');

    const items: QuotationItem[] = (payload.items || [])
      .map((it) => {
        const service = String(it.service || '').trim();
        const description = String(it.description || '').trim();
        const size = String(it.size || '').trim();
        const unit_label = String(it.unit_label || '').trim();
        const rawQty = Number(bnToEnDigits(String(it.quantity ?? 1)));
        const quantity = Number.isFinite(rawQty) && rawQty > 0 ? roundMoney2(rawQty) : 1;
        const rate_bdt = parseNonNegativeDecimal(it.rate_bdt ?? 0, 'Rate');
        const amount_bdt =
          rate_bdt > 0
            ? roundMoney2(quantity * rate_bdt)
            : parseNonNegativeDecimal(it.amount_bdt ?? 0, 'Amount');
        return {
          service,
          description,
          size,
          quantity,
          unit_label,
          rate_bdt,
          amount_bdt,
        };
      })
      .filter((it) => it.service.length > 0);

    if (items.length === 0) throw new Error('Please add at least one service line item.');

    const subtotal = roundMoney2(items.reduce((sum, it) => sum + it.amount_bdt, 0));

    // Independent Discount, VAT, and Tax options (all default false when omitted)
    const discountEnabled =
      payload.discount_enabled !== undefined
        ? Boolean(payload.discount_enabled)
        : Number(payload.discount_bdt || 0) > 0;
    const discountType: 'amount' | 'percent' =
      payload.discount_type === 'percent' ? 'percent' : 'amount';
    const rawDiscountVal =
      payload.discount_value !== undefined
        ? parseNonNegativeDecimal(payload.discount_value, 'Discount')
        : parseNonNegativeDecimal(payload.discount_bdt ?? 0, 'Discount');
    const discountValue = discountEnabled ? rawDiscountVal : 0;
    const discount = !discountEnabled
      ? 0
      : discountType === 'percent'
      ? roundMoney2(subtotal * (Math.min(100, discountValue) / 100))
      : roundMoney2(Math.min(subtotal, discountValue));

    const afterDiscount = roundMoney2(Math.max(0, subtotal - discount));

    const vatEnabled = Boolean(payload.vat_enabled);
    const vatType: 'amount' | 'percent' = payload.vat_type === 'amount' ? 'amount' : 'percent';
    const vatBase: 'subtotal' | 'after_discount' =
      payload.vat_base === 'subtotal' ? 'subtotal' : 'after_discount';
    const vatValue = vatEnabled ? parseNonNegativeDecimal(payload.vat_value ?? 0, 'VAT') : 0;
    const vatBdt = !vatEnabled
      ? 0
      : vatType === 'percent'
      ? roundMoney2((vatBase === 'subtotal' ? subtotal : afterDiscount) * (vatValue / 100))
      : roundMoney2(vatValue);

    const taxEnabled = Boolean(payload.tax_enabled);
    const taxType: 'amount' | 'percent' = payload.tax_type === 'amount' ? 'amount' : 'percent';
    const taxBase: 'subtotal' | 'after_discount' | 'after_discount_and_vat' =
      payload.tax_base === 'subtotal'
        ? 'subtotal'
        : payload.tax_base === 'after_discount_and_vat'
        ? 'after_discount_and_vat'
        : 'after_discount';
    const taxValue = taxEnabled ? parseNonNegativeDecimal(payload.tax_value ?? 0, 'Tax') : 0;
    const taxCalcBase =
      taxBase === 'subtotal'
        ? subtotal
        : taxBase === 'after_discount_and_vat'
        ? roundMoney2(afterDiscount + vatBdt)
        : afterDiscount;
    const taxBdt = !taxEnabled
      ? 0
      : taxType === 'percent'
      ? roundMoney2(taxCalcBase * (taxValue / 100))
      : roundMoney2(taxValue);

    const total = roundMoney2(Math.max(0, subtotal - discount + vatBdt + taxBdt));
    const quotationDate =
      payload.quotation_date && isValidIsoDate(payload.quotation_date)
        ? payload.quotation_date
        : getTodayDhakaIso();
    const validUntil =
      payload.valid_until && isValidIsoDate(payload.valid_until)
        ? payload.valid_until
        : '';
    const status: QuotationStatus = payload.status
      ? normalizeQuotationStatus(payload.status)
      : 'Draft';

    const leadSource = normalizeLeadSource(
      payload.lead_source || leadRow?.lead_source || 'Not Specified'
    );
    let refType = String(payload.referral_contact_type || leadRow?.referral_contact_type || '').trim();
    let refName = String(payload.referral_contact_name || '').trim();
    let refPhone = String(payload.referral_contact_phone || '').trim();
    if (!refName && leadRow) {
      if (leadSource === 'Agent Referral' || refType === 'agent') {
        refType = 'agent';
        refName = leadRow.agent_name;
        refPhone = leadRow.agent_phone_display;
      } else if (leadSource === 'Caretaker Referral' || refType === 'caretaker') {
        refType = 'caretaker';
        refName = leadRow.caretaker_name;
        refPhone = leadRow.caretaker_phone_display;
      }
    }

    const rawShare = String(payload.share_url || '').trim();
    const safeShare = rawShare ? validateSafeExternalUrl(rawShare) : '';
    if (rawShare && !safeShare) {
      throw new Error('Quotation share link must be a valid https:// or http:// URL.');
    }

    const followupDate =
      payload.followup_date && isValidIsoDate(payload.followup_date) ? payload.followup_date : '';
    const followupNote = String(payload.followup_note || '').trim();
    const now = getNowDhakaTimestamp();

    if (payload.quotation_id) {
      const existing = getQuotationById(payload.quotation_id);
      if (!existing) throw new Error('Quotation not found.');
      const nextHistory = [...(existing.status_history || [])];
      let statusChangedAt = existing.status_changed_at || existing.created_at || now;
      if (status !== existing.status) {
        statusChangedAt = now;
        nextHistory.push({
          status,
          changed_at: now,
          changed_by: actor.name,
          note: followupNote || undefined,
        });
      }
      const nextFollowupDone =
        status === 'Accepted' || status === 'Cancelled'
          ? 1
          : payload.followup_date
          ? 0
          : existing.followup_done
          ? 1
          : 0;
      const nextDoneAt = nextFollowupDone === 1 ? existing.followup_done_at || now : '';

      db.prepare(
        `UPDATE quotations SET
          customer_id = ?, building_id = ?,
          quotation_date = ?, valid_until = ?, customer_name = ?, phone_display = ?, phone_e164 = ?,
          address = ?, area = ?, lead_source = ?, referral_contact_type = ?, referral_contact_name = ?, referral_contact_phone = ?,
          items_json = ?, subtotal_bdt = ?,
          discount_enabled = ?, discount_type = ?, discount_value = ?, discount_bdt = ?,
          vat_enabled = ?, vat_type = ?, vat_value = ?, vat_base = ?, vat_bdt = ?,
          tax_enabled = ?, tax_type = ?, tax_value = ?, tax_base = ?, tax_bdt = ?,
          total_bdt = ?,
          terms = ?, notes = ?, status = ?, status_changed_at = ?, status_history_json = ?,
          followup_date = ?, followup_note = ?, followup_done = ?, followup_done_at = ?, share_url = ?,
          updated_at = ?
         WHERE quotation_id = ?`
      ).run(
        String(payload.customer_id ?? existing.customer_id),
        String(payload.building_id ?? existing.building_id),
        quotationDate,
        validUntil,
        customerName,
        phone.display,
        phone.e164,
        address,
        String(payload.area || '').trim(),
        leadSource,
        refType,
        refName,
        refPhone,
        JSON.stringify(items),
        subtotal,
        discountEnabled ? 1 : 0,
        discountType,
        discountValue,
        discount,
        vatEnabled ? 1 : 0,
        vatType,
        vatValue,
        vatBase,
        vatBdt,
        taxEnabled ? 1 : 0,
        taxType,
        taxValue,
        taxBase,
        taxBdt,
        total,
        String(payload.terms || '').trim(),
        String(payload.notes || '').trim(),
        status,
        statusChangedAt,
        JSON.stringify(nextHistory),
        payload.followup_date !== undefined ? followupDate : existing.followup_date,
        payload.followup_note !== undefined ? followupNote : existing.followup_note,
        nextFollowupDone,
        nextDoneAt,
        payload.share_url !== undefined ? safeShare : existing.share_url,
        now,
        existing.quotation_id
      );
      return getQuotationById(existing.quotation_id)!;
    }

    const qId = generateNextId('quotation_sequence', 'QTN', 'quotations', 'quotation_id');
    const activePad = getPad('quotation');
    const initHistory = [{ status, changed_at: now, changed_by: actor.name }];
    const initDone = status === 'Accepted' || status === 'Cancelled' ? 1 : 0;

    db.prepare(
      `INSERT INTO quotations (
        quotation_id, lead_id, customer_id, building_id, quotation_date, valid_until,
        customer_name, phone_display, phone_e164, address, area,
        lead_source, referral_contact_type, referral_contact_name, referral_contact_phone,
        items_json, subtotal_bdt,
        discount_enabled, discount_type, discount_value, discount_bdt,
        vat_enabled, vat_type, vat_value, vat_base, vat_bdt,
        tax_enabled, tax_type, tax_value, tax_base, tax_bdt,
        total_bdt,
        terms, notes, status, status_changed_at, status_history_json,
        followup_date, followup_note, followup_done, followup_done_at, share_url,
        converted_order_id, pad_snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`
    ).run(
      qId,
      leadId,
      String(payload.customer_id || ''),
      String(payload.building_id || ''),
      quotationDate,
      validUntil,
      customerName,
      phone.display,
      phone.e164,
      address,
      String(payload.area || '').trim(),
      leadSource,
      refType,
      refName,
      refPhone,
      JSON.stringify(items),
      subtotal,
      discountEnabled ? 1 : 0,
      discountType,
      discountValue,
      discount,
      vatEnabled ? 1 : 0,
      vatType,
      vatValue,
      vatBase,
      vatBdt,
      taxEnabled ? 1 : 0,
      taxType,
      taxValue,
      taxBase,
      taxBdt,
      total,
      String(payload.terms || '').trim(),
      String(payload.notes || '').trim(),
      status,
      now,
      JSON.stringify(initHistory),
      followupDate,
      followupNote,
      initDone,
      initDone ? now : '',
      safeShare,
      activePad ? JSON.stringify(activePad) : '',
      now,
      now
    );

    if (leadId) {
      db.prepare(
        `UPDATE leads SET
          linked_quotation_id = ?,
          stage = CASE WHEN stage IN ('New', 'Contacted') THEN 'Quotation Sent' ELSE stage END,
          updated_at = ?
         WHERE lead_id = ?`
      ).run(qId, now, leadId);
      db.prepare(
        `INSERT INTO lead_notes (note_id, lead_id, channel, note_text, created_by, created_at)
         VALUES (?, ?, 'Other', ?, ?, ?)`
      ).run(makeUid('LNT'), leadId, `Quotation created and linked (${qId} · BDT ${total}).`, actor.name, now);
    }

    return getQuotationById(qId)!;
  }
);

/**
 * Converts a quotation to an order.
 * Repeated conversion NEVER creates a duplicate: it returns the existing linked order!
 */
export const convertQuotationToOrderTx = db.transaction(
  (
    quotationId: string,
    scheduleInput: {
      booking_date?: string;
      scheduled_date?: string;
      scheduled_time?: string;
      estimated_duration_mins?: number;
      assigned_supervisor_id?: string;
      instructions?: string;
    },
    actor: AuthUser
  ): { alreadyConverted: boolean; order: OrderRecord; quotation: QuotationRecord } => {
    const q = getQuotationById(quotationId);
    if (!q) throw new Error('Quotation not found.');
    if (q.status === 'Cancelled') {
      throw new Error('A cancelled quotation cannot be converted into an order.');
    }

    if (q.converted_order_id) {
      const linked = getOrderById(q.converted_order_id);
      if (linked) {
        return { alreadyConverted: true, order: linked, quotation: q };
      }
    }

    const services = Array.from(new Set(q.items.map((i) => i.service).filter(Boolean)));
    const newOrder = createOrderTx(
      {
        customer_id: q.customer_id || undefined,
        building_id: q.building_id || undefined,
        customer_name: q.customer_name,
        phone: q.phone_display,
        address: q.address,
        area: q.area,
        services,
        booking_date:
          scheduleInput.booking_date && isValidIsoDate(scheduleInput.booking_date)
            ? scheduleInput.booking_date
            : getTodayDhakaIso(),
        scheduled_date:
          scheduleInput.scheduled_date && isValidIsoDate(scheduleInput.scheduled_date)
            ? scheduleInput.scheduled_date
            : getTodayDhakaIso(),
        scheduled_time: scheduleInput.scheduled_time || '10:00',
        estimated_duration_mins: scheduleInput.estimated_duration_mins || 120,
        price_bdt: q.total_bdt,
        instructions: scheduleInput.instructions || q.notes,
        notes: q.notes,
        lead_source: q.lead_source,
        referral_contact_type: q.referral_contact_type,
        referral_contact_name: q.referral_contact_name,
        referral_contact_phone: q.referral_contact_phone,
        assigned_supervisor_id: scheduleInput.assigned_supervisor_id || '',
        status: 'Confirmed',
        quotation_id: q.quotation_id,
        lead_id: q.lead_id || '',
      },
      actor
    );

    const now = getNowDhakaTimestamp();
    const nextHistory = [
      ...(q.status_history || []),
      {
        status: 'Accepted' as QuotationStatus,
        changed_at: now,
        changed_by: actor.name,
        note: `Converted to Order ${newOrder.order_id}`,
      },
    ];
    db.prepare(
      `UPDATE quotations SET
        converted_order_id = ?,
        status = 'Accepted',
        status_changed_at = ?,
        status_history_json = ?,
        followup_done = 1,
        followup_done_at = ?,
        updated_at = ?
       WHERE quotation_id = ?`
    ).run(newOrder.order_id, now, JSON.stringify(nextHistory), now, now, q.quotation_id);

    return {
      alreadyConverted: false,
      order: newOrder,
      quotation: getQuotationById(q.quotation_id)!,
    };
  }
);

// ============================================================================
// MONEY RECEIPTS (NO DUPLICATE PAYMENT RECORDING, BLOCKED ON NO-CHARGE VISITS)
// ============================================================================

export function getAllReceipts(): MoneyReceiptRecord[] {
  const rows = db.prepare('SELECT * FROM receipts ORDER BY created_at DESC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(mapReceiptRow);
}

export const issueMoneyReceiptTx = db.transaction(
  (
    payload: {
      order_id: string;
      receipt_date?: string;
      payment_method: PaymentMethod;
      transaction_ref?: string;
      notes?: string;
    },
    actor: AuthUser
  ): { alreadyIssued: boolean; receipt: MoneyReceiptRecord; order: OrderRecord } => {
    const order = getOrderById(payload.order_id);
    if (!order) throw new Error('Order not found.');
    if (order.is_no_charge_visit) {
      throw new Error('Money receipts cannot be issued for no-charge return visits.');
    }
    if (order.status !== 'Completed' || !order.full_bill_collected) {
      throw new Error('Money receipts can only be issued for Completed orders with full bill collected.');
    }

    const existingRow = db
      .prepare('SELECT * FROM receipts WHERE order_id = ?')
      .get(order.order_id) as Record<string, unknown> | undefined;
    if (existingRow) {
      return {
        alreadyIssued: true,
        receipt: mapReceiptRow(existingRow),
        order,
      };
    }

    const method = translatePaymentMethodToEnglish(payload.payment_method || 'Cash');
    const receiptDate =
      payload.receipt_date && isValidIsoDate(payload.receipt_date)
        ? payload.receipt_date
        : getTodayDhakaIso();
    const receiptId = generateNextId('receipt_sequence', 'MR', 'receipts', 'receipt_id');
    const now = getNowDhakaTimestamp();
    const activePad = getPad('receipt');

    db.prepare(
      `INSERT INTO receipts (
        receipt_id, order_id, receipt_date, customer_name, phone_display, address,
        services_text, amount_received, payment_method, transaction_ref,
        received_by, notes, pad_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      receiptId,
      order.order_id,
      receiptDate,
      order.customer_name,
      order.phone_display,
      order.address,
      order.services_text,
      order.price_bdt,
      method,
      String(payload.transaction_ref || '').trim(),
      actor.name,
      String(payload.notes || '').trim(),
      activePad ? JSON.stringify(activePad) : '',
      now
    );

    db.prepare('UPDATE orders SET receipt_id = ?, updated_at = ? WHERE order_id = ?').run(
      receiptId,
      now,
      order.order_id
    );

    appendHistory(
      order.order_id,
      order.status,
      order.status,
      `Money receipt issued (${receiptId} · ${method}).`,
      actor.name
    );

    const created = db
      .prepare('SELECT * FROM receipts WHERE receipt_id = ?')
      .get(receiptId) as Record<string, unknown>;

    return {
      alreadyIssued: false,
      receipt: mapReceiptRow(created),
      order: getOrderById(order.order_id)!,
    };
  }
);

// ============================================================================
// DOCUMENT PADS (QUOTATION PAD & RECEIPT PAD)
// ============================================================================

export function getPad(padType: PadType): DocumentPadConfig | null {
  const row = db.prepare('SELECT * FROM document_pads WHERE pad_type = ?').get(padType) as
    | Record<string, unknown>
    | undefined;
  return row ? mapPadRow(row) : null;
}

export function savePadConfig(
  padType: PadType,
  payload: {
    file_name: string;
    mime_type: string;
    image_data_url: string;
    fields: PadFieldConfig[];
    drive_file_id?: string;
  },
  actor: AuthUser
): DocumentPadConfig {
  if (padType !== 'quotation' && padType !== 'receipt') {
    throw new Error('Invalid document pad type.');
  }
  const allowedMimes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']);
  if (!allowedMimes.has(payload.mime_type.toLowerCase())) {
    throw new Error('Only PDF, PNG, or JPG files can be uploaded.');
  }
  if (!payload.image_data_url || !payload.image_data_url.startsWith('data:image/')) {
    throw new Error('Pad image could not be processed. Please upload again.');
  }
  if (payload.image_data_url.length > 10 * 1024 * 1024) {
    throw new Error('Pad file size must be under 10 MB.');
  }

  const existing = getPad(padType);
  const nextVersion = existing ? existing.version + 1 : 1;
  const now = getNowDhakaTimestamp();
  const safeFields =
    Array.isArray(payload.fields) && payload.fields.length > 0
      ? payload.fields
      : existing?.fields || getDefaultPadFields(padType);

  db.prepare(
    `INSERT INTO document_pads (
      pad_type, version, file_name, mime_type, image_data_url,
      page_width_mm, page_height_mm, fields_json, updated_at, updated_by, drive_file_id
    ) VALUES (?, ?, ?, ?, ?, 210, 297, ?, ?, ?, ?)
    ON CONFLICT(pad_type) DO UPDATE SET
      version = excluded.version,
      file_name = excluded.file_name,
      mime_type = excluded.mime_type,
      image_data_url = excluded.image_data_url,
      fields_json = excluded.fields_json,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      drive_file_id = CASE WHEN excluded.drive_file_id != '' THEN excluded.drive_file_id ELSE document_pads.drive_file_id END`
  ).run(
    padType,
    nextVersion,
    String(payload.file_name || 'pad.png').slice(0, 180),
    payload.mime_type.toLowerCase(),
    payload.image_data_url,
    JSON.stringify(safeFields),
    now,
    actor.name,
    String(payload.drive_file_id || '')
  );

  return getPad(padType)!;
}

export function updatePadFieldsOnly(
  padType: PadType,
  fields: PadFieldConfig[],
  actor: AuthUser
): DocumentPadConfig {
  const existing = getPad(padType);
  if (!existing) {
    throw new Error('Please upload a document pad file first.');
  }
  const now = getNowDhakaTimestamp();
  db.prepare(
    'UPDATE document_pads SET fields_json = ?, updated_at = ?, updated_by = ? WHERE pad_type = ?'
  ).run(JSON.stringify(fields), now, actor.name, padType);
  return getPad(padType)!;
}

export function deletePadConfig(padType: PadType): void {
  db.prepare('DELETE FROM document_pads WHERE pad_type = ?').run(padType);
}

// ============================================================================
// OVERHEAD EXPENSES (SEPARATE FROM PER-JOB COST)
// ============================================================================

export function listOverheadExpenses(): OverheadExpenseRecord[] {
  return db
    .prepare('SELECT * FROM overhead_expenses ORDER BY expense_date DESC, created_at DESC')
    .all() as OverheadExpenseRecord[];
}

export function createOverheadExpense(
  payload: {
    expense_date: string;
    category: string;
    description: string;
    amount_bdt: number | string;
  },
  actor: AuthUser
): OverheadExpenseRecord {
  const expenseDate = isValidIsoDate(payload.expense_date)
    ? payload.expense_date
    : getTodayDhakaIso();
  const category = normalizeExpenseCategory(String(payload.category || '').trim());
  const description = String(payload.description || '').trim();
  if (!description) throw new Error('Expense description is required.');
  const amount = parseNonNegativeAmount(payload.amount_bdt, 'Expense amount');
  if (amount <= 0) throw new Error('Expense amount must be greater than 0.');

  const id = makeUid('OVH');
  const now = getNowDhakaTimestamp();
  db.prepare(
    `INSERT INTO overhead_expenses (id, expense_date, category, description, amount_bdt, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, expenseDate, category, description, amount, actor.name, now);

  return db
    .prepare('SELECT * FROM overhead_expenses WHERE id = ?')
    .get(id) as OverheadExpenseRecord;
}

export function deleteOverheadExpense(id: string): void {
  db.prepare('DELETE FROM overhead_expenses WHERE id = ?').run(id);
}

// ============================================================================
// COMPANY BRANDING (LOGO UPLOAD / PREVIEW / REMOVE)
// ============================================================================

export function getCompanyLogoDataUrl(): string {
  return getSettingRaw('company_logo_data_url', '');
}

export function saveCompanyLogo(payload: {
  file_name: string;
  mime_type: string;
  data_url: string;
}): AppSettings {
  const mime = String(payload.mime_type || '').trim().toLowerCase();
  const allowed = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
  if (!allowed.has(mime)) {
    throw new Error('Only PNG, JPG, or WebP logo files can be uploaded.');
  }
  const dataUrl = String(payload.data_url || '').trim();
  if (!dataUrl.startsWith('data:image/')) {
    throw new Error('Logo file could not be processed. Please try again.');
  }
  // Max ~3MB base64 payload (~2.2MB binary)
  if (dataUrl.length > 3 * 1024 * 1024) {
    throw new Error('Company logo file size must be under 3 MB.');
  }

  const now = getNowDhakaTimestamp();
  setSettingRaw('company_logo_data_url', dataUrl);
  setSettingRaw('company_logo_file_name', String(payload.file_name || 'company-logo.png').slice(0, 140));
  setSettingRaw('company_logo_mime_type', mime);
  setSettingRaw('company_logo_updated_at', now);
  return getPublicSettings();
}

export function deleteCompanyLogo(): AppSettings {
  setSettingRaw('company_logo_data_url', '');
  setSettingRaw('company_logo_file_name', '');
  setSettingRaw('company_logo_mime_type', '');
  setSettingRaw('company_logo_updated_at', '');
  return getPublicSettings();
}

// ============================================================================
// PROSPECTIVE CUSTOMERS (LEADS) & DATED NOTES (ADMIN-ONLY)
// ============================================================================

function mapLeadRow(row: Record<string, unknown>): LeadRecord {
  let services: string[] = [];
  try {
    const parsed = JSON.parse(String(row.interested_services_json || '[]'));
    if (Array.isArray(parsed)) services = parsed.map(String);
  } catch {
    services = String(row.interested_services_text || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const rawRefType = String(row.referral_contact_type || '');
  const refType =
    rawRefType === 'agent' || rawRefType === 'caretaker' ? rawRefType : '';

  return {
    lead_id: String(row.lead_id),
    name: String(row.name || ''),
    phone_display: String(row.phone_display || ''),
    phone_e164: String(row.phone_e164 || ''),
    area: String(row.area || ''),
    building_org: String(row.building_org || ''),
    address: String(row.address || ''),
    contact_role: String(row.contact_role || ''),
    interested_services: services,
    interested_services_text: String(row.interested_services_text || services.join(', ')),
    lead_source: normalizeLeadSource(String(row.lead_source || '')),
    referral_contact_type: refType,
    stage: normalizeLeadStage(String(row.stage || 'New')),
    next_followup_date: String(row.next_followup_date || ''),
    followup_done: Number(row.followup_done || 0) === 1,
    followup_done_at: String(row.followup_done_at || ''),
    followup_version: Number(row.followup_version || 0),
    reminder_sent: Number(row.reminder_sent || 0) === 1,
    reminder_sent_at: String(row.reminder_sent_at || ''),
    reminder_sent_for_date: String(row.reminder_sent_for_date || ''),
    reminder_sent_version: Number(row.reminder_sent_version || 0),
    linked_quotation_id: String(row.linked_quotation_id || ''),
    linked_order_id: String(row.linked_order_id || ''),
    agent_name: String(row.agent_name || ''),
    agent_phone_display: String(row.agent_phone_display || ''),
    agent_phone_e164: String(row.agent_phone_e164 || ''),
    agent_note: String(row.agent_note || ''),
    caretaker_name: String(row.caretaker_name || ''),
    caretaker_phone_display: String(row.caretaker_phone_display || ''),
    caretaker_phone_e164: String(row.caretaker_phone_e164 || ''),
    caretaker_note: String(row.caretaker_note || ''),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

export function listLeads(): LeadRecord[] {
  const rows = db.prepare('SELECT * FROM leads ORDER BY updated_at DESC, created_at DESC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(mapLeadRow);
}

export function getLeadById(leadId: string): LeadRecord | null {
  const row = db.prepare('SELECT * FROM leads WHERE lead_id = ?').get(leadId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapLeadRow(row) : null;
}

export function listAllLeadNotes(): LeadNoteRecord[] {
  return db
    .prepare('SELECT * FROM lead_notes ORDER BY created_at DESC')
    .all() as LeadNoteRecord[];
}

export function findDuplicateContactsByPhone(
  rawPhone: string,
  excludeLeadId = ''
): {
  normalized: { display: string; e164: string } | null;
  matchingLeads: Array<{
    lead_id: string;
    name: string;
    phone_display: string;
    area: string;
    building_org: string;
    stage: LeadStage;
  }>;
  matchingOrders: Array<{
    order_id: string;
    customer_name: string;
    phone_display: string;
    area: string;
    scheduled_date: string;
    status: OrderStatus;
  }>;
} {
  const norm = normalizeBangladeshPhone(rawPhone || '');
  if (!norm) {
    return { normalized: null, matchingLeads: [], matchingOrders: [] };
  }

  const leadRows = db
    .prepare(
      'SELECT lead_id, name, phone_display, area, building_org, stage FROM leads WHERE phone_e164 = ? AND lead_id != ? ORDER BY updated_at DESC LIMIT 10'
    )
    .all(norm.e164, excludeLeadId) as Array<{
    lead_id: string;
    name: string;
    phone_display: string;
    area: string;
    building_org: string;
    stage: LeadStage;
  }>;

  const orderRows = db
    .prepare(
      'SELECT order_id, customer_name, phone_display, area, scheduled_date, status FROM orders WHERE phone_e164 = ? ORDER BY created_at DESC LIMIT 10'
    )
    .all(norm.e164) as Array<{
    order_id: string;
    customer_name: string;
    phone_display: string;
    area: string;
    scheduled_date: string;
    status: OrderStatus;
  }>;

  return {
    normalized: norm,
    matchingLeads: leadRows,
    matchingOrders: orderRows,
  };
}

export const createLeadTx = db.transaction(
  (
    input: {
      name: string;
      phone: string;
      area?: string;
      building_org?: string;
      address?: string;
      contact_role?: string;
      interested_services?: string[];
      lead_source?: string;
      referral_contact_type?: '' | 'agent' | 'caretaker';
      stage?: LeadStage;
      next_followup_date?: string;
      initial_note?: string;
      initial_channel?: LeadChannel;
      agent_name?: string;
      agent_phone?: string;
      agent_note?: string;
      caretaker_name?: string;
      caretaker_phone?: string;
      caretaker_note?: string;
    },
    actor: AuthUser
  ): LeadRecord => {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Prospect name is required.');

    const phone = normalizeBangladeshPhone(input.phone || '');
    if (!phone) {
      throw new Error('Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX).');
    }

    const agentPhone = normalizeOptionalContactPhone(input.agent_phone || '');
    const caretakerPhone = normalizeOptionalContactPhone(input.caretaker_phone || '');

    const services = Array.isArray(input.interested_services)
      ? input.interested_services.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const stage: LeadStage = normalizeLeadStage(String(input.stage || 'New'));
    const leadSource = normalizeLeadSource(String(input.lead_source || ''));
    const refType =
      input.referral_contact_type === 'agent' || input.referral_contact_type === 'caretaker'
        ? input.referral_contact_type
        : leadSource === 'Agent Referral'
        ? 'agent'
        : leadSource === 'Caretaker Referral'
        ? 'caretaker'
        : '';

    const nextFollowup = String(input.next_followup_date || '').trim();
    if (nextFollowup && !isValidIsoDate(nextFollowup)) {
      throw new Error('Please enter a valid next follow-up date.');
    }

    const leadId = generateNextId('lead_sequence', 'LD', 'leads', 'lead_id');
    const now = getNowDhakaTimestamp();
    const followupVersion = nextFollowup ? 1 : 0;

    db.prepare(
      `INSERT INTO leads (
        lead_id, name, phone_display, phone_e164, area, building_org, address, contact_role,
        interested_services_json, interested_services_text, lead_source, referral_contact_type, stage,
        next_followup_date, followup_done, followup_done_at, followup_version,
        reminder_sent, reminder_sent_at, reminder_sent_for_date, reminder_sent_version,
        linked_quotation_id, linked_order_id,
        agent_name, agent_phone_display, agent_phone_e164, agent_note,
        caretaker_name, caretaker_phone_display, caretaker_phone_e164, caretaker_note,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, 0, '', '', 0, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      leadId,
      name,
      phone.display,
      phone.e164,
      String(input.area || '').trim(),
      String(input.building_org || '').trim(),
      String(input.address || '').trim(),
      String(input.contact_role || '').trim(),
      JSON.stringify(services),
      services.join(', '),
      leadSource,
      refType,
      stage,
      nextFollowup,
      followupVersion,
      String(input.agent_name || '').trim(),
      agentPhone.display,
      agentPhone.e164,
      String(input.agent_note || '').trim(),
      String(input.caretaker_name || '').trim(),
      caretakerPhone.display,
      caretakerPhone.e164,
      String(input.caretaker_note || '').trim(),
      now,
      now
    );

    const initialNote = String(input.initial_note || '').trim();
    if (initialNote) {
      const channel: LeadChannel = normalizeLeadChannel(String(input.initial_channel || 'Call'));
      db.prepare(
        `INSERT INTO lead_notes (note_id, lead_id, channel, note_text, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(makeUid('LNT'), leadId, channel, initialNote, actor.name, now);
    }

    return getLeadById(leadId)!;
  }
);

export const updateLeadTx = db.transaction(
  (
    leadId: string,
    input: {
      name: string;
      phone: string;
      area?: string;
      building_org?: string;
      address?: string;
      contact_role?: string;
      interested_services?: string[];
      lead_source?: string;
      referral_contact_type?: '' | 'agent' | 'caretaker';
      stage?: LeadStage;
      next_followup_date?: string;
      agent_name?: string;
      agent_phone?: string;
      agent_note?: string;
      caretaker_name?: string;
      caretaker_phone?: string;
      caretaker_note?: string;
    },
    actor: AuthUser
  ): LeadRecord => {
    const existing = getLeadById(leadId);
    if (!existing) throw new Error('Prospect record not found.');

    const name = String(input.name || '').trim();
    if (!name) throw new Error('Prospect name is required.');

    const phone = normalizeBangladeshPhone(input.phone || '');
    if (!phone) {
      throw new Error('Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX).');
    }

    const agentPhone =
      input.agent_phone !== undefined
        ? normalizeOptionalContactPhone(input.agent_phone)
        : { display: existing.agent_phone_display, e164: existing.agent_phone_e164 };
    const caretakerPhone =
      input.caretaker_phone !== undefined
        ? normalizeOptionalContactPhone(input.caretaker_phone)
        : { display: existing.caretaker_phone_display, e164: existing.caretaker_phone_e164 };

    const services = Array.isArray(input.interested_services)
      ? input.interested_services.map((s) => String(s).trim()).filter(Boolean)
      : existing.interested_services;
    const stage: LeadStage = input.stage ? normalizeLeadStage(String(input.stage)) : existing.stage;
    const leadSource =
      input.lead_source !== undefined
        ? normalizeLeadSource(String(input.lead_source))
        : existing.lead_source;
    const refType =
      input.referral_contact_type !== undefined
        ? input.referral_contact_type === 'agent' || input.referral_contact_type === 'caretaker'
          ? input.referral_contact_type
          : ''
        : leadSource === 'Agent Referral'
        ? 'agent'
        : leadSource === 'Caretaker Referral'
        ? 'caretaker'
        : existing.referral_contact_type;

    const nextFollowup =
      input.next_followup_date !== undefined
        ? String(input.next_followup_date || '').trim()
        : existing.next_followup_date;
    if (nextFollowup && !isValidIsoDate(nextFollowup)) {
      throw new Error('Please enter a valid next follow-up date.');
    }

    const now = getNowDhakaTimestamp();
    const dateChanged = nextFollowup !== existing.next_followup_date;
    const nextVersion = dateChanged
      ? nextFollowup
        ? (existing.followup_version || 0) + 1
        : existing.followup_version
      : existing.followup_version;

    db.prepare(
      `UPDATE leads SET
        name = ?,
        phone_display = ?,
        phone_e164 = ?,
        area = ?,
        building_org = ?,
        address = ?,
        contact_role = ?,
        interested_services_json = ?,
        interested_services_text = ?,
        lead_source = ?,
        referral_contact_type = ?,
        stage = ?,
        next_followup_date = ?,
        followup_done = ?,
        followup_done_at = ?,
        followup_version = ?,
        reminder_sent = ?,
        reminder_sent_at = ?,
        reminder_sent_for_date = ?,
        reminder_sent_version = ?,
        agent_name = ?,
        agent_phone_display = ?,
        agent_phone_e164 = ?,
        agent_note = ?,
        caretaker_name = ?,
        caretaker_phone_display = ?,
        caretaker_phone_e164 = ?,
        caretaker_note = ?,
        updated_at = ?
       WHERE lead_id = ?`
    ).run(
      name,
      phone.display,
      phone.e164,
      String(input.area ?? existing.area).trim(),
      String(input.building_org ?? existing.building_org).trim(),
      String(input.address ?? existing.address).trim(),
      String(input.contact_role ?? existing.contact_role).trim(),
      JSON.stringify(services),
      services.join(', '),
      leadSource,
      refType,
      stage,
      nextFollowup,
      dateChanged && nextFollowup ? 0 : existing.followup_done ? 1 : 0,
      dateChanged && nextFollowup ? '' : existing.followup_done_at,
      nextVersion,
      dateChanged ? 0 : existing.reminder_sent ? 1 : 0,
      dateChanged ? '' : existing.reminder_sent_at,
      dateChanged ? '' : existing.reminder_sent_for_date,
      dateChanged ? 0 : existing.reminder_sent_version,
      String(input.agent_name ?? existing.agent_name).trim(),
      agentPhone.display,
      agentPhone.e164,
      String(input.agent_note ?? existing.agent_note).trim(),
      String(input.caretaker_name ?? existing.caretaker_name).trim(),
      caretakerPhone.display,
      caretakerPhone.e164,
      String(input.caretaker_note ?? existing.caretaker_note).trim(),
      now,
      leadId
    );

    if (stage !== existing.stage) {
      db.prepare(
        `INSERT INTO lead_notes (note_id, lead_id, channel, note_text, created_by, created_at)
         VALUES (?, ?, 'Other', ?, ?, ?)`
      ).run(
        makeUid('LNT'),
        leadId,
        `Stage changed: ${existing.stage} -> ${stage}`,
        actor.name,
        now
      );
    }

    return getLeadById(leadId)!;
  }
);

export const addLeadNoteTx = db.transaction(
  (
    leadId: string,
    payload: {
      channel?: LeadChannel;
      note_text: string;
      stage?: LeadStage;
      next_followup_date?: string;
    },
    actor: AuthUser
  ): { lead: LeadRecord; note: LeadNoteRecord } => {
    const existing = getLeadById(leadId);
    if (!existing) throw new Error('Prospect record not found.');

    const text = String(payload.note_text || '').trim();
    if (!text) throw new Error('Please enter a contact note.');

    const channel: LeadChannel = normalizeLeadChannel(String(payload.channel || 'Call'));
    const now = getNowDhakaTimestamp();
    const noteId = makeUid('LNT');

    db.prepare(
      `INSERT INTO lead_notes (note_id, lead_id, channel, note_text, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(noteId, leadId, channel, text, actor.name, now);

    const newStage: LeadStage =
      payload.stage && LEAD_STAGES.includes(normalizeLeadStage(String(payload.stage)))
        ? normalizeLeadStage(String(payload.stage))
        : existing.stage === 'New'
        ? 'Contacted'
        : existing.stage;

    const nextFollowup =
      payload.next_followup_date !== undefined
        ? String(payload.next_followup_date || '').trim()
        : existing.next_followup_date;
    if (nextFollowup && !isValidIsoDate(nextFollowup)) {
      throw new Error('Please enter a valid next follow-up date.');
    }

    const dateChanged = nextFollowup !== existing.next_followup_date && nextFollowup !== '';
    const nextVersion = dateChanged ? (existing.followup_version || 0) + 1 : existing.followup_version;

    db.prepare(
      `UPDATE leads SET
        stage = ?,
        next_followup_date = ?,
        followup_done = ?,
        followup_done_at = ?,
        followup_version = ?,
        reminder_sent = ?,
        reminder_sent_at = ?,
        reminder_sent_for_date = ?,
        reminder_sent_version = ?,
        updated_at = ?
       WHERE lead_id = ?`
    ).run(
      newStage,
      nextFollowup,
      dateChanged ? 0 : existing.followup_done ? 1 : 0,
      dateChanged ? '' : existing.followup_done_at,
      nextVersion,
      dateChanged ? 0 : existing.reminder_sent ? 1 : 0,
      dateChanged ? '' : existing.reminder_sent_at,
      dateChanged ? '' : existing.reminder_sent_for_date,
      dateChanged ? 0 : existing.reminder_sent_version,
      now,
      leadId
    );

    const note = db
      .prepare('SELECT * FROM lead_notes WHERE note_id = ?')
      .get(noteId) as LeadNoteRecord;
    return { lead: getLeadById(leadId)!, note };
  }
);

export const rescheduleLeadFollowupTx = db.transaction(
  (
    leadId: string,
    payload: { next_followup_date: string; note?: string },
    actor: AuthUser
  ): LeadRecord => {
    const existing = getLeadById(leadId);
    if (!existing) throw new Error('Prospect record not found.');

    const newDate = String(payload.next_followup_date || '').trim();
    if (!isValidIsoDate(newDate)) {
      throw new Error('Please enter a valid next follow-up date.');
    }

    const now = getNowDhakaTimestamp();
    const nextVersion = (existing.followup_version || 0) + 1;

    db.prepare(
      `UPDATE leads SET
        next_followup_date = ?,
        followup_done = 0,
        followup_done_at = '',
        followup_version = ?,
        reminder_sent = 0,
        reminder_sent_at = '',
        reminder_sent_for_date = '',
        reminder_sent_version = 0,
        updated_at = ?
       WHERE lead_id = ?`
    ).run(newDate, nextVersion, now, leadId);

    const noteMsg = payload.note
      ? `Next follow-up scheduled: ${newDate} (${String(payload.note).trim()})`
      : `Next follow-up date updated: ${existing.next_followup_date || 'None'} -> ${newDate}`;

    db.prepare(
      `INSERT INTO lead_notes (note_id, lead_id, channel, note_text, created_by, created_at)
       VALUES (?, ?, 'Other', ?, ?, ?)`
    ).run(makeUid('LNT'), leadId, noteMsg, actor.name, now);

    return getLeadById(leadId)!;
  }
);

export const toggleLeadFollowupDoneTx = db.transaction(
  (
    leadId: string,
    isDone: boolean,
    nextFollowupDate: string | undefined,
    noteText: string | undefined,
    actor: AuthUser
  ): LeadRecord => {
    const existing = getLeadById(leadId);
    if (!existing) throw new Error('Prospect record not found.');
    const now = getNowDhakaTimestamp();

    const optionalNext = String(nextFollowupDate || '').trim();
    if (optionalNext && !isValidIsoDate(optionalNext)) {
      throw new Error('Please enter a valid next follow-up date.');
    }

    if (optionalNext) {
      const nextVersion = (existing.followup_version || 0) + 1;
      db.prepare(
        `UPDATE leads SET
          next_followup_date = ?,
          followup_done = 0,
          followup_done_at = '',
          followup_version = ?,
          reminder_sent = 0,
          reminder_sent_at = '',
          reminder_sent_for_date = '',
          reminder_sent_version = 0,
          stage = CASE WHEN stage = 'New' THEN 'Contacted' ELSE stage END,
          updated_at = ?
         WHERE lead_id = ?`
      ).run(optionalNext, nextVersion, now, leadId);

      db.prepare(
        `INSERT INTO lead_notes (note_id, lead_id, channel, note_text, created_by, created_at)
         VALUES (?, ?, 'Call', ?, ?, ?)`
      ).run(
        makeUid('LNT'),
        leadId,
        `${noteText ? String(noteText).trim() + ' | ' : ''}Follow-up completed; next follow-up scheduled: ${optionalNext}`,
        actor.name,
        now
      );
    } else {
      db.prepare(
        `UPDATE leads SET
          followup_done = ?,
          followup_done_at = ?,
          stage = CASE WHEN ? = 1 AND stage = 'New' THEN 'Contacted' ELSE stage END,
          updated_at = ?
         WHERE lead_id = ?`
      ).run(isDone ? 1 : 0, isDone ? now : '', isDone ? 1 : 0, now, leadId);

      db.prepare(
        `INSERT INTO lead_notes (note_id, lead_id, channel, note_text, created_by, created_at)
         VALUES (?, ?, 'Other', ?, ?, ?)`
      ).run(
        makeUid('LNT'),
        leadId,
        noteText
          ? String(noteText).trim()
          : isDone
          ? 'Prospect follow-up marked as done.'
          : 'Prospect follow-up reopened.',
        actor.name,
        now
      );
    }

    return getLeadById(leadId)!;
  }
);

// ============================================================================
// ISSUED PDF ARCHIVE (QUOTATIONS & MONEY RECEIPTS)
// ============================================================================

export function saveIssuedPdf(
  payload: {
    doc_type: PadType;
    doc_id: string;
    file_name: string;
    pdf_base64: string;
  },
  actor: AuthUser
): IssuedPdfSummary {
  if (payload.doc_type !== 'quotation' && payload.doc_type !== 'receipt') {
    throw new Error('Invalid document type.');
  }
  const docId = String(payload.doc_id || '').trim();
  if (!docId) throw new Error('Document ID is required.');
  const rawBase64 = String(payload.pdf_base64 || '').trim();
  if (!rawBase64) throw new Error('PDF data is missing.');
  if (rawBase64.length > 12 * 1024 * 1024) {
    throw new Error('PDF file exceeds maximum size limit.');
  }

  const sizeBytes = Math.round((rawBase64.length * 3) / 4);
  const now = getNowDhakaTimestamp();
  const pdfId = makeUid('PDF');
  const safeFileName = String(payload.file_name || `${docId}.pdf`).slice(0, 160);

  db.prepare(
    `INSERT INTO issued_pdfs (pdf_id, doc_type, doc_id, file_name, pdf_base64, size_bytes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(doc_type, doc_id) DO UPDATE SET
       file_name = excluded.file_name,
       pdf_base64 = excluded.pdf_base64,
       size_bytes = excluded.size_bytes,
       created_by = excluded.created_by,
       created_at = excluded.created_at`
  ).run(pdfId, payload.doc_type, docId, safeFileName, rawBase64, sizeBytes, actor.name, now);

  const row = db
    .prepare(
      'SELECT pdf_id, doc_type, doc_id, file_name, size_bytes, created_by, created_at FROM issued_pdfs WHERE doc_type = ? AND doc_id = ?'
    )
    .get(payload.doc_type, docId) as IssuedPdfSummary;
  return row;
}

export function listIssuedPdfSummaries(): IssuedPdfSummary[] {
  return db
    .prepare(
      'SELECT pdf_id, doc_type, doc_id, file_name, size_bytes, created_by, created_at FROM issued_pdfs ORDER BY created_at DESC'
    )
    .all() as IssuedPdfSummary[];
}

export function getIssuedPdfByDoc(docType: PadType, docId: string): IssuedPdfRecord | null {
  const row = db
    .prepare('SELECT * FROM issued_pdfs WHERE doc_type = ? AND doc_id = ?')
    .get(docType, docId) as IssuedPdfRecord | undefined;
  return row || null;
}

export function getAllIssuedPdfsForBackup(): IssuedPdfRecord[] {
  return db
    .prepare('SELECT * FROM issued_pdfs ORDER BY created_at DESC')
    .all() as IssuedPdfRecord[];
}

// ============================================================================
// REMINDER ENGINE, SETTINGS, SECONDARY BACKUP & ATOMIC RESTORE
// ============================================================================

export function getPublicSettings(): AppSettings {
  const syncSecret = getSettingRaw('google_sync_secret', '');
  const webAppUrl = getSettingRaw('google_webapp_url', '');
  const secUrl =
    process.env.SECONDARY_DRIVE_WEBAPP_URL?.trim() ||
    getSettingRaw('secondary_drive_webapp_url', '');
  const secSecret =
    process.env.SECONDARY_DRIVE_SYNC_SECRET?.trim() ||
    getSettingRaw('secondary_drive_sync_secret', '');

  const primaryDriveEmail = getSettingRaw('primary_drive_email', '');
  const syncRevision = Math.max(1, parseInt(getSettingRaw('sync_revision', '1'), 10) || 1);
  const lastSyncedRevision = parseInt(getSettingRaw('primary_drive_last_synced_revision', '0'), 10) || 0;
  const lastSyncedAt = getSettingRaw('primary_drive_last_synced_at', '');
  const primaryLastError = getSettingRaw('primary_drive_last_error', '');

  let primarySyncStatus: AppSettings['primary_drive_sync_status'] = 'not_connected';
  if (primaryDriveEmail) {
    if (primaryLastError && syncRevision > lastSyncedRevision) {
      primarySyncStatus = 'sync_failed';
    } else if (lastSyncedAt && lastSyncedRevision >= syncRevision) {
      primarySyncStatus = 'saved_to_primary_drive';
    } else {
      primarySyncStatus = 'pending_sync';
    }
  } else if (primaryLastError) {
    primarySyncStatus = 'sync_failed';
  }

  return {
    default_followup_value: parseInt(getSettingRaw('default_followup_value', '6'), 10) || 6,
    default_followup_unit:
      getSettingRaw('default_followup_unit', 'months') === 'days' ? 'days' : 'months',
    reminder_email: getSettingRaw('reminder_email', 'sunvilozltd@gmail.com'),
    owner_email: getAdminAccountEmailHint(),
    daily_reminder_hour: parseInt(getSettingRaw('daily_reminder_hour', '9'), 10) || 9,
    google_webapp_url: webAppUrl,
    google_sync_configured: Boolean(webAppUrl && syncSecret.length >= 8),
    last_google_sync_at: getSettingRaw('last_google_sync_at', ''),
    last_google_sync_status: (getSettingRaw(
      'last_google_sync_status',
      'idle'
    ) as AppSettings['last_google_sync_status']),
    last_google_sync_error: getSettingRaw('last_google_sync_error', ''),
    last_drive_backup_at: getSettingRaw('last_drive_backup_at', ''),
    reminder_trigger_status: getSettingRaw('reminder_trigger_status', 'Pending Setup'),
    reminders_paused_after_restore: getSettingRaw('reminders_paused_after_restore', '0') === '1',
    schedule_conflict_buffer_mins: Math.max(
      0,
      Math.min(360, parseInt(getSettingRaw('schedule_conflict_buffer_mins', '60'), 10) || 60)
    ),

    company_logo_data_url: getSettingRaw('company_logo_data_url', ''),
    company_logo_file_name: getSettingRaw('company_logo_file_name', ''),
    company_logo_mime_type: getSettingRaw('company_logo_mime_type', ''),
    company_logo_updated_at: getSettingRaw('company_logo_updated_at', ''),

    primary_drive_email: primaryDriveEmail,
    primary_drive_folder_label: getSettingRaw(
      'primary_drive_folder_label',
      'Private App Data Folder (appDataFolder)'
    ),
    primary_drive_file_id: getSettingRaw('primary_drive_file_id', ''),
    sync_revision: syncRevision,
    primary_drive_last_synced_revision: lastSyncedRevision,
    primary_drive_last_synced_at: lastSyncedAt,
    primary_drive_sync_status: primarySyncStatus,
    primary_drive_last_error: primaryLastError,
    primary_drive_last_checksum: getSettingRaw('primary_drive_last_checksum', ''),

    secondary_drive_email: getSettingRaw('secondary_drive_email', ''),
    secondary_drive_folder_id: getSettingRaw('secondary_drive_folder_id', ''),
    secondary_drive_folder_name: getSettingRaw(
      'secondary_drive_folder_name',
      'SUNVILOZ Clean Care Backups'
    ),
    secondary_drive_webapp_url: secUrl,
    secondary_drive_secret_configured: Boolean(secUrl && secSecret.length >= 8),
    auto_backup_enabled: getSettingRaw('auto_backup_enabled', '0') === '1',
    auto_backup_hour: parseInt(getSettingRaw('auto_backup_hour', '2'), 10) || 2,
    last_verified_backup_at: getSettingRaw('last_verified_backup_at', ''),
    last_verified_backup_file: getSettingRaw('last_verified_backup_file', ''),
    last_backup_error: getSettingRaw('last_backup_error', ''),
  };
}

export function getServerGoogleCredentials(): { webAppUrl: string; syncSecret: string } {
  return {
    webAppUrl: getSettingRaw('google_webapp_url', ''),
    syncSecret: getSettingRaw('google_sync_secret', ''),
  };
}

export function getSecondaryDriveBridgeCredentials(): { webAppUrl: string; syncSecret: string } {
  return {
    webAppUrl:
      process.env.SECONDARY_DRIVE_WEBAPP_URL?.trim() ||
      getSettingRaw('secondary_drive_webapp_url', ''),
    syncSecret:
      process.env.SECONDARY_DRIVE_SYNC_SECRET?.trim() ||
      getSettingRaw('secondary_drive_sync_secret', ''),
  };
}

export function getLastAutoBackupDate(): string {
  return getSettingRaw('last_auto_backup_date', '');
}

export function setLastAutoBackupDate(isoDate: string): void {
  setSettingRaw('last_auto_backup_date', isoDate);
}

export function verifyRemindersAfterRestore(): AppSettings {
  setSettingRaw('reminders_paused_after_restore', '0');
  setSettingRaw('reminder_trigger_status', 'Verified and Active After Restore');
  return getPublicSettings();
}

export function assertDistinctDriveAccounts(primaryEmailRaw: string, secondaryEmailRaw: string): void {
  const p = String(primaryEmailRaw || '').trim().toLowerCase();
  const s = String(secondaryEmailRaw || '').trim().toLowerCase();
  if (p && s && p === s) {
    throw new Error(
      `Primary Google Drive and Secondary Backup Drive must use two different Google accounts (${p} is already assigned to the other destination).`
    );
  }
}

export function saveSettings(payload: {
  default_followup_value?: number;
  default_followup_unit?: FollowupUnit;
  reminder_email?: string;
  daily_reminder_hour?: number;
  schedule_conflict_buffer_mins?: number;
  google_webapp_url?: string;
  google_sync_secret?: string;
  primary_drive_email?: string;
  primary_drive_file_id?: string;
  secondary_drive_email?: string;
  secondary_drive_folder_id?: string;
  secondary_drive_folder_name?: string;
  secondary_drive_webapp_url?: string;
  secondary_drive_sync_secret?: string;
  auto_backup_enabled?: boolean;
  auto_backup_hour?: number;
}): AppSettings {
  // Enforce distinct Primary vs Secondary Drive accounts BEFORE saving
  const nextPrimary =
    payload.primary_drive_email !== undefined
      ? String(payload.primary_drive_email).trim().toLowerCase()
      : getSettingRaw('primary_drive_email', '').trim().toLowerCase();
  const nextSecondary =
    payload.secondary_drive_email !== undefined
      ? String(payload.secondary_drive_email).trim().toLowerCase()
      : getSettingRaw('secondary_drive_email', '').trim().toLowerCase();
  assertDistinctDriveAccounts(nextPrimary, nextSecondary);

  if (payload.default_followup_value !== undefined) {
    const val = parseInt(String(payload.default_followup_value), 10);
    if (!Number.isInteger(val) || val < 1 || val > 3650) {
      throw new Error('Default follow-up value must be between 1 and 3650.');
    }
    setSettingRaw('default_followup_value', String(val));
  }
  if (payload.default_followup_unit !== undefined) {
    setSettingRaw(
      'default_followup_unit',
      payload.default_followup_unit === 'days' ? 'days' : 'months'
    );
  }
  if (payload.reminder_email !== undefined) {
    const email = String(payload.reminder_email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Please enter a valid reminder email address.');
    }
    setSettingRaw('reminder_email', email);
  }
  if (payload.daily_reminder_hour !== undefined) {
    const h = Math.min(23, Math.max(0, parseInt(String(payload.daily_reminder_hour), 10) || 9));
    setSettingRaw('daily_reminder_hour', String(h));
  }
  if (payload.schedule_conflict_buffer_mins !== undefined) {
    const mins = parseInt(String(payload.schedule_conflict_buffer_mins), 10);
    if (!Number.isInteger(mins) || mins < 0 || mins > 360) {
      throw new Error('Schedule conflict buffer must be between 0 and 360 minutes.');
    }
    setSettingRaw('schedule_conflict_buffer_mins', String(mins));
  }
  if (payload.google_webapp_url !== undefined) {
    setSettingRaw('google_webapp_url', String(payload.google_webapp_url).trim());
  }
  if (payload.google_sync_secret !== undefined && payload.google_sync_secret.trim().length > 0) {
    setSettingRaw('google_sync_secret', payload.google_sync_secret.trim());
  }
  if (payload.primary_drive_email !== undefined) {
    setSettingRaw('primary_drive_email', nextPrimary);
  }
  if (payload.primary_drive_file_id !== undefined) {
    setSettingRaw('primary_drive_file_id', String(payload.primary_drive_file_id).trim());
  }
  if (payload.secondary_drive_email !== undefined) {
    setSettingRaw('secondary_drive_email', nextSecondary);
  }
  if (payload.secondary_drive_folder_id !== undefined) {
    setSettingRaw('secondary_drive_folder_id', String(payload.secondary_drive_folder_id).trim());
  }
  if (payload.secondary_drive_folder_name !== undefined) {
    setSettingRaw(
      'secondary_drive_folder_name',
      String(payload.secondary_drive_folder_name).trim() || 'SUNVILOZ Clean Care Backups'
    );
  }
  if (payload.secondary_drive_webapp_url !== undefined) {
    setSettingRaw('secondary_drive_webapp_url', String(payload.secondary_drive_webapp_url).trim());
  }
  if (
    payload.secondary_drive_sync_secret !== undefined &&
    payload.secondary_drive_sync_secret.trim().length > 0
  ) {
    setSettingRaw('secondary_drive_sync_secret', payload.secondary_drive_sync_secret.trim());
  }
  if (payload.auto_backup_enabled !== undefined) {
    setSettingRaw('auto_backup_enabled', payload.auto_backup_enabled ? '1' : '0');
  }
  if (payload.auto_backup_hour !== undefined) {
    const h = Math.min(23, Math.max(0, parseInt(String(payload.auto_backup_hour), 10) || 2));
    setSettingRaw('auto_backup_hour', String(h));
  }

  return getPublicSettings();
}

// ============================================================================
// PRIMARY GOOGLE DRIVE VERSIONED SYNC HELPERS
// ============================================================================

export function markBusinessDataMutated(): number {
  const nextRev = bumpSyncRevision(db);
  setSettingRaw('primary_drive_last_error', '');
  return nextRev;
}

export function getCurrentSyncRevision(): number {
  return Math.max(1, parseInt(getSettingRaw('sync_revision', '1'), 10) || 1);
}

export function connectPrimaryDriveAccount(payload: {
  email: string;
  file_id?: string;
}): AppSettings {
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('A verified Google account email is required to connect Primary Drive.');
  }
  const existingSecondary = getSettingRaw('secondary_drive_email', '').trim().toLowerCase();
  assertDistinctDriveAccounts(email, existingSecondary);

  const prevPrimary = getSettingRaw('primary_drive_email', '').trim().toLowerCase();
  setSettingRaw('primary_drive_email', email);
  setSettingRaw('primary_drive_folder_label', 'Private App Data Folder (appDataFolder)');
  if (payload.file_id) {
    setSettingRaw('primary_drive_file_id', String(payload.file_id).trim());
  } else if (prevPrimary && prevPrimary !== email) {
    setSettingRaw('primary_drive_file_id', '');
    setSettingRaw('primary_drive_last_synced_revision', '0');
    setSettingRaw('primary_drive_last_synced_at', '');
  }
  setSettingRaw('primary_drive_last_error', '');
  return getPublicSettings();
}

export function disconnectPrimaryDriveAccount(): AppSettings {
  setSettingRaw('primary_drive_email', '');
  setSettingRaw('primary_drive_file_id', '');
  setSettingRaw('primary_drive_last_error', '');
  return getPublicSettings();
}

export function buildPrimaryDriveSnapshot() {
  const settings = getPublicSettings();
  const backup = buildFullBackupJson();
  return {
    ...backup,
    sync_revision: settings.sync_revision,
    base_synced_revision: settings.primary_drive_last_synced_revision,
    primary_drive_email: settings.primary_drive_email,
  };
}

export function confirmPrimaryDriveWrite(payload: {
  revision: number;
  file_id: string;
  checksum_sha256: string;
  email?: string;
}): AppSettings {
  const rev = Math.max(1, Number(payload.revision || 0));
  const fileId = String(payload.file_id || '').trim();
  const checksum = String(payload.checksum_sha256 || '').trim();
  if (!fileId) {
    throw new Error('Google Drive file confirmation ID is required before marking sync saved.');
  }
  if (payload.email) {
    const email = String(payload.email).trim().toLowerCase();
    const existingSecondary = getSettingRaw('secondary_drive_email', '').trim().toLowerCase();
    assertDistinctDriveAccounts(email, existingSecondary);
    setSettingRaw('primary_drive_email', email);
  }
  const now = getNowDhakaTimestamp();
  const prevSynced = parseInt(getSettingRaw('primary_drive_last_synced_revision', '0'), 10) || 0;
  setSettingRaw('primary_drive_file_id', fileId);
  setSettingRaw('primary_drive_last_synced_revision', String(Math.max(prevSynced, rev)));
  setSettingRaw('primary_drive_last_synced_at', now);
  setSettingRaw('primary_drive_last_checksum', checksum);
  setSettingRaw('primary_drive_last_error', '');
  return getPublicSettings();
}

export function reportPrimaryDriveSyncError(errorMessage: string): AppSettings {
  setSettingRaw(
    'primary_drive_last_error',
    String(errorMessage || 'Primary Drive sync failed.').slice(0, 400)
  );
  return getPublicSettings();
}

export function restoreFromPrimaryDriveTx(
  snapshot: Record<string, unknown>,
  actor: AuthUser,
  meta?: { file_id?: string; email?: string }
) {
  const restored = restoreBackupTx(snapshot, actor);
  const remoteRev = Math.max(1, Number(snapshot.sync_revision || 1));
  const now = getNowDhakaTimestamp();
  setSettingRaw('sync_revision', String(remoteRev));
  setSettingRaw('primary_drive_last_synced_revision', String(remoteRev));
  setSettingRaw('primary_drive_last_synced_at', now);
  setSettingRaw('primary_drive_last_checksum', String(snapshot.integrity_sha256 || ''));
  setSettingRaw('primary_drive_last_error', '');
  if (meta?.file_id) {
    setSettingRaw('primary_drive_file_id', String(meta.file_id).trim());
  }
  if (meta?.email) {
    const email = String(meta.email).trim().toLowerCase();
    const existingSecondary = getSettingRaw('secondary_drive_email', '').trim().toLowerCase();
    assertDistinctDriveAccounts(email, existingSecondary);
    setSettingRaw('primary_drive_email', email);
  }
  return restored;
}

export function listReminderLogs(limit = 50): ReminderLogRecord[] {
  return db
    .prepare('SELECT * FROM reminder_logs ORDER BY sent_at DESC LIMIT ?')
    .all(limit) as ReminderLogRecord[];
}

export function recordReminderLog(log: Omit<ReminderLogRecord, 'log_id'>): ReminderLogRecord {
  const id = makeUid('LOG');
  db.prepare(
    `INSERT INTO reminder_logs (
      log_id, dedupe_key, order_id, customer_name, phone_display, services_text,
      completion_date, followup_date, recipient_email, send_type, status, error_message, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    log.dedupe_key,
    log.order_id,
    log.customer_name,
    log.phone_display,
    log.services_text,
    log.completion_date,
    log.followup_date,
    log.recipient_email,
    log.send_type,
    log.status,
    log.error_message,
    log.sent_at
  );
  return db.prepare('SELECT * FROM reminder_logs WHERE log_id = ?').get(id) as ReminderLogRecord;
}

export const runLocalReminderDedupeCheckTx = db.transaction((): {
  pausedAfterRestore: boolean;
  sentCount: number;
  skippedCount: number;
  orderSentCount: number;
  leadSentCount: number;
  eligibleOrders: OrderRecord[];
  eligibleLeads: LeadRecord[];
} => {
  if (getSettingRaw('reminders_paused_after_restore', '0') === '1') {
    return {
      pausedAfterRestore: true,
      sentCount: 0,
      skippedCount: 0,
      orderSentCount: 0,
      leadSentCount: 0,
      eligibleOrders: [],
      eligibleLeads: [],
    };
  }

  const today = getTodayDhakaIso();
  const now = getNowDhakaTimestamp();
  const recipient = getSettingRaw('reminder_email', 'sunvilozltd@gmail.com');

  const sentRows = db
    .prepare("SELECT dedupe_key FROM reminder_logs WHERE status = 'SENT'")
    .all() as Array<{ dedupe_key: string }>;
  const sentKeys = new Set(sentRows.map((r) => r.dedupe_key));

  const orders = getAllOrders();
  let orderSentCount = 0;
  let leadSentCount = 0;
  let skippedCount = 0;
  const eligibleOrders: OrderRecord[] = [];
  const eligibleLeads: LeadRecord[] = [];

  // 1) Completed Orders (6-month or custom default follow-up; excludes No-Charge Return Visits)
  for (const o of orders) {
    if (o.status !== 'Completed') continue;
    if (o.is_no_charge_visit) continue;
    if (o.followup_done) continue;
    if (!isValidIsoDate(o.followup_date)) continue;
    if (o.followup_date > today) continue;

    const version = o.followup_version || 1;
    const dedupeKey = `${o.order_id}|${o.followup_date}|v${version}`;

    if (
      sentKeys.has(dedupeKey) ||
      (o.reminder_sent &&
        o.reminder_sent_for_date === o.followup_date &&
        o.reminder_sent_version === version)
    ) {
      skippedCount++;
      continue;
    }

    sentKeys.add(dedupeKey);
    orderSentCount++;
    eligibleOrders.push(o);

    recordReminderLog({
      dedupe_key: dedupeKey,
      order_id: o.order_id,
      customer_name: o.customer_name,
      phone_display: o.phone_display,
      services_text: o.services_text,
      completion_date: o.completion_date,
      followup_date: o.followup_date,
      recipient_email: recipient,
      send_type: 'AUTO_DAILY',
      status: 'SENT',
      error_message: '',
      sent_at: now,
    });

    db.prepare(
      `UPDATE orders SET
        reminder_sent = 1,
        reminder_sent_at = ?,
        reminder_sent_for_date = ?,
        reminder_sent_version = ?,
        updated_at = ?
       WHERE order_id = ?`
    ).run(now, o.followup_date, version, now, o.order_id);
  }

  // 2) Prospective Customers (Leads with custom manual follow-up dates)
  const leads = listLeads();
  for (const l of leads) {
    if (l.stage === 'Not Interested') continue;
    if (l.followup_done) continue;
    if (!isValidIsoDate(l.next_followup_date)) continue;
    if (l.next_followup_date > today) continue;

    const version = l.followup_version || 1;
    const dedupeKey = `LEAD|${l.lead_id}|${l.next_followup_date}|v${version}`;

    if (
      sentKeys.has(dedupeKey) ||
      (l.reminder_sent &&
        l.reminder_sent_for_date === l.next_followup_date &&
        l.reminder_sent_version === version)
    ) {
      skippedCount++;
      continue;
    }

    sentKeys.add(dedupeKey);
    leadSentCount++;
    eligibleLeads.push(l);

    recordReminderLog({
      dedupe_key: dedupeKey,
      order_id: l.lead_id,
      customer_name: `${l.name} (Prospect)`,
      phone_display: l.phone_display,
      services_text: l.interested_services_text || l.building_org || 'Prospect Follow-Up',
      completion_date: '',
      followup_date: l.next_followup_date,
      recipient_email: recipient,
      send_type: 'LEAD_FOLLOWUP',
      status: 'SENT',
      error_message: '',
      sent_at: now,
    });

    db.prepare(
      `UPDATE leads SET
        reminder_sent = 1,
        reminder_sent_at = ?,
        reminder_sent_for_date = ?,
        reminder_sent_version = ?,
        updated_at = ?
       WHERE lead_id = ?`
    ).run(now, l.next_followup_date, version, now, l.lead_id);
  }

  return {
    pausedAfterRestore: false,
    sentCount: orderSentCount + leadSentCount,
    skippedCount,
    orderSentCount,
    leadSentCount,
    eligibleOrders,
    eligibleLeads,
  };
});

// ============================================================================
// BACKUP HISTORY, VERIFIED V3 PACKAGE, CHECKSUM VALIDATION & ATOMIC RESTORE
// ============================================================================

export function listBackupHistory(limit = 30): BackupHistoryRecord[] {
  return db
    .prepare('SELECT * FROM backup_history ORDER BY created_at DESC LIMIT ?')
    .all(limit) as BackupHistoryRecord[];
}

export function recordBackupHistory(entry: {
  source: BackupHistoryRecord['source'];
  status: BackupHistoryRecord['status'];
  file_name: string;
  drive_file_id?: string;
  drive_account_email?: string;
  folder_name?: string;
  size_bytes?: number;
  checksum_sha256?: string;
  error_message?: string;
  created_by: string;
}): BackupHistoryRecord {
  const id = makeUid('BKP');
  const now = getNowDhakaTimestamp();
  const safeStatus = entry.status === 'verified' ? 'verified' : 'failed';

  db.prepare(
    `INSERT INTO backup_history (
      backup_id, source, status, file_name, drive_file_id, drive_account_email,
      folder_name, size_bytes, checksum_sha256, error_message, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    entry.source,
    safeStatus,
    String(entry.file_name || 'backup.json').slice(0, 180),
    String(entry.drive_file_id || ''),
    String(entry.drive_account_email || ''),
    String(entry.folder_name || ''),
    Number(entry.size_bytes || 0),
    String(entry.checksum_sha256 || ''),
    String(entry.error_message || ''),
    String(entry.created_by || 'System'),
    now
  );

  // Critical invariant: A failed or interrupted backup NEVER replaces last verified backup!
  if (safeStatus === 'verified' && entry.source !== 'pre_restore_recovery') {
    setSettingRaw('last_verified_backup_at', now);
    setSettingRaw('last_verified_backup_file', String(entry.file_name || ''));
    setSettingRaw('last_backup_error', '');
  } else if (safeStatus === 'failed') {
    setSettingRaw('last_backup_error', String(entry.error_message || 'Backup failed.'));
  }

  return db
    .prepare('SELECT * FROM backup_history WHERE backup_id = ?')
    .get(id) as BackupHistoryRecord;
}

export function getAdminBootstrapPayload(): AdminBootstrapPayload {
  const history = db
    .prepare('SELECT * FROM status_history ORDER BY changed_at DESC LIMIT 500')
    .all() as StatusHistoryRecord[];

  return {
    todayDhaka: getTodayDhakaIso(),
    customers: listCustomers(db),
    buildings: listBuildings(db),
    orders: getAllOrders(),
    quotations: getAllQuotations(),
    receipts: getAllReceipts(),
    leads: listLeads(),
    leadNotes: listAllLeadNotes(),
    supervisors: listSupervisors(),
    workers: listWorkers(db),
    workerPaymentHistory: listWorkerPaymentHistory(db),
    settlementEntries: listAllSettlementEntries(db),
    complaints: listAllComplaints(db),
    overhead: listOverheadExpenses(),
    history,
    reminderLogs: listReminderLogs(80),
    issuedPdfs: listIssuedPdfSummaries(),
    backupHistory: listBackupHistory(30),
    pads: {
      quotation: getPad('quotation'),
      receipt: getPad('receipt'),
    },
    settings: getPublicSettings(),
  };
}

function computeBackupChecksum(payloadWithoutChecksum: Record<string, unknown>): string {
  const clone = { ...payloadWithoutChecksum };
  delete clone.integrity_sha256;
  const serialized = JSON.stringify(clone);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Full private backup JSON v4:
 * Includes customers, building/tank profiles, orders, workers, worker payments & history,
 * settlement verification entries, complaints & return visits, quotations, money receipts,
 * prospects & notes, supervisor identities (NO password hashes!), overhead expenses,
 * status history, reminder logs, document pads, issued PDFs, company logo, and non-secret settings.
 * STRICTLY excludes passwords, password hashes, token_version, OAuth tokens, and sync secrets.
 */
export function buildFullBackupJson() {
  const pubSettings = getPublicSettings();
  const safeSettings = {
    default_followup_value: pubSettings.default_followup_value,
    default_followup_unit: pubSettings.default_followup_unit,
    reminder_email: pubSettings.reminder_email,
    owner_email: pubSettings.owner_email,
    daily_reminder_hour: pubSettings.daily_reminder_hour,
    schedule_conflict_buffer_mins: pubSettings.schedule_conflict_buffer_mins,
    auto_backup_enabled: pubSettings.auto_backup_enabled,
    auto_backup_hour: pubSettings.auto_backup_hour,
    secondary_drive_folder_name: pubSettings.secondary_drive_folder_name,
  };

  const extendedTables = getExtendedBackupTables(db);

  const basePayload: Record<string, unknown> = {
    schema_version: 4,
    app_name: 'SUNVILOZ Clean Care',
    exported_at: getNowDhakaTimestamp(),
    timezone: 'Asia/Dhaka',
    ...extendedTables,
    orders: getAllOrders(),
    quotations: getAllQuotations(),
    receipts: getAllReceipts(),
    leads: listLeads(),
    leadNotes: listAllLeadNotes(),
    supervisors: listSupervisors(), // Safe: id, name, username, phone_display, is_active ONLY (no password_hash!)
    overhead: listOverheadExpenses(),
    history: db.prepare('SELECT * FROM status_history ORDER BY changed_at DESC').all(),
    reminderLogs: listReminderLogs(1000),
    pads: {
      quotation: getPad('quotation'),
      receipt: getPad('receipt'),
    },
    issuedPdfs: getAllIssuedPdfsForBackup(),
    branding: {
      company_logo_data_url: pubSettings.company_logo_data_url,
      company_logo_file_name: pubSettings.company_logo_file_name,
      company_logo_mime_type: pubSettings.company_logo_mime_type,
      company_logo_updated_at: pubSettings.company_logo_updated_at,
    },
    settings: safeSettings,
    supervisor_relink_guide:
      'On a fresh installation, supervisor names, IDs, and order assignments restore automatically, while passwords are excluded from backups for security. After restore, open the Supervisors screen to set a new password for each supervisor.',
  };

  const integrity_sha256 = computeBackupChecksum(basePayload);
  return {
    ...basePayload,
    integrity_sha256,
  };
}

export function validateBackupPackage(raw: unknown): BackupValidationSummary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Backup file is not valid JSON.');
  }

  const backup = raw as Record<string, unknown>;
  const version = Number(backup.schema_version || 0);
  if (version !== 2 && version !== 3 && version !== 4) {
    throw new Error(
      `Unsupported backup schema version (${version || 'unknown'}). Only SUNVILOZ versions 2, 3, or 4 are supported.`
    );
  }

  const exportedAt = String(backup.exported_at || '').trim();
  if (!exportedAt) {
    throw new Error('Backup file is missing export timestamp (exported_at).');
  }

  if (!Array.isArray(backup.orders)) {
    throw new Error('Backup file does not contain a valid orders array.');
  }

  // Verify SHA-256 checksum if present (required for v3+)
  let checksumVerified = false;
  const warnings: string[] = [];
  const providedChecksum = String(backup.integrity_sha256 || '').trim();
  if (version >= 3) {
    if (!providedChecksum) {
      throw new Error(`Backup schema v${version} is missing its integrity checksum.`);
    }
    const expected = computeBackupChecksum(backup);
    if (expected !== providedChecksum) {
      throw new Error(
        'Backup file failed integrity verification (checksum mismatch). Restore aborted for safety.'
      );
    }
    checksumVerified = true;
  } else if (providedChecksum) {
    const expected = computeBackupChecksum(backup);
    if (expected !== providedChecksum) {
      throw new Error('Backup file checksum mismatch.');
    }
    checksumVerified = true;
  } else {
    warnings.push(
      'This is an older schema v2 backup — it may not include prospects, building profiles, workers, logo, or issued PDFs.'
    );
  }

  const padsObj = (backup.pads && typeof backup.pads === 'object' ? backup.pads : {}) as Record<
    string,
    unknown
  >;
  const padCount = (padsObj.quotation ? 1 : 0) + (padsObj.receipt ? 1 : 0);
  const brandingObj = (backup.branding && typeof backup.branding === 'object'
    ? backup.branding
    : {}) as Record<string, unknown>;
  const hasLogo = Boolean(
    brandingObj.company_logo_data_url &&
      String(brandingObj.company_logo_data_url).startsWith('data:image/')
  );

  const supervisorsCount = Array.isArray(backup.supervisors) ? backup.supervisors.length : 0;
  if (supervisorsCount > 0) {
    warnings.push(
      'Passwords are excluded from backups for security — on a fresh install, reset supervisor passwords after restore.'
    );
  }
  warnings.push(
    'Gmail follow-up reminders will be paused automatically after restore until the admin verifies Gmail settings.'
  );

  return {
    valid: true,
    schema_version: version,
    exported_at: exportedAt,
    timezone: String(backup.timezone || 'Asia/Dhaka'),
    checksum_verified: checksumVerified,
    counts: {
      customers: Array.isArray(backup.customers) ? backup.customers.length : 0,
      buildings: Array.isArray(backup.buildings) ? backup.buildings.length : 0,
      orders: Array.isArray(backup.orders) ? backup.orders.length : 0,
      quotations: Array.isArray(backup.quotations) ? backup.quotations.length : 0,
      receipts: Array.isArray(backup.receipts) ? backup.receipts.length : 0,
      leads: Array.isArray(backup.leads) ? backup.leads.length : 0,
      lead_notes: Array.isArray(backup.leadNotes) ? backup.leadNotes.length : 0,
      supervisors: supervisorsCount,
      workers: Array.isArray(backup.workers) ? backup.workers.length : 0,
      order_workers: Array.isArray(backup.orderWorkers) ? backup.orderWorkers.length : 0,
      worker_payment_history: Array.isArray(backup.workerPaymentHistory)
        ? backup.workerPaymentHistory.length
        : 0,
      settlement_entries: Array.isArray(backup.settlementEntries) ? backup.settlementEntries.length : 0,
      complaints: Array.isArray(backup.complaints) ? backup.complaints.length : 0,
      overhead: Array.isArray(backup.overhead) ? backup.overhead.length : 0,
      history: Array.isArray(backup.history) ? backup.history.length : 0,
      reminder_logs: Array.isArray(backup.reminderLogs) ? backup.reminderLogs.length : 0,
      pads: padCount,
      issued_pdfs: Array.isArray(backup.issuedPdfs) ? backup.issuedPdfs.length : 0,
      has_company_logo: hasLogo,
    },
    warnings,
  };
}

export function hasExistingBusinessData(): boolean {
  const counts = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM orders) +
        (SELECT COUNT(*) FROM quotations) +
        (SELECT COUNT(*) FROM receipts) +
        (SELECT COUNT(*) FROM leads) AS total`
    )
    .get() as { total: number };
  return (counts?.total || 0) > 0;
}

export function saveLocalBackupSnapshot(
  subDir: 'backups' | 'recovery',
  fileName: string,
  backupObj: Record<string, unknown>
): { filePath: string; sizeBytes: number; checksum: string } {
  const safeBase = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const targetDir = path.resolve(DATA_DIR, subDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const resolved = path.resolve(targetDir, safeBase);
  if (!resolved.startsWith(targetDir + path.sep)) {
    throw new Error('Invalid file path.');
  }
  const content = JSON.stringify(backupObj, null, 2);
  fs.writeFileSync(resolved, content, 'utf8');
  return {
    filePath: resolved,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    checksum: String(backupObj.integrity_sha256 || ''),
  };
}

/**
 * Safely migrates legacy Turn-1 localStorage records without overwriting existing SQLite rows.
 */
export const migrateLegacyLocalStorageTx = db.transaction(
  (
    legacy: {
      orders?: Array<Record<string, unknown>>;
      history?: Array<Record<string, unknown>>;
      reminderLogs?: Array<Record<string, unknown>>;
      settings?: Record<string, unknown>;
    },
    actor: AuthUser
  ): { importedOrders: number } => {
    let importedOrders = 0;
    const now = getNowDhakaTimestamp();

    if (Array.isArray(legacy.orders)) {
      for (const o of legacy.orders) {
        const orderId = String(o.order_id || '').trim();
        if (!orderId) continue;
        const exists = db.prepare('SELECT 1 FROM orders WHERE order_id = ?').get(orderId);
        if (exists) continue;

        const services = Array.isArray(o.services)
          ? o.services.map(String)
          : String(o.services_text || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
        const priceBdt = Number(o.price_bdt || 0);
        const normalizedStatus = normalizeOrderStatus(String(o.status || 'New'));
        const isCompleted = normalizedStatus === 'Completed';

        db.prepare(
          `INSERT INTO orders (
            order_id, quotation_id, receipt_id, previous_order_id, lead_id,
            customer_name, phone_display, phone_e164, address, area,
            services_json, services_text, booking_date, scheduled_date, scheduled_time,
            price_bdt, instructions, notes,
            assigned_supervisor_id, assigned_supervisor_name, status,
            advance_given, completion_date, completed_at, completed_by_name,
            full_bill_collected, payment_collected_at, collected_by_name,
            actual_expenses, supervisor_settlement, job_profit_or_loss, settlement_status,
            followup_date, followup_rule_note, followup_version,
            reminder_sent, reminder_sent_at, reminder_sent_for_date, reminder_sent_version,
            followup_done, followup_done_at, created_at, updated_at
          ) VALUES (?, '', '', ?, '', ?, ?, ?, ?, '', ?, ?, '', ?, '10:00', ?, '', ?, '', '', ?, 0, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          orderId,
          String(o.previous_order_id || ''),
          String(o.customer_name || ''),
          String(o.phone_display || ''),
          String(o.phone_e164 || ''),
          String(o.address || ''),
          JSON.stringify(services),
          services.join(', '),
          String(o.scheduled_date || getTodayDhakaIso()),
          priceBdt,
          String(o.notes || ''),
          normalizedStatus,
          String(o.completion_date || ''),
          isCompleted ? String(o.updated_at || now) : '',
          isCompleted ? actor.name : '',
          isCompleted ? 1 : 0,
          isCompleted ? String(o.updated_at || now) : '',
          isCompleted ? actor.name : '',
          isCompleted ? priceBdt : 0,
          isCompleted ? priceBdt : 0,
          isCompleted ? 'Pending' : 'Not Applicable',
          String(o.followup_date || ''),
          String(o.followup_rule_note || ''),
          Number(o.followup_version || 0),
          o.reminder_sent ? 1 : 0,
          String(o.reminder_sent_at || ''),
          String(o.reminder_sent_for_date || ''),
          Number(o.reminder_sent_version || 0),
          o.followup_done ? 1 : 0,
          String(o.followup_done_at || ''),
          String(o.created_at || now),
          String(o.updated_at || now)
        );
        importedOrders++;
      }
    }

    if (Array.isArray(legacy.history)) {
      for (const h of legacy.history) {
        const hid = String(h.history_id || makeUid('HIS'));
        db.prepare(
          `INSERT OR IGNORE INTO status_history (history_id, order_id, previous_status, new_status, note, changed_by, changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          hid,
          String(h.order_id || ''),
          String(h.previous_status || ''),
          String(h.new_status || ''),
          String(h.note || ''),
          String(h.changed_by || actor.name),
          String(h.changed_at || now)
        );
      }
    }

    if (Array.isArray(legacy.reminderLogs)) {
      for (const l of legacy.reminderLogs) {
        const lid = String(l.log_id || makeUid('LOG'));
        db.prepare(
          `INSERT OR IGNORE INTO reminder_logs (
            log_id, dedupe_key, order_id, customer_name, phone_display, services_text,
            completion_date, followup_date, recipient_email, send_type, status, error_message, sent_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          lid,
          String(l.dedupe_key || ''),
          String(l.order_id || ''),
          String(l.customer_name || ''),
          String(l.phone_display || ''),
          String(l.services_text || ''),
          String(l.completion_date || ''),
          String(l.followup_date || ''),
          String(l.recipient_email || ''),
          String(l.send_type || 'AUTO_DAILY'),
          String(l.status || 'SENT'),
          String(l.error_message || ''),
          String(l.sent_at || now)
        );
      }
    }

    return { importedOrders };
  }
);

const restoreBackupAtomicInnerTx = db.transaction(
  (
    backup: Record<string, unknown>,
    actor: AuthUser
  ): {
    restoredOrders: number;
    restoredQuotations: number;
    restoredReceipts: number;
    restoredLeads: number;
    restoredLeadNotes: number;
    restoredSupervisors: number;
    restoredOverhead: number;
    restoredPads: number;
    restoredIssuedPdfs: number;
    restoredLogo: boolean;
  } => {
    let restoredOrders = 0;
    let restoredQuotations = 0;
    let restoredReceipts = 0;
    let restoredLeads = 0;
    let restoredLeadNotes = 0;
    let restoredSupervisors = 0;
    let restoredOverhead = 0;
    let restoredPads = 0;
    let restoredIssuedPdfs = 0;
    let restoredLogo = false;
    const now = getNowDhakaTimestamp();

    // 1) Supervisors (safe identities only; preserve existing password_hash if already present,
    //    or insert locked placeholder requiring admin password reset on fresh install)
    if (Array.isArray(backup.supervisors)) {
      for (const raw of backup.supervisors as Array<Record<string, unknown>>) {
        const id = String(raw.id || '').trim();
        const username = String(raw.username || '').trim().toLowerCase();
        if (!id || !username) continue;
        const existingById = db
          .prepare("SELECT id, password_hash FROM users WHERE id = ? AND role = 'supervisor'")
          .get(id) as { id: string; password_hash: string } | undefined;
        if (existingById) {
          db.prepare(
            `UPDATE users SET name = ?, phone_display = ?, is_active = ?, updated_at = ?
             WHERE id = ? AND role = 'supervisor'`
          ).run(
            String(raw.name || ''),
            String(raw.phone_display || ''),
            raw.is_active === false ? 0 : 1,
            String(raw.updated_at || now),
            id
          );
          restoredSupervisors++;
        } else {
          // Ensure username doesn't collide with admin or another user
          const usernameTaken = db
            .prepare('SELECT id FROM users WHERE lower(username) = ?')
            .get(username) as { id: string } | undefined;
          const safeUsername = usernameTaken ? `${username}_${id.slice(-4).toLowerCase()}` : username;
          db.prepare(
            `INSERT INTO users (id, role, name, username, phone_display, password_hash, is_active, created_at, updated_at)
             VALUES (?, 'supervisor', ?, ?, ?, 'LOCKED_REQUIRES_ADMIN_PASSWORD_RESET', ?, ?, ?)`
          ).run(
            id,
            String(raw.name || ''),
            safeUsername,
            String(raw.phone_display || ''),
            raw.is_active === false ? 0 : 1,
            String(raw.created_at || now),
            String(raw.updated_at || now)
          );
          restoredSupervisors++;
        }
      }
    }

    // 2) Orders (idempotent INSERT OR REPLACE by order_id — never duplicates on retry)
    if (Array.isArray(backup.orders)) {
      for (const raw of backup.orders as Array<Record<string, unknown>>) {
        const id = String(raw.order_id || '').trim();
        if (!id) continue;
        const services = Array.isArray(raw.services) ? raw.services.map(String) : [];
        const otherExp = Array.isArray(raw.other_expenses) ? raw.other_expenses : [];
        const normStatus = normalizeOrderStatus(String(raw.status || 'New'));
        const normSettlement = normalizeSettlementStatus(String(raw.settlement_status || 'Not Applicable'));
        const durationMins = Number(raw.estimated_duration_mins || 120) || 120;
        const schedTime = String(raw.scheduled_time || '10:00');
        const endTime = String(raw.scheduled_end_time || computeEndTime24(schedTime, durationMins));
        db.prepare(
          `INSERT OR REPLACE INTO orders (
            order_id, quotation_id, receipt_id, previous_order_id, lead_id,
            customer_id, building_id, building_name,
            customer_name, phone_display, phone_e164, address, area,
            services_json, services_text, booking_date, scheduled_date, scheduled_time,
            estimated_duration_mins, scheduled_end_time,
            price_bdt, instructions, notes,
            lead_source, referral_contact_type, referral_contact_name, referral_contact_phone,
            assigned_supervisor_id, assigned_supervisor_name, status,
            parent_order_id, is_return_visit, is_no_charge_visit, complaint_id,
            previous_work_date, followup_converted_order_id,
            advance_given, advance_supervisor_id, advance_supervisor_name, advance_given_at,
            completion_date, completed_at, completed_by_user_id, completed_by_name,
            full_bill_collected, status_locked, status_locked_at, payment_collected_at, collected_by_name,
            transport_cost, meals_cost, other_expenses_json, other_expenses_total,
            worker_pay_total, supervisor_paid_worker_total, return_visit_expenses_total,
            actual_expenses, supervisor_settlement, settlement_actual_total, settlement_remaining,
            job_profit_or_loss,
            settlement_status, settlement_confirmed_at, settlement_confirmed_by, settlement_note,
            followup_date, followup_rule_note, followup_version,
            reminder_sent, reminder_sent_at, reminder_sent_for_date, reminder_sent_version,
            followup_done, followup_done_at, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?
          )`
        ).run(
          id,
          String(raw.quotation_id || ''),
          String(raw.receipt_id || ''),
          String(raw.previous_order_id || ''),
          String(raw.lead_id || ''),
          String(raw.customer_id || ''),
          String(raw.building_id || ''),
          String(raw.building_name || ''),
          String(raw.customer_name || ''),
          String(raw.phone_display || ''),
          String(raw.phone_e164 || ''),
          String(raw.address || ''),
          String(raw.area || ''),
          JSON.stringify(services),
          String(raw.services_text || services.join(', ')),
          String(raw.booking_date || ''),
          String(raw.scheduled_date || ''),
          schedTime,
          durationMins,
          endTime,
          Number(raw.price_bdt || 0),
          String(raw.instructions || ''),
          String(raw.notes || ''),
          normalizeLeadSource(String(raw.lead_source || '')),
          String(raw.referral_contact_type || ''),
          String(raw.referral_contact_name || ''),
          String(raw.referral_contact_phone || ''),
          String(raw.assigned_supervisor_id || ''),
          String(raw.assigned_supervisor_name || ''),
          normStatus,
          String(raw.parent_order_id || ''),
          raw.is_return_visit ? 1 : 0,
          raw.is_no_charge_visit ? 1 : 0,
          String(raw.complaint_id || ''),
          String(raw.previous_work_date || ''),
          String(raw.followup_converted_order_id || ''),
          Number(raw.advance_given || 0),
          String(raw.advance_supervisor_id || ''),
          String(raw.advance_supervisor_name || ''),
          String(raw.advance_given_at || ''),
          String(raw.completion_date || ''),
          String(raw.completed_at || ''),
          String(raw.completed_by_user_id || ''),
          String(raw.completed_by_name || ''),
          raw.full_bill_collected ? 1 : 0,
          normStatus === 'Completed' && Boolean(raw.full_bill_collected) ? 1 : 0,
          normStatus === 'Completed' && Boolean(raw.full_bill_collected)
            ? String(raw.status_locked_at || raw.payment_collected_at || raw.completed_at || now)
            : '',
          String(raw.payment_collected_at || ''),
          String(raw.collected_by_name || ''),
          Number(raw.transport_cost || 0),
          Number(raw.meals_cost || 0),
          JSON.stringify(otherExp),
          Number(raw.other_expenses_total || 0),
          Number(raw.worker_pay_total || 0),
          Number(raw.supervisor_paid_worker_total || 0),
          Number(raw.return_visit_expenses_total || 0),
          Number(raw.actual_expenses || 0),
          Number(raw.supervisor_settlement || 0),
          Number(raw.settlement_actual_total || 0),
          Number(raw.settlement_remaining ?? (normStatus === 'Completed' ? Number(raw.supervisor_settlement || 0) : 0)),
          Number(raw.job_profit_or_loss || 0),
          normSettlement,
          String(raw.settlement_confirmed_at || ''),
          String(raw.settlement_confirmed_by || ''),
          String(raw.settlement_note || ''),
          String(raw.followup_date || ''),
          String(raw.followup_rule_note || ''),
          Number(raw.followup_version || 0),
          raw.reminder_sent ? 1 : 0,
          String(raw.reminder_sent_at || ''),
          String(raw.reminder_sent_for_date || ''),
          Number(raw.reminder_sent_version || 0),
          raw.followup_done ? 1 : 0,
          String(raw.followup_done_at || ''),
          String(raw.created_at || now),
          String(raw.updated_at || now)
        );
        restoredOrders++;
      }
    }

    // 3) Quotations
    if (Array.isArray(backup.quotations)) {
      for (const raw of backup.quotations as Array<Record<string, unknown>>) {
        const id = String(raw.quotation_id || '').trim();
        if (!id) continue;
        db.prepare(
          `INSERT OR REPLACE INTO quotations (
            quotation_id, lead_id, customer_id, building_id, quotation_date, valid_until, customer_name, phone_display, phone_e164,
            address, area, items_json, subtotal_bdt,
            discount_enabled, discount_type, discount_value, discount_bdt,
            vat_enabled, vat_type, vat_value, vat_base, vat_bdt,
            tax_enabled, tax_type, tax_value, tax_base, tax_bdt,
            total_bdt,
            terms, notes, status, status_changed_at, status_history_json,
            followup_date, followup_note, followup_done, followup_done_at, share_url,
            lead_source, referral_contact_type, referral_contact_name, referral_contact_phone,
            converted_order_id, pad_snapshot_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          String(raw.lead_id || ''),
          String(raw.customer_id || ''),
          String(raw.building_id || ''),
          String(raw.quotation_date || ''),
          String(raw.valid_until || ''),
          String(raw.customer_name || ''),
          String(raw.phone_display || ''),
          String(raw.phone_e164 || ''),
          String(raw.address || ''),
          String(raw.area || ''),
          JSON.stringify(raw.items || []),
          roundMoney2(Number(raw.subtotal_bdt || 0)),
          raw.discount_enabled !== undefined
            ? raw.discount_enabled
              ? 1
              : 0
            : Number(raw.discount_bdt || 0) > 0
            ? 1
            : 0,
          String(raw.discount_type || 'amount') === 'percent' ? 'percent' : 'amount',
          roundMoney2(
            raw.discount_value !== undefined
              ? Number(raw.discount_value || 0)
              : Number(raw.discount_bdt || 0)
          ),
          roundMoney2(Number(raw.discount_bdt || 0)),
          raw.vat_enabled ? 1 : 0,
          String(raw.vat_type || 'percent') === 'amount' ? 'amount' : 'percent',
          roundMoney2(Number(raw.vat_value || 0)),
          String(raw.vat_base || 'after_discount') === 'subtotal' ? 'subtotal' : 'after_discount',
          roundMoney2(Number(raw.vat_bdt || 0)),
          raw.tax_enabled ? 1 : 0,
          String(raw.tax_type || 'percent') === 'amount' ? 'amount' : 'percent',
          roundMoney2(Number(raw.tax_value || 0)),
          String(raw.tax_base || 'after_discount') === 'subtotal'
            ? 'subtotal'
            : String(raw.tax_base || 'after_discount') === 'after_discount_and_vat'
            ? 'after_discount_and_vat'
            : 'after_discount',
          roundMoney2(Number(raw.tax_bdt || 0)),
          roundMoney2(Number(raw.total_bdt || 0)),
          String(raw.terms || ''),
          String(raw.notes || ''),
          normalizeQuotationStatus(String(raw.status || 'Draft')),
          String(raw.status_changed_at || raw.updated_at || now),
          JSON.stringify(Array.isArray(raw.status_history) ? raw.status_history : []),
          String(raw.followup_date || ''),
          String(raw.followup_note || ''),
          raw.followup_done ? 1 : 0,
          String(raw.followup_done_at || ''),
          String(raw.share_url || ''),
          normalizeLeadSource(String(raw.lead_source || '')),
          String(raw.referral_contact_type || ''),
          String(raw.referral_contact_name || ''),
          String(raw.referral_contact_phone || ''),
          String(raw.converted_order_id || ''),
          raw.pad_snapshot ? JSON.stringify(raw.pad_snapshot) : '',
          String(raw.created_at || now),
          String(raw.updated_at || now)
        );
        restoredQuotations++;
      }
    }

    // 4) Money Receipts
    if (Array.isArray(backup.receipts)) {
      for (const raw of backup.receipts as Array<Record<string, unknown>>) {
        const id = String(raw.receipt_id || '').trim();
        if (!id) continue;
        db.prepare(
          `INSERT OR REPLACE INTO receipts (
            receipt_id, order_id, receipt_date, customer_name, phone_display, address,
            services_text, amount_received, payment_method, transaction_ref,
            received_by, notes, pad_snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          String(raw.order_id || ''),
          String(raw.receipt_date || ''),
          String(raw.customer_name || ''),
          String(raw.phone_display || ''),
          String(raw.address || ''),
          String(raw.services_text || ''),
          Number(raw.amount_received || 0),
          translatePaymentMethodToEnglish(String(raw.payment_method || 'Cash')),
          String(raw.transaction_ref || ''),
          String(raw.received_by || actor.name),
          String(raw.notes || ''),
          raw.pad_snapshot ? JSON.stringify(raw.pad_snapshot) : '',
          String(raw.created_at || now)
        );
        restoredReceipts++;
      }
    }

    // 5) Leads & Dated Lead Notes
    if (Array.isArray(backup.leads)) {
      for (const raw of backup.leads as Array<Record<string, unknown>>) {
        const id = String(raw.lead_id || '').trim();
        if (!id) continue;
        const services = Array.isArray(raw.interested_services)
          ? raw.interested_services.map(String)
          : [];
        db.prepare(
          `INSERT OR REPLACE INTO leads (
            lead_id, name, phone_display, phone_e164, area, building_org, address, contact_role,
            interested_services_json, interested_services_text, lead_source, referral_contact_type, stage,
            next_followup_date, followup_done, followup_done_at, followup_version,
            reminder_sent, reminder_sent_at, reminder_sent_for_date, reminder_sent_version,
            linked_quotation_id, linked_order_id,
            agent_name, agent_phone_display, agent_phone_e164, agent_note,
            caretaker_name, caretaker_phone_display, caretaker_phone_e164, caretaker_note,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          String(raw.name || ''),
          String(raw.phone_display || ''),
          String(raw.phone_e164 || ''),
          String(raw.area || ''),
          String(raw.building_org || ''),
          String(raw.address || ''),
          String(raw.contact_role || ''),
          JSON.stringify(services),
          String(raw.interested_services_text || services.join(', ')),
          normalizeLeadSource(String(raw.lead_source || '')),
          String(raw.referral_contact_type || ''),
          normalizeLeadStage(String(raw.stage || 'New')),
          String(raw.next_followup_date || ''),
          raw.followup_done ? 1 : 0,
          String(raw.followup_done_at || ''),
          Number(raw.followup_version || 0),
          raw.reminder_sent ? 1 : 0,
          String(raw.reminder_sent_at || ''),
          String(raw.reminder_sent_for_date || ''),
          Number(raw.reminder_sent_version || 0),
          String(raw.linked_quotation_id || ''),
          String(raw.linked_order_id || ''),
          String(raw.agent_name || ''),
          String(raw.agent_phone_display || ''),
          String(raw.agent_phone_e164 || ''),
          String(raw.agent_note || ''),
          String(raw.caretaker_name || ''),
          String(raw.caretaker_phone_display || ''),
          String(raw.caretaker_phone_e164 || ''),
          String(raw.caretaker_note || ''),
          String(raw.created_at || now),
          String(raw.updated_at || now)
        );
        restoredLeads++;
      }
    }

    if (Array.isArray(backup.leadNotes)) {
      for (const raw of backup.leadNotes as Array<Record<string, unknown>>) {
        const id = String(raw.note_id || '').trim();
        if (!id) continue;
        db.prepare(
          `INSERT OR REPLACE INTO lead_notes (note_id, lead_id, channel, note_text, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          String(raw.lead_id || ''),
          normalizeLeadChannel(String(raw.channel || 'Call')),
          String(raw.note_text || ''),
          String(raw.created_by || actor.name),
          String(raw.created_at || now)
        );
        restoredLeadNotes++;
      }
    }

    // 6) Overhead Expenses (idempotent by id)
    if (Array.isArray(backup.overhead)) {
      for (const raw of backup.overhead as Array<Record<string, unknown>>) {
        const id = String(raw.id || '').trim();
        if (!id) continue;
        db.prepare(
          `INSERT OR REPLACE INTO overhead_expenses (id, expense_date, category, description, amount_bdt, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          String(raw.expense_date || getTodayDhakaIso()),
          normalizeExpenseCategory(String(raw.category || '')),
          String(raw.description || ''),
          Number(raw.amount_bdt || 0),
          String(raw.created_by || actor.name),
          String(raw.created_at || now)
        );
        restoredOverhead++;
      }
    }

    // 7) Status History & Reminder Logs (idempotent by primary key)
    if (Array.isArray(backup.history)) {
      for (const raw of backup.history as Array<Record<string, unknown>>) {
        const id = String(raw.history_id || '').trim();
        if (!id) continue;
        db.prepare(
          `INSERT OR REPLACE INTO status_history (history_id, order_id, previous_status, new_status, note, changed_by, changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          String(raw.order_id || ''),
          String(raw.previous_status || ''),
          String(raw.new_status || ''),
          String(raw.note || ''),
          String(raw.changed_by || actor.name),
          String(raw.changed_at || now)
        );
      }
    }

    if (Array.isArray(backup.reminderLogs)) {
      for (const raw of backup.reminderLogs as Array<Record<string, unknown>>) {
        const id = String(raw.log_id || '').trim();
        if (!id) continue;
        db.prepare(
          `INSERT OR REPLACE INTO reminder_logs (
            log_id, dedupe_key, order_id, customer_name, phone_display, services_text,
            completion_date, followup_date, recipient_email, send_type, status, error_message, sent_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          String(raw.dedupe_key || ''),
          String(raw.order_id || ''),
          String(raw.customer_name || ''),
          String(raw.phone_display || ''),
          String(raw.services_text || ''),
          String(raw.completion_date || ''),
          String(raw.followup_date || ''),
          String(raw.recipient_email || ''),
          String(raw.send_type || 'AUTO_DAILY'),
          String(raw.status || 'SENT'),
          String(raw.error_message || ''),
          String(raw.sent_at || now)
        );
      }
    }

    // 8) Document Pads (actual quotation & receipt pad images + field positions + versions)
    if (backup.pads && typeof backup.pads === 'object') {
      const padsObj = backup.pads as Record<string, unknown>;
      for (const padType of ['quotation', 'receipt'] as PadType[]) {
        const rawPad = padsObj[padType] as Record<string, unknown> | null | undefined;
        if (!rawPad || !rawPad.image_data_url) continue;
        db.prepare(
          `INSERT OR REPLACE INTO document_pads (
            pad_type, version, file_name, mime_type, image_data_url,
            page_width_mm, page_height_mm, fields_json, updated_at, updated_by, drive_file_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          padType,
          Number(rawPad.version || 1),
          String(rawPad.file_name || `${padType}_pad.png`),
          String(rawPad.mime_type || 'image/png'),
          String(rawPad.image_data_url || ''),
          Number(rawPad.page_width_mm || 210),
          Number(rawPad.page_height_mm || 297),
          JSON.stringify(Array.isArray(rawPad.fields) ? rawPad.fields : getDefaultPadFields(padType)),
          String(rawPad.updated_at || now),
          String(rawPad.updated_by || actor.name),
          String(rawPad.drive_file_id || '')
        );
        restoredPads++;
      }
    }

    // 9) Issued PDFs (idempotent by doc_type + doc_id)
    if (Array.isArray(backup.issuedPdfs)) {
      for (const raw of backup.issuedPdfs as Array<Record<string, unknown>>) {
        const docType = String(raw.doc_type || '');
        const docId = String(raw.doc_id || '').trim();
        const b64 = String(raw.pdf_base64 || '').trim();
        if ((docType !== 'quotation' && docType !== 'receipt') || !docId || !b64) continue;
        db.prepare(
          `INSERT INTO issued_pdfs (pdf_id, doc_type, doc_id, file_name, pdf_base64, size_bytes, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(doc_type, doc_id) DO UPDATE SET
             file_name = excluded.file_name,
             pdf_base64 = excluded.pdf_base64,
             size_bytes = excluded.size_bytes,
             created_by = excluded.created_by,
             created_at = excluded.created_at`
        ).run(
          String(raw.pdf_id || makeUid('PDF')),
          docType,
          docId,
          String(raw.file_name || `${docId}.pdf`),
          b64,
          Number(raw.size_bytes || Math.round((b64.length * 3) / 4)),
          String(raw.created_by || actor.name),
          String(raw.created_at || now)
        );
        restoredIssuedPdfs++;
      }
    }

    // 9b) Extended tables (customers, buildings, workers, order_workers, payment history, settlement entries, complaints)
    restoreExtendedBackupTablesTx(db, backup);

    // 10) Company Branding / Logo
    if (backup.branding && typeof backup.branding === 'object') {
      const b = backup.branding as Record<string, unknown>;
      const logoUrl = String(b.company_logo_data_url || '').trim();
      if (logoUrl.startsWith('data:image/')) {
        setSettingRaw('company_logo_data_url', logoUrl);
        setSettingRaw('company_logo_file_name', String(b.company_logo_file_name || 'logo.png'));
        setSettingRaw('company_logo_mime_type', String(b.company_logo_mime_type || 'image/png'));
        setSettingRaw('company_logo_updated_at', String(b.company_logo_updated_at || now));
        restoredLogo = true;
      }
    }

    // 11) Non-secret App Settings
    if (backup.settings && typeof backup.settings === 'object') {
      const s = backup.settings as Record<string, unknown>;
      if (s.default_followup_value !== undefined) {
        const val = parseInt(String(s.default_followup_value), 10);
        if (val >= 1 && val <= 3650) setSettingRaw('default_followup_value', String(val));
      }
      if (s.default_followup_unit === 'days' || s.default_followup_unit === 'months') {
        setSettingRaw('default_followup_unit', s.default_followup_unit);
      }
      if (typeof s.reminder_email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.reminder_email)) {
        setSettingRaw('reminder_email', s.reminder_email.toLowerCase());
      }
      if (s.daily_reminder_hour !== undefined) {
        const h = Math.min(23, Math.max(0, parseInt(String(s.daily_reminder_hour), 10) || 9));
        setSettingRaw('daily_reminder_hour', String(h));
      }
      if (s.schedule_conflict_buffer_mins !== undefined) {
        const mins = Math.min(360, Math.max(0, parseInt(String(s.schedule_conflict_buffer_mins), 10) || 60));
        setSettingRaw('schedule_conflict_buffer_mins', String(mins));
      }
      if (typeof s.secondary_drive_folder_name === 'string' && s.secondary_drive_folder_name.trim()) {
        setSettingRaw('secondary_drive_folder_name', s.secondary_drive_folder_name.trim());
      }
    }

    // 12) Always pause Gmail reminders after restore until admin verifies authorization & settings!
    setSettingRaw('reminders_paused_after_restore', '1');
    setSettingRaw('reminder_trigger_status', 'Paused After Restore (Admin Verification Required)');

    return {
      restoredOrders,
      restoredQuotations,
      restoredReceipts,
      restoredLeads,
      restoredLeadNotes,
      restoredSupervisors,
      restoredOverhead,
      restoredPads,
      restoredIssuedPdfs,
      restoredLogo,
    };
  }
);

export function restoreBackupTx(
  backup: Record<string, unknown>,
  actor: AuthUser
): {
  validation: BackupValidationSummary;
  preRestoreRecoveryFile: string;
  restoredOrders: number;
  restoredQuotations: number;
  restoredReceipts: number;
  restoredLeads: number;
  restoredLeadNotes: number;
  restoredSupervisors: number;
  restoredOverhead: number;
  restoredPads: number;
  restoredIssuedPdfs: number;
  restoredLogo: boolean;
} {
  // 1) Validate schema & checksum BEFORE touching any existing data
  const validation = validateBackupPackage(backup);

  // 2) Automatically create a pre-restore recovery snapshot if current data exists
  let preRestoreRecoveryFile = '';
  if (hasExistingBusinessData()) {
    const stamp = getNowDhakaTimestamp().replace(/[^0-9]/g, '').slice(0, 14);
    const recoveryName = `sunviloz_pre_restore_recovery_${stamp}.json`;
    const currentSnapshot = buildFullBackupJson();
    const saved = saveLocalBackupSnapshot('recovery', recoveryName, currentSnapshot);
    preRestoreRecoveryFile = recoveryName;
    recordBackupHistory({
      source: 'pre_restore_recovery',
      status: 'verified',
      file_name: recoveryName,
      size_bytes: saved.sizeBytes,
      checksum_sha256: saved.checksum,
      created_by: actor.name,
    });
  }

  // 3) Atomic SQLite transaction (rolls back completely if any write fails)
  const counts = restoreBackupAtomicInnerTx(backup, actor);

  return {
    validation,
    preRestoreRecoveryFile,
    ...counts,
  };
}

// ============================================================================
// DB-BOUND WRAPPERS FOR EXTENDED MODULES (CUSTOMERS, BUILDINGS, WORKERS, SETTLEMENTS, COMPLAINTS, QUOTATION FOLLOW-UPS)
// ============================================================================

export const createCustomer = db.transaction(
  (payload: Parameters<typeof extCreateCustomerTx>[1]) => extCreateCustomerTx(db, payload)
);

export const updateCustomer = db.transaction(
  (customerId: string, payload: Parameters<typeof extUpdateCustomerTx>[2]) =>
    extUpdateCustomerTx(db, customerId, payload)
);

export const createBuilding = db.transaction(
  (payload: Parameters<typeof extCreateBuildingTx>[1]) => extCreateBuildingTx(db, payload)
);

export const updateBuilding = db.transaction(
  (buildingId: string, payload: Parameters<typeof extUpdateBuildingTx>[2]) =>
    extUpdateBuildingTx(db, buildingId, payload)
);

export const deleteBuilding = db.transaction((buildingId: string) =>
  extDeleteBuildingTx(db, buildingId)
);

export function checkOrderScheduleConflicts(
  params: Parameters<typeof extCheckScheduleConflicts>[1]
) {
  return extCheckScheduleConflicts(db, params);
}

export const createWorker = db.transaction(
  (payload: Parameters<typeof extCreateWorkerTx>[1]) => extCreateWorkerTx(db, payload)
);

export const updateWorker = db.transaction(
  (workerId: string, payload: Parameters<typeof extUpdateWorkerTx>[2]) =>
    extUpdateWorkerTx(db, workerId, payload)
);

export const markOrderWorkerPaid = db.transaction(
  (
    orderId: string,
    orderWorkerId: string,
    payload: Parameters<typeof extMarkOrderWorkerPaidTx>[3],
    actor: AuthUser
  ) => {
    const workerRow = extMarkOrderWorkerPaidTx(db, orderId, orderWorkerId, payload, actor);
    const order = getOrderById(orderId);
    return { workerRow, order };
  }
);

export const correctOrderWorkerPayment = db.transaction(
  (
    orderId: string,
    orderWorkerId: string,
    payload: Parameters<typeof extCorrectOrderWorkerPaymentTx>[3],
    actor: AuthUser
  ) => {
    const workerRow = extCorrectOrderWorkerPaymentTx(db, orderId, orderWorkerId, payload, actor);
    const order = getOrderById(orderId);
    return { workerRow, order };
  }
);

export const recordSupervisorSettlementEntry = db.transaction(
  (
    orderId: string,
    payload: Parameters<typeof extRecordSettlementEntryTx>[2],
    actor: AuthUser
  ) => {
    const entry = extRecordSettlementEntryTx(db, orderId, payload, actor);
    const order = getOrderById(orderId);
    return { entry, order };
  }
);

export const createOrderComplaint = db.transaction(
  (
    orderId: string,
    payload: Parameters<typeof extCreateComplaintTx>[2],
    actor: AuthUser
  ) => extCreateComplaintTx(db, orderId, payload, actor)
);

export const updateOrderComplaint = db.transaction(
  (complaintId: string, payload: Parameters<typeof extUpdateComplaintTx>[2]) =>
    extUpdateComplaintTx(db, complaintId, payload)
);

export const updateQuotationFollowup = db.transaction(
  (
    quotationId: string,
    payload: Parameters<typeof extUpdateQuotationFollowupTx>[2],
    actor: AuthUser
  ) => {
    extUpdateQuotationFollowupTx(db, quotationId, payload, actor);
    return getQuotationById(quotationId);
  }
);

// ============================================================================
// DB-BOUND MOBILE SECURITY, SESSIONS, WEBAUTHN & IDEMPOTENCY WRAPPERS
// ============================================================================

export function dbCreatePersistentSession(
  params: Parameters<typeof createPersistentSession>[1]
) {
  return createPersistentSession(db, params);
}

export function dbValidatePersistentSessionCookie(
  cookieValue: string,
  expectedDeviceId?: string
) {
  return validatePersistentSessionCookie(db, cookieValue, expectedDeviceId);
}

export function dbIsSessionActive(sessionId: string, userId?: string): boolean {
  return isSessionActive(db, sessionId, userId);
}

export function dbTouchSession(sessionId: string, nextTokenVersion?: number): void {
  touchSession(db, sessionId, nextTokenVersion);
}

export function dbRevokeSessionById(sessionId: string, reason = 'sign_out'): void {
  revokeSessionById(db, sessionId, reason);
}

export function dbRevokeAllSessionsForUser(
  userId: string,
  reason: string,
  exceptSessionId?: string
): void {
  revokeAllSessionsForUser(db, userId, reason, exceptSessionId);
}

export function dbRevokeSessionsForDevice(
  userId: string,
  deviceId: string,
  reason = 'device_removed'
): void {
  revokeSessionsForDevice(db, userId, deviceId, reason);
}

export function dbListActiveSessionsForUser(userId: string, currentSessionId?: string) {
  return listActiveSessionsForUser(db, userId, currentSessionId);
}

export function dbSaveWebAuthnChallenge(
  params: Parameters<typeof saveWebAuthnChallenge>[1]
) {
  return saveWebAuthnChallenge(db, params);
}

export function dbConsumeWebAuthnChallenge(
  params: Parameters<typeof consumeWebAuthnChallenge>[1]
) {
  return consumeWebAuthnChallenge(db, params);
}

export function dbSaveWebAuthnCredential(
  params: Parameters<typeof saveWebAuthnCredential>[1]
) {
  saveWebAuthnCredential(db, params);
}

export function dbListWebAuthnCredentialsForUser(userId: string) {
  return listWebAuthnCredentialsForUser(db, userId);
}

export function dbListWebAuthnCredentialsForUserAndDevice(userId: string, deviceId: string) {
  return listWebAuthnCredentialsForUserAndDevice(db, userId, deviceId);
}

export function dbGetWebAuthnCredentialById(credentialId: string) {
  return getWebAuthnCredentialById(db, credentialId);
}

export function dbUpdateWebAuthnCredentialCounter(credentialId: string, newCounter: number) {
  updateWebAuthnCredentialCounter(db, credentialId, newCounter);
}

export function dbListEnrolledDevicesForUser(userId: string, currentDeviceId?: string) {
  return listEnrolledDevicesForUser(db, userId, currentDeviceId);
}

export function dbRevokeWebAuthnCredentialAndSessions(userId: string, credentialId: string) {
  return revokeWebAuthnCredentialAndSessions(db, userId, credentialId);
}

export function dbGetIdempotentResponse(
  idemKey: string,
  userId: string,
  method: string,
  reqPath: string
) {
  return getIdempotentResponse(db, idemKey, userId, method, reqPath);
}

export function dbStoreIdempotentResponse(
  idemKey: string,
  userId: string,
  method: string,
  reqPath: string,
  statusCode: number,
  body: unknown
) {
  storeIdempotentResponse(db, idemKey, userId, method, reqPath, statusCode, body);
}



