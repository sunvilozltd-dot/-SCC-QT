/**
 * SUNVILOZ Clean Care — Secondary Google Drive Backup Bridge (SecondaryBackupDrive.gs)
 *
 * Deploy this script under your SECOND (independent) Google account so the primary
 * Apps Script daily scheduler can store actual private dated backup files owned by the
 * second Google account even when the Android phone app is completely closed.
 *
 * Setup:
 * 1. Sign in to your SECOND Google account and open https://script.google.com -> New Project.
 * 2. Paste this file as Code.gs.
 * 3. Run setBackupSecret('your-strong-secret-min-12-chars') once from the Editor.
 * 4. Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone.
 * 5. Save the Web App URL and Secret in SUNVILOZ Clean Care -> Settings -> Backup & Restore.
 */

var SECONDARY_BACKUP_CONFIG = {
  TIMEZONE: 'Asia/Dhaka',
  DEFAULT_FOLDER_NAME: 'SUNVILOZ Clean Care Backups'
};

function setBackupSecret(secretValue) {
  var clean = String(secretValue || '').trim();
  if (clean.length < 12) {
    throw new Error('BACKUP_SECRET must be at least 12 characters.');
  }
  PropertiesService.getScriptProperties().setProperty('BACKUP_SECRET', clean);
  return { ok: true, message: 'BACKUP_SECRET saved securely in Script Properties.' };
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expectedSecret = (PropertiesService.getScriptProperties().getProperty('BACKUP_SECRET') || '').trim();
    if (!expectedSecret) {
      return secJsonResponse_({
        ok: false,
        error: 'BACKUP_SECRET is not configured yet. Run setBackupSecret(...) once in the secondary Apps Script project.'
      });
    }
    if (!secConstantTimeEqual_(String(body.secret || '').trim(), expectedSecret)) {
      return secJsonResponse_({ ok: false, error: 'Unauthorized: invalid backup bridge secret.' });
    }

    if (!lock.tryLock(25000)) {
      return secJsonResponse_({ ok: false, error: 'Backup bridge is busy. Please retry shortly.' });
    }

    var action = String(body.action || '');
    var payload = body.payload || {};
    var folderName = String(payload.folder_name || SECONDARY_BACKUP_CONFIG.DEFAULT_FOLDER_NAME).trim();
    var folder = getOrCreateOwnedPrivateFolder_(folderName);
    var ownerEmail = '';
    try { ownerEmail = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase(); } catch (err2) {}

    if (action === 'save_secondary_backup') {
      var stamp = Utilities.formatDate(new Date(), SECONDARY_BACKUP_CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmmss');
      var fileName = String(payload.file_name || ('sunviloz_backup_' + stamp + '.json')).trim();
      var backupObj = payload.backup || {};
      var content = JSON.stringify(backupObj, null, 2);

      // Creates a brand-new actual private file owned directly by this second Google account (NOT a shortcut)
      var blob = Utilities.newBlob(content, 'application/json', fileName);
      var created = folder.createFile(blob);
      try { created.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (err3) {}

      // Read back the saved file to verify integrity before marking success
      var readBack = created.getBlob().getDataAsString('UTF-8');
      var parsedBack = JSON.parse(readBack);
      var verifiedChecksum = '';
      if (parsedBack && parsedBack.payload) {
        var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(parsedBack.payload), Utilities.Charset.UTF_8);
        verifiedChecksum = secBytesToHex_(digest);
      }
      if (payload.expected_checksum_sha256 && !secConstantTimeEqual_(verifiedChecksum, String(payload.expected_checksum_sha256))) {
        created.setTrashed(true);
        throw new Error('Backup read-back integrity check failed; corrupted file discarded.');
      }

      return secJsonResponse_({
        ok: true,
        message: 'Verified private backup saved to Secondary Google Drive.',
        data: {
          file_id: created.getId(),
          file_name: created.getName(),
          folder_id: folder.getId(),
          folder_name: folder.getName(),
          size_bytes: created.getSize(),
          account_email: ownerEmail,
          verified_checksum: verifiedChecksum
        }
      });
    }

    if (action === 'list_secondary_backups') {
      var files = folder.getFiles();
      var list = [];
      while (files.hasNext()) {
        var f = files.next();
        if (f.isTrashed()) continue;
        list.push({
          file_id: f.getId(),
          file_name: f.getName(),
          size_bytes: f.getSize(),
          created_at: Utilities.formatDate(f.getDateCreated(), SECONDARY_BACKUP_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss')
        });
      }
      list.sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });
      return secJsonResponse_({
        ok: true,
        data: { account_email: ownerEmail, folder_name: folder.getName(), files: list }
      });
    }

    if (action === 'read_secondary_backup') {
      var fileId = String(payload.file_id || '').trim();
      var file = DriveApp.getFileById(fileId);
      if (file.isTrashed()) throw new Error('Requested backup file is in Trash.');
      var text = file.getBlob().getDataAsString('UTF-8');
      return secJsonResponse_({
        ok: true,
        data: { file_id: file.getId(), file_name: file.getName(), backup: JSON.parse(text) }
      });
    }

    return secJsonResponse_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return secJsonResponse_({ ok: false, error: err && err.message ? err.message : String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
}

function getOrCreateOwnedPrivateFolder_(folderName) {
  var iter = DriveApp.getFoldersByName(folderName);
  while (iter.hasNext()) {
    var candidate = iter.next();
    if (candidate.isTrashed()) continue;
    try {
      var owner = candidate.getOwner();
      var me = Session.getEffectiveUser().getEmail();
      if (!owner || !me || owner.getEmail().toLowerCase() === me.toLowerCase()) {
        return candidate;
      }
    } catch (err) {
      return candidate;
    }
  }
  var created = DriveApp.createFolder(folderName);
  try { created.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (err4) {}
  return created;
}

function secBytesToHex_(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] + 256) % 256;
    var h = v.toString(16);
    out.push(h.length === 1 ? '0' + h : h);
  }
  return out.join('');
}

function secConstantTimeEqual_(a, b) {
  var diff = a.length ^ b.length;
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    diff |= ((i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0));
  }
  return diff === 0;
}

function secJsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
