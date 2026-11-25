/**
 * Google Apps Script Backend Proxy Client (server/appsScriptProxy.ts)
 *
 * When APPS_SCRIPT_WEBAPP_URL is configured, routes authentication & status checks
 * to the exact same Google Apps Script Web App backend used by the native Android app.
 *
 * Strictly distinguishes:
 * - BACKEND_UNCONFIGURED / BACKEND_UNREACHABLE / BACKEND_SETUP_REQUIRED (HTTP 503)
 * - AUTH_FAILED (HTTP 401 — "Invalid username or password.")
 */

export interface AppsScriptResponse<T = Record<string, unknown>> {
  ok: boolean;
  code?: string;
  error?: string;
  data?: T;
}

export function getConfiguredAppsScriptUrl(): string {
  return String(process.env.APPS_SCRIPT_WEBAPP_URL || '').trim();
}

export function isAppsScriptUrlValid(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'script.google.com' || u.hostname === 'script.googleusercontent.com')
    );
  } catch {
    return false;
  }
}

export class AppsScriptBackendError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 503) {
    super(message);
    this.name = 'AppsScriptBackendError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export async function callAppsScriptApi<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
  token = '',
  requestId = ''
): Promise<T> {
  const url = getConfiguredAppsScriptUrl();
  if (!url) {
    throw new AppsScriptBackendError(
      'BACKEND_UNCONFIGURED',
      'Apps Script backend URL (APPS_SCRIPT_WEBAPP_URL) is not configured yet.',
      503
    );
  }
  if (!isAppsScriptUrlValid(url)) {
    throw new AppsScriptBackendError(
      'BACKEND_UNCONFIGURED',
      'APPS_SCRIPT_WEBAPP_URL must be a valid https://script.google.com/... Web App URL.',
      503
    );
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    res = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        action,
        token,
        request_id: requestId,
        payload,
      }),
    });
    clearTimeout(timer);
  } catch {
    throw new AppsScriptBackendError(
      'BACKEND_UNREACHABLE',
      'Unable to reach the configured Google Apps Script backend. Verify your deployment URL, Web App access ("Anyone"), and internet connection.',
      503
    );
  }

  const text = await res.text();
  let parsed: AppsScriptResponse<T>;
  try {
    parsed = JSON.parse(text) as AppsScriptResponse<T>;
  } catch {
    throw new AppsScriptBackendError(
      'BACKEND_UNREACHABLE',
      'The Apps Script URL returned a non-JSON response (often caused by missing Web App deployment or wrong access permissions). Verify the deployment URL in Apps Script.',
      503
    );
  }

  if (!parsed.ok) {
    const code = String(parsed.code || 'BACKEND_ERROR');
    const msg = String(parsed.error || 'Apps Script request failed.');
    if (code === 'AUTH_FAILED') {
      throw new AppsScriptBackendError('AUTH_FAILED', msg, 401);
    }
    if (code === 'AUTH_REQUIRED' || code === 'SESSION_REVOKED') {
      throw new AppsScriptBackendError(code, msg, 401);
    }
    if (code === 'BACKEND_SETUP_REQUIRED') {
      throw new AppsScriptBackendError('BACKEND_SETUP_REQUIRED', msg, 503);
    }
    if (code === 'STATUS_LOCKED') {
      throw new AppsScriptBackendError('STATUS_LOCKED', msg, 409);
    }
    if (code === 'FORBIDDEN') {
      throw new AppsScriptBackendError('FORBIDDEN', msg, 403);
    }
    throw new AppsScriptBackendError(code, msg, 400);
  }

  return (parsed.data || {}) as T;
}
