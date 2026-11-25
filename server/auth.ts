import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AuthUser } from '../src/types/order.ts';

let activeSigningSecret =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export function configureSessionSigningSecret(secret: string): void {
  if (secret && secret.length >= 16) {
    activeSigningSecret = secret;
  }
}

export const SESSION_COOKIE_NAME = 'sunviloz_sid';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days bearer token (paired with server-side revocable session)
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days persistent mobile session cookie

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(plain: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt:')) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(plain, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface AuthUserWithVersion extends AuthUser {
  token_version: number;
}

export interface TokenPayload {
  uid: string;
  role: 'admin' | 'supervisor';
  tv: number;
  sid?: string;
  did?: string;
  exp: number;
}

export function issueSessionToken(
  user: Pick<AuthUser, 'id' | 'role'> & {
    token_version?: number;
    session_id?: string;
    device_id?: string;
  }
): string {
  const payload: TokenPayload = {
    uid: user.id,
    role: user.role,
    tv: Number(user.token_version || 1),
    sid: user.session_id || undefined,
    did: user.device_id || undefined,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', activeSigningSecret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expectedSig = crypto
    .createHmac('sha256', activeSigningSecret)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.uid || !parsed.role || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return {
      ...parsed,
      tv: Number(parsed.tv || 1),
    };
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (forwarded.includes('https')) return true;
  const origin = String(req.headers.origin || '').toLowerCase();
  return origin.startsWith('https://');
}

export function setPersistentSessionCookie(
  req: Request,
  res: Response,
  cookieValue: string
): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearPersistentSessionCookie(req: Request, res: Response): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
  deviceId?: string;
}

export function createAuthMiddleware(
  getUserWithVersion: (id: string) => AuthUserWithVersion | null,
  checkSessionActive?: (sessionId: string, userId: string) => boolean
) {
  return function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const payload = verifySessionToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Please sign in again.' });
      return;
    }

    const userRecord = getUserWithVersion(payload.uid);
    if (!userRecord || !userRecord.is_active) {
      res.status(403).json({
        error: 'Your account is inactive or access has been revoked. Please contact the admin.',
      });
      return;
    }

    if (payload.tv !== userRecord.token_version) {
      res.status(401).json({
        error: 'Your session has been revoked because your password or access changed. Please sign in again.',
      });
      return;
    }

    if (payload.sid && checkSessionActive && !checkSessionActive(payload.sid, payload.uid)) {
      res.status(401).json({
        error: 'This device session has been signed out or revoked. Please sign in again.',
      });
      return;
    }

    const { token_version: _tv, ...safeUser } = userRecord;
    req.user = safeUser;
    req.sessionId = payload.sid;
    req.deviceId = payload.did;
    next();
  };
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Access denied. This action is restricted to administrators.' });
    return;
  }
  next();
}
