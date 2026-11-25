import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  AuthedRequest,
  createAuthMiddleware,
  issueSessionToken,
  requireAdmin,
  setPersistentSessionCookie,
} from './server/auth.ts';
import {
  addLeadNoteTx,
  adminUpdateCompletedWorkersTx,
  assertSupervisorCanAccessOrder,
  authenticateOrResetAdminByVerifiedEmail,
  authenticateUser,
  buildFullBackupJson,
  changeOrderStatusNonCompleteTx,
  changeOwnPassword,
  checkOrderScheduleConflicts,
  completeOrderAtomicTx,
  confirmSupervisorSettlementTx,
  convertQuotationToOrderTx,
  correctCompletedOrderFinancialsTx,
  correctOrderWorkerPayment,
  createBuilding,
  createCustomer,
  createLeadTx,
  createOrderComplaint,
  createOrderTx,
  createOverheadExpense,
  createSupervisorAccount,
  createWorker,
  dbCreatePersistentSession,
  dbGetIdempotentResponse,
  dbIsSessionActive,
  dbListWebAuthnCredentialsForUserAndDevice,
  dbStoreIdempotentResponse,
  deleteBuilding,
  deleteCompanyLogo,
  deleteOverheadExpense,
  deletePadConfig,
  ensureInitialAdminFromEnv,
  findDuplicateContactsByPhone,
  getAdminAccountEmailHint,
  getAdminBootstrapPayload,
  getAuthorizedGoogleOwnerEmail,
  getCompanyLogoDataUrl,
  getCurrentSyncRevision,
  getIssuedPdfByDoc,
  getLastAutoBackupDate,
  getOrderById,
  getPad,
  getPublicSettings,
  getSecondaryDriveBridgeCredentials,
  getServerGoogleCredentials,
  getSupervisorEligibleJobs,
  getUserAuthRecordById,
  getUserTokenVersion,
  hasAdminClaimed,
  INITIAL_ADMIN_USERNAME,
  isEnvAdminConfigured,
  issueMoneyReceiptTx,
  listReminderLogs,
  listSupervisors,
  markBusinessDataMutated,
  markOrderWorkerPaid,
  migrateLegacyLocalStorageTx,
  projectSupervisorJob,
  recordBackupHistory,
  recordReminderLog,
  recordSupervisorSettlementEntry,
  rescheduleFollowupTx,
  rescheduleLeadFollowupTx,
  restoreBackupTx,
  runLocalReminderDedupeCheckTx,
  saveCompanyLogo,
  saveIssuedPdf,
  saveLocalBackupSnapshot,
  savePadConfig,
  saveQuotationTx,
  saveSettings,
  scheduleReturnVisitTx,
  setLastAutoBackupDate,
  setSettingRaw,
  toggleFollowupDoneTx,
  toggleLeadFollowupDoneTx,
  updateAdminAccountCredentials,
  updateBuilding,
  updateCustomer,
  updateLeadTx,
  updateOrderAdvanceTx,
  updateOrderComplaint,
  updateOrderTx,
  updatePadFieldsOnly,
  updateQuotationFollowup,
  updateSupervisorAccount,
  updateWorker,
  validateBackupPackage,
  verifyRemindersAfterRestore,
} from './server/db.ts';
import { sanitizeDeviceId, sanitizeDeviceLabel } from './server/mobileSecurityDb.ts';
import { registerPrimaryDriveRoutes } from './server/primaryDriveRoutes.ts';
import { registerWebAuthnAndSessionRoutes } from './server/webauthnRoutes.ts';
import {
  buildLeadSourceXlsx,
  buildMonthlyFinancialXlsx,
  buildMonthlyTeamXlsx,
  buildMonthlyWorkerPaymentsXlsx,
} from './server/excelExport.ts';
import {
  callGoogleAppsScriptBridge,
  pushSecondaryDriveBackup,
  validateGoogleWebAppUrl,
} from './server/googleSync.ts';
import {
  isFirebaseAdminLoginAvailable,
  verifyFirebaseIdToken,
} from './server/firebaseVerify.ts';
import {
  AppsScriptBackendError,
  callAppsScriptApi,
  getConfiguredAppsScriptUrl,
  isAppsScriptUrlValid,
} from './server/appsScriptProxy.ts';
import {
  addCalendarDays,
  addCalendarMonths,
  getNowDhakaTimestamp,
  getTodayDhakaIso,
} from './src/utils/dateAndPhone.ts';
import type { PadType } from './src/types/order.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function getCurrentDhakaHour(): number {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    hour12: false,
  }).format(new Date());
  const h = parseInt(hourStr, 10);
  return Number.isFinite(h) ? h % 24 : 0;
}

async function executeScheduledServerBackup(actorName: string): Promise<{
  ok: boolean;
  fileName: string;
  sizeBytes: number;
  pushedToSecondaryDrive: boolean;
  driveFileId: string;
  driveEmail: string;
  errorMessage: string;
}> {
  const settings = getPublicSettings();
  const stamp = getNowDhakaTimestamp().replace(/[^0-9]/g, '').slice(0, 14);
  const fileName = `sunviloz_backup_${stamp}.json`;

  try {
    const backup = buildFullBackupJson();
    const localSnap = saveLocalBackupSnapshot('backups', fileName, backup);
    const secCreds = getSecondaryDriveBridgeCredentials();

    let driveFileId = '';
    let driveEmail = settings.secondary_drive_email || '';
    let folderName = settings.secondary_drive_folder_name || 'SUNVILOZ Clean Care Backups';
    let pushedToSecondaryDrive = false;

    if (secCreds.webAppUrl && secCreds.syncSecret) {
      const pushed = await pushSecondaryDriveBackup(
        secCreds.webAppUrl,
        secCreds.syncSecret,
        fileName,
        folderName,
        backup
      );
      driveFileId = pushed.driveFileId;
      if (pushed.ownerEmail) driveEmail = pushed.ownerEmail;
      if (pushed.folderName) folderName = pushed.folderName;
      pushedToSecondaryDrive = true;
    }

    recordBackupHistory({
      source: 'secondary_drive_scheduler',
      status: 'verified',
      file_name: fileName,
      drive_file_id: driveFileId,
      drive_account_email: driveEmail,
      folder_name: folderName,
      size_bytes: localSnap.sizeBytes,
      checksum_sha256: localSnap.checksum,
      created_by: actorName,
    });
    setLastAutoBackupDate(getTodayDhakaIso());

    return {
      ok: true,
      fileName,
      sizeBytes: localSnap.sizeBytes,
      pushedToSecondaryDrive,
      driveFileId,
      driveEmail,
      errorMessage: '',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Scheduled backup failed.';
    recordBackupHistory({
      source: 'secondary_drive_scheduler',
      status: 'failed',
      file_name: fileName,
      drive_account_email: settings.secondary_drive_email || '',
      folder_name: settings.secondary_drive_folder_name || 'SUNVILOZ Clean Care Backups',
      error_message: msg,
      created_by: actorName,
    });
    return {
      ok: false,
      fileName,
      sizeBytes: 0,
      pushedToSecondaryDrive: false,
      driveFileId: '',
      driveEmail: settings.secondary_drive_email || '',
      errorMessage: msg,
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  const requireAuth = createAuthMiddleware(getUserAuthRecordById, dbIsSessionActive);

  // Serialize business data mutations, enforce X-Idempotency-Key deduplication,
  // check optional X-Expected-Revision for multi-device conflict detection, and bump sync_revision.
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

  let writeSerializationChain: Promise<void> = Promise.resolve();

  app.use((req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      next();
      return;
    }
    const isBusinessMutation = BUSINESS_MUTATION_PREFIXES.some((prefix) =>
      req.path.startsWith(prefix)
    );
    if (!isBusinessMutation || req.path === '/api/orders/check-conflicts') {
      next();
      return;
    }

    const idemKey = String(
      req.headers['x-idempotency-key'] ||
        (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).submission_key || '' : '')
    )
      .trim()
      .slice(0, 120);

    const expectedRevisionRaw = req.headers['x-expected-revision'];
    const expectedRevision =
      expectedRevisionRaw !== undefined && String(expectedRevisionRaw).trim() !== ''
        ? parseInt(String(expectedRevisionRaw), 10)
        : null;

    // Queue write execution strictly so concurrent mobile writes never race or overwrite silently
    const prev = writeSerializationChain;
    let releaseLock!: () => void;
    writeSerializationChain = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    prev.then(() => {
      let released = false;
      const done = () => {
        if (!released) {
          released = true;
          releaseLock();
        }
      };
      res.on('finish', done);
      res.on('close', done);

      // Extract authenticated user identity if Bearer token is present (for idempotency scoping)
      let actorKey = 'anon';
      const authHeader = String(req.headers.authorization || '');
      if (authHeader.startsWith('Bearer ')) {
        const tok = authHeader.slice(7).trim();
        const dot = tok.indexOf('.');
        if (dot > 0) {
          try {
            const p = JSON.parse(Buffer.from(tok.slice(0, dot), 'base64url').toString('utf8')) as {
              uid?: string;
            };
            if (p.uid) actorKey = p.uid;
          } catch {
            // Let requireAuth handle invalid token
          }
        }
      }

      if (idemKey && actorKey !== 'anon') {
        const cached = dbGetIdempotentResponse(idemKey, actorKey, method, req.path);
        if (cached) {
          res.setHeader('X-Idempotent-Replay', '1');
          res.status(cached.statusCode).json(cached.body);
          return;
        }
      }

      if (
        expectedRevision !== null &&
        Number.isFinite(expectedRevision) &&
        expectedRevision > 0 &&
        expectedRevision !== getCurrentSyncRevision()
      ) {
        res.status(409).json({
          code: 'REVISION_CONFLICT',
          current_revision: getCurrentSyncRevision(),
          error:
            'Newer changes were saved from another device. Please refresh to load the latest revision before saving.',
        });
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        const statusCode = res.statusCode || 200;
        if (statusCode >= 200 && statusCode < 300) {
          const nextRev = markBusinessDataMutated();
          if (body && typeof body === 'object' && !Array.isArray(body)) {
            const rec = body as Record<string, unknown>;
            if (rec.bootstrap && typeof rec.bootstrap === 'object') {
              (rec.bootstrap as Record<string, unknown>).settings = getPublicSettings();
            }
            if (rec.settings && typeof rec.settings === 'object') {
              rec.settings = getPublicSettings();
            }
            rec.sync_revision = nextRev;
          }
          if (idemKey && actorKey !== 'anon') {
            dbStoreIdempotentResponse(idemKey, actorKey, method, req.path, statusCode, body);
          }
        }
        return originalJson(body);
      }) as typeof res.json;

      next();
    });
  });

  const wrap =
    (fn: (req: AuthedRequest, res: express.Response) => Promise<void> | void) =>
    async (req: AuthedRequest, res: express.Response) => {
      try {
        await fn(req, res);
      } catch (err) {
        const rawMessage =
          err instanceof Error ? err.message : 'An unexpected server error occurred.';
        if (rawMessage.startsWith('STATUS_LOCKED:')) {
          res.status(409).json({
            code: 'STATUS_LOCKED',
            error: rawMessage.replace(/^STATUS_LOCKED:\s*/, ''),
          });
          return;
        }
        const status = rawMessage.startsWith('Access denied') ? 403 : 400;
        res.status(status).json({ error: rawMessage });
      }
    };

  const issuePersistentAuthResponse = (
    req: express.Request,
    res: express.Response,
    user: { id: string; role: 'admin' | 'supervisor'; name: string; username: string; phone_display: string; is_active: boolean },
    message: string
  ) => {
    const deviceId = sanitizeDeviceId(req.body?.device_id || req.headers['x-device-id'] || '');
    const deviceLabel = sanitizeDeviceLabel(
      req.body?.device_label,
      String(req.headers['user-agent'] || '')
    );
    const tv = getUserTokenVersion(user.id);
    const created = dbCreatePersistentSession({
      userId: user.id,
      deviceId,
      deviceLabel,
      tokenVersion: tv,
    });
    setPersistentSessionCookie(req, res, created.cookieValue);
    const token = issueSessionToken({
      ...user,
      token_version: tv,
      session_id: created.sessionId,
      device_id: created.deviceId,
    });
    const deviceUnlockEnrolled =
      dbListWebAuthnCredentialsForUserAndDevice(user.id, created.deviceId).length > 0;
    res.json({
      token,
      user,
      deviceId: created.deviceId,
      deviceUnlockEnrolled,
      message,
    });
  };

  // ============================================================================
  // AUTH ROUTES
  // ============================================================================

  app.get(
    '/api/auth/status',
    wrap(async (_req, res) => {
      const configuredAppsScriptUrl = getConfiguredAppsScriptUrl();
      if (configuredAppsScriptUrl) {
        if (!isAppsScriptUrlValid(configuredAppsScriptUrl)) {
          res.json({
            needsAdminSetup: false,
            adminSetupLocked: false,
            envAdminConfigured: false,
            googleAdminEnabled: false,
            ownerEmailHint: '',
            initialAdminUsername: INITIAL_ADMIN_USERNAME,
            companyLogoDataUrl: getCompanyLogoDataUrl(),
            backendMode: 'apps_script',
            backendConfigured: false,
            backendReachable: false,
            backendStatusMessage:
              'Apps Script backend URL is invalid. Set APPS_SCRIPT_WEBAPP_URL to your deployed https://script.google.com/... Web App URL.',
          });
          return;
        }
        try {
          const gasStatus = await callAppsScriptApi<{
            adminConfigured?: boolean;
            adminSetupLocked?: boolean;
            initialAdminUsername?: string;
            primaryOwnerGoogleEmail?: string;
            googleOwnerResetEnabled?: boolean;
            companyLogoDataUrl?: string;
          }>('auth.status');
          const primaryGoogleOwner = String(gasStatus.primaryOwnerGoogleEmail || '')
            .trim()
            .toLowerCase();
          res.json({
            needsAdminSetup: false,
            adminSetupLocked: Boolean(gasStatus.adminSetupLocked),
            envAdminConfigured: false,
            googleAdminEnabled:
              isFirebaseAdminLoginAvailable() &&
              Boolean(gasStatus.googleOwnerResetEnabled) &&
              Boolean(primaryGoogleOwner),
            ownerEmailHint: primaryGoogleOwner,
            initialAdminUsername: gasStatus.initialAdminUsername || INITIAL_ADMIN_USERNAME,
            companyLogoDataUrl: gasStatus.companyLogoDataUrl || getCompanyLogoDataUrl(),
            backendMode: 'apps_script',
            backendConfigured: true,
            backendReachable: true,
            backendStatusMessage: gasStatus.adminSetupLocked
              ? 'Apps Script backend is reachable, but the initial Admin account has not been created yet. Run setupInitialAdmin(...) once from the Apps Script Editor.'
              : '',
          });
          return;
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Unable to reach the configured Google Apps Script backend.';
          res.json({
            needsAdminSetup: false,
            adminSetupLocked: false,
            envAdminConfigured: false,
            googleAdminEnabled: false,
            ownerEmailHint: '',
            initialAdminUsername: INITIAL_ADMIN_USERNAME,
            companyLogoDataUrl: getCompanyLogoDataUrl(),
            backendMode: 'apps_script',
            backendConfigured: true,
            backendReachable: false,
            backendStatusMessage: msg,
          });
          return;
        }
      }

      ensureInitialAdminFromEnv();
      const adminClaimed = hasAdminClaimed();
      const authorizedGoogleOwner = getAuthorizedGoogleOwnerEmail();
      res.json({
        needsAdminSetup: false,
        adminSetupLocked: !adminClaimed,
        envAdminConfigured: isEnvAdminConfigured(),
        // Only enable Google Admin reset when an actual verified Primary Google Account Owner is linked (never scc@gmail.com)
        googleAdminEnabled:
          isFirebaseAdminLoginAvailable() && adminClaimed && Boolean(authorizedGoogleOwner),
        ownerEmailHint: authorizedGoogleOwner,
        initialAdminUsername: INITIAL_ADMIN_USERNAME,
        companyLogoDataUrl: getCompanyLogoDataUrl(),
        backendMode: 'local_preview',
        backendConfigured: true,
        backendReachable: true,
        backendStatusMessage: '',
      });
    })
  );

  // Public admin bootstrap is permanently locked to prevent unauthorized visitors from claiming admin
  app.post(
    '/api/auth/bootstrap',
    wrap((_req, res) => {
      res.status(403).json({
        error: `Initial admin setup is locked. Run setupInitialAdmin(...) in Apps Script (or configure server-side ADMIN_PASSWORD for local preview) to initialize ${INITIAL_ADMIN_USERNAME}.`,
      });
    })
  );

  // Lightweight per-IP rate limiter for password verification routes
  const authAttemptTracker = new Map<string, { count: number; resetAt: number }>();
  const checkAuthRateLimit = (req: express.Request, res: express.Response): boolean => {
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const rec = authAttemptTracker.get(ip);
    if (!rec || nowMs > rec.resetAt) {
      authAttemptTracker.set(ip, { count: 1, resetAt: nowMs + 15 * 60 * 1000 });
      return true;
    }
    if (rec.count >= 25) {
      res.status(429).json({
        error: 'Too many sign-in or password attempts. Please wait a few minutes and try again.',
      });
      return false;
    }
    rec.count += 1;
    return true;
  };

  app.post(
    '/api/auth/login',
    wrap(async (req, res) => {
      if (!checkAuthRateLimit(req, res)) return;
      const { username, password } = req.body || {};

      // If Apps Script backend is configured, authenticate against Apps Script directly
      const configuredAppsScriptUrl = getConfiguredAppsScriptUrl();
      if (configuredAppsScriptUrl) {
        try {
          const gasLogin = await callAppsScriptApi<{
            token: string;
            user: {
              id: string;
              role: 'admin' | 'supervisor';
              name: string;
              username: string;
              phone_display: string;
              is_active: boolean;
            };
            deviceId?: string;
            message?: string;
          }>('auth.login', {
            username: String(username || '').trim().toLowerCase(),
            // Preserve password as exact string including symbols
            password: String(password || ''),
            device_id: sanitizeDeviceId(req.body?.device_id || req.headers['x-device-id'] || ''),
            device_label: sanitizeDeviceLabel(req.body?.device_label || 'Web Preview'),
          });
          res.json({
            token: gasLogin.token,
            user: gasLogin.user,
            deviceId: gasLogin.deviceId,
            deviceUnlockEnrolled: false,
            message: gasLogin.message || `Welcome back, ${gasLogin.user.name}!`,
          });
          return;
        } catch (err) {
          if (err instanceof AppsScriptBackendError) {
            res.status(err.httpStatus).json({
              code: err.code,
              error: err.message,
            });
            return;
          }
          res.status(503).json({
            code: 'BACKEND_UNREACHABLE',
            error: 'Unable to reach the configured Google Apps Script backend.',
          });
          return;
        }
      }

      // Local preview fallback mode
      ensureInitialAdminFromEnv();
      if (!hasAdminClaimed()) {
        res.status(503).json({
          code: 'BACKEND_SETUP_REQUIRED',
          error:
            'Admin account has not been initialized yet. Configure ADMIN_PASSWORD (or APPS_SCRIPT_WEBAPP_URL) and reload.',
        });
        return;
      }

      try {
        const user = authenticateUser(username, password);
        issuePersistentAuthResponse(req, res, user, `Welcome back, ${user.name}!`);
      } catch (err) {
        res.status(401).json({
          code: 'AUTH_FAILED',
          error: err instanceof Error ? err.message : 'Invalid username or password.',
        });
      }
    })
  );

  app.post(
    '/api/auth/change-password',
    requireAuth,
    wrap((req, res) => {
      const { current_password, new_password } = req.body || {};
      const updatedUser = changeOwnPassword(
        req.user!.id,
        String(current_password || ''),
        String(new_password || ''),
        req.sessionId
      );
      const token = issueSessionToken({
        ...updatedUser,
        token_version: getUserTokenVersion(updatedUser.id),
        session_id: req.sessionId,
        device_id: req.deviceId,
      });
      res.json({
        token,
        user: updatedUser,
        message: 'Password updated successfully. Other active sessions have been signed out.',
      });
    })
  );

  // Admin-only Account Settings update (username and/or password) requiring current_password re-authentication
  app.post(
    '/api/auth/account/credentials',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const { current_password, new_username, new_password } = req.body || {};
      const result = updateAdminAccountCredentials(
        req.user!.id,
        {
          current_password: String(current_password || ''),
          new_username: new_username !== undefined ? String(new_username) : undefined,
          new_password: new_password !== undefined ? String(new_password) : undefined,
        },
        req.sessionId
      );
      const token = issueSessionToken({
        ...result.user,
        token_version: getUserTokenVersion(result.user.id),
        session_id: req.sessionId,
        device_id: req.deviceId,
      });
      const msg =
        result.usernameChanged && result.passwordChanged
          ? `Admin username (${result.user.username}) and password updated. Other sessions revoked.`
          : result.usernameChanged
          ? `Admin username updated to ${result.user.username}. Other sessions revoked.`
          : 'Admin password updated. Other sessions revoked.';
      res.json({
        token,
        user: result.user,
        message: msg,
      });
    })
  );

  app.post(
    '/api/auth/change-password-with-credentials',
    wrap((req, res) => {
      if (!checkAuthRateLimit(req, res)) return;
      const { username, current_password, new_password } = req.body || {};
      let authed;
      try {
        authed = authenticateUser(String(username || ''), String(current_password || ''));
      } catch (err) {
        res.status(401).json({
          error: err instanceof Error ? err.message : 'Invalid username or current password.',
        });
        return;
      }
      const updatedUser = changeOwnPassword(
        authed.id,
        String(current_password || ''),
        String(new_password || '')
      );
      issuePersistentAuthResponse(
        req,
        res,
        updatedUser,
        'Password changed successfully. You are now signed in.'
      );
    })
  );

  app.post(
    '/api/auth/google-admin',
    wrap(async (req, res) => {
      if (!checkAuthRateLimit(req, res)) return;
      const { idToken, new_password } = req.body || {};
      let verified;
      try {
        verified = await verifyFirebaseIdToken(String(idToken || ''));
      } catch (err) {
        res.status(401).json({
          error: err instanceof Error ? err.message : 'Google verification failed.',
        });
        return;
      }

      const nextPass =
        typeof new_password === 'string' && new_password.length > 0 ? new_password : undefined;
      const user = authenticateOrResetAdminByVerifiedEmail(
        verified.email,
        nextPass,
        verified.name
      );
      issuePersistentAuthResponse(
        req,
        res,
        user,
        nextPass
          ? 'Admin password updated via Google verification. You are now signed in.'
          : `Welcome back, ${user.name}!`
      );
    })
  );

  app.get(
    '/api/auth/me',
    requireAuth,
    wrap((req, res) => {
      res.json({ user: req.user });
    })
  );

  // Register persistent session resume, logout, device list/removal, and WebAuthn passkey routes
  registerWebAuthnAndSessionRoutes(app, requireAuth);
  // Register admin-only Primary Google Drive durable versioned sync routes
  registerPrimaryDriveRoutes(app, requireAuth);

  // ============================================================================
  // ADMIN BOOTSTRAP & LEGACY LOCALSTORAGE MIGRATION
  // ============================================================================

  app.get(
    '/api/bootstrap',
    requireAuth,
    requireAdmin,
    wrap((_req, res) => {
      res.json(getAdminBootstrapPayload());
    })
  );

  app.post(
    '/api/migrate-local',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const result = migrateLegacyLocalStorageTx(req.body || {}, req.user!);
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message:
          result.importedOrders > 0
            ? `Successfully migrated ${result.importedOrders} saved orders.`
            : 'No new legacy data found to migrate.',
      });
    })
  );

  // ============================================================================
  // CUSTOMERS & BUILDING / WATER TANK PROFILES (ADMIN-ONLY)
  // ============================================================================

  app.post(
    '/api/customers',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const customer = createCustomer(req.body || {});
      res.json({
        customer,
        bootstrap: getAdminBootstrapPayload(),
        message: `Customer profile saved (${customer.name}).`,
      });
    })
  );

  app.put(
    '/api/customers/:customerId',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const customer = updateCustomer(String(req.params.customerId), req.body || {});
      res.json({
        customer,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Customer details updated.',
      });
    })
  );

  app.post(
    '/api/buildings',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const building = createBuilding(req.body || {});
      res.json({
        building,
        bootstrap: getAdminBootstrapPayload(),
        message: `Building profile "${building.name}" saved.`,
      });
    })
  );

  app.put(
    '/api/buildings/:buildingId',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const building = updateBuilding(String(req.params.buildingId), req.body || {});
      res.json({
        building,
        bootstrap: getAdminBootstrapPayload(),
        message: `Building profile "${building.name}" updated.`,
      });
    })
  );

  app.delete(
    '/api/buildings/:buildingId',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      deleteBuilding(String(req.params.buildingId));
      res.json({
        bootstrap: getAdminBootstrapPayload(),
        message: 'Building profile deleted.',
      });
    })
  );

  // ============================================================================
  // SUPERVISOR RESTRICTED ROUTES (RBAC + 7-DAY ASIA/DHAKA WINDOW + PROJECTION)
  // ============================================================================

  app.get(
    '/api/supervisor/jobs',
    requireAuth,
    wrap((req, res) => {
      if (req.user!.role !== 'supervisor') {
        res.status(403).json({ error: 'This endpoint is restricted to supervisor accounts.' });
        return;
      }
      res.json({
        ...getSupervisorEligibleJobs(req.user!.id),
        companyLogoDataUrl: getCompanyLogoDataUrl(),
      });
    })
  );

  // Direct order lookup — enforces strict role + assignment + 7-day window + field projection
  app.get(
    '/api/orders/:orderId',
    requireAuth,
    wrap((req, res) => {
      const orderId = String(req.params.orderId || '');
      if (req.user!.role === 'supervisor') {
        const order = assertSupervisorCanAccessOrder(req.user!.id, orderId);
        res.json({ job: projectSupervisorJob(order) });
        return;
      }
      const order = getOrderById(orderId);
      if (!order) {
        res.status(404).json({ error: 'Order not found.' });
        return;
      }
      res.json({ order });
    })
  );

  // Completion route — allowed for BOTH assigned Supervisor (within 7 days) AND Admin
  app.post(
    '/api/orders/:orderId/complete',
    requireAuth,
    wrap((req, res) => {
      const orderId = String(req.params.orderId || '');
      const updated = completeOrderAtomicTx(orderId, req.body || {}, req.user!);
      if (req.user!.role === 'supervisor') {
        res.json({
          job: projectSupervisorJob(updated),
          message: 'Job marked as completed successfully.',
        });
        return;
      }
      res.json({
        order: updated,
        bootstrap: getAdminBootstrapPayload(),
        message: updated.is_no_charge_visit
          ? `No-charge return visit (${updated.order_id}) completed and linked to parent job profitability.`
          : `Order completed and follow-up date (${updated.followup_date}) scheduled.`,
      });
    })
  );

  // ============================================================================
  // ADMIN ORDER ROUTES, CONFLICT CHECK, SETTLEMENT VERIFICATION & COMPLAINTS
  // ============================================================================

  app.post(
    '/api/orders/check-conflicts',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const conflicts = checkOrderScheduleConflicts(req.body || {});
      res.json({ conflicts });
    })
  );

  app.post(
    '/api/orders',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const order = createOrderTx(req.body || {}, req.user!);
      res.json({
        order,
        bootstrap: getAdminBootstrapPayload(),
        message: `New order created (${order.order_id}).`,
      });
    })
  );

  app.put(
    '/api/orders/:orderId',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const order = updateOrderTx(String(req.params.orderId), req.body || {}, req.user!);
      res.json({
        order,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Order details updated successfully.',
      });
    })
  );

  app.patch(
    '/api/orders/:orderId/advance',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const order = updateOrderAdvanceTx(String(req.params.orderId), req.body || {}, req.user!);
      res.json({
        order,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Supervisor assignment and advance saved.',
      });
    })
  );

  app.patch(
    '/api/orders/:orderId/status',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const { new_status, note } = req.body || {};
      const order = changeOrderStatusNonCompleteTx(
        String(req.params.orderId),
        new_status,
        note || '',
        req.user!
      );
      res.json({
        order,
        bootstrap: getAdminBootstrapPayload(),
        message: `Order status updated to "${order.status}".`,
      });
    })
  );

  app.patch(
    '/api/orders/:orderId/financials',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const order = correctCompletedOrderFinancialsTx(
        String(req.params.orderId),
        req.body || {},
        req.user!
      );
      res.json({
        order,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Expense and financial correction saved and logged in history.',
      });
    })
  );

  app.post(
    '/api/orders/:orderId/settlement',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const order = confirmSupervisorSettlementTx(
        String(req.params.orderId),
        req.body?.note || '',
        req.user!
      );
      res.json({
        order,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Supervisor settlement confirmed as Settled.',
      });
    })
  );

  app.post(
    '/api/orders/:orderId/settlement-entries',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const result = recordSupervisorSettlementEntry(
        String(req.params.orderId),
        req.body || {},
        req.user!
      );
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message: `Settlement entry recorded (${result.entry.amount_bdt} BDT).`,
      });
    })
  );

  app.patch(
    '/api/orders/:orderId/followup',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const order = rescheduleFollowupTx(String(req.params.orderId), req.body || {}, req.user!);
      res.json({
        order,
        bootstrap: getAdminBootstrapPayload(),
        message: `Follow-up date updated (${order.followup_date}) and new reminder scheduled.`,
      });
    })
  );

  app.patch(
    '/api/orders/:orderId/followup-done',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const isDone = req.body?.is_done !== false;
      const order = toggleFollowupDoneTx(String(req.params.orderId), isDone, req.user!);
      res.json({
        order,
        bootstrap: getAdminBootstrapPayload(),
        message: isDone ? 'Follow-up marked as done.' : 'Follow-up reopened.',
      });
    })
  );

  // Complaints & No-Charge Return Visits
  app.post(
    '/api/orders/:orderId/complaints',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const complaint = createOrderComplaint(
        String(req.params.orderId),
        req.body || {},
        req.user!
      );
      res.json({
        complaint,
        bootstrap: getAdminBootstrapPayload(),
        message: `Complaint logged (${complaint.complaint_id}).`,
      });
    })
  );

  app.patch(
    '/api/complaints/:complaintId',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const complaint = updateOrderComplaint(String(req.params.complaintId), req.body || {});
      res.json({
        complaint,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Complaint record updated.',
      });
    })
  );

  app.post(
    '/api/complaints/:complaintId/return-visit',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const { order, complaint } = scheduleReturnVisitTx(
        String(req.params.complaintId),
        req.body || {},
        req.user!
      );
      res.json({
        order,
        complaint,
        bootstrap: getAdminBootstrapPayload(),
        message: order.is_no_charge_visit
          ? `No-Charge Return Visit scheduled (${order.order_id}).`
          : `Return visit scheduled (${order.order_id}).`,
      });
    })
  );

  // ============================================================================
  // WORKERS, TEAM ASSIGNMENT & PER-JOB WORKER PAY (ADMIN-ONLY)
  // ============================================================================

  app.post(
    '/api/workers',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const worker = createWorker(req.body || {});
      res.json({
        worker,
        bootstrap: getAdminBootstrapPayload(),
        message: `Worker added (${worker.name}).`,
      });
    })
  );

  app.patch(
    '/api/workers/:workerId',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const worker = updateWorker(String(req.params.workerId), req.body || {});
      res.json({
        worker,
        bootstrap: getAdminBootstrapPayload(),
        message: `Worker updated (${worker.name}).`,
      });
    })
  );

  app.put(
    '/api/orders/:orderId/workers',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const order = adminUpdateCompletedWorkersTx(
        String(req.params.orderId),
        req.body || {},
        req.user!
      );
      res.json({
        order,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Order worker team updated and recorded in order history.',
      });
    })
  );

  app.post(
    '/api/orders/:orderId/workers/:orderWorkerId/mark-paid',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const result = markOrderWorkerPaid(
        String(req.params.orderId),
        String(req.params.orderWorkerId),
        req.body || {},
        req.user!
      );
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message: `Worker payment recorded for ${result.workerRow.worker_name} (${result.workerRow.agreed_pay_bdt} BDT).`,
      });
    })
  );

  app.patch(
    '/api/orders/:orderId/workers/:orderWorkerId/payment',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const result = correctOrderWorkerPayment(
        String(req.params.orderId),
        String(req.params.orderWorkerId),
        req.body || {},
        req.user!
      );
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message: `Worker payment updated for ${result.workerRow.worker_name} and logged in payment history.`,
      });
    })
  );

  // ============================================================================
  // QUOTATIONS, FOLLOW-UPS & CONVERSION (ADMIN-ONLY)
  // ============================================================================

  app.post(
    '/api/quotations',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const quotation = saveQuotationTx(req.body || {}, req.user!);
      res.json({
        quotation,
        bootstrap: getAdminBootstrapPayload(),
        message: `Quotation saved (${quotation.quotation_id}).`,
      });
    })
  );

  app.patch(
    '/api/quotations/:quotationId/followup',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const quotation = updateQuotationFollowup(
        String(req.params.quotationId),
        req.body || {},
        req.user!
      );
      res.json({
        quotation,
        bootstrap: getAdminBootstrapPayload(),
        message: `Quotation follow-up updated (${quotation?.quotation_id || req.params.quotationId}).`,
      });
    })
  );

  app.post(
    '/api/quotations/:quotationId/convert',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const result = convertQuotationToOrderTx(
        String(req.params.quotationId),
        req.body || {},
        req.user!
      );
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message: result.alreadyConverted
          ? `This quotation is already linked to Order ${result.order.order_id}. Opened existing order.`
          : `New order created from quotation (${result.order.order_id}).`,
      });
    })
  );

  // ============================================================================
  // MONEY RECEIPTS (ADMIN-ONLY, NO DUPLICATE PAYMENT)
  // ============================================================================

  app.post(
    '/api/receipts',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const result = issueMoneyReceiptTx(req.body || {}, req.user!);
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message: result.alreadyIssued
          ? `Money Receipt (${result.receipt.receipt_id}) was already issued for this order. No duplicate payment added.`
          : `Money Receipt issued (${result.receipt.receipt_id}).`,
      });
    })
  );

  // ============================================================================
  // EXCEL (.XLSX) REPORT EXPORTS (ADMIN-ONLY)
  // ============================================================================

  app.post(
    '/api/reports/export-xlsx',
    requireAuth,
    requireAdmin,
    wrap(async (req, res) => {
      const { report_type, filters } = req.body || {};
      const bootstrap = getAdminBootstrapPayload();
      const f = (filters && typeof filters === 'object' ? filters : {}) as Record<string, string>;
      const today = getTodayDhakaIso();
      const defaultMonth = today.slice(0, 7);

      let buffer: Buffer;
      let fileName: string;

      if (report_type === 'monthly_financial') {
        const [defYearStr, defMonthStr] = defaultMonth.split('-');
        const reqYear = Number(f.year) || Number(defYearStr);
        const reqMonth = Number(f.month) || Number(defMonthStr);
        const lastDay = new Date(Date.UTC(reqYear, reqMonth, 0)).getUTCDate();
        const fallbackMonthKey = `${reqYear}-${String(reqMonth).padStart(2, '0')}`;
        const dateFrom = f.dateFrom || `${fallbackMonthKey}-01`;
        const dateTo = f.dateTo || `${fallbackMonthKey}-${String(lastDay).padStart(2, '0')}`;
        buffer = await buildMonthlyFinancialXlsx(bootstrap, {
          dateFrom,
          dateTo,
          area: f.area || '',
          service: f.service || '',
          supervisorId: f.supervisorId || '',
        });
        fileName = `SUNVILOZ_Monthly_Jobs_Income_${dateFrom}_to_${dateTo}.xlsx`;
      } else if (report_type === 'monthly_team') {
        const month = f.month || defaultMonth;
        buffer = await buildMonthlyTeamXlsx(bootstrap, {
          month,
          supervisorId: f.supervisorId || '',
          workerId: f.workerId || '',
        });
        fileName = `SUNVILOZ_Team_Report_${month}.xlsx`;
      } else if (report_type === 'monthly_worker_payments') {
        const month = f.month || defaultMonth;
        buffer = await buildMonthlyWorkerPaymentsXlsx(bootstrap, {
          month,
          workerId: f.workerId || '',
        });
        fileName = `SUNVILOZ_Worker_Payments_${month}.xlsx`;
      } else if (report_type === 'lead_source') {
        const dateFrom = f.dateFrom || `${defaultMonth}-01`;
        const dateTo = f.dateTo || `${defaultMonth}-31`;
        buffer = await buildLeadSourceXlsx(bootstrap, {
          dateFrom,
          dateTo,
        });
        fileName = `SUNVILOZ_Lead_Source_Report_${dateFrom}_to_${dateTo}.xlsx`;
      } else {
        throw new Error('Invalid report type for Excel export.');
      }

      const safeFile = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
      res.send(buffer);
    })
  );

  // ============================================================================
  // SUPERVISOR ACCOUNTS MANAGEMENT (ADMIN-ONLY)
  // ============================================================================

  app.get(
    '/api/supervisors',
    requireAuth,
    requireAdmin,
    wrap((_req, res) => {
      res.json({ supervisors: listSupervisors() });
    })
  );

  app.post(
    '/api/supervisors',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const supervisor = createSupervisorAccount(req.body || {});
      res.json({
        supervisor,
        bootstrap: getAdminBootstrapPayload(),
        message: `Supervisor account created (${supervisor.name}).`,
      });
    })
  );

  app.patch(
    '/api/supervisors/:id',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const hasPasswordReset = Boolean(req.body?.password && String(req.body.password).length > 0);
      const supervisor = updateSupervisorAccount(String(req.params.id), req.body || {});
      res.json({
        supervisor,
        bootstrap: getAdminBootstrapPayload(),
        message: !supervisor.is_active
          ? `Supervisor (${supervisor.name}) deactivated and all active sessions revoked.`
          : hasPasswordReset
          ? `Password reset for ${supervisor.name} and all previous sessions revoked.`
          : `Supervisor (${supervisor.name}) updated and active.`,
      });
    })
  );

  // ============================================================================
  // GENERAL BUSINESS EXPENSES (OVERHEAD, SEPARATE FROM PER-JOB COST, ADMIN-ONLY)
  // ============================================================================

  app.post(
    '/api/overhead',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const record = createOverheadExpense(req.body || {}, req.user!);
      res.json({
        record,
        bootstrap: getAdminBootstrapPayload(),
        message: 'General business expense saved.',
      });
    })
  );

  app.delete(
    '/api/overhead/:id',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      deleteOverheadExpense(String(req.params.id));
      res.json({
        bootstrap: getAdminBootstrapPayload(),
        message: 'General business expense deleted.',
      });
    })
  );

  // ============================================================================
  // REUSABLE DOCUMENT PADS (QUOTATION PAD & RECEIPT PAD)
  // ============================================================================

  app.post(
    '/api/pads/:padType',
    requireAuth,
    requireAdmin,
    wrap(async (req, res) => {
      const padType = String(req.params.padType) as PadType;
      const saved = savePadConfig(padType, req.body || {}, req.user!);

      const { webAppUrl, syncSecret } = getServerGoogleCredentials();
      let driveNote = '';
      if (webAppUrl && syncSecret) {
        try {
          const bridgeRes = await callGoogleAppsScriptBridge(webAppUrl, syncSecret, 'save_pad', {
            pad_type: padType,
            version: saved.version,
            file_name: saved.file_name,
            mime_type: saved.mime_type,
            image_data_url: saved.image_data_url,
            fields: saved.fields,
          });
          const driveId = String(bridgeRes.data?.drive_file_id || '');
          if (driveId) {
            savePadConfig(padType, { ...saved, drive_file_id: driveId }, req.user!);
            driveNote = ' and saved to private Google Drive.';
          }
        } catch (syncErr) {
          setSettingRaw('last_google_sync_status', 'error');
          setSettingRaw(
            'last_google_sync_error',
            syncErr instanceof Error ? syncErr.message : 'Pad sync to Google Drive failed.'
          );
        }
      }

      res.json({
        pad: getPad(padType),
        bootstrap: getAdminBootstrapPayload(),
        message: `${padType === 'quotation' ? 'Quotation Pad' : 'Money Receipt Pad'} saved (v${saved.version})${driveNote}`,
      });
    })
  );

  app.patch(
    '/api/pads/:padType/fields',
    requireAuth,
    requireAdmin,
    wrap(async (req, res) => {
      const padType = String(req.params.padType) as PadType;
      const saved = updatePadFieldsOnly(padType, req.body?.fields || [], req.user!);

      const { webAppUrl, syncSecret } = getServerGoogleCredentials();
      if (webAppUrl && syncSecret) {
        try {
          await callGoogleAppsScriptBridge(webAppUrl, syncSecret, 'save_pad', {
            pad_type: padType,
            version: saved.version,
            file_name: saved.file_name,
            mime_type: saved.mime_type,
            image_data_url: saved.image_data_url,
            fields: saved.fields,
          });
        } catch {
          // Local save already succeeded
        }
      }

      res.json({
        pad: saved,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Dynamic field positions saved.',
      });
    })
  );

  app.delete(
    '/api/pads/:padType',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const padType = String(req.params.padType) as PadType;
      deletePadConfig(padType);
      res.json({
        bootstrap: getAdminBootstrapPayload(),
        message: 'Custom pad removed and reverted to default layout.',
      });
    })
  );

  // ============================================================================
  // PROSPECTS / LEADS (STRICTLY ADMIN-ONLY)
  // ============================================================================

  app.get(
    '/api/leads/check-phone',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const phone = String(req.query.phone || '');
      const excludeLeadId = String(req.query.excludeLeadId || '');
      res.json(findDuplicateContactsByPhone(phone, excludeLeadId));
    })
  );

  app.post(
    '/api/leads',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const lead = createLeadTx(req.body || {}, req.user!);
      res.json({
        lead,
        bootstrap: getAdminBootstrapPayload(),
        message: `New prospect saved (${lead.lead_id}).`,
      });
    })
  );

  app.put(
    '/api/leads/:leadId',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const lead = updateLeadTx(String(req.params.leadId), req.body || {}, req.user!);
      res.json({
        lead,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Prospect details updated.',
      });
    })
  );

  app.post(
    '/api/leads/:leadId/notes',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const result = addLeadNoteTx(String(req.params.leadId), req.body || {}, req.user!);
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Contact note added.',
      });
    })
  );

  app.patch(
    '/api/leads/:leadId/followup',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const lead = rescheduleLeadFollowupTx(String(req.params.leadId), req.body || {}, req.user!);
      res.json({
        lead,
        bootstrap: getAdminBootstrapPayload(),
        message: `Next follow-up scheduled (${lead.next_followup_date}).`,
      });
    })
  );

  app.patch(
    '/api/leads/:leadId/followup-done',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const isDone = req.body?.is_done !== false;
      const nextFollowupDate = req.body?.next_followup_date;
      const noteText = req.body?.note_text;
      const lead = toggleLeadFollowupDoneTx(
        String(req.params.leadId),
        isDone,
        nextFollowupDate,
        noteText,
        req.user!
      );
      res.json({
        lead,
        bootstrap: getAdminBootstrapPayload(),
        message: nextFollowupDate
          ? `Current follow-up marked done and next date (${lead.next_followup_date}) scheduled.`
          : isDone
          ? 'Prospect follow-up marked as done.'
          : 'Prospect follow-up reopened.',
      });
    })
  );

  // ============================================================================
  // COMPANY BRANDING (LOGO UPLOAD & REMOVE — ADMIN-ONLY)
  // ============================================================================

  app.post(
    '/api/branding/logo',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const settings = saveCompanyLogo(req.body || {});
      res.json({
        settings,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Company logo saved. It will now appear on login, dashboard, and supervisor screens.',
      });
    })
  );

  app.delete(
    '/api/branding/logo',
    requireAuth,
    requireAdmin,
    wrap((_req, res) => {
      const settings = deleteCompanyLogo();
      res.json({
        settings,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Company logo removed. Default branding "SUNVILOZ Clean Care" will be displayed.',
      });
    })
  );

  // ============================================================================
  // ISSUED PDF ARCHIVE (ADMIN-ONLY)
  // ============================================================================

  app.post(
    '/api/issued-pdfs',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const pdf = saveIssuedPdf(req.body || {}, req.user!);
      res.json({
        pdf,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Issued PDF saved to backup archive.',
      });
    })
  );

  app.get(
    '/api/issued-pdfs/:docType/:docId',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const docType = String(req.params.docType) as PadType;
      const docId = String(req.params.docId);
      const record = getIssuedPdfByDoc(docType, docId);
      if (!record) {
        res.status(404).json({ error: 'Archived PDF not found.' });
        return;
      }
      res.json({ pdf: record });
    })
  );

  // ============================================================================
  // SETTINGS, GOOGLE SYNC, SECONDARY BACKUP, ATOMIC RESTORE & REMINDERS
  // ============================================================================

  app.patch(
    '/api/settings',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const body = req.body || {};
      if (body.google_webapp_url) {
        validateGoogleWebAppUrl(body.google_webapp_url);
      }
      if (body.secondary_drive_webapp_url) {
        validateGoogleWebAppUrl(body.secondary_drive_webapp_url);
      }
      const settings = saveSettings(body);
      res.json({
        settings,
        bootstrap: getAdminBootstrapPayload(),
        message:
          'Settings saved. Default follow-up rule changes apply only to future completed orders.',
      });
    })
  );

  app.post(
    '/api/google/sync',
    requireAuth,
    requireAdmin,
    wrap(async (_req, res) => {
      const { webAppUrl, syncSecret } = getServerGoogleCredentials();
      setSettingRaw('last_google_sync_status', 'pending');
      setSettingRaw('last_google_sync_error', '');

      try {
        const backup = buildFullBackupJson();
        const bridgeRes = await callGoogleAppsScriptBridge(webAppUrl, syncSecret, 'full_sync', {
          backup,
          settings: getPublicSettings(),
        });
        const now = getNowDhakaTimestamp();
        setSettingRaw('last_google_sync_at', now);
        setSettingRaw('last_drive_backup_at', now);
        setSettingRaw('last_google_sync_status', 'verified');
        setSettingRaw('last_google_sync_error', '');
        if (bridgeRes.data?.trigger_status) {
          setSettingRaw('reminder_trigger_status', String(bridgeRes.data.trigger_status));
        }
        res.json({
          bootstrap: getAdminBootstrapPayload(),
          message:
            bridgeRes.message ||
            'Google Sheet, reminder schedule, and private Google Drive backup synced successfully.',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Google sync failed.';
        setSettingRaw('last_google_sync_status', 'error');
        setSettingRaw('last_google_sync_error', msg);
        res.status(400).json({ error: msg, bootstrap: getAdminBootstrapPayload() });
      }
    })
  );

  app.post(
    '/api/google/test-email',
    requireAuth,
    requireAdmin,
    wrap(async (_req, res) => {
      const settings = getPublicSettings();
      const { webAppUrl, syncSecret } = getServerGoogleCredentials();
      const today = getTodayDhakaIso();
      const now = getNowDhakaTimestamp();
      const sampleFollowup =
        settings.default_followup_unit === 'months'
          ? addCalendarMonths(today, settings.default_followup_value)
          : addCalendarDays(today, settings.default_followup_value);

      if (webAppUrl && syncSecret) {
        try {
          const bridgeRes = await callGoogleAppsScriptBridge(
            webAppUrl,
            syncSecret,
            'send_test_email',
            { reminder_email: settings.reminder_email }
          );
          recordReminderLog({
            dedupe_key: `TEST|${now}`,
            order_id: `TEST-${now.slice(11, 19).replace(/:/g, '')}`,
            customer_name: 'Sample Customer (Live Gmail Test)',
            phone_display: '01700000000',
            services_text: 'Overhead Tank Cleaning',
            completion_date: today,
            followup_date: sampleFollowup,
            recipient_email: settings.reminder_email,
            send_type: 'TEST_EMAIL',
            status: 'SENT',
            error_message: '',
            sent_at: now,
          });
          setSettingRaw('last_google_sync_status', 'verified');
          setSettingRaw('last_google_sync_error', '');
          res.json({
            bootstrap: getAdminBootstrapPayload(),
            message:
              bridgeRes.message ||
              `Live Gmail test reminder sent to ${settings.reminder_email}.`,
          });
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Gmail test email failed.';
          setSettingRaw('last_google_sync_status', 'error');
          setSettingRaw('last_google_sync_error', msg);
          res.status(400).json({ error: msg, bootstrap: getAdminBootstrapPayload() });
          return;
        }
      }

      recordReminderLog({
        dedupe_key: `TEST|${now}`,
        order_id: `TEST-${now.slice(11, 19).replace(/:/g, '')}`,
        customer_name: 'Sample Customer (Local Test Log)',
        phone_display: '01700000000',
        services_text: 'Overhead Tank Cleaning',
        completion_date: today,
        followup_date: sampleFollowup,
        recipient_email: settings.reminder_email,
        send_type: 'TEST_EMAIL',
        status: 'SENT',
        error_message: '',
        sent_at: now,
      });

      res.json({
        bootstrap: getAdminBootstrapPayload(),
        message: `Local test reminder logged for ${settings.reminder_email}. To send live Gmail emails, configure the Apps Script URL and Sync Secret in Settings -> Google Connection.`,
      });
    })
  );

  app.post(
    '/api/reminders/verify-after-restore',
    requireAuth,
    requireAdmin,
    wrap((_req, res) => {
      const settings = verifyRemindersAfterRestore();
      res.json({
        settings,
        bootstrap: getAdminBootstrapPayload(),
        message: 'Gmail reminder settings verified and follow-up reminders re-enabled.',
      });
    })
  );

  app.post(
    '/api/reminders/check',
    requireAuth,
    requireAdmin,
    wrap((_req, res) => {
      const result = runLocalReminderDedupeCheckTx();
      if (result.pausedAfterRestore) {
        res.status(409).json({
          error:
            'Gmail follow-up reminders are paused after backup restore for safety. Please verify Gmail settings in Settings -> Backup & Restore or General Settings before re-enabling.',
          pausedAfterRestore: true,
          bootstrap: getAdminBootstrapPayload(),
        });
        return;
      }

      const message =
        result.sentCount > 0
          ? `${result.sentCount} follow-up reminder(s) processed (${result.orderSentCount} completed orders, ${result.leadSentCount} prospects).${
              result.skippedCount > 0 ? ` (${result.skippedCount} duplicate(s) prevented)` : ''
            }`
          : result.skippedCount > 0
          ? `No new reminders due (${result.skippedCount} already sent — duplicate prevention active).`
          : 'No due or overdue order or prospect follow-ups at this time.';
      res.json({
        ...result,
        reminderLogs: listReminderLogs(80),
        bootstrap: getAdminBootstrapPayload(),
        message,
      });
    })
  );

  app.get(
    '/api/backup',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const backup = buildFullBackupJson();
      if (req.query.record === '1') {
        const stamp = getNowDhakaTimestamp().replace(/[^0-9]/g, '').slice(0, 14);
        const fileName = `sunviloz_backup_${stamp}.json`;
        const serialized = JSON.stringify(backup);
        recordBackupHistory({
          source: 'local_download',
          status: 'verified',
          file_name: fileName,
          size_bytes: Buffer.byteLength(serialized, 'utf8'),
          checksum_sha256: String(backup.integrity_sha256 || ''),
          created_by: req.user!.name,
        });
      }
      res.json(backup);
    })
  );

  app.post(
    '/api/backup/validate',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const summary = validateBackupPackage(req.body);
      res.json({ summary });
    })
  );

  app.post(
    '/api/backup/record',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const body = req.body || {};
      const record = recordBackupHistory({
        source: body.source || 'secondary_drive_oauth',
        status: body.status === 'verified' ? 'verified' : 'failed',
        file_name: String(body.file_name || 'backup.json'),
        drive_file_id: String(body.drive_file_id || ''),
        drive_account_email: String(body.drive_account_email || ''),
        folder_name: String(body.folder_name || ''),
        size_bytes: Number(body.size_bytes || 0),
        checksum_sha256: String(body.checksum_sha256 || ''),
        error_message: String(body.error_message || ''),
        created_by: req.user!.name,
      });
      res.json({
        record,
        bootstrap: getAdminBootstrapPayload(),
      });
    })
  );

  app.post(
    '/api/backup/run-scheduled',
    requireAuth,
    requireAdmin,
    wrap(async (req, res) => {
      const result = await executeScheduledServerBackup(req.user!.name);
      if (!result.ok) {
        res.status(400).json({
          error: result.errorMessage,
          bootstrap: getAdminBootstrapPayload(),
        });
        return;
      }
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message: result.pushedToSecondaryDrive
          ? `Server backup completed (${result.fileName}) and uploaded to Secondary Google Drive.`
          : `Verified server backup snapshot saved (${result.fileName}). Connect Secondary Apps Script URL to auto-upload to Secondary Drive.`,
      });
    })
  );

  app.post(
    '/api/restore',
    requireAuth,
    requireAdmin,
    wrap((req, res) => {
      const result = restoreBackupTx(req.body || {}, req.user!);
      res.json({
        ...result,
        bootstrap: getAdminBootstrapPayload(),
        message: `Backup restored: ${result.restoredOrders} orders, ${result.restoredQuotations} quotations, ${result.restoredReceipts} receipts, ${result.restoredLeads} prospects, ${result.restoredPads} pads, and ${result.restoredIssuedPdfs} PDFs. Gmail reminders are paused until verified.`,
      });
    })
  );

  app.get(
    '/api/settings',
    requireAuth,
    requireAdmin,
    wrap((_req, res) => {
      res.json({ settings: getPublicSettings() });
    })
  );

  // Native Android APK & Android Studio Project ZIP artifact endpoints
  const androidDownloadsDir = path.resolve(process.cwd(), 'public', 'downloads');
  const androidApkPath = path.join(androidDownloadsDir, 'SUNVILOZ-Clean-Care.apk');
  const androidProjectZipPath = path.join(
    androidDownloadsDir,
    'SUNVILOZ-Clean-Care-Android-Studio-Project.zip'
  );

  app.get('/api/android/artifacts', (_req, res) => {
    const apkExists = fs.existsSync(androidApkPath);
    const zipExists = fs.existsSync(androidProjectZipPath);
    const apkStat = apkExists ? fs.statSync(androidApkPath) : null;
    const zipStat = zipExists ? fs.statSync(androidProjectZipPath) : null;
    const apkSha256 = apkExists
      ? crypto.createHash('sha256').update(fs.readFileSync(androidApkPath)).digest('hex')
      : null;

    res.json({
      applicationId: 'com.sunviloz.cleancare',
      versionCode: 2,
      versionName: '1.0.1',
      minSdk: 26,
      targetSdk: 35,
      apk: {
        available: apkExists,
        fileName: 'SUNVILOZ-Clean-Care.apk',
        signingType: 'debug-signed (Test Build)',
        sizeBytes: apkStat ? apkStat.size : 0,
        sha256: apkSha256,
        downloadUrl: apkExists ? '/api/android/download/apk' : null,
      },
      projectZip: {
        available: zipExists,
        fileName: 'SUNVILOZ-Clean-Care-Android-Studio-Project.zip',
        sizeBytes: zipStat ? zipStat.size : 0,
        downloadUrl: zipExists ? '/api/android/download/project-zip' : null,
      },
    });
  });

  app.get('/api/android/download/apk', (_req, res) => {
    if (!fs.existsSync(androidApkPath)) {
      res.status(404).json({ error: 'Android APK file has not been generated yet.' });
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="SUNVILOZ-Clean-Care.apk"');
    res.sendFile(androidApkPath);
  });

  app.get('/api/android/download/project-zip', (_req, res) => {
    if (!fs.existsSync(androidProjectZipPath)) {
      res.status(404).json({ error: 'Android Studio project ZIP is not available yet.' });
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="SUNVILOZ-Clean-Care-Android-Studio-Project.zip"'
    );
    res.sendFile(androidProjectZipPath);
  });

  // Strictly allowlisted list of the 7 Primary Apps Script backend files (never includes SecondaryBackupDrive.gs)
  const primaryAppsScriptFiles: Array<{
    fileName: string;
    editorName: string;
    kind: 'manifest' | 'script';
    note: string;
  }> = [
    {
      fileName: 'appsscript.json',
      editorName: 'appsscript.json',
      kind: 'manifest',
      note: 'Enable via Project Settings → Show "appsscript.json" manifest file in editor, then replace all contents.',
    },
    {
      fileName: 'Code.gs',
      editorName: 'Code',
      kind: 'script',
      note: 'Open the default Code.gs file, select all, delete, and paste this code.',
    },
    {
      fileName: 'Database.gs',
      editorName: 'Database',
      kind: 'script',
      note: 'Click Files (+) → Script → name it "Database", then paste.',
    },
    {
      fileName: 'Auth.gs',
      editorName: 'Auth',
      kind: 'script',
      note: 'Click Files (+) → Script → name it "Auth", then paste.',
    },
    {
      fileName: 'BusinessLogic.gs',
      editorName: 'BusinessLogic',
      kind: 'script',
      note: 'Click Files (+) → Script → name it "BusinessLogic", then paste.',
    },
    {
      fileName: 'BackupRestore.gs',
      editorName: 'BackupRestore',
      kind: 'script',
      note: 'Click Files (+) → Script → name it "BackupRestore", then paste.',
    },
    {
      fileName: 'Triggers.gs',
      editorName: 'Triggers',
      kind: 'script',
      note: 'Click Files (+) → Script → name it "Triggers", then paste. After saving all 7 files, run provisionWorkspaceAndTriggers from this file.',
    },
  ];

  app.get('/api/android/apps-script-files', (_req, res) => {
    try {
      const gasDir = path.join(process.cwd(), 'gas');
      const files = primaryAppsScriptFiles.map((meta, idx) => {
        const filePath = path.join(gasDir, meta.fileName);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Missing Apps Script file: ${meta.fileName}`);
        }
        const content = fs.readFileSync(filePath, 'utf8');
        return {
          order: idx + 1,
          fileName: meta.fileName,
          editorName: meta.editorName,
          kind: meta.kind,
          note: meta.note,
          lineCount: content.split('\n').length,
          content,
        };
      });
      res.json({
        primaryOwnerEmail: 'sunvilozltd@gmail.com',
        initialAdminUsername: 'scc@gmail.com',
        excludedFiles: ['SecondaryBackupDrive.gs', 'SETUP_GUIDE.md'],
        files,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Unable to load Apps Script source files.' });
    }
  });

  // Any unmatched /api/* route returns 404 JSON instead of SPA index.html
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Requested API endpoint not found.' });
  });

  // Serve saved PNG company logo for mobile PWA home-screen icons when uploaded (fallback to static brand PNGs)
  app.get(['/apple-touch-icon.png', '/pwa-192x192.png', '/pwa-512x512.png'], (req, res, next) => {
    try {
      const logoDataUrl = getCompanyLogoDataUrl();
      if (logoDataUrl && logoDataUrl.startsWith('data:image/png;base64,')) {
        const b64 = logoDataUrl.slice('data:image/png;base64,'.length);
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 100 && buf.length <= 2 * 1024 * 1024) {
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.send(buf);
          return;
        }
      }
    } catch {
      // Fallback to static brand icon in public/ or dist/
    }
    next();
  });

  // ============================================================================
  // VITE / STATIC SPA SERVING
  // ============================================================================

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: false,
        hmr: false,
      },
      appType: 'spa',
    });

    // When HMR/WebSocket is disabled in middleware mode, serve a clean WebSocket-free
    // /@vite/client module that preserves CSS injection and import.meta.hot without
    // attempting a failing WebSocket connection.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== '.' && url[0] !== '/')) return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return \`\${pathname}?\${queryToInject}\${search ? '&' + search.slice(1) : ''}\${hash || ''}\`;
}
export class ErrorOverlay {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  // Server-side daily automatic backup scheduler (Asia/Dhaka) — runs even when UI is closed
  let autoBackupRunning = false;
  const schedulerTimer = setInterval(async () => {
    if (autoBackupRunning) return;
    try {
      const settings = getPublicSettings();
      if (!settings.auto_backup_enabled) return;
      const todayDhaka = getTodayDhakaIso();
      if (getLastAutoBackupDate() === todayDhaka) return;
      const currentHour = getCurrentDhakaHour();
      if (currentHour < settings.auto_backup_hour) return;

      autoBackupRunning = true;
      await executeScheduledServerBackup('Automatic Server Scheduler');
    } catch {
      // Errors are recorded inside executeScheduledServerBackup without replacing last verified backup
    } finally {
      autoBackupRunning = false;
    }
  }, 60_000);
  schedulerTimer.unref();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SUNVILOZ Clean Care server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
