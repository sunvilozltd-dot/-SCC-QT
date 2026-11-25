import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { ActiveSessionInfo, EnrolledDeviceInfo } from '../src/types/order.ts';
import { getNowDhakaTimestamp } from '../src/utils/dateAndPhone.ts';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days persistent mobile session
const CHALLENGE_TTL_MS = 1000 * 60 * 5; // 5 minutes WebAuthn challenge TTL

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function initMobileSecuritySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_label TEXT NOT NULL DEFAULT 'Unknown Device',
      secret_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      is_revoked INTEGER NOT NULL DEFAULT 0,
      revoked_reason TEXT NOT NULL DEFAULT '',
      last_active_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      credential_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_label TEXT NOT NULL DEFAULT 'Mobile Device',
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports_json TEXT NOT NULL DEFAULT '[]',
      backed_up INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      challenge_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      device_id TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL CHECK(purpose IN ('register', 'authenticate')),
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      idem_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL DEFAULT 200,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, is_revoked);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_device ON user_sessions(user_id, device_id);
    CREATE INDEX IF NOT EXISTS idx_webauthn_creds_user ON webauthn_credentials(user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_webauthn_creds_device ON webauthn_credentials(user_id, device_id, is_active);
  `);
}

export function sanitizeDeviceId(raw: unknown): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
  return cleaned || `dev_${crypto.randomBytes(12).toString('hex')}`;
}

export function sanitizeDeviceLabel(raw: unknown, userAgent?: string): string {
  const direct = String(raw || '')
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 80);
  if (direct) return direct;
  const ua = String(userAgent || '');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android Phone';
  if (/Mac OS X/i.test(ua)) return 'Mac Browser';
  if (/Windows/i.test(ua)) return 'Windows Browser';
  return 'Web Browser';
}

export interface CreatedSession {
  sessionId: string;
  deviceId: string;
  deviceLabel: string;
  cookieValue: string;
  expiresAtMs: number;
}

export function createPersistentSession(
  db: Database.Database,
  params: {
    userId: string;
    deviceId: string;
    deviceLabel: string;
    tokenVersion: number;
  }
): CreatedSession {
  const sessionId = crypto.randomBytes(18).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const secretHash = sha256Hex(secret);
  const now = getNowDhakaTimestamp();
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  const safeDeviceId = sanitizeDeviceId(params.deviceId);
  const safeLabel = sanitizeDeviceLabel(params.deviceLabel);

  db.prepare(
    `INSERT INTO user_sessions (
      session_id, user_id, device_id, device_label, secret_hash, token_version,
      is_revoked, revoked_reason, last_active_at, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?)`
  ).run(
    sessionId,
    params.userId,
    safeDeviceId,
    safeLabel,
    secretHash,
    Number(params.tokenVersion || 1),
    now,
    now,
    expiresAtMs
  );

  return {
    sessionId,
    deviceId: safeDeviceId,
    deviceLabel: safeLabel,
    cookieValue: `${sessionId}.${secret}`,
    expiresAtMs,
  };
}

export interface ValidatedSessionRow {
  session_id: string;
  user_id: string;
  device_id: string;
  device_label: string;
  token_version: number;
  last_active_at: string;
  created_at: string;
  expires_at: number;
}

export function validatePersistentSessionCookie(
  db: Database.Database,
  cookieValue: string,
  expectedDeviceId?: string
): ValidatedSessionRow | null {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return null;
  const sessionId = cookieValue.slice(0, dot).trim();
  const secret = cookieValue.slice(dot + 1).trim();
  if (!sessionId || !secret) return null;

  const row = db
    .prepare(
      `SELECT session_id, user_id, device_id, device_label, secret_hash, token_version, is_revoked, last_active_at, created_at, expires_at
       FROM user_sessions
       WHERE session_id = ?`
    )
    .get(sessionId) as
    | (ValidatedSessionRow & { secret_hash: string; is_revoked: number })
    | undefined;

  if (!row || row.is_revoked !== 0) return null;
  if (Date.now() > Number(row.expires_at || 0)) return null;

  const actualHash = Buffer.from(sha256Hex(secret), 'hex');
  const expectedHash = Buffer.from(row.secret_hash, 'hex');
  if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(actualHash, expectedHash)) {
    return null;
  }

  if (expectedDeviceId && row.device_id !== expectedDeviceId) {
    return null;
  }

  return {
    session_id: row.session_id,
    user_id: row.user_id,
    device_id: row.device_id,
    device_label: row.device_label,
    token_version: Number(row.token_version || 1),
    last_active_at: row.last_active_at,
    created_at: row.created_at,
    expires_at: Number(row.expires_at),
  };
}

export function isSessionActive(db: Database.Database, sessionId: string, userId?: string): boolean {
  if (!sessionId) return false;
  const row = db
    .prepare('SELECT user_id, is_revoked, expires_at FROM user_sessions WHERE session_id = ?')
    .get(sessionId) as { user_id: string; is_revoked: number; expires_at: number } | undefined;
  if (!row) return false;
  if (row.is_revoked !== 0) return false;
  if (Date.now() > Number(row.expires_at || 0)) return false;
  if (userId && row.user_id !== userId) return false;
  return true;
}

export function touchSession(db: Database.Database, sessionId: string, nextTokenVersion?: number): void {
  const now = getNowDhakaTimestamp();
  if (typeof nextTokenVersion === 'number') {
    db.prepare(
      'UPDATE user_sessions SET last_active_at = ?, token_version = ? WHERE session_id = ?'
    ).run(now, nextTokenVersion, sessionId);
  } else {
    db.prepare('UPDATE user_sessions SET last_active_at = ? WHERE session_id = ?').run(now, sessionId);
  }
}

export function revokeSessionById(db: Database.Database, sessionId: string, reason = 'sign_out'): void {
  if (!sessionId) return;
  db.prepare(
    'UPDATE user_sessions SET is_revoked = 1, revoked_reason = ? WHERE session_id = ?'
  ).run(reason, sessionId);
}

export function revokeAllSessionsForUser(
  db: Database.Database,
  userId: string,
  reason: string,
  exceptSessionId?: string
): void {
  if (exceptSessionId) {
    db.prepare(
      'UPDATE user_sessions SET is_revoked = 1, revoked_reason = ? WHERE user_id = ? AND session_id != ? AND is_revoked = 0'
    ).run(reason, userId, exceptSessionId);
  } else {
    db.prepare(
      'UPDATE user_sessions SET is_revoked = 1, revoked_reason = ? WHERE user_id = ? AND is_revoked = 0'
    ).run(reason, userId);
  }
}

export function revokeSessionsForDevice(
  db: Database.Database,
  userId: string,
  deviceId: string,
  reason = 'device_removed'
): void {
  db.prepare(
    'UPDATE user_sessions SET is_revoked = 1, revoked_reason = ? WHERE user_id = ? AND device_id = ? AND is_revoked = 0'
  ).run(reason, userId, deviceId);
}

export function listActiveSessionsForUser(
  db: Database.Database,
  userId: string,
  currentSessionId?: string
): ActiveSessionInfo[] {
  const nowMs = Date.now();
  const rows = db
    .prepare(
      `SELECT session_id, device_id, device_label, created_at, last_active_at, expires_at
       FROM user_sessions
       WHERE user_id = ? AND is_revoked = 0 AND expires_at > ?
       ORDER BY last_active_at DESC`
    )
    .all(userId, nowMs) as Array<{
    session_id: string;
    device_id: string;
    device_label: string;
    created_at: string;
    last_active_at: string;
    expires_at: number;
  }>;

  return rows.map((r) => ({
    session_id: r.session_id,
    device_id: r.device_id,
    device_label: r.device_label,
    created_at: r.created_at,
    last_active_at: r.last_active_at,
    expires_at: new Date(r.expires_at).toISOString(),
    is_current_session: Boolean(currentSessionId && r.session_id === currentSessionId),
  }));
}

// ============================================================================
// WEBAUTHN CREDENTIALS & CHALLENGES (PER-DEVICE BOUND, ZERO BIOMETRIC STORAGE)
// ============================================================================

export interface StoredWebAuthnCredential {
  credential_id: string;
  user_id: string;
  device_id: string;
  device_label: string;
  public_key: string;
  counter: number;
  transports: string[];
  backed_up: boolean;
  is_active: boolean;
  last_used_at: string;
  created_at: string;
}

export function saveWebAuthnChallenge(
  db: Database.Database,
  params: {
    userId: string;
    deviceId: string;
    purpose: 'register' | 'authenticate';
    challenge: string;
  }
): string {
  // Prune expired challenges
  db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').run(Date.now());
  const challengeId = crypto.randomBytes(16).toString('hex');
  const now = getNowDhakaTimestamp();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  db.prepare(
    `INSERT INTO webauthn_challenges (challenge_id, user_id, device_id, purpose, challenge, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(challengeId, params.userId, params.deviceId, params.purpose, params.challenge, expiresAt, now);
  return challengeId;
}

export function consumeWebAuthnChallenge(
  db: Database.Database,
  params: {
    challengeId: string;
    purpose: 'register' | 'authenticate';
    userId?: string;
    deviceId?: string;
  }
): { challenge: string; user_id: string; device_id: string } | null {
  const row = db
    .prepare(
      'SELECT challenge_id, user_id, device_id, purpose, challenge, expires_at FROM webauthn_challenges WHERE challenge_id = ?'
    )
    .get(params.challengeId) as
    | {
        challenge_id: string;
        user_id: string;
        device_id: string;
        purpose: string;
        challenge: string;
        expires_at: number;
      }
    | undefined;

  if (!row) return null;
  // Always delete single-use challenge immediately to prevent replay attacks
  db.prepare('DELETE FROM webauthn_challenges WHERE challenge_id = ?').run(params.challengeId);

  if (row.purpose !== params.purpose) return null;
  if (Date.now() > Number(row.expires_at || 0)) return null;
  if (params.userId && row.user_id !== params.userId) return null;
  if (params.deviceId && row.device_id !== params.deviceId) return null;

  return {
    challenge: row.challenge,
    user_id: row.user_id,
    device_id: row.device_id,
  };
}

export function saveWebAuthnCredential(
  db: Database.Database,
  params: {
    credentialId: string;
    userId: string;
    deviceId: string;
    deviceLabel: string;
    publicKeyBase64Url: string;
    counter: number;
    transports?: string[];
    backedUp?: boolean;
  }
): void {
  const now = getNowDhakaTimestamp();
  db.prepare(
    `INSERT INTO webauthn_credentials (
      credential_id, user_id, device_id, device_label, public_key, counter,
      transports_json, backed_up, is_active, last_used_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(credential_id) DO UPDATE SET
      device_label = excluded.device_label,
      public_key = excluded.public_key,
      counter = excluded.counter,
      transports_json = excluded.transports_json,
      is_active = 1,
      last_used_at = excluded.last_used_at`
  ).run(
    params.credentialId,
    params.userId,
    params.deviceId,
    params.deviceLabel,
    params.publicKeyBase64Url,
    Number(params.counter || 0),
    JSON.stringify(params.transports || []),
    params.backedUp ? 1 : 0,
    now,
    now
  );
}

function mapCredRow(r: Record<string, unknown>): StoredWebAuthnCredential {
  let transports: string[] = [];
  try {
    const parsed = JSON.parse(String(r.transports_json || '[]'));
    if (Array.isArray(parsed)) transports = parsed.map(String);
  } catch {
    transports = [];
  }
  return {
    credential_id: String(r.credential_id),
    user_id: String(r.user_id),
    device_id: String(r.device_id),
    device_label: String(r.device_label || 'Mobile Device'),
    public_key: String(r.public_key),
    counter: Number(r.counter || 0),
    transports,
    backed_up: Number(r.backed_up || 0) === 1,
    is_active: Number(r.is_active || 0) === 1,
    last_used_at: String(r.last_used_at || ''),
    created_at: String(r.created_at || ''),
  };
}

export function listWebAuthnCredentialsForUser(
  db: Database.Database,
  userId: string
): StoredWebAuthnCredential[] {
  const rows = db
    .prepare(
      'SELECT * FROM webauthn_credentials WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC'
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map(mapCredRow);
}

export function listWebAuthnCredentialsForUserAndDevice(
  db: Database.Database,
  userId: string,
  deviceId: string
): StoredWebAuthnCredential[] {
  const rows = db
    .prepare(
      'SELECT * FROM webauthn_credentials WHERE user_id = ? AND device_id = ? AND is_active = 1 ORDER BY created_at DESC'
    )
    .all(userId, deviceId) as Array<Record<string, unknown>>;
  return rows.map(mapCredRow);
}

export function getWebAuthnCredentialById(
  db: Database.Database,
  credentialId: string
): StoredWebAuthnCredential | null {
  const row = db
    .prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ? AND is_active = 1')
    .get(credentialId) as Record<string, unknown> | undefined;
  return row ? mapCredRow(row) : null;
}

export function updateWebAuthnCredentialCounter(
  db: Database.Database,
  credentialId: string,
  newCounter: number
): void {
  const now = getNowDhakaTimestamp();
  db.prepare(
    'UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?'
  ).run(Number(newCounter || 0), now, credentialId);
}

export function listEnrolledDevicesForUser(
  db: Database.Database,
  userId: string,
  currentDeviceId?: string
): EnrolledDeviceInfo[] {
  return listWebAuthnCredentialsForUser(db, userId).map((c) => ({
    credential_id: c.credential_id,
    device_id: c.device_id,
    device_label: c.device_label,
    created_at: c.created_at,
    last_used_at: c.last_used_at,
    is_current_device: Boolean(currentDeviceId && c.device_id === currentDeviceId),
  }));
}

export function revokeWebAuthnCredentialAndSessions(
  db: Database.Database,
  userId: string,
  credentialId: string
): { removedDeviceId: string } {
  const cred = db
    .prepare('SELECT credential_id, device_id FROM webauthn_credentials WHERE credential_id = ? AND user_id = ?')
    .get(credentialId, userId) as { credential_id: string; device_id: string } | undefined;

  if (!cred) {
    throw new Error('Enrolled device credential not found.');
  }

  db.prepare('UPDATE webauthn_credentials SET is_active = 0 WHERE credential_id = ?').run(credentialId);
  // Immediately invalidate all sessions bound to that removed device
  revokeSessionsForDevice(db, userId, cred.device_id, 'device_removed');
  return { removedDeviceId: cred.device_id };
}

export function revokeAllWebAuthnCredentialsForUser(db: Database.Database, userId: string): void {
  db.prepare('UPDATE webauthn_credentials SET is_active = 0 WHERE user_id = ?').run(userId);
}

// ============================================================================
// IDEMPOTENCY KEYS & SYNC REVISION TRACKING
// ============================================================================

export function getIdempotentResponse(
  db: Database.Database,
  idemKey: string,
  userId: string,
  method: string,
  reqPath: string
): { statusCode: number; body: unknown } | null {
  if (!idemKey) return null;
  const scopedKey = `${userId}|${method.toUpperCase()}|${reqPath}|${idemKey}`;
  const row = db
    .prepare('SELECT status_code, response_json FROM idempotency_keys WHERE idem_key = ?')
    .get(scopedKey) as { status_code: number; response_json: string } | undefined;
  if (!row) return null;
  try {
    return {
      statusCode: Number(row.status_code || 200),
      body: JSON.parse(row.response_json),
    };
  } catch {
    return null;
  }
}

export function storeIdempotentResponse(
  db: Database.Database,
  idemKey: string,
  userId: string,
  method: string,
  reqPath: string,
  statusCode: number,
  body: unknown
): void {
  if (!idemKey || statusCode >= 500) return;
  const scopedKey = `${userId}|${method.toUpperCase()}|${reqPath}|${idemKey}`;
  const now = getNowDhakaTimestamp();
  try {
    db.prepare(
      `INSERT OR REPLACE INTO idempotency_keys (idem_key, user_id, method, path, status_code, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(scopedKey, userId, method.toUpperCase(), reqPath, statusCode, JSON.stringify(body), now);
  } catch {
    // Do not fail mutation if idempotency cache write encounters serialization issue
  }
}

export function getOrCreateInternalSigningKey(db: Database.Database): string {
  const envSecret = (process.env.SESSION_SECRET || '').trim();
  if (envSecret.length >= 16) return envSecret;

  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'internal_session_signing_key'")
    .get() as { value: string } | undefined;
  if (row && row.value && row.value.length >= 32) {
    return row.value;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  const now = getNowDhakaTimestamp();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('internal_session_signing_key', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(generated, now);
  return generated;
}

export function bumpSyncRevision(db: Database.Database): number {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'sync_revision'")
    .get() as { value: string } | undefined;
  const current = parseInt(row?.value || '0', 10) || 0;
  const next = current + 1;
  const now = getNowDhakaTimestamp();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('sync_revision', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(String(next), now);
  return next;
}
