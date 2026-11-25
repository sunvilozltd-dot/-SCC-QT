import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudUpload,
  Download,
  FolderOpen,
  HardDrive,
  History,
  LogOut,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { api } from '../services/apiClient';
import {
  connectSecondaryGoogleDrive,
  disconnectSecondaryGoogleDrive,
  downloadSecondaryDriveBackup,
  getSecondaryDriveMemorySession,
  listSecondaryDriveBackups,
  SecondaryDriveFileItem,
  uploadBackupToSecondaryDrive,
} from '../services/secondaryDriveClient';
import { AppSettings, BackupHistoryRecord, BackupValidationSummary } from '../types/order';
import { formatDateTimeEn, getTodayDhakaIso } from '../utils/dateAndPhone';

interface BackupRestoreSectionProps {
  settings: AppSettings;
  backupHistory: BackupHistoryRecord[];
  onSaveSettings: (payload: Record<string, unknown>) => Promise<void>;
  onRefreshBootstrap: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupRestoreSection({
  settings,
  backupHistory,
  onSaveSettings,
  onRefreshBootstrap,
  onNotify,
}: BackupRestoreSectionProps) {
  const [driveConnected, setDriveConnected] = useState(
    () => getSecondaryDriveMemorySession().connected
  );
  const [connectedEmail, setConnectedEmail] = useState(
    () => getSecondaryDriveMemorySession().email || settings.secondary_drive_email || ''
  );
  const [folderName, setFolderName] = useState(
    settings.secondary_drive_folder_name || 'SUNVILOZ Clean Care Backups'
  );
  const [driveFiles, setDriveFiles] = useState<SecondaryDriveFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Server-side daily auto-backup settings
  const [autoEnabled, setAutoEnabled] = useState(Boolean(settings.auto_backup_enabled));
  const [autoHour, setAutoHour] = useState(String(settings.auto_backup_hour ?? 2));
  const [secondaryWebappUrl, setSecondaryWebappUrl] = useState(
    settings.secondary_drive_webapp_url || ''
  );
  const [secondarySecret, setSecondarySecret] = useState('');
  const [savingAuto, setSavingAuto] = useState(false);

  // Busy flags
  const [connecting, setConnecting] = useState(false);
  const [backingUpDrive, setBackingUpDrive] = useState(false);
  const [backingUpScheduled, setBackingUpScheduled] = useState(false);
  const [downloadingLocal, setDownloadingLocal] = useState(false);

  // Restore validation state
  const [pendingRestoreJson, setPendingRestoreJson] = useState<Record<string, unknown> | null>(
    null
  );
  const [pendingRestoreLabel, setPendingRestoreLabel] = useState('');
  const [validationSummary, setValidationSummary] = useState<BackupValidationSummary | null>(null);
  const [confirmRestoreText, setConfirmRestoreText] = useState('');
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    setAutoEnabled(Boolean(settings.auto_backup_enabled));
    setAutoHour(String(settings.auto_backup_hour ?? 2));
    setSecondaryWebappUrl(settings.secondary_drive_webapp_url || '');
    if (settings.secondary_drive_folder_name) {
      setFolderName(settings.secondary_drive_folder_name);
    }
    if (settings.secondary_drive_email && !connectedEmail) {
      setConnectedEmail(settings.secondary_drive_email);
    }
  }, [settings, connectedEmail]);

  const refreshDriveFiles = async (folderId?: string, fName?: string) => {
    setLoadingFiles(true);
    try {
      const res = await listSecondaryDriveBackups(
        folderId || settings.secondary_drive_folder_id || undefined,
        fName || folderName
      );
      setDriveFiles(res.files);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not load Secondary Drive backups.',
        'error'
      );
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleConnectDrive = async () => {
    setConnecting(true);
    try {
      const info = await connectSecondaryGoogleDrive(
        folderName,
        settings.primary_drive_email || ''
      );
      setDriveConnected(true);
      setConnectedEmail(info.email);
      setFolderName(info.folderName);
      await onSaveSettings({
        secondary_drive_email: info.email,
        secondary_drive_folder_id: info.folderId,
        secondary_drive_folder_name: info.folderName,
      });
      onNotify(`Connected Secondary Google Drive: ${info.email}`, 'success');
      await refreshDriveFiles(info.folderId, info.folderName);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to connect Secondary Google Drive.',
        'error'
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectDrive = async () => {
    await disconnectSecondaryGoogleDrive();
    setDriveConnected(false);
    setDriveFiles([]);
    onNotify('Disconnected Secondary Google Drive browser session.', 'success');
  };

  const handleBackupNowToDrive = async () => {
    setBackingUpDrive(true);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `sunviloz_backup_${getTodayDhakaIso()}_${stamp}.json`;
    try {
      const pkg = await api.downloadBackup(false);

      const uploaded = await uploadBackupToSecondaryDrive({
        folderId: settings.secondary_drive_folder_id || undefined,
        folderName,
        fileName,
        backupObject: pkg,
      });

      await api.recordBackupEvent({
        source: 'secondary_drive_oauth',
        status: 'verified',
        file_name: uploaded.fileName,
        drive_file_id: uploaded.fileId,
        drive_account_email: uploaded.ownerEmail,
        folder_name: uploaded.folderName,
        size_bytes: uploaded.sizeBytes,
        checksum_sha256: String(pkg.checksum_sha256 || ''),
      });
      await onRefreshBootstrap();
      await refreshDriveFiles(uploaded.folderId, uploaded.folderName);
      onNotify(`Backup saved to Secondary Google Drive (${uploaded.fileName}).`, 'success');
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Backup to Secondary Google Drive failed.';
      try {
        await api.recordBackupEvent({
          source: 'secondary_drive_oauth',
          status: 'failed',
          file_name: fileName,
          drive_account_email: connectedEmail || settings.secondary_drive_email || '',
          folder_name: folderName,
          error_message: errMsg,
        });
        await onRefreshBootstrap();
      } catch {
        // Ignore secondary error while reporting failure
      }
      onNotify(errMsg, 'error');
    } finally {
      setBackingUpDrive(false);
    }
  };

  const handleRunServerBackupNow = async () => {
    setBackingUpScheduled(true);
    try {
      const res = await api.runScheduledBackupNow();
      await onRefreshBootstrap();
      onNotify(res.message || 'Server backup completed.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Server backup failed.', 'error');
    } finally {
      setBackingUpScheduled(false);
    }
  };

  const handleSaveAutoConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAuto(true);
    try {
      const payload: Record<string, unknown> = {
        auto_backup_enabled: autoEnabled,
        auto_backup_hour: Math.max(0, Math.min(23, Number(autoHour) || 2)),
        secondary_drive_folder_name: folderName.trim() || 'SUNVILOZ Clean Care Backups',
        secondary_drive_webapp_url: secondaryWebappUrl.trim(),
      };
      if (secondarySecret.trim()) {
        payload.secondary_drive_secret = secondarySecret.trim();
      }
      await onSaveSettings(payload);
      setSecondarySecret('');
      onNotify('Automatic backup settings saved.', 'success');
    } finally {
      setSavingAuto(false);
    }
  };

  const handleDownloadLocalJson = async () => {
    setDownloadingLocal(true);
    try {
      const pkg = await api.downloadBackup(true);
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const fileName = `sunviloz_clean_care_backup_${getTodayDhakaIso()}.json`;
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      await onRefreshBootstrap();
      onNotify(`Downloaded local backup file (${fileName}).`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to download backup.', 'error');
    } finally {
      setDownloadingLocal(false);
    }
  };

  const validateRestorePackage = async (jsonObj: Record<string, unknown>, label: string) => {
    try {
      const res = await api.validateBackup(jsonObj);
      setPendingRestoreJson(jsonObj);
      setPendingRestoreLabel(label);
      setValidationSummary(res.summary);
      setConfirmRestoreText('');
      if (!res.summary.valid) {
        onNotify('Backup validation reported issues. Review warnings carefully.', 'error');
      } else {
        onNotify('Backup file validated successfully. Review summary before restoring.', 'success');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Backup validation failed.', 'error');
    }
  };

  const handleLocalFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      await validateRestorePackage(parsed, file.name);
    } catch {
      onNotify('Selected file is not valid JSON.', 'error');
    }
  };

  const handleSelectDriveFileForRestore = async (file: SecondaryDriveFileItem) => {
    try {
      const parsed = await downloadSecondaryDriveBackup(file.id);
      await validateRestorePackage(parsed, `Secondary Drive: ${file.name}`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to download backup from Secondary Drive.',
        'error'
      );
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestoreJson || confirmRestoreText.trim().toUpperCase() !== 'RESTORE') return;
    setRestoring(true);
    try {
      const res = await api.restoreBackup(pendingRestoreJson);
      setPendingRestoreJson(null);
      setValidationSummary(null);
      setConfirmRestoreText('');
      await onRefreshBootstrap();
      onNotify(
        res.message || 'Database restored safely. Automated reminders paused until verified.',
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Restore failed.', 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 1. Secondary Google Drive */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
              <Cloud className="h-5 w-5 text-[#0F766E]" />
              Secondary Google Drive Backup (Independent Account)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Authorize a separate Google account to store private, owned full backup JSON files
              (excluding passwords, hashes, and OAuth secrets).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {driveConnected ? (
              <>
                <button
                  type="button"
                  disabled={backingUpDrive}
                  onClick={handleBackupNowToDrive}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  <CloudUpload className="h-4 w-4" />
                  {backingUpDrive ? 'Uploading...' : 'Backup Now'}
                </button>
                <button
                  type="button"
                  disabled={loadingFiles}
                  onClick={() => refreshDriveFiles()}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingFiles ? 'animate-spin' : ''}`} />
                  Refresh Files
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectDrive}
                  className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={connecting}
                onClick={handleConnectDrive}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132f55] disabled:opacity-50"
              >
                <Cloud className="h-4 w-4" />
                {connecting ? 'Connecting...' : 'Connect Secondary Google Account'}
              </button>
            )}
          </div>
        </div>

        {/* Connected Accounts Separation Summary */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Primary Google Drive Account
            </div>
            <div className="mt-0.5 font-mono font-semibold text-[#0B1F3A]">
              {settings.primary_drive_email || 'Not connected'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              Live business sync (managed under Settings → Google Drive)
            </div>
          </div>
          <div className="border-t border-slate-200 pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Secondary Backup Drive Account
            </div>
            <div className="mt-0.5 font-mono font-semibold text-[#0F766E]">
              {connectedEmail || settings.secondary_drive_email || 'Not connected'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {driveConnected
                ? 'Active browser OAuth session · Independent recovery works even if Primary Drive is unavailable'
                : 'Must be a DIFFERENT Google account from Primary Drive'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-500">Secondary Account</div>
            <div className="mt-0.5 truncate font-mono font-semibold text-[#0B1F3A]">
              {connectedEmail || 'Not connected'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {driveConnected ? 'Active browser OAuth session' : 'Click Connect to authorize'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-500">Private Backup Folder</div>
            <div className="mt-0.5 flex items-center gap-1 font-semibold text-[#0B1F3A]">
              <FolderOpen className="h-3.5 w-3.5 text-[#0F766E]" />
              {folderName}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-500">Last Successful Backup</div>
            <div className="mt-0.5 font-semibold text-[#0B1F3A]">
              {settings.last_verified_backup_at
                ? formatDateTimeEn(settings.last_verified_backup_at)
                : 'No backup yet'}
            </div>
            {settings.last_verified_backup_file && (
              <div className="truncate font-mono text-[10px] text-slate-500">
                {settings.last_verified_backup_file}
              </div>
            )}
          </div>
          <div
            className={`rounded-lg border p-3 ${
              settings.last_backup_error
                ? 'border-red-200 bg-red-50/70'
                : 'border-slate-200 bg-slate-50'
            }`}
          >
            <div className={settings.last_backup_error ? 'text-red-700 font-semibold' : 'text-slate-500'}>
              Latest Backup Error
            </div>
            <div
              className={`mt-0.5 font-medium ${
                settings.last_backup_error ? 'text-red-800' : 'text-emerald-700'
              }`}
            >
              {settings.last_backup_error || 'None (Healthy)'}
            </div>
            {settings.last_backup_error && (
              <div className="mt-0.5 text-[10px] text-red-700">
                Previous verified backup remains intact.
              </div>
            )}
          </div>
        </div>

        {/* Drive Files List */}
        {driveConnected && (
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Backup Versions in Secondary Google Drive ({driveFiles.length})
            </div>
            {driveFiles.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                No backup files listed yet. Click "Backup Now" or "Refresh Files".
              </p>
            ) : (
              <div className="mt-2 max-h-56 overflow-y-auto space-y-1.5">
                {driveFiles.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="font-mono font-semibold text-[#0B1F3A]">{f.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {formatBytes(f.size)} · {formatDateTimeEn(f.createdTime)} · Owner:{' '}
                        {f.ownerEmail}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectDriveFileForRestore(f)}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Validate & Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Server-Side Automatic Daily Backup */}
      <form
        onSubmit={handleSaveAutoConfig}
        className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-[#0B1F3A]">
              Server-Side Daily Automatic Backup
            </h2>
            <p className="text-xs text-slate-500">
              Optional unattended daily backup pushed to your secondary Google Drive Apps Script
              webhook (and saved locally on server).
            </p>
          </div>
          <button
            type="button"
            disabled={backingUpScheduled}
            onClick={handleRunServerBackupNow}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${backingUpScheduled ? 'animate-spin' : ''}`} />
            Run Scheduled Backup Now
          </button>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-[11px] text-amber-950">
          <strong>Important Scheduling &amp; Storage Note:</strong> Server-scheduled daily backups
          depend on an active running server process (or an external scheduled cron job triggering
          backups). For production deployments, point{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">DB_PATH</code> to a
          persistent mounted volume so your SQLite database survives restarts and redeployments.
          Failed backup runs never replace the last verified backup.
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-[#0B1F3A]">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => setAutoEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#0F766E]"
            />
            Enable Daily Auto Backup
          </label>
          <div>
            <label className="text-xs font-semibold text-slate-700">
              Run Hour (Asia/Dhaka, 0–23)
            </label>
            <input
              type="number"
              min="0"
              max="23"
              value={autoHour}
              onChange={(e) => setAutoHour(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">Backup Folder Name</label>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-700">
              Secondary Drive Webhook URL (Optional)
            </label>
            <input
              type="url"
              value={secondaryWebappUrl}
              onChange={(e) => setSecondaryWebappUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">
              Secondary Webhook Secret (Leave blank to keep existing)
            </label>
            <input
              type="password"
              value={secondarySecret}
              onChange={(e) => setSecondarySecret(e.target.value)}
              placeholder={
                settings.secondary_drive_secret_configured ? '•••••••• (Configured)' : 'Optional'
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
        </div>

        <div>
          <button
            type="submit"
            disabled={savingAuto}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {savingAuto ? 'Saving...' : 'Save Backup Schedule'}
          </button>
        </div>
      </form>

      {/* 3. Local Backup Download & Upload Restore */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
              <HardDrive className="h-5 w-5 text-[#0F766E]" />
              Local Backup File & Atomic Restore
            </h2>
            <p className="text-xs text-slate-500">
              Download a full verified JSON backup to your device or upload a backup file to restore
              atomically (a pre-restore recovery snapshot is created automatically).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={downloadingLocal}
              onClick={handleDownloadLocalJson}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {downloadingLocal ? 'Preparing...' : 'Download JSON Backup'}
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#132f55]">
              <Upload className="h-4 w-4" />
              Upload Backup to Restore
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleLocalFileUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Restore Preview & Confirmation Box */}
        {validationSummary && pendingRestoreJson && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-amber-950">
                {validationSummary.valid ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-700" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                )}
                Restore Preview: {pendingRestoreLabel}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingRestoreJson(null);
                  setValidationSummary(null);
                }}
                className="font-semibold text-slate-600 hover:underline"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {[
                ['Orders', validationSummary.counts.orders],
                ['Customers', validationSummary.counts.customers],
                ['Buildings', validationSummary.counts.buildings],
                ['Prospects', validationSummary.counts.leads],
                ['Quotations', validationSummary.counts.quotations],
                ['Receipts', validationSummary.counts.receipts],
                ['Workers', validationSummary.counts.workers],
                ['Order Workers', validationSummary.counts.order_workers],
                ['Settlements', validationSummary.counts.settlement_entries],
                ['Complaints', validationSummary.counts.complaints],
                ['Expenses', validationSummary.counts.overhead],
                ['Issued PDFs', validationSummary.counts.issued_pdfs],
              ].map(([label, count]) => (
                <div key={String(label)} className="rounded-lg bg-white p-2 border border-amber-200">
                  <div className="text-[10px] text-slate-500">{label}</div>
                  <div className="font-bold text-[#0B1F3A]">{String(count)}</div>
                </div>
              ))}
            </div>

            <div className="text-[11px] text-amber-900">
              Schema v{validationSummary.schema_version} · Exported:{' '}
              {formatDateTimeEn(validationSummary.exported_at)} · Checksum:{' '}
              <strong>{validationSummary.checksum_verified ? 'Verified' : 'Unverified'}</strong>
            </div>

            {validationSummary.warnings.length > 0 && (
              <ul className="list-disc pl-5 text-red-700">
                {validationSummary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                type="text"
                value={confirmRestoreText}
                onChange={(e) => setConfirmRestoreText(e.target.value)}
                placeholder='Type "RESTORE" to confirm'
                className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-mono font-bold"
              />
              <button
                type="button"
                disabled={
                  restoring ||
                  !validationSummary.valid ||
                  confirmRestoreText.trim().toUpperCase() !== 'RESTORE'
                }
                onClick={handleConfirmRestore}
                className="rounded-lg bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-40"
              >
                {restoring ? 'Restoring...' : 'Confirm Atomic Restore'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Backup History */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#0B1F3A]">
          <History className="h-4 w-4 text-slate-500" />
          Backup History ({backupHistory.length})
        </h3>
        {backupHistory.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No backup events recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-500">
                  <th className="px-3 py-2">Date & Time</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">File Name</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Status &amp; Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backupHistory.slice(0, 20).map((b) => (
                  <tr key={b.backup_id}>
                    <td className="px-3 py-2 text-slate-600">{formatDateTimeEn(b.created_at)}</td>
                    <td className="px-3 py-2 font-semibold">{b.source}</td>
                    <td className="px-3 py-2 font-mono">{b.file_name}</td>
                    <td className="px-3 py-2">{formatBytes(b.size_bytes)}</td>
                    <td className="px-3 py-2">
                      {b.status === 'verified' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Verified
                        </span>
                      ) : (
                        <div>
                          <span className="rounded bg-red-50 px-2 py-0.5 font-semibold text-red-700">
                            Failed
                          </span>
                          {b.error_message && (
                            <div className="mt-1 text-[11px] text-red-700">{b.error_message}</div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
