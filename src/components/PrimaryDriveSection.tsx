import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cloud,
  CloudDownload,
  CloudUpload,
  FolderLock,
  History,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api, isAppsScriptRuntime } from '../services/apiClient';
import {
  clearPrimaryDriveMemorySession,
  connectPrimaryGoogleDrive,
  downloadPrimaryDriveSnapshot,
  getPrimaryDriveMemorySession,
  listPrimaryDriveVersions,
  PrimaryDriveVersionFile,
  syncSnapshotToPrimaryDrive,
} from '../services/primaryDriveClient';
import { AppSettings } from '../types/order';
import { formatDateTimeEn } from '../utils/dateAndPhone';

interface PrimaryDriveSectionProps {
  settings: AppSettings;
  onBootstrapUpdated: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function PrimaryDriveSection({
  settings,
  onBootstrapUpdated,
  onNotify,
}: PrimaryDriveSectionProps) {
  const inGasRuntime = isAppsScriptRuntime();
  const [browserConnected, setBrowserConnected] = useState(
    () => inGasRuntime || getPrimaryDriveMemorySession().connected
  );
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versions, setVersions] = useState<PrimaryDriveVersionFile[]>([]);
  const [conflictInfo, setConflictInfo] = useState<{
    remoteRevision: number;
    remoteFileId: string;
    remoteModifiedTime: string;
  } | null>(null);

  // Explicit confirmation dialog state before overwriting workspace from Primary Drive
  const [pendingLoadFile, setPendingLoadFile] = useState<PrimaryDriveVersionFile | null>(null);
  const [pendingLoadSnapshot, setPendingLoadSnapshot] = useState<Record<string, unknown> | null>(
    null
  );
  const [confirmLoadText, setConfirmLoadText] = useState('');
  const [loadingRemote, setLoadingRemote] = useState(false);

  const refreshVersions = async () => {
    if (!inGasRuntime && !getPrimaryDriveMemorySession().connected) return;
    setLoadingVersions(true);
    try {
      if (inGasRuntime) {
        const res = await api.listPrimaryDriveGasSnapshots();
        setVersions(res.versions || []);
      } else {
        const files = await listPrimaryDriveVersions();
        setVersions(files);
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to list Primary Drive versions.',
        'error'
      );
    } finally {
      setLoadingVersions(false);
    }
  };

  useEffect(() => {
    setBrowserConnected(inGasRuntime || getPrimaryDriveMemorySession().connected);
    if (inGasRuntime) {
      void refreshVersions();
    }
  }, [settings.primary_drive_email, inGasRuntime]);

  const handleConnectPrimaryDrive = async () => {
    setConnecting(true);
    setConflictInfo(null);
    try {
      const info = await connectPrimaryGoogleDrive({
        disallowEmail: settings.secondary_drive_email || '',
        emailHint: settings.primary_drive_email || '',
      });
      setBrowserConnected(true);
      const res = await api.connectPrimaryDrive({
        email: info.email,
        file_id: info.latestFileId || undefined,
      });
      await onBootstrapUpdated();
      onNotify(res.message, 'success');
      await refreshVersions();

      if (info.hasRemoteData && info.remoteRevision > settings.sync_revision) {
        onNotify(
          `Found newer verified data (v${info.remoteRevision}) in Primary Drive. Use "Load Verified Data" below if this is a fresh deployment.`,
          'success'
        );
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not connect Primary Google Drive.',
        'error'
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectPrimaryDrive = async () => {
    if (inGasRuntime) return;
    clearPrimaryDriveMemorySession();
    setBrowserConnected(false);
    setVersions([]);
    setConflictInfo(null);
    try {
      const res = await api.disconnectPrimaryDrive();
      await onBootstrapUpdated();
      onNotify(res.message, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to disconnect Primary Drive.', 'error');
    }
  };

  const handleSyncNow = async (forceOverwrite = false) => {
    if (inGasRuntime) {
      setSyncing(true);
      try {
        const res = await api.savePrimaryDriveGasSnapshot();
        await onBootstrapUpdated();
        await refreshVersions();
        onNotify(res.message || 'Verified snapshot saved to Primary Google Drive.', 'success');
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Primary Drive snapshot failed.', 'error');
      } finally {
        setSyncing(false);
      }
      return;
    }

    if (!getPrimaryDriveMemorySession().connected) {
      onNotify('Authorize your Primary Google Drive session first.', 'error');
      return;
    }
    setSyncing(true);
    setConflictInfo(null);
    try {
      const { snapshot } = await api.getPrimaryDriveSnapshot();
      const result = await syncSnapshotToPrimaryDrive({
        snapshot,
        expectedBaseRevision: settings.primary_drive_last_synced_revision || 0,
        forceOverwrite,
      });

      if (result.status === 'conflict') {
        setConflictInfo({
          remoteRevision: result.remoteRevision || 0,
          remoteFileId: result.remoteFileId || '',
          remoteModifiedTime: result.remoteModifiedTime || '',
        });
        await api.reportPrimaryDriveFailure(
          `Revision conflict: Primary Drive has newer revision v${result.remoteRevision} from another device. Load remote data or confirm overwrite.`
        );
        await onBootstrapUpdated();
        onNotify(
          `Sync paused: Primary Drive has newer revision v${result.remoteRevision}. Review conflict options below.`,
          'error'
        );
        return;
      }

      // Mark "Saved to Primary Drive" ONLY AFTER Google confirms the write
      const confirmed = await api.confirmPrimaryDriveSync({
        revision: result.revision || Number(snapshot.sync_revision || 1),
        file_id: result.fileId || '',
        checksum_sha256: result.checksumSha256 || String(snapshot.integrity_sha256 || ''),
        email: result.email || settings.primary_drive_email,
      });
      await onBootstrapUpdated();
      await refreshVersions();
      onNotify(confirmed.message, 'success');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Primary Drive sync failed.';
      try {
        await api.reportPrimaryDriveFailure(errMsg);
        await onBootstrapUpdated();
      } catch {
        // Ignore secondary failure reporting error
      }
      onNotify(errMsg, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handlePrepareLoadVersion = async (versionFile: PrimaryDriveVersionFile) => {
    setLoadingRemote(true);
    try {
      if (inGasRuntime) {
        setPendingLoadFile(versionFile);
        setPendingLoadSnapshot({
          sync_revision: versionFile.revision,
          exported_at: versionFile.modifiedTime,
        });
        setConfirmLoadText('');
      } else {
        const snapshot = await downloadPrimaryDriveSnapshot(versionFile.id);
        setPendingLoadFile(versionFile);
        setPendingLoadSnapshot(snapshot);
        setConfirmLoadText('');
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to download snapshot from Primary Drive.',
        'error'
      );
    } finally {
      setLoadingRemote(false);
    }
  };

  const handleConfirmLoadRemote = async () => {
    if (!pendingLoadFile || !pendingLoadSnapshot || confirmLoadText.trim().toUpperCase() !== 'LOAD') {
      return;
    }
    setLoadingRemote(true);
    try {
      const res = inGasRuntime
        ? await api.restorePrimaryDriveGasSnapshot(pendingLoadFile.id)
        : await api.restoreFromPrimaryDrive({
            snapshot: pendingLoadSnapshot,
            file_id: pendingLoadFile.id,
            email: getPrimaryDriveMemorySession().email || settings.primary_drive_email,
          });
      setPendingLoadFile(null);
      setPendingLoadSnapshot(null);
      setConfirmLoadText('');
      setConflictInfo(null);
      await onBootstrapUpdated();
      onNotify(res.message, 'success');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to load Primary Drive data.',
        'error'
      );
    } finally {
      setLoadingRemote(false);
    }
  };

  const syncStatus = settings.primary_drive_sync_status;
  const statusBadge =
    syncStatus === 'saved_to_primary_drive'
      ? {
          label: 'Saved to Primary Drive',
          cls: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          icon: CheckCircle2,
        }
      : syncStatus === 'sync_failed'
      ? {
          label: 'Sync Failed',
          cls: 'border-red-200 bg-red-50 text-red-800',
          icon: AlertTriangle,
        }
      : syncStatus === 'pending_sync'
      ? {
          label: 'Pending Sync',
          cls: 'border-amber-200 bg-amber-50 text-amber-900',
          icon: Clock,
        }
      : {
          label: 'Not Connected',
          cls: 'border-slate-200 bg-slate-100 text-slate-600',
          icon: Cloud,
        };
  const StatusIcon = statusBadge.icon;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
              <Cloud className="h-5 w-5 text-[#0F766E]" />
              Primary Google Drive (Durable Business Data Sync)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Admin-only private Google Drive app data storage. Orders, expenses, worker payments,
              settlements, and follow-ups entered from the mobile app sync through the authenticated
              backend — supervisors never receive access to your Google Drive.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {browserConnected ? (
              <>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => handleSyncNow(false)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  <CloudUpload className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
                  {syncing
                    ? 'Saving Snapshot...'
                    : inGasRuntime
                    ? 'Save Snapshot to Primary Drive'
                    : 'Sync Now to Primary Drive'}
                </button>
                <button
                  type="button"
                  disabled={loadingVersions}
                  onClick={refreshVersions}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingVersions ? 'animate-spin' : ''}`} />
                  Check Versions
                </button>
                {!inGasRuntime && (
                  <button
                    type="button"
                    onClick={handleDisconnectPrimaryDrive}
                    className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                disabled={connecting}
                onClick={handleConnectPrimaryDrive}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132f55] disabled:opacity-50"
              >
                <Cloud className="h-4 w-4" />
                {connecting
                  ? 'Authorizing Google...'
                  : settings.primary_drive_email
                  ? 'Reconnect Primary Google Drive'
                  : 'Connect Primary Google Drive'}
              </button>
            )}
          </div>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-500">Primary Google Account</div>
            <div className="mt-0.5 truncate font-mono font-semibold text-[#0B1F3A]">
              {settings.primary_drive_email || (inGasRuntime ? 'Owner Google Account' : 'Not connected')}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {inGasRuntime
                ? 'Connected natively via Apps Script'
                : browserConnected
                ? 'Active browser authorization'
                : settings.primary_drive_email
                ? 'Click Reconnect to sync from this browser'
                : 'Must be different from Secondary Drive'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-500">Private App Data Folder</div>
            <div className="mt-0.5 flex items-center gap-1.5 font-semibold text-[#0B1F3A]">
              <FolderLock className="h-3.5 w-3.5 shrink-0 text-[#0F766E]" />
              <span className="truncate">
                {settings.primary_drive_folder_label || 'Private App Data (appDataFolder)'}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              Hidden from regular Drive sharing
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-500">Sync Status</div>
            <div className="mt-1">
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold ${statusBadge.cls}`}
              >
                <StatusIcon className="h-3.5 w-3.5" />
                {statusBadge.label}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-slate-500">
              Local Rev v{settings.sync_revision} · Drive Rev v
              {settings.primary_drive_last_synced_revision}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-500">Last Confirmed Drive Write</div>
            <div className="mt-0.5 font-semibold text-[#0B1F3A]">
              {settings.primary_drive_last_synced_at
                ? formatDateTimeEn(settings.primary_drive_last_synced_at)
                : 'Never synced'}
            </div>
            {settings.secondary_drive_email && (
              <div className="mt-0.5 truncate text-[10px] text-slate-500">
                Secondary: <span className="font-mono">{settings.secondary_drive_email}</span>
              </div>
            )}
          </div>
        </div>

        {/* Last Sync Error Banner */}
        {settings.primary_drive_last_error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            <div className="font-bold">Sync Failed — Local Server Changes Preserved</div>
            <p className="mt-1">{settings.primary_drive_last_error}</p>
          </div>
        )}

        {/* Revision Conflict Resolution Panel */}
        {conflictInfo && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3 text-xs text-amber-950">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              Revision Conflict Detected (Prevented Silent Overwrite)
            </div>
            <p>
              Primary Drive already holds revision <strong>v{conflictInfo.remoteRevision}</strong>{' '}
              (updated {formatDateTimeEn(conflictInfo.remoteModifiedTime)}), which is newer than your
              last synced revision (v{settings.primary_drive_last_synced_revision}). Choose whether
              to load the newer Drive data or overwrite Drive with this server&apos;s data:
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loadingRemote}
                onClick={() =>
                  handlePrepareLoadVersion({
                    id: conflictInfo.remoteFileId,
                    name: 'sunviloz_primary_state_v1.json',
                    size: 0,
                    modifiedTime: conflictInfo.remoteModifiedTime,
                    revision: conflictInfo.remoteRevision,
                    checksum: '',
                    isLatest: true,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-3 py-1.5 font-semibold text-white hover:bg-[#132f55]"
              >
                <CloudDownload className="h-3.5 w-3.5" />
                Review &amp; Load Newer Drive Data (v{conflictInfo.remoteRevision})
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={() => handleSyncNow(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-50"
              >
                <CloudUpload className="h-3.5 w-3.5" />
                Force Save Local Data (v{settings.sync_revision})
              </button>
            </div>
          </div>
        )}

        {/* Confirmation Box before replacing SQLite from Primary Drive */}
        {pendingLoadFile && pendingLoadSnapshot && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-amber-950">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                Confirm Loading Verified Data from Primary Drive
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingLoadFile(null);
                  setPendingLoadSnapshot(null);
                }}
                className="font-semibold text-slate-600 hover:underline"
              >
                Cancel
              </button>
            </div>
            <p className="text-amber-900">
              File: <strong className="font-mono">{pendingLoadFile.name}</strong> · Revision:{' '}
              <strong>v{String(pendingLoadSnapshot.sync_revision || pendingLoadFile.revision)}</strong>{' '}
              · Exported:{' '}
              {formatDateTimeEn(
                String(pendingLoadSnapshot.exported_at || pendingLoadFile.modifiedTime || '')
              )}
              . A pre-restore safety snapshot of your current database will be created automatically
              before loading.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={confirmLoadText}
                onChange={(e) => setConfirmLoadText(e.target.value)}
                placeholder='Type "LOAD" to confirm'
                className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-mono text-xs font-bold"
              />
              <button
                type="button"
                disabled={loadingRemote || confirmLoadText.trim().toUpperCase() !== 'LOAD'}
                onClick={handleConfirmLoadRemote}
                className="rounded-lg bg-[#0F766E] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-40"
              >
                {loadingRemote ? 'Loading Verified Data...' : 'Confirm & Load Primary Drive Data'}
              </button>
            </div>
          </div>
        )}

        {/* Versioned Primary Drive Snapshots */}
        {browserConnected && (
          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <History className="h-3.5 w-3.5" />
              Versioned Snapshots in Primary Drive ({versions.length})
            </div>
            {versions.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                No synced snapshots in your private Primary Drive folder yet. Click{' '}
                <strong>Sync Now to Primary Drive</strong> to create your first verified version.
              </p>
            ) : (
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-[#0B1F3A]">{v.name}</span>
                        {v.isLatest && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            Latest
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Rev v{v.revision || '—'} · {formatBytes(v.size)} ·{' '}
                        {formatDateTimeEn(v.modifiedTime)}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={loadingRemote}
                      onClick={() => handlePrepareLoadVersion(v)}
                      className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50"
                    >
                      <CloudDownload className="h-3.5 w-3.5" />
                      Load Verified Data
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
