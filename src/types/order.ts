export type UserRole = 'admin' | 'supervisor';

export type OrderStatus = 'New' | 'Confirmed' | 'In Progress' | 'Completed' | 'Cancelled';

export type QuotationStatus = 'Draft' | 'Sent' | 'Accepted' | 'Cancelled';

export type SettlementStatus = 'Not Applicable' | 'Pending' | 'Settled' | 'Balanced';

export type FollowupUnit = 'months' | 'days';

export type FollowupMode = 'default' | 'custom' | 'exact';

export type PadType = 'quotation' | 'receipt';

export type PaymentMethod = 'Cash' | 'bKash' | 'Nagad' | 'Bank Transfer' | 'Cheque';

export type ComplaintStatus = 'Open' | 'Return Visit Scheduled' | 'Resolved';

export type WorkerPaymentStatus = 'Unpaid' | 'Paid';

export type PaidByRole = '' | 'admin' | 'supervisor';

export type ReferralContactType = '' | 'agent' | 'caretaker';

export type TankMaterial = 'Concrete' | 'PVC' | 'Plastic' | 'Steel' | 'Other';

export type AppScreen =
  | 'dashboard'
  | 'customers'
  | 'leads'
  | 'orders'
  | 'detail'
  | 'quotations'
  | 'receipts'
  | 'followups'
  | 'supervisors'
  | 'workers'
  | 'reports'
  | 'settings';

export type LeadStage =
  | 'New'
  | 'Contacted'
  | 'Quotation Sent'
  | 'Confirmed'
  | 'Not Interested';

export type LeadChannel = 'Call' | 'WhatsApp' | 'Site Visit' | 'Other';

export const LEAD_STAGES: LeadStage[] = [
  'New',
  'Contacted',
  'Quotation Sent',
  'Confirmed',
  'Not Interested',
];

export const LEAD_CHANNELS: LeadChannel[] = ['Call', 'WhatsApp', 'Site Visit', 'Other'];

export const LEAD_SOURCES: string[] = [
  'Facebook',
  'Google',
  'Existing Customer',
  'Agent Referral',
  'Caretaker Referral',
  'Other',
  'Not Specified',
];

export const VALID_STATUSES: OrderStatus[] = [
  'New',
  'Confirmed',
  'In Progress',
  'Completed',
  'Cancelled',
];

export const QUOTATION_STATUSES: QuotationStatus[] = ['Draft', 'Sent', 'Accepted', 'Cancelled'];

export const PAYMENT_METHODS: PaymentMethod[] = [
  'Cash',
  'bKash',
  'Nagad',
  'Bank Transfer',
  'Cheque',
];

export const DEFAULT_SERVICES: string[] = [
  'Overhead Tank Cleaning',
  'Reserve Tank Cleaning',
  'Overhead & Reserve Tank Cleaning',
  'Pipeline Cleaning',
  'Full Package',
];

export const SERVICE_PACKAGE_INCLUSIONS: Record<string, string> = {
  'Overhead & Reserve Tank Cleaning':
    'Includes Overhead Tank Cleaning and Reserve Tank Cleaning',
  'Full Package':
    'Includes Overhead Tank Cleaning, Reserve Tank Cleaning, and Pipeline Cleaning',
};

export function isOrderStatusLocked(order: {
  status: OrderStatus | string;
  full_bill_collected?: boolean | number;
}): boolean {
  const status = String(order.status || '').trim();
  const isCompleted = status === 'Completed' || status === 'সম্পন্ন';
  return isCompleted && Boolean(order.full_bill_collected);
}

export const GENERAL_EXPENSE_CATEGORIES: string[] = [
  'Advertising',
  'Equipment Repair',
  'Phone Bills',
  'Office Expenses',
  'Other',
];

export const COMPLAINT_STATUSES: ComplaintStatus[] = [
  'Open',
  'Return Visit Scheduled',
  'Resolved',
];

export const TANK_MATERIALS: TankMaterial[] = ['Concrete', 'PVC', 'Plastic', 'Steel', 'Other'];

export interface AuthUser {
  id: string;
  role: UserRole;
  name: string;
  username: string;
  phone_display: string;
  is_active: boolean;
}

export interface SupervisorAccount {
  id: string;
  name: string;
  username: string;
  phone_display: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerProfile {
  customer_id: string;
  name: string;
  phone_display: string;
  phone_e164: string;
  lead_source: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface BuildingProfile {
  building_id: string;
  customer_id: string;
  name: string;
  address: string;
  area: string;
  maps_url: string;
  access_instructions: string;
  overhead_tank_qty: number;
  overhead_tank_capacity_litres: number | null;
  overhead_tank_material: string;
  reserve_tank_qty: number;
  reserve_tank_capacity_litres: number | null;
  reserve_tank_material: string;
  tank_notes: string;
  created_at: string;
  updated_at: string;
}

export interface SupervisorBuildingSummary {
  building_id: string;
  name: string;
  address: string;
  area: string;
  maps_url: string;
  access_instructions: string;
  overhead_tank_qty: number;
  overhead_tank_capacity_litres: number | null;
  overhead_tank_material: string;
  reserve_tank_qty: number;
  reserve_tank_capacity_litres: number | null;
  reserve_tank_material: string;
  tank_notes: string;
}

export interface WorkerRecord {
  worker_id: string;
  name: string;
  phone_display: string;
  phone_e164: string;
  is_active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface OrderWorkerAssignment {
  id: string;
  order_id: string;
  worker_id: string;
  worker_name: string;
  agreed_pay_bdt: number; // "Pay for This Job"
  confirmed_worked: boolean;
  payment_status: WorkerPaymentStatus; // 'Unpaid' | 'Paid'
  paid_amount_bdt: number;
  payment_date: string; // YYYY-MM-DD
  payment_method: string;
  paid_by_role: PaidByRole; // 'admin' | 'supervisor' | ''
  payment_reference: string;
  payment_note: string;
  paid_at: string;
  paid_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface WorkerPaymentHistoryRecord {
  history_id: string;
  order_worker_id: string;
  order_id: string;
  worker_id: string;
  worker_name: string;
  action: 'MARK_PAID' | 'CORRECTED' | 'MARK_UNPAID';
  amount_bdt: number;
  payment_date: string;
  payment_method: string;
  paid_by_role: PaidByRole;
  reference: string;
  reason: string;
  changed_by: string;
  changed_at: string;
}

export interface SupervisorSettlementEntry {
  entry_id: string;
  order_id: string;
  supervisor_id: string;
  supervisor_name: string;
  entry_type: 'deposit_received' | 'reimbursement_paid';
  amount_bdt: number;
  entry_datetime: string; // YYYY-MM-DD HH:mm (Asia/Dhaka)
  entry_date: string; // YYYY-MM-DD (Asia/Dhaka)
  payment_method: PaymentMethod;
  reference: string;
  note: string;
  recorded_by: string;
  created_at: string;
}

export interface OrderComplaintRecord {
  complaint_id: string;
  order_id: string;
  complaint_date: string;
  issue: string;
  action_taken: string;
  notes: string;
  status: ComplaintStatus;
  return_visit_order_id: string;
  is_no_charge: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduleConflictItem {
  order_id: string;
  customer_name: string;
  area: string;
  scheduled_date: string;
  scheduled_time: string;
  scheduled_end_time: string;
  estimated_duration_mins: number;
  status: OrderStatus;
  reason: string;
}

export interface OtherExpenseItem {
  description: string;
  amount: number;
}

export interface OrderRecord {
  order_id: string;
  quotation_id: string;
  receipt_id: string;
  previous_order_id: string;
  previous_work_date: string; // Actual completion date of previous order (for repeat bookings)
  followup_converted_order_id: string;
  lead_id: string;
  customer_id: string;
  building_id: string;
  building_name: string;
  customer_name: string;
  phone_display: string;
  phone_e164: string;
  address: string;
  area: string;
  services: string[];
  services_text: string;
  booking_date: string; // YYYY-MM-DD in Asia/Dhaka
  scheduled_date: string; // YYYY-MM-DD
  scheduled_time: string; // HH:mm
  estimated_duration_mins: number;
  scheduled_end_time: string; // HH:mm
  price_bdt: number;
  instructions: string;
  notes: string;
  lead_source: string;
  referral_contact_type: ReferralContactType;
  referral_contact_name: string;
  referral_contact_phone: string;
  assigned_supervisor_id: string;
  assigned_supervisor_name: string;
  status: OrderStatus;
  status_locked: boolean;
  status_locked_at: string;

  // Complaints & Return Visits
  parent_order_id: string;
  is_return_visit: boolean;
  is_no_charge_visit: boolean;
  complaint_id: string;

  // Advance
  advance_given: number;
  advance_supervisor_id: string;
  advance_supervisor_name: string;
  advance_given_at: string;

  // Completion, Full Bill Collection & Actual Expenses
  completion_date: string;
  completed_at: string;
  completed_by_user_id: string;
  completed_by_name: string;
  full_bill_collected: boolean;
  payment_collected_at: string;
  collected_by_name: string;
  transport_cost: number;
  meals_cost: number;
  other_expenses: OtherExpenseItem[];
  other_expenses_total: number;
  worker_pay_total: number; // Confirmed participating workers agreed pay total (counted once in labour cost)
  supervisor_paid_worker_total: number; // Subset paid by supervisor from job cash
  return_visit_expenses_total: number; // Linked no-charge return visits actual expenses counted once in original job profit
  actual_expenses: number; // transport + meals + other + worker_pay_total
  supervisor_settlement: number; // expected settlement = bill (if collected) + advance - (transport + meals + other + supervisor_paid_worker_total)
  job_profit_or_loss: number; // price_bdt - actual_expenses - return_visit_expenses_total

  // Supervisor Settlement Verification
  settlement_actual_total: number; // sum of deposits (if positive) or reimbursements (if negative)
  settlement_remaining: number; // max(0, abs(expected) - actual)
  settlement_status: SettlementStatus;
  settlement_confirmed_at: string;
  settlement_confirmed_by: string;
  settlement_note: string;

  // Assigned & Confirmed Workers
  assigned_workers: OrderWorkerAssignment[];

  // Follow-up & Reminder
  followup_date: string;
  followup_rule_note: string;
  followup_version: number;
  reminder_sent: boolean;
  reminder_sent_at: string;
  reminder_sent_for_date: string;
  reminder_sent_version: number;
  followup_done: boolean;
  followup_done_at: string;

  created_at: string;
  updated_at: string;
}

/** Restricted read-only projection returned to supervisor accounts */
export interface SupervisorJobView {
  order_id: string;
  customer_name: string;
  phone_display: string;
  phone_e164: string;
  address: string;
  area: string;
  services: string[];
  services_text: string;
  scheduled_date: string;
  scheduled_time: string;
  scheduled_end_time: string;
  estimated_duration_mins: number;
  instructions: string;
  price_bdt: number;
  advance_given: number;
  status: OrderStatus;
  status_locked: boolean;
  status_locked_at: string;
  is_return_visit: boolean;
  is_no_charge_visit: boolean;
  parent_order_id: string;
  building_summary: SupervisorBuildingSummary | null;
  assigned_workers: Array<{
    id: string;
    worker_id: string;
    worker_name: string;
    confirmed_worked: boolean;
  }>;
  completion_date: string;
  completed_at: string;
  full_bill_collected: boolean;
  transport_cost: number;
  meals_cost: number;
  other_expenses: OtherExpenseItem[];
  actual_expenses: number;
  supervisor_settlement: number;
  settlement_status: SettlementStatus;
}

export interface LeadNoteRecord {
  note_id: string;
  lead_id: string;
  channel: LeadChannel;
  note_text: string;
  created_by: string;
  created_at: string;
}

export interface LeadRecord {
  lead_id: string;
  name: string;
  phone_display: string;
  phone_e164: string;
  area: string;
  building_org: string;
  address: string;
  contact_role: string;
  interested_services: string[];
  interested_services_text: string;
  lead_source: string;
  referral_contact_type: ReferralContactType;
  stage: LeadStage;
  next_followup_date: string;
  followup_done: boolean;
  followup_done_at: string;
  followup_version: number;
  reminder_sent: boolean;
  reminder_sent_at: string;
  reminder_sent_for_date: string;
  reminder_sent_version: number;
  linked_quotation_id: string;
  linked_order_id: string;
  agent_name: string;
  agent_phone_display: string;
  agent_phone_e164: string;
  agent_note: string;
  caretaker_name: string;
  caretaker_phone_display: string;
  caretaker_phone_e164: string;
  caretaker_note: string;
  created_at: string;
  updated_at: string;
}

export interface QuotationItem {
  service: string;
  description: string;
  size?: string;
  quantity: number;
  unit_label?: string;
  rate_bdt: number;
  amount_bdt: number;
}

export interface QuotationStatusHistoryEntry {
  status: QuotationStatus;
  changed_at: string;
  changed_by: string;
  note?: string;
}

export interface PadFieldConfig {
  key: string;
  label: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  fontSize: number;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  color: string;
  visible: boolean;
}

export interface DocumentPadConfig {
  pad_type: PadType;
  version: number;
  file_name: string;
  mime_type: string;
  image_data_url: string;
  page_width_mm: number;
  page_height_mm: number;
  fields: PadFieldConfig[];
  updated_at: string;
  updated_by: string;
  drive_file_id: string;
}

export type QuotationChargeMode = 'amount' | 'percent';

export type VatCalculationBase = 'subtotal' | 'after_discount';

export type TaxCalculationBase = 'subtotal' | 'after_discount' | 'after_discount_and_vat';

export interface QuotationRecord {
  quotation_id: string;
  lead_id: string;
  customer_id: string;
  building_id: string;
  quotation_date: string;
  valid_until: string;
  customer_name: string;
  phone_display: string;
  phone_e164: string;
  address: string;
  area: string;
  items: QuotationItem[];
  subtotal_bdt: number;
  discount_enabled: boolean;
  discount_type: QuotationChargeMode;
  discount_value: number;
  discount_bdt: number;
  vat_enabled: boolean;
  vat_type: QuotationChargeMode;
  vat_value: number;
  vat_base: VatCalculationBase;
  vat_bdt: number;
  tax_enabled: boolean;
  tax_type: QuotationChargeMode;
  tax_value: number;
  tax_base: TaxCalculationBase;
  tax_bdt: number;
  total_bdt: number;
  terms: string;
  notes: string;
  lead_source: string;
  referral_contact_type: ReferralContactType;
  referral_contact_name: string;
  referral_contact_phone: string;
  status: QuotationStatus;
  status_changed_at: string;
  status_history: QuotationStatusHistoryEntry[];
  followup_date: string;
  followup_note: string;
  followup_done: boolean;
  followup_done_at: string;
  share_url: string;
  converted_order_id: string;
  pad_snapshot: DocumentPadConfig | null;
  created_at: string;
  updated_at: string;
}

export interface MoneyReceiptRecord {
  receipt_id: string;
  order_id: string;
  receipt_date: string;
  customer_name: string;
  phone_display: string;
  address: string;
  services_text: string;
  amount_received: number;
  payment_method: PaymentMethod;
  transaction_ref: string;
  received_by: string;
  notes: string;
  pad_snapshot: DocumentPadConfig | null;
  created_at: string;
}

export interface IssuedPdfRecord {
  pdf_id: string;
  doc_type: PadType;
  doc_id: string;
  file_name: string;
  pdf_base64: string;
  size_bytes: number;
  created_by: string;
  created_at: string;
}

export interface IssuedPdfSummary {
  pdf_id: string;
  doc_type: PadType;
  doc_id: string;
  file_name: string;
  size_bytes: number;
  created_by: string;
  created_at: string;
}

export interface BackupHistoryRecord {
  backup_id: string;
  source:
    | 'secondary_drive_oauth'
    | 'secondary_drive_scheduler'
    | 'local_download'
    | 'pre_restore_recovery';
  status: 'verified' | 'failed';
  file_name: string;
  drive_file_id: string;
  drive_account_email: string;
  folder_name: string;
  size_bytes: number;
  checksum_sha256: string;
  error_message: string;
  created_by: string;
  created_at: string;
}

export interface BackupValidationSummary {
  valid: boolean;
  schema_version: number;
  exported_at: string;
  timezone: string;
  checksum_verified: boolean;
  counts: {
    orders: number;
    quotations: number;
    receipts: number;
    leads: number;
    lead_notes: number;
    customers: number;
    buildings: number;
    workers: number;
    order_workers: number;
    worker_payment_history: number;
    settlement_entries: number;
    complaints: number;
    supervisors: number;
    overhead: number;
    history: number;
    reminder_logs: number;
    pads: number;
    issued_pdfs: number;
    has_company_logo: boolean;
  };
  warnings: string[];
}

export interface OverheadExpenseRecord {
  id: string;
  expense_date: string;
  category: string;
  description: string;
  amount_bdt: number;
  created_by: string;
  created_at: string;
}

export interface StatusHistoryRecord {
  history_id: string;
  order_id: string;
  previous_status: string;
  new_status: string;
  note: string;
  changed_by: string;
  changed_at: string;
}

export interface ReminderLogRecord {
  log_id: string;
  dedupe_key: string;
  order_id: string;
  customer_name: string;
  phone_display: string;
  services_text: string;
  completion_date: string;
  followup_date: string;
  recipient_email: string;
  send_type: 'AUTO_DAILY' | 'TEST_EMAIL' | 'LEAD_FOLLOWUP';
  status: 'SENT' | 'FAILED';
  error_message: string;
  sent_at: string;
}

export type PrimaryDriveSyncStatus =
  | 'not_connected'
  | 'pending_sync'
  | 'saved_to_primary_drive'
  | 'sync_failed';

export interface EnrolledDeviceInfo {
  credential_id: string;
  device_id: string;
  device_label: string;
  created_at: string;
  last_used_at: string;
  is_current_device?: boolean;
}

export interface ActiveSessionInfo {
  session_id: string;
  device_id: string;
  device_label: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  is_current_session?: boolean;
}

export interface AppSettings {
  default_followup_value: number;
  default_followup_unit: FollowupUnit;
  reminder_email: string;
  owner_email: string;
  daily_reminder_hour: number;
  schedule_conflict_buffer_mins: number;
  google_webapp_url: string;
  google_sync_configured: boolean;
  last_google_sync_at: string;
  last_google_sync_status: 'idle' | 'pending' | 'verified' | 'error';
  last_google_sync_error: string;
  last_drive_backup_at: string;
  reminder_trigger_status: string;
  reminders_paused_after_restore: boolean;

  // Company Branding
  company_logo_data_url: string;
  company_logo_file_name: string;
  company_logo_mime_type: string;
  company_logo_updated_at: string;

  // Primary Google Drive Durable Sync (appDataFolder)
  primary_drive_email: string;
  primary_drive_folder_label: string;
  primary_drive_file_id: string;
  sync_revision: number;
  primary_drive_last_synced_revision: number;
  primary_drive_last_synced_at: string;
  primary_drive_sync_status: PrimaryDriveSyncStatus;
  primary_drive_last_error: string;
  primary_drive_last_checksum: string;

  // Secondary Google Drive Backup & Scheduler
  secondary_drive_email: string;
  secondary_drive_folder_id: string;
  secondary_drive_folder_name: string;
  secondary_drive_webapp_url: string;
  secondary_drive_secret_configured: boolean;
  auto_backup_enabled: boolean;
  auto_backup_hour: number;
  last_verified_backup_at: string;
  last_verified_backup_file: string;
  last_backup_error: string;
}

export interface AdminBootstrapPayload {
  todayDhaka: string;
  orders: OrderRecord[];
  quotations: QuotationRecord[];
  receipts: MoneyReceiptRecord[];
  leads: LeadRecord[];
  leadNotes: LeadNoteRecord[];
  customers: CustomerProfile[];
  buildings: BuildingProfile[];
  workers: WorkerRecord[];
  workerPaymentHistory: WorkerPaymentHistoryRecord[];
  settlementEntries: SupervisorSettlementEntry[];
  complaints: OrderComplaintRecord[];
  supervisors: SupervisorAccount[];
  overhead: OverheadExpenseRecord[];
  history: StatusHistoryRecord[];
  reminderLogs: ReminderLogRecord[];
  issuedPdfs: IssuedPdfSummary[];
  backupHistory: BackupHistoryRecord[];
  pads: Record<PadType, DocumentPadConfig | null>;
  settings: AppSettings;
}
