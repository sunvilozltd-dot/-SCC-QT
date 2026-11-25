const DEVICE_ID_STORAGE_KEY = 'sunviloz_device_id_v1';

function generateOpaqueDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `dev_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  const rand = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `dev_${rand}`;
}

/**
 * Returns a stable, non-secret per-device/per-browser identifier used to bind
 * WebAuthn credentials and persistent sessions strictly to THIS phone/browser.
 */
export function getOrCreateDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && existing.length >= 8) {
      return existing;
    }
    const created = generateOpaqueDeviceId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return generateOpaqueDeviceId();
  }
}

export function getFriendlyDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Web Browser';
  const ua = navigator.userAgent || '';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /CriOS|Chrome/i.test(ua)
    ? 'Chrome'
    : /FxiOS|Firefox/i.test(ua)
    ? 'Firefox'
    : /Safari/i.test(ua)
    ? 'Safari'
    : 'Browser';

  if (/iPhone/i.test(ua)) return `iPhone (${browser})`;
  if (/iPad/i.test(ua)) return `iPad (${browser})`;
  if (/Android/i.test(ua)) return `Android Phone (${browser})`;
  if (/Macintosh|Mac OS X/i.test(ua)) return `Mac (${browser})`;
  if (/Windows/i.test(ua)) return `Windows PC (${browser})`;
  if (/Linux/i.test(ua)) return `Linux (${browser})`;
  return browser;
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return false;
  } catch {
    return false;
  }
}
