/**
 * Authenticated Google Apps Script Bridge (Server-Side Only).
 * Enforces strict HTTPS + Google Apps Script host allowlist to block SSRF.
 */

const ALLOWED_GAS_HOSTS = new Set([
  'script.google.com',
  'script.googleusercontent.com',
]);

export function validateGoogleWebAppUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Please enter a valid Google Apps Script Web App URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Google Apps Script URL must start with https://.');
  }
  if (!ALLOWED_GAS_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      'Only approved Google Apps Script domains (script.google.com) are allowed.'
    );
  }
  return parsed.toString();
}

export interface GasBridgeResponse {
  ok: boolean;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export async function callGoogleAppsScriptBridge(
  webAppUrl: string,
  syncSecret: string,
  action: string,
  payload: Record<string, unknown>
): Promise<GasBridgeResponse> {
  const safeUrl = validateGoogleWebAppUrl(webAppUrl);
  if (!safeUrl) {
    throw new Error('Please save the Google Apps Script Web App URL in Settings → Google Sync first.');
  }
  if (!syncSecret || syncSecret.trim().length < 8) {
    throw new Error('Please configure a sync secret token of at least 8 characters in Settings → Google Sync.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(safeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: syncSecret.trim(),
        action,
        payload,
      }),
      redirect: 'follow',
      signal: controller.signal,
    });

    const text = await response.text();
    let json: GasBridgeResponse | null = null;
    try {
      json = JSON.parse(text) as GasBridgeResponse;
    } catch {
      if (!response.ok) {
        throw new Error(`Google Apps Script error (HTTP ${response.status}). Please verify deployment permissions.`);
      }
      throw new Error('Invalid JSON response from Google Apps Script. Please check deployment settings.');
    }

    if (!response.ok || !json.ok) {
      throw new Error(json.error || json.message || 'Google connection error.');
    }

    return json;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Google Apps Script request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function pushSecondaryDriveBackup(
  webAppUrl: string,
  syncSecret: string,
  fileName: string,
  folderName: string,
  backup: Record<string, unknown>
): Promise<{ driveFileId: string; ownerEmail: string; folderName: string; sizeBytes: number }> {
  const res = await callGoogleAppsScriptBridge(webAppUrl, syncSecret, 'save_secondary_backup', {
    file_name: fileName,
    folder_name: folderName || 'SUNVILOZ Clean Care Backups',
    backup,
  });
  return {
    driveFileId: String(res.data?.file_id || ''),
    ownerEmail: String(res.data?.owner_email || ''),
    folderName: String(res.data?.folder_name || folderName || 'SUNVILOZ Clean Care Backups'),
    sizeBytes: Number(res.data?.size_bytes || 0),
  };
}

