import type {
  ActiveSessionInfo,
  AdminBootstrapPayload,
  AppSettings,
  AuthUser,
  BackupHistoryRecord,
  BackupValidationSummary,
  BuildingProfile,
  ComplaintStatus,
  CustomerProfile,
  DocumentPadConfig,
  EnrolledDeviceInfo,
  FollowupMode,
  FollowupUnit,
  IssuedPdfRecord,
  IssuedPdfSummary,
  LeadChannel,
  LeadNoteRecord,
  LeadRecord,
  LeadStage,
  MoneyReceiptRecord,
  OrderComplaintRecord,
  OrderRecord,
  OrderStatus,
  OrderWorkerAssignment,
  OtherExpenseItem,
  PadFieldConfig,
  PadType,
  PaymentMethod,
  PrimaryDriveSyncStatus,
  QuotationItem,
  QuotationRecord,
  QuotationStatus,
  ScheduleConflictItem,
  SupervisorAccount,
  SupervisorJobView,
  SupervisorSettlementEntry,
  WorkerRecord,
} from '../types/order';
import { getFriendlyDeviceLabel, getOrCreateDeviceId } from './deviceIdentity';
import {
  createIdempotencyKey,
  enqueuePendingMutation,
  listPendingMutations,
  removePendingMutation,
  updatePendingMutationFailure,
} from './offlineSyncQueue';

// Session token held strictly in JS memory (never localStorage/sessionStorage)
let authTokenInMemory = '';
let onSessionRevokedCallback: ((reason: string) => void) | null = null;
let onBusinessDataMutatedCallback: (() => void) | null = null;

export function setAuthToken(token: string) {
  authTokenInMemory = token;
}

export function clearAuthToken() {
  authTokenInMemory = '';
}

export function getAuthToken(): string {
  return authTokenInMemory;
}

export function setOnSessionRevoked(cb: ((reason: string) => void) | null) {
  onSessionRevokedCallback = cb;
}

export function setOnBusinessDataMutated(cb: (() => void) | null) {
  onBusinessDataMutatedCallback = cb;
}

const BUSINESS_MUTATION_PREFIXES = [
  '/api/orders',
  '/api/customers',
  '/api/buildings',
  '/api/leads',
  '/api/quotations',
  '/api/receipts',
  '/api/workers',
  '/api/complaints',
  '/api/overhead',
  '/api/supervisors',
  '/api/pads',
  '/api/branding',
  '/api/issued-pdfs',
  '/api/settings',
];

function isBusinessMutationRequest(path: string, method: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return false;
  if (path === '/api/orders/check-conflicts') return false;
  return BUSINESS_MUTATION_PREFIXES.some((p) => path.startsWith(p));
}

function isNetworkFailureError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('network request failed')
  );
}

export interface ApiRequestOptions extends RequestInit {
  idempotencyKey?: string;
  queueOnOfflineLabel?: string;
}

export class OfflineQueuedError extends Error {
  readonly queued = true;
  readonly idempotencyKey: string;
  constructor(label: string, idempotencyKey: string) {
    super(`Offline: "${label}" saved locally and will sync automatically when reconnected.`);
    this.name = 'OfflineQueuedError';
    this.idempotencyKey = idempotencyKey;
  }
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const isBizMut = isBusinessMutationRequest(path, method);
  const idemKey =
    options.idempotencyKey || (isBizMut ? createIdempotencyKey('req') : undefined);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Id': getOrCreateDeviceId(),
    ...((options.headers as Record<string, string>) || {}),
  };
  if (authTokenInMemory) {
    headers.Authorization = `Bearer ${authTokenInMemory}`;
  }
  if (idemKey) {
    headers['X-Idempotency-Key'] = idemKey;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch (err) {
    if (
      options.queueOnOfflineLabel &&
      idemKey &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
      isNetworkFailureError(err)
    ) {
      enqueuePendingMutation({
        idempotencyKey: idemKey,
        method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path,
        bodyJson: typeof options.body === 'string' ? options.body : '{}',
        label: options.queueOnOfflineLabel,
      });
      throw new OfflineQueuedError(options.queueOnOfflineLabel, idemKey);
    }
    throw new Error(
      typeof navigator !== 'undefined' && !navigator.onLine
        ? 'You are currently offline. Please check your internet connection and retry.'
        : 'Could not reach the server. Please check your connection and try again.'
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data.error || `Server error (${res.status})`;
    if (
      authTokenInMemory &&
      !path.startsWith('/api/auth/login') &&
      !path.startsWith('/api/auth/bootstrap') &&
      !path.startsWith('/api/auth/change-password-with-credentials') &&
      !path.startsWith('/api/auth/google-admin') &&
      !path.startsWith('/api/auth/webauthn/authenticate') &&
      (res.status === 401 ||
        (res.status === 403 && String(errMsg).toLowerCase().includes('deactivated')))
    ) {
      authTokenInMemory = '';
      onSessionRevokedCallback?.(errMsg);
    }
    throw new Error(errMsg);
  }

  if (isBizMut) {
    onBusinessDataMutatedCallback?.();
  }
  return data as T;
}

/**
 * Replays locally queued offline mobile mutations in strict FIFO order using their
 * original X-Idempotency-Key so retries never create duplicate records.
 */
export async function flushPendingMutations(): Promise<{
  syncedCount: number;
  remainingCount: number;
  lastError: string;
}> {
  const items = listPendingMutations();
  if (items.length === 0) {
    return { syncedCount: 0, remainingCount: 0, lastError: '' };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { syncedCount: 0, remainingCount: items.length, lastError: 'Device is offline.' };
  }

  let syncedCount = 0;
  let lastError = '';

  for (const item of items) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Device-Id': getOrCreateDeviceId(),
        'X-Idempotency-Key': item.idempotencyKey,
      };
      if (authTokenInMemory) {
        headers.Authorization = `Bearer ${authTokenInMemory}`;
      }
      const res = await fetch(item.path, {
        method: item.method,
        credentials: 'include',
        headers,
        body: item.bodyJson,
      });

      if (res.ok) {
        removePendingMutation(item.idempotencyKey);
        syncedCount += 1;
        continue;
      }

      const data = await res.json().catch(() => ({}));
      const errMsg = data.error || `Server error (${res.status})`;

      if (res.status === 401) {
        lastError = errMsg;
        updatePendingMutationFailure(item.idempotencyKey, errMsg);
        break;
      }

      // Permanent validation/conflict error: record message so user sees it, keep remaining items safe
      lastError = errMsg;
      updatePendingMutationFailure(item.idempotencyKey, errMsg);
      if (res.status >= 500) {
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Network error during retry.';
      updatePendingMutationFailure(item.idempotencyKey, lastError);
      break;
    }
  }

  if (syncedCount > 0) {
    onBusinessDataMutatedCallback?.();
  }

  return {
    syncedCount,
    remainingCount: listPendingMutations().length,
    lastError,
  };
}

async function downloadReportBlob(
  reportType: 'monthly_financial' | 'monthly_team' | 'monthly_worker_payments' | 'lead_source',
  filters: Record<string, string>,
  fallbackFileName: string
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Id': getOrCreateDeviceId(),
  };
  if (authTokenInMemory) {
    headers.Authorization = `Bearer ${authTokenInMemory}`;
  }
  const res = await fetch('/api/reports/export-xlsx', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ report_type: reportType, filters }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Excel export failed (${res.status})`);
  }
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const match = disp.match(/filename="([^"]+)"/);
  const fileName = match ? match[1] : fallbackFileName;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return fileName;
}

export interface SessionResumeResponse {
  status: 'authenticated' | 'locked' | 'unauthenticated';
  token?: string;
  user?: AuthUser;
  deviceUnlockAvailable?: boolean;
  deviceId?: string;
  userPreview?: {
    id: string;
    name: string;
    username: string;
    role: 'admin' | 'supervisor';
  };
}

export const api = {
  // Auth & Persistent Device Sessions
  getAuthStatus: () =>
    apiRequest<{
      needsAdminSetup: boolean;
      adminSetupLocked?: boolean;
      envAdminConfigured: boolean;
      googleAdminEnabled?: boolean;
      ownerEmailHint: string;
      initialAdminUsername?: string;
      companyLogoDataUrl: string;
      backendMode?: 'apps_script' | 'local_preview';
      backendConfigured?: boolean;
      backendReachable?: boolean;
      backendStatusMessage?: string;
    }>('/api/auth/status'),

  resumeSession: () =>
    apiRequest<SessionResumeResponse>(
      `/api/auth/session/resume?deviceId=${encodeURIComponent(getOrCreateDeviceId())}`
    ),

  logout: () =>
    apiRequest<{ ok: boolean; message: string }>('/api/auth/logout', {
      method: 'POST',
    }),

  bootstrapAdmin: (payload: { name: string; username: string; password: string }) =>
    apiRequest<{ token: string; user: AuthUser; message: string }>('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { username: string; password: string }) =>
    apiRequest<{
      token: string;
      user: AuthUser;
      deviceId?: string;
      deviceUnlockEnrolled?: boolean;
      message: string;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        device_id: getOrCreateDeviceId(),
        device_label: getFriendlyDeviceLabel(),
      }),
    }),

  changePassword: (payload: { current_password: string; new_password: string }) =>
    apiRequest<{ token: string; user: AuthUser; message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminAccountCredentials: (payload: {
    current_password: string;
    new_username?: string;
    new_password?: string;
  }) =>
    apiRequest<{ token: string; user: AuthUser; message: string }>(
      '/api/auth/account/credentials',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  changePasswordWithCredentials: (payload: {
    username: string;
    current_password: string;
    new_password: string;
  }) =>
    apiRequest<{
      token: string;
      user: AuthUser;
      deviceId?: string;
      deviceUnlockEnrolled?: boolean;
      message: string;
    }>('/api/auth/change-password-with-credentials', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        device_id: getOrCreateDeviceId(),
        device_label: getFriendlyDeviceLabel(),
      }),
    }),

  googleAdminAuth: (payload: { idToken: string; new_password?: string }) =>
    apiRequest<{
      token: string;
      user: AuthUser;
      deviceId?: string;
      deviceUnlockEnrolled?: boolean;
      message: string;
    }>('/api/auth/google-admin', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        device_id: getOrCreateDeviceId(),
        device_label: getFriendlyDeviceLabel(),
      }),
    }),

  getMe: () => apiRequest<{ user: AuthUser }>('/api/auth/me'),

  // Enrolled Devices & WebAuthn Device Unlock
  listDevices: () =>
    apiRequest<{
      devices: EnrolledDeviceInfo[];
      sessions: ActiveSessionInfo[];
      currentDeviceEnrolled: boolean;
    }>(`/api/auth/devices?deviceId=${encodeURIComponent(getOrCreateDeviceId())}`),

  removeDevice: (credentialId: string) =>
    apiRequest<{
      ok: boolean;
      removedDeviceId: string;
      revokedCurrentSession: boolean;
      devices: EnrolledDeviceInfo[];
      sessions: ActiveSessionInfo[];
      message: string;
    }>(`/api/auth/devices/${encodeURIComponent(credentialId)}`, {
      method: 'DELETE',
    }),

  revokeSession: (sessionId: string) =>
    apiRequest<{
      ok: boolean;
      sessions: ActiveSessionInfo[];
      message: string;
    }>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),

  webAuthnRegisterOptions: (preferPlatform = true) =>
    apiRequest<{
      challengeId: string;
      options: unknown;
    }>('/api/auth/webauthn/register/options', {
      method: 'POST',
      body: JSON.stringify({
        device_id: getOrCreateDeviceId(),
        prefer_platform: preferPlatform,
      }),
    }),

  webAuthnRegisterVerify: (payload: { challengeId: string; response: unknown }) =>
    apiRequest<{
      verified: boolean;
      devices: EnrolledDeviceInfo[];
      message: string;
    }>('/api/auth/webauthn/register/verify', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        device_id: getOrCreateDeviceId(),
        device_label: getFriendlyDeviceLabel(),
      }),
    }),

  webAuthnAuthOptions: () =>
    apiRequest<{
      challengeId: string;
      options: unknown;
    }>('/api/auth/webauthn/authenticate/options', {
      method: 'POST',
      body: JSON.stringify({
        device_id: getOrCreateDeviceId(),
      }),
    }),

  webAuthnAuthVerify: (payload: { challengeId: string; response: unknown }) =>
    apiRequest<{
      token: string;
      user: AuthUser;
      message: string;
    }>('/api/auth/webauthn/authenticate/verify', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        device_id: getOrCreateDeviceId(),
      }),
    }),

  // Primary Google Drive Sync (Admin-only)
  getPrimaryDriveStatus: () =>
    apiRequest<{
      primary_drive_email: string;
      primary_drive_folder_label: string;
      primary_drive_file_id: string;
      sync_revision: number;
      primary_drive_last_synced_revision: number;
      primary_drive_last_synced_at: string;
      primary_drive_sync_status: PrimaryDriveSyncStatus;
      primary_drive_last_error: string;
      secondary_drive_email: string;
    }>('/api/drive/primary/status'),

  connectPrimaryDrive: (payload: { email: string; file_id?: string }) =>
    apiRequest<{ settings: AppSettings; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/drive/primary/connect',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  disconnectPrimaryDrive: () =>
    apiRequest<{ settings: AppSettings; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/drive/primary/disconnect',
      {
        method: 'POST',
      }
    ),

  getPrimaryDriveSnapshot: () =>
    apiRequest<{ snapshot: Record<string, unknown> }>('/api/drive/primary/snapshot'),

  confirmPrimaryDriveSync: (payload: {
    revision: number;
    file_id: string;
    checksum_sha256: string;
    email?: string;
  }) =>
    apiRequest<{ settings: AppSettings; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/drive/primary/confirm-sync',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  reportPrimaryDriveFailure: (error: string) =>
    apiRequest<{ settings: AppSettings; bootstrap: AdminBootstrapPayload }>(
      '/api/drive/primary/report-failure',
      {
        method: 'POST',
        body: JSON.stringify({ error }),
      }
    ),

  restoreFromPrimaryDrive: (payload: {
    snapshot: Record<string, unknown>;
    file_id?: string;
    email?: string;
  }) =>
    apiRequest<{
      preRestoreRecoveryFile: string;
      restoredOrders: number;
      restoredQuotations: number;
      restoredReceipts: number;
      restoredLeads: number;
      restoredPads: number;
      restoredIssuedPdfs: number;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>('/api/drive/primary/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Admin Bootstrap & Legacy Migration
  getAdminBootstrap: () => apiRequest<AdminBootstrapPayload>('/api/bootstrap'),

  migrateLegacyLocalStorage: (legacyData: unknown) =>
    apiRequest<{ importedOrders: number; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/migrate-local',
      {
        method: 'POST',
        body: JSON.stringify(legacyData),
      }
    ),

  // Customers & Building / Water Tank Profiles
  createCustomer: (payload: {
    name: string;
    phone: string;
    lead_source?: string;
    notes?: string;
  }) =>
    apiRequest<{ customer: CustomerProfile; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/customers',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  updateCustomer: (
    customerId: string,
    payload: { name: string; phone: string; lead_source?: string; notes?: string }
  ) =>
    apiRequest<{ customer: CustomerProfile; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/customers/${encodeURIComponent(customerId)}`,
      { method: 'PUT', body: JSON.stringify(payload) }
    ),

  createBuilding: (payload: {
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
  }) =>
    apiRequest<{ building: BuildingProfile; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/buildings',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  updateBuilding: (
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
  ) =>
    apiRequest<{ building: BuildingProfile; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/buildings/${encodeURIComponent(buildingId)}`,
      { method: 'PUT', body: JSON.stringify(payload) }
    ),

  deleteBuilding: (buildingId: string) =>
    apiRequest<{ bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/buildings/${encodeURIComponent(buildingId)}`,
      { method: 'DELETE' }
    ),

  // Supervisor Restricted Endpoints
  getSupervisorJobs: () =>
    apiRequest<{
      todayDhaka: string;
      endDateDhaka: string;
      jobs: SupervisorJobView[];
      companyLogoDataUrl: string;
    }>('/api/supervisor/jobs'),

  completeOrderAsSupervisor: (
    orderId: string,
    payload: {
      transport_cost: number | string;
      meals_cost: number | string;
      other_expenses: OtherExpenseItem[];
      full_bill_collected: boolean;
      confirmed_worker_ids?: string[];
    }
  ) =>
    apiRequest<{ job: SupervisorJobView; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/complete`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        queueOnOfflineLabel: `Complete Job ${orderId}`,
      }
    ),

  // Admin Orders, Conflict Check, Settlement Verification & Complaints
  checkScheduleConflicts: (payload: {
    supervisor_id: string;
    scheduled_date: string;
    scheduled_time: string;
    estimated_duration_mins?: number;
    scheduled_end_time?: string;
    exclude_order_id?: string;
  }) =>
    apiRequest<{ conflicts: ScheduleConflictItem[] }>('/api/orders/check-conflicts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createOrder: (payload: Record<string, unknown>) =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/orders',
      {
        method: 'POST',
        body: JSON.stringify(payload),
        queueOnOfflineLabel: 'Create Order',
      }
    ),

  updateOrder: (orderId: string, payload: Record<string, unknown>) =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}`,
      { method: 'PUT', body: JSON.stringify(payload) }
    ),

  updateOrderAdvance: (
    orderId: string,
    payload: { advance_given: number | string; supervisor_id?: string }
  ) =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/advance`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  changeOrderStatus: (orderId: string, newStatus: OrderStatus, note = '') =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/status`,
      { method: 'PATCH', body: JSON.stringify({ new_status: newStatus, note }) }
    ),

  completeOrderAsAdmin: (
    orderId: string,
    payload: {
      completion_date: string;
      transport_cost: number | string;
      meals_cost: number | string;
      other_expenses: OtherExpenseItem[];
      full_bill_collected: boolean;
      confirmed_worker_ids?: string[];
      followup_mode: FollowupMode;
      custom_value?: number;
      custom_unit?: FollowupUnit;
      followup_date?: string;
    }
  ) =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/complete`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        queueOnOfflineLabel: `Complete Order ${orderId}`,
      }
    ),

  correctCompletedFinancials: (
    orderId: string,
    payload: {
      completion_date?: string;
      price_bdt?: number | string;
      advance_given?: number | string;
      transport_cost: number | string;
      meals_cost: number | string;
      other_expenses: OtherExpenseItem[];
      reason: string;
    }
  ) =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/financials`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  confirmSettlement: (orderId: string, note = '') =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/settlement`,
      { method: 'POST', body: JSON.stringify({ note }) }
    ),

  recordSettlementEntry: (
    orderId: string,
    payload: {
      amount_bdt: number | string;
      entry_datetime?: string;
      payment_method?: PaymentMethod;
      reference?: string;
      note?: string;
      submission_key?: string;
    }
  ) =>
    apiRequest<{
      entry: SupervisorSettlementEntry;
      order: OrderRecord;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>(`/api/orders/${encodeURIComponent(orderId)}/settlement-entries`, {
      method: 'POST',
      body: JSON.stringify(payload),
      queueOnOfflineLabel: `Record Settlement (${orderId})`,
    }),

  rescheduleFollowup: (
    orderId: string,
    payload: {
      followup_mode: FollowupMode;
      base_date?: string;
      custom_value?: number;
      custom_unit?: FollowupUnit;
      followup_date?: string;
    }
  ) =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/followup`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
        queueOnOfflineLabel: `Reschedule Follow-Up (${orderId})`,
      }
    ),

  toggleFollowupDone: (orderId: string, isDone: boolean) =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/followup-done`,
      {
        method: 'PATCH',
        body: JSON.stringify({ is_done: isDone }),
        queueOnOfflineLabel: `Update Follow-Up (${orderId})`,
      }
    ),

  // Complaints & Return Visits
  createOrderComplaint: (
    orderId: string,
    payload: {
      complaint_date?: string;
      issue: string;
      action_taken?: string;
      notes?: string;
      status?: ComplaintStatus;
    }
  ) =>
    apiRequest<{
      complaint: OrderComplaintRecord;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>(`/api/orders/${encodeURIComponent(orderId)}/complaints`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateOrderComplaint: (
    complaintId: string,
    payload: {
      issue?: string;
      action_taken?: string;
      notes?: string;
      status?: ComplaintStatus;
    }
  ) =>
    apiRequest<{
      complaint: OrderComplaintRecord;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>(`/api/complaints/${encodeURIComponent(complaintId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  scheduleReturnVisit: (
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
    }
  ) =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/complaints/${encodeURIComponent(complaintId)}/return-visit`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  // Workers, Order Team & Per-Job Worker Pay
  createWorker: (payload: { name: string; phone?: string; is_active?: boolean; notes?: string }) =>
    apiRequest<{ worker: WorkerRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/workers',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  updateWorker: (
    workerId: string,
    payload: { name?: string; phone?: string; is_active?: boolean; notes?: string }
  ) =>
    apiRequest<{ worker: WorkerRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/workers/${encodeURIComponent(workerId)}`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  adminUpdateOrderWorkers: (
    orderId: string,
    payload: {
      assigned_workers: Array<{
        worker_id: string;
        agreed_pay_bdt: number | string;
        confirmed_worked: boolean;
      }>;
      reason?: string;
    }
  ) =>
    apiRequest<{ order: OrderRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/workers`,
      { method: 'PUT', body: JSON.stringify(payload) }
    ),

  markOrderWorkerPaid: (
    orderId: string,
    orderWorkerId: string,
    payload: {
      payment_date?: string;
      payment_method?: PaymentMethod;
      paid_by_role: 'admin' | 'supervisor';
      reference?: string;
      note?: string;
      submission_key?: string;
    }
  ) =>
    apiRequest<{
      workerRow: OrderWorkerAssignment;
      order: OrderRecord;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>(
      `/api/orders/${encodeURIComponent(orderId)}/workers/${encodeURIComponent(orderWorkerId)}/mark-paid`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        queueOnOfflineLabel: `Worker Payment (${orderId})`,
      }
    ),

  correctOrderWorkerPayment: (
    orderId: string,
    orderWorkerId: string,
    payload: {
      action: 'CORRECTED' | 'MARK_UNPAID';
      agreed_pay_bdt?: number | string;
      payment_date?: string;
      payment_method?: PaymentMethod;
      paid_by_role?: 'admin' | 'supervisor';
      reference?: string;
      reason: string;
    }
  ) =>
    apiRequest<{
      workerRow: OrderWorkerAssignment;
      order: OrderRecord;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>(
      `/api/orders/${encodeURIComponent(orderId)}/workers/${encodeURIComponent(orderWorkerId)}/payment`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  // Quotations & Quotation Follow-Ups
  saveQuotation: (payload: {
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
    lead_source?: string;
    referral_contact_type?: '' | 'agent' | 'caretaker';
    referral_contact_name?: string;
    referral_contact_phone?: string;
  }) =>
    apiRequest<{ quotation: QuotationRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/quotations',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  updateQuotationFollowup: (
    quotationId: string,
    payload: {
      status?: QuotationStatus;
      followup_date?: string;
      followup_note?: string;
      followup_done?: boolean;
      share_url?: string;
    }
  ) =>
    apiRequest<{ quotation: QuotationRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/quotations/${encodeURIComponent(quotationId)}/followup`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  convertQuotationToOrder: (
    quotationId: string,
    payload: {
      booking_date?: string;
      scheduled_date?: string;
      scheduled_time?: string;
      assigned_supervisor_id?: string;
      instructions?: string;
    }
  ) =>
    apiRequest<{
      alreadyConverted: boolean;
      order: OrderRecord;
      quotation: QuotationRecord;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>(`/api/quotations/${encodeURIComponent(quotationId)}/convert`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Money Receipts
  issueMoneyReceipt: (payload: {
    order_id: string;
    receipt_date?: string;
    payment_method: PaymentMethod;
    transaction_ref?: string;
    notes?: string;
  }) =>
    apiRequest<{
      alreadyIssued: boolean;
      receipt: MoneyReceiptRecord;
      order: OrderRecord;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>('/api/receipts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Excel (.xlsx) Report Downloads
  downloadReportXlsx: downloadReportBlob,

  // Prospects / Leads (Admin-only)
  checkDuplicatePhone: (phone: string, excludeLeadId = '') =>
    apiRequest<{
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
    }>(
      `/api/leads/check-phone?phone=${encodeURIComponent(phone)}&excludeLeadId=${encodeURIComponent(
        excludeLeadId
      )}`
    ),

  createLead: (payload: {
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
  }) =>
    apiRequest<{ lead: LeadRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/leads',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  updateLead: (
    leadId: string,
    payload: {
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
    }
  ) =>
    apiRequest<{ lead: LeadRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/leads/${encodeURIComponent(leadId)}`,
      { method: 'PUT', body: JSON.stringify(payload) }
    ),

  addLeadNote: (
    leadId: string,
    payload: {
      channel?: LeadChannel;
      note_text: string;
      stage?: LeadStage;
      next_followup_date?: string;
    }
  ) =>
    apiRequest<{
      lead: LeadRecord;
      note: LeadNoteRecord;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  rescheduleLeadFollowup: (
    leadId: string,
    payload: { next_followup_date: string; note?: string }
  ) =>
    apiRequest<{ lead: LeadRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/leads/${encodeURIComponent(leadId)}/followup`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  toggleLeadFollowupDone: (
    leadId: string,
    payload: { is_done?: boolean; next_followup_date?: string; note_text?: string }
  ) =>
    apiRequest<{ lead: LeadRecord; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/leads/${encodeURIComponent(leadId)}/followup-done`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    ),

  // Supervisors
  createSupervisor: (payload: {
    name: string;
    username: string;
    phone: string;
    password: string;
  }) =>
    apiRequest<{
      supervisor: SupervisorAccount;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>('/api/supervisors', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSupervisor: (
    id: string,
    payload: { name?: string; phone?: string; is_active?: boolean; password?: string }
  ) =>
    apiRequest<{
      supervisor: SupervisorAccount;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>(`/api/supervisors/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // General Business Expenses (Overhead)
  createOverhead: (payload: {
    expense_date: string;
    category: string;
    description: string;
    amount_bdt: number | string;
  }) =>
    apiRequest<{ bootstrap: AdminBootstrapPayload; message: string }>('/api/overhead', {
      method: 'POST',
      body: JSON.stringify(payload),
      queueOnOfflineLabel: `Business Expense (${payload.category})`,
    }),

  deleteOverhead: (id: string) =>
    apiRequest<{ bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/overhead/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  // Document Pads
  uploadPad: (
    padType: PadType,
    payload: {
      file_name: string;
      mime_type: string;
      image_data_url: string;
      fields: PadFieldConfig[];
    }
  ) =>
    apiRequest<{ pad: DocumentPadConfig; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/pads/${padType}`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  savePadFields: (padType: PadType, fields: PadFieldConfig[]) =>
    apiRequest<{ pad: DocumentPadConfig; bootstrap: AdminBootstrapPayload; message: string }>(
      `/api/pads/${padType}/fields`,
      { method: 'PATCH', body: JSON.stringify({ fields }) }
    ),

  deletePad: (padType: PadType) =>
    apiRequest<{ bootstrap: AdminBootstrapPayload; message: string }>(`/api/pads/${padType}`, {
      method: 'DELETE',
    }),

  // Company Branding Logo
  saveCompanyLogo: (payload: { file_name: string; mime_type: string; data_url: string }) =>
    apiRequest<{ settings: AppSettings; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/branding/logo',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  deleteCompanyLogo: () =>
    apiRequest<{ settings: AppSettings; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/branding/logo',
      { method: 'DELETE' }
    ),

  // Issued PDF Archive
  saveIssuedPdf: (payload: {
    doc_type: PadType;
    doc_id: string;
    file_name: string;
    pdf_base64: string;
  }) =>
    apiRequest<{ pdf: IssuedPdfSummary; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/issued-pdfs',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  getIssuedPdf: (docType: PadType, docId: string) =>
    apiRequest<{ pdf: IssuedPdfRecord }>(
      `/api/issued-pdfs/${encodeURIComponent(docType)}/${encodeURIComponent(docId)}`
    ),

  // Settings, Google Sync, Secondary Backup & Atomic Restore
  saveSettings: (payload: Record<string, unknown>) =>
    apiRequest<{ settings: AppSettings; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/settings',
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  syncWithGoogle: () =>
    apiRequest<{ bootstrap: AdminBootstrapPayload; message: string }>('/api/google/sync', {
      method: 'POST',
    }),

  sendTestEmail: () =>
    apiRequest<{ bootstrap: AdminBootstrapPayload; message: string }>('/api/google/test-email', {
      method: 'POST',
    }),

  runReminderCheck: () =>
    apiRequest<{ bootstrap: AdminBootstrapPayload; message: string }>('/api/reminders/check', {
      method: 'POST',
    }),

  verifyRemindersAfterRestore: () =>
    apiRequest<{ settings: AppSettings; bootstrap: AdminBootstrapPayload; message: string }>(
      '/api/reminders/verify-after-restore',
      { method: 'POST' }
    ),

  downloadBackup: (record = false) =>
    apiRequest<Record<string, unknown>>(`/api/backup${record ? '?record=1' : ''}`),

  validateBackup: (backupJson: Record<string, unknown>) =>
    apiRequest<{ summary: BackupValidationSummary }>('/api/backup/validate', {
      method: 'POST',
      body: JSON.stringify(backupJson),
    }),

  recordBackupEvent: (payload: {
    source: BackupHistoryRecord['source'];
    status: BackupHistoryRecord['status'];
    file_name: string;
    drive_file_id?: string;
    drive_account_email?: string;
    folder_name?: string;
    size_bytes?: number;
    checksum_sha256?: string;
    error_message?: string;
  }) =>
    apiRequest<{ record: BackupHistoryRecord; bootstrap: AdminBootstrapPayload }>(
      '/api/backup/record',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  runScheduledBackupNow: () =>
    apiRequest<{
      ok: boolean;
      fileName: string;
      pushedToSecondaryDrive: boolean;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>('/api/backup/run-scheduled', { method: 'POST' }),

  restoreBackup: (backupJson: Record<string, unknown>) =>
    apiRequest<{
      preRestoreRecoveryFile: string;
      restoredOrders: number;
      restoredQuotations: number;
      restoredReceipts: number;
      restoredLeads: number;
      restoredPads: number;
      restoredIssuedPdfs: number;
      bootstrap: AdminBootstrapPayload;
      message: string;
    }>('/api/restore', {
      method: 'POST',
      body: JSON.stringify(backupJson),
    }),
};
