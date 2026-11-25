import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Strict in-memory OAuth token storage (NEVER persisted to localStorage or sessionStorage)
let secondaryDriveAccessToken = '';
let secondaryDriveAccountEmail = '';

const DEFAULT_BACKUP_FOLDER_NAME = 'SUNVILOZ Clean Care Backups';

function getFirebaseAuthInstance() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

export interface SecondaryDriveFileItem {
  id: string;
  name: string;
  size: number;
  createdTime: string;
  ownerEmail: string;
}

export function getSecondaryDriveMemorySession(): {
  connected: boolean;
  email: string;
} {
  return {
    connected: Boolean(secondaryDriveAccessToken && secondaryDriveAccountEmail),
    email: secondaryDriveAccountEmail,
  };
}

function escapeDriveQueryValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!secondaryDriveAccessToken) {
    throw new Error(
      'Secondary Google Drive session is not active. Click "Connect Secondary Google Account" to authorize.'
    );
  }
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${secondaryDriveAccessToken}`);

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    secondaryDriveAccessToken = '';
    throw new Error('Secondary Google Drive authorization expired. Please reconnect.');
  }
  return res;
}

async function ensurePrivateBackupFolder(
  folderName = DEFAULT_BACKUP_FOLDER_NAME
): Promise<{ folderId: string; folderName: string }> {
  const safeName = folderName.trim() || DEFAULT_BACKUP_FOLDER_NAME;
  const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQueryValue(
    safeName
  )}' and trashed = false and 'me' in owners`;

  const searchRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,owners(emailAddress,me))&orderBy=createdTime desc&pageSize=5`
  );
  if (!searchRes.ok) {
    const errText = await searchRes.text().catch(() => '');
    throw new Error(`Failed to find backup folder (${searchRes.status}): ${errText.slice(0, 120)}`);
  }
  const searchJson = (await searchRes.json()) as {
    files?: Array<{ id: string; name: string }>;
  };
  if (searchJson.files && searchJson.files.length > 0) {
    return {
      folderId: searchJson.files[0].id,
      folderName: searchJson.files[0].name,
    };
  }

  // Create a brand new private folder owned by the signed-in second Google account
  const createRes = await driveFetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: safeName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }
  );
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new Error(`Failed to create backup folder (${createRes.status}): ${errText.slice(0, 120)}`);
  }
  const created = (await createRes.json()) as { id: string; name: string };
  return { folderId: created.id, folderName: created.name };
}

/**
 * Authorizes an independent second Google account for private Google Drive backup.
 * Always prompts account selection and strictly rejects the same account connected to Primary Drive.
 */
export async function connectSecondaryGoogleDrive(
  folderName = DEFAULT_BACKUP_FOLDER_NAME,
  disallowEmail = ''
): Promise<{ email: string; folderId: string; folderName: string }> {
  const auth = getFirebaseAuthInstance();
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.setCustomParameters({
    prompt: 'select_account',
  });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken || '';
  const email = (result.user?.email || '').trim().toLowerCase();

  if (!accessToken || !email) {
    throw new Error(
      'Google Drive access token was not returned. Please allow the popup permissions and try again.'
    );
  }

  const disallowed = disallowEmail.trim().toLowerCase();
  if (disallowed && email === disallowed) {
    throw new Error(
      `Cannot use ${email} for Secondary Backup Drive because it is already connected as your Primary Google Drive. Please choose a different Google account.`
    );
  }

  secondaryDriveAccessToken = accessToken;
  secondaryDriveAccountEmail = email;

  const folder = await ensurePrivateBackupFolder(folderName);
  return {
    email,
    folderId: folder.folderId,
    folderName: folder.folderName,
  };
}

export async function disconnectSecondaryGoogleDrive(): Promise<void> {
  secondaryDriveAccessToken = '';
  secondaryDriveAccountEmail = '';
}

/**
 * Uploads an actual backup JSON file owned by the second Google account inside its private backup folder.
 * Never creates a shortcut or shared reference.
 */
export async function uploadBackupToSecondaryDrive(params: {
  folderId?: string;
  folderName?: string;
  fileName: string;
  backupObject: Record<string, unknown>;
}): Promise<{
  fileId: string;
  fileName: string;
  sizeBytes: number;
  createdTime: string;
  ownerEmail: string;
  folderId: string;
  folderName: string;
}> {
  let folderId = params.folderId || '';
  let folderName = params.folderName || DEFAULT_BACKUP_FOLDER_NAME;

  if (!folderId) {
    const ensured = await ensurePrivateBackupFolder(folderName);
    folderId = ensured.folderId;
    folderName = ensured.folderName;
  }

  const jsonContent = JSON.stringify(params.backupObject, null, 2);
  const boundary = `sunviloz_bkp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata = {
    name: params.fileName,
    mimeType: 'application/json',
    parents: [folderId],
    description: 'SUNVILOZ Clean Care verified full backup package',
  };

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    jsonContent,
    `--${boundary}--`,
  ].join('\r\n');

  const uploadRes = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime,owners(emailAddress,me)',
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(
      `Failed to upload backup to Secondary Google Drive (HTTP ${uploadRes.status}): ${errText.slice(0, 140)}`
    );
  }

  const uploaded = (await uploadRes.json()) as {
    id: string;
    name: string;
    size?: string;
    createdTime?: string;
    owners?: Array<{ emailAddress?: string; me?: boolean }>;
  };

  if (!uploaded.id) {
    throw new Error('Could not verify the uploaded backup file ID.');
  }

  const ownerEmail =
    uploaded.owners?.find((o) => o.me)?.emailAddress ||
    uploaded.owners?.[0]?.emailAddress ||
    secondaryDriveAccountEmail;

  return {
    fileId: uploaded.id,
    fileName: uploaded.name || params.fileName,
    sizeBytes: Number(uploaded.size || new Blob([jsonContent]).size),
    createdTime: uploaded.createdTime || new Date().toISOString(),
    ownerEmail,
    folderId,
    folderName,
  };
}

/**
 * Lists dated backup versions stored in the second Google account's private backup folder.
 */
export async function listSecondaryDriveBackups(
  folderId?: string,
  folderName = DEFAULT_BACKUP_FOLDER_NAME
): Promise<{ folderId: string; folderName: string; files: SecondaryDriveFileItem[] }> {
  let resolvedFolderId = folderId || '';
  let resolvedFolderName = folderName;
  if (!resolvedFolderId) {
    const ensured = await ensurePrivateBackupFolder(folderName);
    resolvedFolderId = ensured.folderId;
    resolvedFolderName = ensured.folderName;
  }

  const q = `'${escapeDriveQueryValue(
    resolvedFolderId
  )}' in parents and trashed = false and mimeType = 'application/json' and 'me' in owners`;

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,size,createdTime,owners(emailAddress,me))&orderBy=createdTime desc&pageSize=30`
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Failed to list backups from Secondary Google Drive (${res.status}): ${errText.slice(0, 120)}`
    );
  }

  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      size?: string;
      createdTime?: string;
      owners?: Array<{ emailAddress?: string; me?: boolean }>;
    }>;
  };

  const files: SecondaryDriveFileItem[] = (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    size: Number(f.size || 0),
    createdTime: f.createdTime || '',
    ownerEmail:
      f.owners?.find((o) => o.me)?.emailAddress ||
      f.owners?.[0]?.emailAddress ||
      secondaryDriveAccountEmail,
  }));

  return {
    folderId: resolvedFolderId,
    folderName: resolvedFolderName,
    files,
  };
}

/**
 * Downloads and parses a backup file directly from the second Google account's Drive.
 * Works completely independently without access to the primary Google Drive.
 */
export async function downloadSecondaryDriveBackup(
  fileId: string
): Promise<Record<string, unknown>> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Failed to download backup from Secondary Drive (${res.status}): ${errText.slice(0, 120)}`
    );
  }
  const parsed = (await res.json()) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Downloaded backup file is not valid JSON.');
  }
  return parsed;
}
