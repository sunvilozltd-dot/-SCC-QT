import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Clock,
  Cloud,
  CloudUpload,
  Eye,
  EyeOff,
  FileCheck2,
  Globe,
  KeyRound,
  Mail,
  MapPin,
  Palette,
  Phone,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { api, isAppsScriptRuntime, setAuthToken } from '../services/apiClient';
import {
  AppSettings,
  AuthUser,
  BackupHistoryRecord,
  DocumentPadConfig,
  FollowupUnit,
  PadFieldConfig,
  PadType,
  ReminderLogRecord,
} from '../types/order';
import {
  COMPANY_ADDRESS,
  COMPANY_EMAIL,
  COMPANY_NAME,
  COMPANY_PHONE,
  COMPANY_WEBSITE,
} from '../utils/companyConstants';
import { formatDateTimeEn } from '../utils/dateAndPhone';
import { BackupRestoreSection } from './BackupRestoreSection';
import { BrandingSection } from './BrandingSection';
import { DocumentPadsEditor } from './DocumentPadsEditor';
import { EnrolledDevicesPanel } from './EnrolledDevicesPanel';
import { PrimaryDriveSection } from './PrimaryDriveSection';
import { PWAInstallButton } from './PWAInstallButton';

export type SettingsTab = 'general' | 'google_drive' | 'account' | 'branding' | 'pads' | 'backup';

interface SettingsViewProps {
  currentUser: AuthUser;
  initialTab?: SettingsTab;
  activeSupervisorsCount: number;
  settings: AppSettings;
  pads: Record<PadType, DocumentPadConfig | null>;
  reminderLogs: ReminderLogRecord[];
  backupHistory: BackupHistoryRecord[];
  onOpenSupervisors: () => void;
  onUserUpdated: (user: AuthUser) => void;
  onDeviceEnrollmentChanged?: (enrolled: boolean) => void;
  onCurrentSessionRevoked?: () => void;
  onSaveSettings: (payload: Record<string, unknown>) => Promise<void>;
  onSaveCompanyLogo: (payload: {
    file_name: string;
    mime_type: string;
    data_url: string;
  }) => Promise<void>;
  onDeleteCompanyLogo: () => Promise<void>;
  onUploadPad: (
    padType: PadType,
    payload: {
      file_name: string;
      mime_type: string;
      image_data_url: string;
      fields: PadFieldConfig[];
    }
  ) => Promise<void>;
  onSavePadFields: (padType: PadType, fields: PadFieldConfig[]) => Promise<void>;
  onDeletePad: (padType: PadType) => Promise<void>;
  onSyncGoogle: () => Promise<void>;
  onSendTestEmail: () => Promise<void>;
  onRunReminderCheck: () => Promise<void>;
  onVerifyRemindersAfterRestore: () => Promise<void>;
  onRefreshBootstrap: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function SettingsView({
  currentUser,
  initialTab = 'general',
  activeSupervisorsCount,
  settings,
  pads,
  reminderLogs,
  backupHistory,
  onOpenSupervisors,
  onUserUpdated,
  onDeviceEnrollmentChanged,
  onCurrentSessionRevoked,
  onSaveSettings,
  onSaveCompanyLogo,
  onDeleteCompanyLogo,
  onUploadPad,
  onSavePadFields,
  onDeletePad,
  onSyncGoogle,
  onSendTestEmail,
  onRunReminderCheck,
  onVerifyRemindersAfterRestore,
  onRefreshBootstrap,
  onNotify,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // General & Reminders state
  const [defaultVal, setDefaultVal] = useState(String(settings.default_followup_value || 6));
  const [defaultUnit, setDefaultUnit] = useState<FollowupUnit>(
    settings.default_followup_unit || 'months'
  );
  const [reminderEmail, setReminderEmail] = useState(
    settings.reminder_email || 'sunvilozltd@gmail.com'
  );
  const [dailyHour, setDailyHour] = useState(String(settings.daily_reminder_hour ?? 9));
  const [conflictBuffer, setConflictBuffer] = useState(
    String(settings.schedule_conflict_buffer_mins ?? 30)
  );
  const [webappUrl, setWebappUrl] = useState(settings.google_webapp_url || '');
  const [syncSecret, setSyncSecret] = useState('');
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [busyAction, setBusyAction] = useState('');

  // Account Credentials (Admin username + password with current password re-authentication)
  const [newUsername, setNewUsername] = useState(currentUser.username);
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showCurPass, setShowCurPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [savingPass, setSavingPass] = useState(false);
  const [passError, setPassError] = useState('');

  useEffect(() => {
    setNewUsername(currentUser.username);
  }, [currentUser.username]);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGeneral(true);
    try {
      const payload: Record<string, unknown> = {
        default_followup_value: Math.max(1, Number(defaultVal) || 6),
        default_followup_unit: defaultUnit,
        reminder_email: reminderEmail.trim(),
        daily_reminder_hour: Math.max(0, Math.min(23, Number(dailyHour) || 9)),
        schedule_conflict_buffer_mins: Math.max(0, Math.min(180, Number(conflictBuffer) || 0)),
        google_webapp_url: webappUrl.trim(),
      };
      if (syncSecret.trim()) {
        payload.google_sync_secret = syncSecret.trim();
      }
      await onSaveSettings(payload);
      setSyncSecret('');
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleUpdateAccountCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    const trimmedUsername = newUsername.trim().toLowerCase();
    const usernameChanged = trimmedUsername !== currentUser.username.trim().toLowerCase();
    const passwordChanged = newPass.length > 0;

    if (!curPass) {
      setPassError('Current password is required to verify your identity.');
      return;
    }
    if (!usernameChanged && !passwordChanged) {
      setPassError('Enter a new admin username or a new password to update.');
      return;
    }
    if (usernameChanged && trimmedUsername.length < 3) {
      setPassError('Admin username must be at least 3 characters.');
      return;
    }
    if (passwordChanged) {
      if (newPass.length < 6) {
        setPassError('New password must be at least 6 characters.');
        return;
      }
      if (newPass !== confirmPass) {
        setPassError('New password and confirmation do not match.');
        return;
      }
      if (curPass === newPass) {
        setPassError('New password must be different from your current password.');
        return;
      }
    }

    setSavingPass(true);
    try {
      const res = await api.updateAdminAccountCredentials({
        current_password: curPass,
        ...(usernameChanged ? { new_username: trimmedUsername } : {}),
        ...(passwordChanged ? { new_password: newPass } : {}),
      });
      setAuthToken(res.token);
      onUserUpdated(res.user);
      setCurPass('');
      setNewPass('');
      setConfirmPass('');
      onNotify(res.message || 'Admin account credentials updated.', 'success');
    } catch (err) {
      setPassError(err instanceof Error ? err.message : 'Failed to update admin credentials.');
    } finally {
      setSavingPass(false);
    }
  };

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusyAction(key);
    try {
      await fn();
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0B1F3A]">Settings</h1>
        <p className="text-sm text-slate-500">
          Configure Primary Google Drive sync, Secondary Backup &amp; Restore, admin credentials,
          device unlock, mobile installation, branding, and document pads.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: 'general', label: 'General & Reminders', icon: Clock },
            { key: 'google_drive', label: 'Google Drive', icon: Cloud },
            { key: 'account', label: 'Account & Security', icon: KeyRound },
            { key: 'branding', label: 'Branding & Company Info', icon: Palette },
            { key: 'pads', label: 'Quotation & Receipt Pads', icon: FileCheck2 },
            { key: 'backup', label: 'Backup & Restore', icon: CloudUpload },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: General & Reminders */}
      {activeTab === 'general' && (
        <div className="space-y-5">
          {settings.reminders_paused_after_restore && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <div>
                <strong>Reminders Paused After Restore:</strong> Verify your restored data before
                re-enabling automated daily reminder checks.
              </div>
              <button
                type="button"
                disabled={busyAction === 'verify'}
                onClick={() => runAction('verify', onVerifyRemindersAfterRestore)}
                className="rounded-lg bg-amber-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {busyAction === 'verify' ? 'Resuming...' : 'Verify & Resume Reminders'}
              </button>
            </div>
          )}

          <form
            onSubmit={handleSaveGeneral}
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
          >
            <h2 className="text-base font-bold text-[#0B1F3A]">
              Operational Defaults & Primary Google Sync
            </h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Default Repeat Follow-Up Interval
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="number"
                    min="1"
                    value={defaultVal}
                    onChange={(e) => setDefaultVal(e.target.value)}
                    className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <select
                    value={defaultUnit}
                    onChange={(e) => setDefaultUnit(e.target.value as FollowupUnit)}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm"
                  >
                    <option value="months">Months</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Schedule Conflict Buffer (Minutes)
                </label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={conflictBuffer}
                  onChange={(e) => setConflictBuffer(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Travel/setup gap between two jobs assigned to the same supervisor.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Daily Reminder Hour (Asia/Dhaka, 0–23)
                </label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={dailyHour}
                  onChange={(e) => setDailyHour(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Owner / Reminder Recipient Email
                </label>
                <input
                  type="email"
                  value={reminderEmail}
                  onChange={(e) => setReminderEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              {isAppsScriptRuntime() ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 flex flex-col justify-center">
                  <div className="font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    Connected Natively via Google Apps Script
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-emerald-800">
                    Business records save directly to your private Google Sheet and PDFs/backups
                    archive directly to your private Google Drive — no backend URL required.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Primary Google Apps Script Web App URL (Local Preview Only)
                  </label>
                  <input
                    type="url"
                    value={webappUrl}
                    onChange={(e) => setWebappUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              )}
            </div>

            {!isAppsScriptRuntime() && (
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Primary Sync Shared Secret (Leave blank to keep existing)
                </label>
                <input
                  type="password"
                  value={syncSecret}
                  onChange={(e) => setSyncSecret(e.target.value)}
                  placeholder={
                    settings.google_sync_configured ? '•••••••• (Configured)' : 'Enter secret'
                  }
                  className="mt-1 max-w-md w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={savingGeneral}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {savingGeneral ? 'Saving...' : 'Save Settings'}
              </button>
              <button
                type="button"
                disabled={busyAction === 'sync'}
                onClick={() => runAction('sync', onSyncGoogle)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${busyAction === 'sync' ? 'animate-spin' : ''}`}
                />
                {isAppsScriptRuntime() ? 'Save Drive Snapshot Now' : 'Sync Primary Google Drive'}
              </button>
              <button
                type="button"
                disabled={busyAction === 'test'}
                onClick={() => runAction('test', onSendTestEmail)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                Send Test Email
              </button>
              <button
                type="button"
                disabled={busyAction === 'rem'}
                onClick={() => runAction('rem', onRunReminderCheck)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Run Reminder Check Now
              </button>
            </div>
          </form>

          {/* Reminder Logs */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-[#0B1F3A]">
              Recent Email Reminder Logs ({reminderLogs.length})
            </h3>
            {reminderLogs.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No reminder emails sent yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-500">
                      <th className="px-3 py-2">Sent At</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2">Recipient</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reminderLogs.slice(0, 20).map((log) => (
                      <tr key={log.log_id}>
                        <td className="px-3 py-2 text-slate-600">
                          {formatDateTimeEn(log.sent_at)}
                        </td>
                        <td className="px-3 py-2 font-semibold">{log.send_type}</td>
                        <td className="px-3 py-2">
                          {log.order_id} · {log.customer_name}
                        </td>
                        <td className="px-3 py-2 font-mono">{log.recipient_email}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded px-2 py-0.5 font-semibold ${
                              log.status === 'SENT'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 1B: Google Drive (Primary Drive) */}
      {activeTab === 'google_drive' && (
        <PrimaryDriveSection
          settings={settings}
          onBootstrapUpdated={onRefreshBootstrap}
          onNotify={onNotify}
        />
      )}

      {/* TAB 2: Account & Security */}
      {activeTab === 'account' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <form
              onSubmit={handleUpdateAccountCredentials}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-[#0F766E]">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#0B1F3A]">
                    Admin Username &amp; Password
                  </h2>
                  <p className="text-xs text-slate-500">
                    Signed in as <strong className="font-mono">{currentUser.username}</strong> ·
                    Re-authentication required
                  </p>
                </div>
              </div>

              {passError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                  {passError}
                </div>
              )}

              <div className="space-y-3 text-sm">
                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Admin Username / Email
                  </label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="e.g. scc@gmail.com"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Changes are preserved across server restarts and require your current password.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Current Password (Required to Verify) *
                  </label>
                  <div className="relative mt-1">
                    <input
                      name="settings_current_password_verify"
                      type={showCurPass ? 'text' : 'password'}
                      required
                      autoComplete="off"
                      value={curPass}
                      onChange={(e) => setCurPass(e.target.value)}
                      placeholder="Enter current password"
                      className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-10 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurPass((v) => !v)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showCurPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    New Password (Optional, min 6 characters)
                  </label>
                  <div className="relative mt-1">
                    <input
                      type={showNewPass ? 'text' : 'password'}
                      minLength={6}
                      autoComplete="new-password"
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      placeholder="Leave blank to keep current password"
                      className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-10 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPass((v) => !v)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {newPass.length > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-slate-700">
                      Confirm New Password *
                    </label>
                    <input
                      type={showNewPass ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={confirmPass}
                      onChange={(e) => setConfirmPass(e.target.value)}
                      placeholder="Re-enter new password"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={savingPass}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {savingPass ? 'Saving...' : 'Save Admin Credentials'}
              </button>
            </form>

            <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                    <UserCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[#0B1F3A]">Supervisor Login Accounts</h2>
                    <p className="text-xs text-slate-500">
                      Active supervisor accounts: <strong>{activeSupervisorsCount}</strong>
                    </p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-600">
                  Create individual login accounts for your field supervisors with their own username
                  and password. Resetting a supervisor&apos;s password or deactivating their account
                  immediately revokes all active mobile sessions and device unlock credentials.
                </p>
              </div>
              <div>
                <button
                  type="button"
                  onClick={onOpenSupervisors}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#132f55]"
                >
                  <UserCheck className="h-4 w-4" />
                  Create &amp; Manage Supervisor Logins
                </button>
              </div>
            </div>
          </div>

          <EnrolledDevicesPanel
            onNotify={onNotify}
            onEnrollmentChanged={onDeviceEnrollmentChanged}
            onCurrentSessionRevoked={onCurrentSessionRevoked}
          />

          <PWAInstallButton variant="card" onNotify={onNotify} />
        </div>
      )}

      {/* TAB 3: Branding & Official Contact Info */}
      {activeTab === 'branding' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
              <Building2 className="h-5 w-5 text-[#0F766E]" />
              Official Company Details (Printed on Quotations & Money Receipts)
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0F766E]" />
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">
                    Company Address
                  </div>
                  <div className="font-semibold text-[#0B1F3A]">{COMPANY_ADDRESS}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
                <Globe className="mt-0.5 h-4 w-4 shrink-0 text-[#0F766E]" />
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">Website</div>
                  <div className="font-semibold text-[#0B1F3A]">{COMPANY_WEBSITE}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-[#0F766E]" />
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">Hotline</div>
                  <div className="font-mono font-semibold text-[#0B1F3A]">{COMPANY_PHONE}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#0F766E]" />
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">Email</div>
                  <div className="font-semibold text-[#0B1F3A]">{COMPANY_EMAIL}</div>
                </div>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {COMPANY_NAME} documents, stamps, and PDF exports automatically use these exact
              contact details.
            </p>
          </div>

          <BrandingSection
            settings={settings}
            onSaveLogo={onSaveCompanyLogo}
            onDeleteLogo={onDeleteCompanyLogo}
            onNotify={onNotify}
          />
        </div>
      )}

      {/* TAB 4: Document Pads */}
      {activeTab === 'pads' && (
        <DocumentPadsEditor
          pads={pads}
          companyLogoDataUrl={settings.company_logo_data_url}
          onUploadPad={onUploadPad}
          onSaveFields={onSavePadFields}
          onDeletePad={onDeletePad}
          onNotify={onNotify}
        />
      )}

      {/* TAB 5: Backup & Restore */}
      {activeTab === 'backup' && (
        <BackupRestoreSection
          settings={settings}
          backupHistory={backupHistory}
          onSaveSettings={onSaveSettings}
          onRefreshBootstrap={onRefreshBootstrap}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
