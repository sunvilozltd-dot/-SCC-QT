import type { Express, Response } from 'express';
import { AuthedRequest, requireAdmin } from './auth.ts';
import {
  buildPrimaryDriveSnapshot,
  confirmPrimaryDriveWrite,
  connectPrimaryDriveAccount,
  disconnectPrimaryDriveAccount,
  getAdminBootstrapPayload,
  getPublicSettings,
  reportPrimaryDriveSyncError,
  restoreFromPrimaryDriveTx,
} from './db.ts';

export function registerPrimaryDriveRoutes(
  app: Express,
  requireAuth: (req: AuthedRequest, res: Response, next: () => void) => void
): void {
  const wrap =
    (fn: (req: AuthedRequest, res: Response) => Promise<void> | void) =>
    async (req: AuthedRequest, res: Response) => {
      try {
        await fn(req, res);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Primary Drive operation failed.';
        const status = message.startsWith('Access denied') ? 403 : 400;
        res.status(status).json({ error: message });
      }
    };

  // Admin-only Primary Drive sync status
  app.get(
    '/api/drive/primary/status',
    requireAuth,
    requireAdmin,
    wrap((_req, res) => {
      const s = getPublicSettings();
      res.json({
        primary_drive_email: s.primary_drive_email,
        primary_drive_folder_label: s.primary_drive_folder_label,
        primary_drive_file_id: s.primary_drive_file_id,
        sync_revision: s.sync_revision,
        primary_drive_last_synced_revision: s.primary_drive_last_synced_revision,
        primary_drive_last_synced_at: s.primary_drive_last_synced_at,
        primary_drive_sync_status: s.primary_drive_sync_status,
        primary_drive_last_error: s.primary_drive_last_error,
        secondary_drive_email: s.secondary_drive_email,
      });
    })
  );

  // Admin-only connect Primary Google Drive account (rejects same account as Secondary Drive)
  app.post(
    '/api/drive/primary/connect',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const settings = connectPrimaryDriveAccount({
        email: String(req.body?.email || ''),
        file_id: req.body?.file_id ? String(req.body.file_id) : undefined,
      });
      res.json({
        settings,
        bootstrap: getAdminBootstrapPayload(),
        message: `Connected Primary Google Drive (${settings.primary_drive_email}).`,
      });
    })
  );

  // Admin-only disconnect Primary Google Drive
  app.post(
    '/api/drive/primary/disconnect',
    requireAuth,
    requireAdmin,
    wrap((_req, res) => {
      const settings = disconnectPrimaryDriveAccount();
      res.json({
        settings,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Disconnected Primary Google Drive account.',
      });
    })
  );

  // Admin-only versioned snapshot for uploading to Google Drive appDataFolder
  app.get(
    '/api/drive/primary/snapshot',
    requireAuth,
    requireAdmin,
    wrap((_req, res) => {
      const snapshot = buildPrimaryDriveSnapshot();
      res.json({ snapshot });
    })
  );

  // Admin-only confirmation called ONLY AFTER Google Drive API confirms HTTP 200 write
  app.post(
    '/api/drive/primary/confirm-sync',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const settings = confirmPrimaryDriveWrite({
        revision: Number(req.body?.revision || 0),
        file_id: String(req.body?.file_id || ''),
        checksum_sha256: String(req.body?.checksum_sha256 || ''),
        email: req.body?.email ? String(req.body.email) : undefined,
      });
      res.json({
        settings,
        bootstrap: getAdminBootstrapPayload(),
        message: `Saved to Primary Drive (Revision v${settings.primary_drive_last_synced_revision}).`,
      });
    })
  );

  // Admin-only failure reporting — preserves pending changes in SQLite for safe retry
  app.post(
    '/api/drive/primary/report-failure',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const settings = reportPrimaryDriveSyncError(String(req.body?.error || 'Sync failed.'));
      res.json({
        settings,
        bootstrap: getAdminBootstrapPayload(),
      });
    })
  );

  // Admin-only atomic restore from a verified Primary Drive snapshot (e.g. fresh deployment)
  app.post(
    '/api/drive/primary/restore',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const snapshot = req.body?.snapshot as Record<string, unknown> | undefined;
      if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('Primary Drive snapshot payload is required.');
      }
      const result = restoreFromPrimaryDriveTx(snapshot, req.user!, {
        file_id: req.body?.file_id ? String(req.body.file_id) : undefined,
        email: req.body?.email ? String(req.body.email) : undefined,
      });
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message: `Loaded verified Primary Drive data (v${snapshot.sync_revision || 1}): ${result.restoredOrders} orders, ${result.restoredQuotations} quotations, ${result.restoredReceipts} receipts.`,
      });
    })
  );
}
