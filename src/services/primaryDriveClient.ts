import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Strict in-memory OAuth token storage for Primary Drive (NEVER persisted to localStorage/sessionStorage)
let primaryDriveAccessToken = '';
let primaryDriveAccountEmail = '';

const PRIMARY_STATE_FILENAME = 'sunviloz_primary_state_v1.json';
const PRIMARY_HISTORY_PREFIX = 'sunviloz_primary_rev_';
const MAX_VERSIONED_HISTORY_COPIES = 10;

// Serialize all Primary Drive writes in this browser session so rapid changes never race
let primarySyncLock: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = primarySyncLock.then(fn, fn);
  primarySyncLock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function getFirebaseAuthInstance() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

export interface PrimaryDriveMemorySession {
  connected: boolean;
  email: string;
}

export interface PrimaryDriveVersionFile {
  id: string;
  name: string;
  size: number;
  modifiedTime: string;
  revision: number;
  checksum: string;
  isLatest: boolean;
}

export function getPrimaryDriveMemorySession(): PrimaryDriveMemorySession {
  return {
    connected: Boolean(primaryDriveAccessToken && primaryDriveAccountEmail),
    email: primaryDriveAccountEmail,
  };
}

export function clearPrimaryDriveMemorySession(): void {
  primaryDriveAccessToken = '';
  primaryDriveAccountEmail = '';
}

async function primaryDriveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!primaryDriveAccessToken) {
    throw new Error(
      'Primary Google Drive session is not active in this browser. Click "Connect Primary Google Drive" to authorize.'
    );
  }
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${primaryDriveAccessToken}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    primaryDriveAccessToken = '';
    throw new Error('Primary Google Drive authorization expired. Please reconnect.');
  }
  return res;
}

/**
 * Authorizes the admin's designated Primary Google Account with private appDataFolder scope.
 * Strictly rejects connecting the same Google account already assigned to Secondary Drive.
 */
export async function connectPrimaryGoogleDrive(params?: {
  disallowEmail?: string;
  emailHint?: string;
}): Promise<{ email: string; latestFileId: string; hasRemoteData: boolean; remoteRevision: number }> {
  const auth = getFirebaseAuthInstance();
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.appdata');
  provider.setCustomParameters({
    prompt: 'select_account',
    ...(params?.emailHint ? { login_hint: params.emailHint } : {}),
  });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken || '';
  const email = (result.user?.email || '').trim().toLowerCase();

  if (!accessToken || !email) {
    throw new Error(
      'Google Drive permission was not granted. Please allow the popup and approve Private App Data access.'
    );
  }

  const disallowed = String(params?.disallowEmail || '').trim().toLowerCase();
  if (disallowed && email === disallowed) {
    throw new Error(
      `Cannot use ${email} for Primary Drive because it is already connected as your Secondary Backup Drive. Please select a different Google account.`
    );
  }

  primaryDriveAccessToken = accessToken;
  primaryDriveAccountEmail = email;

  // Inspect existing latest file inside private appDataFolder
  const existing = await findLatestPrimaryStateFile();
  return {
    email,
    latestFileId: existing?.id || '',
    hasRemoteData: Boolean(existing),
    remoteRevision: existing?.revision || 0,
  };
}

export async function findLatestPrimaryStateFile(): Promise<PrimaryDriveVersionFile | null> {
  const q = `name = '${PRIMARY_STATE_FILENAME}' and trashed = false`;
  const res = await primaryDriveFetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(
      q
    )}&fields=files(id,name,size,modifiedTime,appProperties)&orderBy=modifiedTime desc&pageSize=5`
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Failed to inspect Primary Drive appDataFolder (HTTP ${res.status}): ${errText.slice(0, 140)}`
    );
  }
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      size?: string;
      modifiedTime?: string;
      appProperties?: Record<string, string>;
    }>;
  };
  const first = data.files?.[0];
  if (!first) return null;
  return {
    id: first.id,
    name: first.name,
    size: Number(first.size || 0),
    modifiedTime: first.modifiedTime || '',
    revision: Number(first.appProperties?.syncRevision || 0),
    checksum: String(first.appProperties?.checksumSha256 || ''),
    isLatest: true,
  };
}

export async function listPrimaryDriveVersions(): Promise<PrimaryDriveVersionFile[]> {
  const res = await primaryDriveFetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(
      'trashed = false'
    )}&fields=files(id,name,size,modifiedTime,appProperties)&orderBy=modifiedTime desc&pageSize=25`
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Failed to list Primary Drive versions (HTTP ${res.status}): ${errText.slice(0, 140)}`
    );
  }
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      size?: string;
      modifiedTime?: string;
      appProperties?: Record<string, string>;
    }>;
  };
  return (data.files || [])
    .filter(
      (f) => f.name === PRIMARY_STATE_FILENAME || f.name.startsWith(PRIMARY_HISTORY_PREFIX)
    )
    .map((f) => ({
      id: f.id,
      name: f.name,
      size: Number(f.size || 0),
      modifiedTime: f.modifiedTime || '',
      revision: Number(f.appProperties?.syncRevision || 0),
      checksum: String(f.appProperties?.checksumSha256 || ''),
      isLatest: f.name === PRIMARY_STATE_FILENAME,
    }));
}

export async function downloadPrimaryDriveSnapshot(
  fileId: string
): Promise<Record<string, unknown>> {
  const res = await primaryDriveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Failed to download Primary Drive snapshot (HTTP ${res.status}): ${errText.slice(0, 140)}`
    );
  }
  const parsed = (await res.json()) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Primary Drive snapshot file is not valid JSON.');
  }
  return parsed;
}

async function uploadMultipartAppDataFile(params: {
  existingFileId?: string;
  name: string;
  content: string;
  appProperties: Record<string, string>;
}): Promise<{ id: string; modifiedTime: string; size: number }> {
  const boundary = `sunviloz_pri_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata: Record<string, unknown> = {
    name: params.name,
    mimeType: 'application/json',
    appProperties: params.appProperties,
  };
  if (!params.existingFileId) {
    metadata.parents = ['appDataFolder'];
  }

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    params.content,
    `--${boundary}--`,
  ].join('\r\n');

  const url = params.existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        params.existingFileId
      )}?uploadType=multipart&fields=id,modifiedTime,size`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime,size';

  const res = await primaryDriveFetch(url, {
    method: params.existingFileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Google Drive write failed (HTTP ${res.status}): ${errText.slice(0, 140)}`
    );
  }

  const uploaded = (await res.json()) as { id?: string; modifiedTime?: string; size?: string };
  if (!uploaded.id) {
    throw new Error('Google Drive did not return a confirmed file ID.');
  }
  return {
    id: uploaded.id,
    modifiedTime: uploaded.modifiedTime || new Date().toISOString(),
    size: Number(uploaded.size || new Blob([params.content]).size),
  };
}

export interface PrimaryDriveSyncResult {
  status: 'saved' | 'conflict';
  fileId?: string;
  revision?: number;
  checksumSha256?: string;
  email?: string;
  remoteRevision?: number;
  remoteFileId?: string;
  remoteModifiedTime?: string;
}

/**
 * Serialized, revision-checked write to Primary Google Drive private appDataFolder.
 * - Checks remote revision first so two devices cannot overwrite each other silently.
 * - Writes both the latest state file and a versioned recovery snapshot.
 * - Returns 'saved' ONLY AFTER Google Drive confirms HTTP 200 with a verified file ID.
 */
export async function syncSnapshotToPrimaryDrive(params: {
  snapshot: Record<string, unknown>;
  expectedBaseRevision: number;
  forceOverwrite?: boolean;
}): Promise<PrimaryDriveSyncResult> {
  return runSerialized(async () => {
    const revision = Math.max(1, Number(params.snapshot.sync_revision || 1));
    const checksum = String(params.snapshot.integrity_sha256 || '');
    const latestRemote = await findLatestPrimaryStateFile();

    // Conflict guard: if another device pushed a newer revision with a different checksum,
    // stop and let the admin explicitly load remote data or force push!
    if (
      latestRemote &&
      !params.forceOverwrite &&
      latestRemote.revision > params.expectedBaseRevision &&
      latestRemote.checksum &&
      latestRemote.checksum !== checksum
    ) {
      return {
        status: 'conflict',
        remoteRevision: latestRemote.revision,
        remoteFileId: latestRemote.id,
        remoteModifiedTime: latestRemote.modifiedTime,
      };
    }

    const jsonContent = JSON.stringify(params.snapshot);
    const props = {
      syncRevision: String(revision),
      checksumSha256: checksum,
      appName: 'SUNVILOZ_CLEAN_CARE',
    };

    // 1. Write/update primary latest file (confirmed by Google)
    const savedLatest = await uploadMultipartAppDataFile({
      existingFileId: latestRemote?.id,
      name: PRIMARY_STATE_FILENAME,
      content: jsonContent,
      appProperties: props,
    });

    // 2. Write an immutable versioned recovery copy (best-effort, does not fail main confirmed write)
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await uploadMultipartAppDataFile({
        name: `${PRIMARY_HISTORY_PREFIX}v${revision}_${stamp}.json`,
        content: jsonContent,
        appProperties: props,
      });

      // Prune old versioned copies beyond MAX_VERSIONED_HISTORY_COPIES
      const versions = await listPrimaryDriveVersions();
      const historyOnly = versions.filter((v) => !v.isLatest);
      if (historyOnly.length > MAX_VERSIONED_HISTORY_COPIES) {
        const toDelete = historyOnly.slice(MAX_VERSIONED_HISTORY_COPIES);
        for (const old of toDelete) {
          await primaryDriveFetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(old.id)}`,
            { method: 'DELETE' }
          ).catch(() => undefined);
        }
      }
    } catch {
      // Main state file is already verified written; history pruning is best-effort
    }

    return {
      status: 'saved',
      fileId: savedLatest.id,
      revision,
      checksumSha256: checksum,
      email: primaryDriveAccountEmail,
    };
  });
}
