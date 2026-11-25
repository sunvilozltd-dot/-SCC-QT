import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface CertCache {
  certs: Record<string, string>;
  expiresAtMs: number;
}

let certCache: CertCache | null = null;
let cachedProjectId: string | null = null;

function readFirebaseProjectId(): string {
  if (cachedProjectId !== null) return cachedProjectId;
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: unknown };
      if (typeof raw.projectId === 'string' && raw.projectId.trim()) {
        cachedProjectId = raw.projectId.trim();
        return cachedProjectId;
      }
    }
  } catch {
    // Fall through
  }
  cachedProjectId = '';
  return '';
}

export function isFirebaseAdminLoginAvailable(): boolean {
  return readFirebaseProjectId().length > 0;
}

async function fetchGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && certCache && now < certCache.expiresAtMs) {
    return certCache.certs;
  }

  const res = await fetch(GOOGLE_CERTS_URL, { method: 'GET' });
  if (!res.ok) {
    throw new Error('Unable to verify Google sign-in right now. Please try again.');
  }

  const certs = (await res.json()) as Record<string, string>;
  const cc = res.headers.get('cache-control') || '';
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.min(Math.max(parseInt(maxAgeMatch[1], 10), 60), 86400) : 3600;

  certCache = {
    certs,
    expiresAtMs: now + maxAgeSec * 1000,
  };
  return certs;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const jsonStr = Buffer.from(segment, 'base64url').toString('utf8');
  return JSON.parse(jsonStr) as T;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
  const projectId = readFirebaseProjectId();
  if (!projectId) {
    throw new Error('Google Admin sign-in is not configured in this workspace.');
  }

  const raw = String(idToken || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Google verification token.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: unknown; kid?: unknown };
  let payload: {
    iss?: unknown;
    aud?: unknown;
    sub?: unknown;
    exp?: unknown;
    iat?: unknown;
    auth_time?: unknown;
    email?: unknown;
    email_verified?: unknown;
    name?: unknown;
  };

  try {
    header = decodeBase64UrlJson(headerB64);
    payload = decodeBase64UrlJson(payloadB64);
  } catch {
    throw new Error('Malformed Google verification token.');
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new Error('Unsupported Google token signature algorithm.');
  }

  let certs = await fetchGooglePublicCerts(false);
  let certPem = certs[header.kid];
  if (!certPem) {
    certs = await fetchGooglePublicCerts(true);
    certPem = certs[header.kid];
  }
  if (!certPem) {
    throw new Error('Google token signing key not recognized. Please sign in again.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const sigBuf = Buffer.from(sigB64, 'base64url');
  if (!verifier.verify(certPem, sigBuf)) {
    throw new Error('Google verification signature check failed.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIss = `https://securetoken.google.com/${projectId}`;

  if (payload.iss !== expectedIss || payload.aud !== projectId) {
    throw new Error('Google token does not belong to this application.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Google token subject is missing.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Google sign-in token expired. Please try again.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Google sign-in token timestamp is invalid.');
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowSec + 300) {
    throw new Error('Google sign-in auth timestamp is invalid.');
  }
  if (payload.email_verified !== true || typeof payload.email !== 'string' || !payload.email.includes('@')) {
    throw new Error('Your Google account must have a verified email address.');
  }

  return {
    uid: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    name: typeof payload.name === 'string' ? payload.name.trim() : '',
  };
}
