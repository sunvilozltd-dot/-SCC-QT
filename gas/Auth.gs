/**
 * SUNVILOZ Clean Care — Authentication, First-Time Setup, Account & Security,
 * and Email-Code Password Recovery (Auth.gs)
 *
 * Security guarantees:
 * - Salted PBKDF2-HMAC-SHA256 password hashing (exact passwords including symbols; never trimmed).
 * - Usernames normalized consistently by trim().toLowerCase().
 * - Fresh sign-in accepts ONLY the currently saved username and password.
 *   No default password and no Google sign-in bypass exist.
 * - First-time admin setup is allowed ONLY when the admin password has never been initialized,
 *   verified via a one-time code sent exclusively to sunvilozltd@gmail.com, rechecked under
 *   LockService.getScriptLock(), and permanently disabled once initialized.
 * - Forgot Password sends a separate-purpose one-time recovery code ONLY to the server-fixed
 *   address sunvilozltd@gmail.com (changing the admin username never changes the recovery email).
 * - All one-time codes expire after 10 minutes, are rate-limited for both requests and attempts,
 *   are invalidated immediately upon use or replacement, and are stored ONLY as salted HMAC-SHA256
 *   verifiers in the AuthCodes sheet (never plaintext, never logged, never backed up).
 * - Credential changes and password recovery revoke ALL previous admin sessions immediately.
 */

var AUTH_CONFIG = {
  PBKDF2_ITERATIONS: 10000,
  SALT_BYTES: 16,
  SESSION_TTL_DAYS: 30,
  OTP_TTL_MS: 10 * 60 * 1000,           // 10 minutes
  OTP_COOLDOWN_MS: 60 * 1000,           // 60 seconds between code requests per purpose
  OTP_MAX_REQUESTS_PER_HOUR: 5,         // Max 5 code requests per hour per purpose
  OTP_MAX_VERIFY_ATTEMPTS: 5,           // Max 5 failed verification attempts per code
  PURPOSE_INITIAL_SETUP: 'initial_setup',
  PURPOSE_PASSWORD_RECOVERY: 'password_recovery'
};

function getFixedRecoveryEmail_() {
  return SUNVILOZ_CONFIG.FIXED_RECOVERY_EMAIL;
}

function normalizeUsername_(raw) {
  return String(raw || '').trim().toLowerCase();
}

function generateRandomSaltHex_() {
  var entropy = Utilities.getUuid() + '|' + new Date().getTime() + '|' + Math.random() + '|' + Utilities.getUuid();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, entropy, Utilities.Charset.UTF_8);
  return bytesToHex_(digest.slice(0, AUTH_CONFIG.SALT_BYTES));
}

function generateSixDigitOtp_() {
  var entropy = Utilities.getUuid() + '|' + new Date().getTime() + '|' + Math.random() + '|' + Utilities.getUuid();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, entropy, Utilities.Charset.UTF_8);
  // Extract an unbiased 31-bit positive integer from first 4 SHA-256 bytes
  var n = (((digest[0] & 0x7f) << 24) | ((digest[1] & 0xff) << 16) | ((digest[2] & 0xff) << 8) | (digest[3] & 0xff)) % 1000000;
  var s = String(n);
  while (s.length < 6) s = '0' + s;
  return s;
}

/**
 * Pure Apps Script PBKDF2-HMAC-SHA256 using native Utilities.computeHmacSha256Signature.
 */
function pbkdf2HmacSha256Hex_(password, saltHex, iterations) {
  var passBytes = stringToUtf8Bytes_(String(password));
  var saltBytes = hexToBytes_(saltHex);
  var firstInput = saltBytes.concat([0, 0, 0, 1]);
  var u = Utilities.computeHmacSha256Signature(firstInput, passBytes);
  var result = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, passBytes);
    for (var j = 0; j < result.length; j++) {
      result[j] = result[j] ^ u[j];
    }
  }
  return bytesToHex_(result);
}

function hashPasswordGas_(password) {
  var exactPassword = String(password || '');
  if (exactPassword.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  if (exactPassword.length > 128) {
    throw new Error('Password must be 128 characters or fewer.');
  }
  var saltHex = generateRandomSaltHex_();
  var derivedHex = pbkdf2HmacSha256Hex_(exactPassword, saltHex, AUTH_CONFIG.PBKDF2_ITERATIONS);
  return 'pbkdf2_sha256$' + AUTH_CONFIG.PBKDF2_ITERATIONS + '$' + saltHex + '$' + derivedHex;
}

function verifyPasswordGas_(password, storedHash) {
  var exactPassword = String(password || '');
  var parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }
  var iterations = parseInt(parts[1], 10);
  var saltHex = parts[2];
  var expectedHex = parts[3];
  if (!iterations || iterations < 1000 || !saltHex || !expectedHex) {
    return false;
  }
  var actualHex = pbkdf2HmacSha256Hex_(exactPassword, saltHex, iterations);
  return constantTimeEqual_(actualHex, expectedHex);
}

function getOrCreateSigningSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SESSION_SIGNING_SECRET');
  if (!secret || secret.length < 32) {
    secret = computeSha256Hex_(Utilities.getUuid() + '|' + new Date().getTime() + '|' + Utilities.getUuid()) +
             computeSha256Hex_(Utilities.getUuid() + '|' + Math.random());
    props.setProperty('SESSION_SIGNING_SECRET', secret);
  }
  return secret;
}

function createProtectedCodeVerifier_(purpose, code) {
  var saltHex = generateRandomSaltHex_();
  var secret = getOrCreateSigningSecret_();
  var input = String(purpose) + '|' + saltHex + '|' + String(code || '').trim();
  var hmacBytes = Utilities.computeHmacSha256Signature(input, secret);
  return 'otp_hmac_sha256$' + saltHex + '$' + bytesToHex_(hmacBytes);
}

function verifyProtectedCodeVerifier_(purpose, code, storedVerifier) {
  var parts = String(storedVerifier || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'otp_hmac_sha256') return false;
  var saltHex = parts[1];
  var expectedHex = parts[2];
  if (!saltHex || !expectedHex) return false;
  var secret = getOrCreateSigningSecret_();
  var input = String(purpose) + '|' + saltHex + '|' + String(code || '').trim();
  var actualBytes = Utilities.computeHmacSha256Signature(input, secret);
  return constantTimeEqual_(bytesToHex_(actualBytes), expectedHex);
}

function signSessionToken_(payloadObj) {
  var payloadJson = JSON.stringify(payloadObj);
  var payloadB64 = Utilities.base64EncodeWebSafe(payloadJson).replace(/=+$/, '');
  var secret = getOrCreateSigningSecret_();
  var sigBytes = Utilities.computeHmacSha256Signature(payloadB64, secret);
  var sigB64 = Utilities.base64EncodeWebSafe(sigBytes).replace(/=+$/, '');
  return payloadB64 + '.' + sigB64;
}

function verifySessionToken_(token) {
  var raw = String(token || '').trim();
  var dot = raw.indexOf('.');
  if (dot <= 0) return null;
  var payloadB64 = raw.slice(0, dot);
  var sigB64 = raw.slice(dot + 1);
  var secret = getOrCreateSigningSecret_();
  var expectedBytes = Utilities.computeHmacSha256Signature(payloadB64, secret);
  var expectedB64 = Utilities.base64EncodeWebSafe(expectedBytes).replace(/=+$/, '');
  if (!constantTimeEqual_(sigB64, expectedB64)) {
    return null;
  }
  try {
    var padded = payloadB64 + '==='.slice((payloadB64.length + 3) % 4);
    var jsonStr = Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString('UTF-8');
    var parsed = JSON.parse(jsonStr);
    if (!parsed || !parsed.uid || !parsed.sid || !parsed.exp) return null;
    if (Date.now() > Number(parsed.exp)) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function toPublicAccount_(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    role: String(row.role || 'supervisor'),
    name: String(row.name || ''),
    username: String(row.username || ''),
    phone_display: String(row.phone_display || ''),
    is_active: String(row.is_active) === '1' || row.is_active === true || row.is_active === 1
  };
}

function findAccountByUsername_(ss, usernameRaw) {
  var norm = normalizeUsername_(usernameRaw);
  if (!norm) return null;
  var rows = readSheetObjects_(ss, 'Accounts');
  for (var i = 0; i < rows.length; i++) {
    if (normalizeUsername_(rows[i].username) === norm) {
      return rows[i];
    }
  }
  return null;
}

function findAccountById_(ss, accountId) {
  var rows = readSheetObjects_(ss, 'Accounts');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(accountId)) {
      return rows[i];
    }
  }
  return null;
}

function findPrimaryAdmin_(ss) {
  var rows = readSheetObjects_(ss, 'Accounts');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].role) === 'admin') {
      return rows[i];
    }
  }
  return null;
}

/**
 * First-time admin setup is eligible ONLY when the admin password has NEVER been initialized.
 * Once a password hash is set (or admin_password_initialized === '1'), setup is permanently disabled.
 */
function isInitialAdminSetupEligible_(ss) {
  var settings = getSettingsMap_(ss);
  if (settings.admin_password_initialized === '1') {
    return false;
  }
  var admin = findPrimaryAdmin_(ss);
  if (admin && String(admin.password_hash || '').trim().length > 0) {
    // Existing initialized admin found — lock setup permanently
    setSetting_(ss, 'admin_password_initialized', '1');
    return false;
  }
  return true;
}

function revokeSessionsForUser_(ss, userId, reason, keepSessionId) {
  var sheet = ss.getSheetByName('Sessions');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return;
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var sidIdx = headers.indexOf('session_id');
  var uidIdx = headers.indexOf('user_id');
  var revAtIdx = headers.indexOf('revoked_at');
  var revReasonIdx = headers.indexOf('revoked_reason');
  var now = getNowDhakaTimestamp_();
  var changed = false;

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][uidIdx]) === String(userId) && !String(values[r][revAtIdx] || '').trim()) {
      if (keepSessionId && String(values[r][sidIdx]) === String(keepSessionId)) {
        continue;
      }
      values[r][revAtIdx] = now;
      values[r][revReasonIdx] = String(reason || 'revoked');
      changed = true;
    }
  }
  if (changed) {
    sheet.getRange(2, 1, values.length - 1, headers.length).setValues(values.slice(1));
  }
}

function createSessionForAccount_(ss, accountRow, deviceId, deviceLabel) {
  var now = getNowDhakaTimestamp_();
  var sid = makeUid_('SES');
  var expMs = Date.now() + AUTH_CONFIG.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  var expIso = Utilities.formatDate(new Date(expMs), SUNVILOZ_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var tv = parseInt(String(accountRow.token_version || '1'), 10) || 1;
  var cleanDevId = String(deviceId || makeUid_('DEV')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  var cleanDevLabel = String(deviceLabel || 'Android Device').trim().slice(0, 80);

  appendSheetObject_(ss, 'Sessions', {
    session_id: sid,
    user_id: String(accountRow.id),
    device_id: cleanDevId,
    device_label: cleanDevLabel,
    token_version: tv,
    created_at: now,
    last_seen_at: now,
    expires_at: expIso,
    revoked_at: '',
    revoked_reason: ''
  });

  var token = signSessionToken_({
    uid: String(accountRow.id),
    role: String(accountRow.role),
    sid: sid,
    did: cleanDevId,
    tv: tv,
    exp: expMs
  });

  return {
    token: token,
    session_id: sid,
    device_id: cleanDevId,
    user: toPublicAccount_(accountRow)
  };
}

function authenticateSessionToken_(ss, token) {
  var payload = verifySessionToken_(token);
  if (!payload) {
    throw new Error('AUTH_REQUIRED: Invalid or expired session. Please sign in again.');
  }
  var account = findAccountById_(ss, payload.uid);
  if (!account) {
    throw new Error('AUTH_REQUIRED: Account no longer exists. Please sign in again.');
  }
  var active = String(account.is_active) === '1' || account.is_active === true || account.is_active === 1;
  if (!active) {
    throw new Error('SESSION_REVOKED: This account has been deactivated by the administrator.');
  }
  var currentTv = parseInt(String(account.token_version || '1'), 10) || 1;
  if (Number(payload.tv) !== currentTv) {
    throw new Error('SESSION_REVOKED: Admin credentials were updated. Please sign in with your current username and password.');
  }

  var sessions = readSheetObjects_(ss, 'Sessions');
  var found = null;
  for (var i = sessions.length - 1; i >= 0; i--) {
    if (String(sessions[i].session_id) === String(payload.sid)) {
      found = sessions[i];
      break;
    }
  }
  if (!found || String(found.revoked_at || '').trim() !== '') {
    throw new Error('SESSION_REVOKED: This session has been signed out or revoked.');
  }

  return {
    user: toPublicAccount_(account),
    accountRow: account,
    sessionId: String(payload.sid),
    deviceId: String(payload.did || '')
  };
}

// ============================================================================
// PROTECTED ONE-TIME EMAIL VERIFICATION & RECOVERY CODES
// ============================================================================

function checkOtpRequestRateLimit_(ss, purpose, nowMs) {
  var rows = readSheetObjects_(ss, 'AuthCodes');
  var hourAgo = nowMs - 60 * 60 * 1000;
  var countLastHour = 0;
  var latestMs = 0;

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].purpose) !== String(purpose)) continue;
    var createdMs = Number(rows[i].created_at_ms || 0);
    if (createdMs >= hourAgo) {
      countLastHour++;
    }
    if (createdMs > latestMs) {
      latestMs = createdMs;
    }
  }

  if (latestMs > 0 && (nowMs - latestMs) < AUTH_CONFIG.OTP_COOLDOWN_MS) {
    var waitSec = Math.ceil((AUTH_CONFIG.OTP_COOLDOWN_MS - (nowMs - latestMs)) / 1000);
    throw new Error('RATE_LIMITED: Please wait ' + waitSec + ' seconds before requesting another code.');
  }
  if (countLastHour >= AUTH_CONFIG.OTP_MAX_REQUESTS_PER_HOUR) {
    throw new Error('RATE_LIMITED: Too many code requests in the past hour. Please try again later.');
  }
}

function invalidateActiveCodesForPurpose_(ss, purpose) {
  var sheet = ss.getSheetByName('AuthCodes');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return;
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var pIdx = headers.indexOf('purpose');
  var usedIdx = headers.indexOf('used_at');
  var invIdx = headers.indexOf('invalidated_at');
  var now = getNowDhakaTimestamp_();
  var changed = false;

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][pIdx]) === String(purpose) &&
        !String(values[r][usedIdx] || '').trim() &&
        !String(values[r][invIdx] || '').trim()) {
      values[r][invIdx] = now;
      changed = true;
    }
  }
  if (changed) {
    sheet.getRange(2, 1, values.length - 1, headers.length).setValues(values.slice(1));
  }
}

function issueAndSendOtpCode_(ss, purpose, targetAccountId) {
  var nowMs = Date.now();
  checkOtpRequestRateLimit_(ss, purpose, nowMs);

  // Replace any previously active code for this purpose
  invalidateActiveCodesForPurpose_(ss, purpose);

  var recipient = getFixedRecoveryEmail_();
  var code = generateSixDigitOtp_();
  var verifier = createProtectedCodeVerifier_(purpose, code);
  var nowStr = getNowDhakaTimestamp_();
  var expiresAtMs = nowMs + AUTH_CONFIG.OTP_TTL_MS;

  var subject = purpose === AUTH_CONFIG.PURPOSE_INITIAL_SETUP
    ? 'SUNVILOZ Clean Care — First-Time Admin Setup Verification Code'
    : 'SUNVILOZ Clean Care — Admin Password Recovery Code';

  var heading = purpose === AUTH_CONFIG.PURPOSE_INITIAL_SETUP
    ? 'First-Time Admin Account Setup'
    : 'Admin Password Recovery';

  var bodyText = [
    'SUNVILOZ Clean Care — ' + heading,
    '',
    'Your one-time verification code is: ' + code,
    '',
    'This code expires in 10 minutes and can only be used once.',
    'If you did not request this code, ignore this email — your account remains protected.',
    '',
    '— SUNVILOZ Clean Care Security'
  ].join('\n');

  // Send strictly to the fixed owner email sunvilozltd@gmail.com (never logged!)
  try {
    GmailApp.sendEmail(recipient, subject, bodyText);
  } catch (mailErr) {
    throw new Error(
      'EMAIL_DELIVERY_FAILED: Unable to send verification email via Apps Script GmailApp. ' +
      'The workspace owner must authorize Gmail permission in the Apps Script Editor.'
    );
  }

  appendSheetObject_(ss, 'AuthCodes', {
    code_id: makeUid_('OTP'),
    purpose: purpose,
    target_account_id: String(targetAccountId || SUNVILOZ_CONFIG.INITIAL_ADMIN_ID),
    recipient_email: recipient,
    code_verifier: verifier,
    expires_at_ms: expiresAtMs,
    attempt_count: 0,
    max_attempts: AUTH_CONFIG.OTP_MAX_VERIFY_ATTEMPTS,
    used_at: '',
    invalidated_at: '',
    created_at_ms: nowMs,
    created_at: nowStr
  });
}

function verifyOtpCode_(ss, purpose, codeRaw, consume) {
  var code = String(codeRaw || '').trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error('INVALID_CODE: Please enter the 6-digit verification code.');
  }

  var rows = readSheetObjects_(ss, 'AuthCodes');
  var latest = null;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i].purpose) === String(purpose)) {
      latest = rows[i];
      break;
    }
  }

  if (!latest) {
    throw new Error('INVALID_CODE: Verification code is invalid or expired. Please request a new code.');
  }
  if (String(latest.used_at || '').trim() !== '') {
    throw new Error('INVALID_CODE: This verification code has already been used. Please request a new code.');
  }
  if (String(latest.invalidated_at || '').trim() !== '') {
    throw new Error('INVALID_CODE: This verification code is no longer valid. Please request a new code.');
  }

  var nowMs = Date.now();
  if (nowMs > Number(latest.expires_at_ms || 0)) {
    updateSheetObjectByKey_(ss, 'AuthCodes', 'code_id', latest.code_id, {
      invalidated_at: getNowDhakaTimestamp_()
    });
    throw new Error('CODE_EXPIRED: This verification code has expired after 10 minutes. Please request a new code.');
  }

  var attempts = parseInt(String(latest.attempt_count || '0'), 10) || 0;
  var maxAttempts = parseInt(String(latest.max_attempts || AUTH_CONFIG.OTP_MAX_VERIFY_ATTEMPTS), 10) || AUTH_CONFIG.OTP_MAX_VERIFY_ATTEMPTS;
  if (attempts >= maxAttempts) {
    updateSheetObjectByKey_(ss, 'AuthCodes', 'code_id', latest.code_id, {
      invalidated_at: getNowDhakaTimestamp_()
    });
    throw new Error('RATE_LIMITED: Too many incorrect verification attempts. Please request a new code.');
  }

  if (!verifyProtectedCodeVerifier_(purpose, code, latest.code_verifier)) {
    var nextAttempts = attempts + 1;
    var patchFail = { attempt_count: nextAttempts };
    if (nextAttempts >= maxAttempts) {
      patchFail.invalidated_at = getNowDhakaTimestamp_();
    }
    updateSheetObjectByKey_(ss, 'AuthCodes', 'code_id', latest.code_id, patchFail);
    throw new Error('INVALID_CODE: Verification code is incorrect.');
  }

  if (consume) {
    updateSheetObjectByKey_(ss, 'AuthCodes', 'code_id', latest.code_id, {
      used_at: getNowDhakaTimestamp_()
    });
  }
  return latest;
}

// ============================================================================
// OWNER-ONLY APPS SCRIPT EDITOR HELPER (NOT EXPOSED TO doPost / doGet)
// ============================================================================

/**
 * Run this once from the Apps Script Editor to verify GmailApp authorization
 * and confirm live email delivery to sunvilozltd@gmail.com.
 */
function testRecoveryEmailDelivery() {
  var recipient = getFixedRecoveryEmail_();
  GmailApp.sendEmail(
    recipient,
    'SUNVILOZ Clean Care — Email Delivery Verification',
    'Gmail delivery from your SUNVILOZ Clean Care Apps Script project to ' +
      recipient + ' is authorized and working (' + getNowDhakaTimestamp_() + ' Asia/Dhaka).'
  );
  Logger.log('Test delivery email sent to %s', recipient);
  return { ok: true, recipient: recipient };
}

// ============================================================================
// PUBLIC & AUTHENTICATED AUTH HANDLERS (CALLED BY doPost)
// ============================================================================

function handleAuthStatus_(ss) {
  var eligible = isInitialAdminSetupEligible_(ss);
  var admin = findPrimaryAdmin_(ss);
  var settings = getSettingsMap_(ss);
  var logoDataUrl = settings.company_logo_file_id
    ? readDriveFileAsDataUrl_(settings.company_logo_file_id, settings.company_logo_mime_type)
    : '';

  return {
    backendReady: true,
    needsInitialAdminSetup: eligible,
    adminConfigured: !eligible,
    initialAdminUsername: (eligible && admin && admin.username)
      ? normalizeUsername_(admin.username)
      : SUNVILOZ_CONFIG.INITIAL_ADMIN_USERNAME,
    recoveryRecipientEmail: getFixedRecoveryEmail_(),
    companyLogoDataUrl: logoDataUrl
  };
}

/**
 * Step 1 of First-Time Admin Setup:
 * Sends a one-time initial_setup verification code ONLY to sunvilozltd@gmail.com.
 * Generic response prevents leaking state while still enforcing eligibility & rate limits.
 */
function handleInitialSetupRequestCode_(ss) {
  if (!isInitialAdminSetupEligible_(ss)) {
    throw new Error('SETUP_DISABLED: Admin account is already initialized. Use Forgot Password if you need to recover access.');
  }
  var admin = findPrimaryAdmin_(ss);
  issueAndSendOtpCode_(ss, AUTH_CONFIG.PURPOSE_INITIAL_SETUP, admin ? admin.id : SUNVILOZ_CONFIG.INITIAL_ADMIN_ID);
  return {
    sent: true,
    message: 'If first-time setup is eligible, a 6-digit verification code has been sent to the registered owner email (' + getFixedRecoveryEmail_() + '). The code expires in 10 minutes.'
  };
}

/**
 * Step 2 of First-Time Admin Setup (executed under LockService.getScriptLock()):
 * - Rechecks setup eligibility inside the lock.
 * - Requires valid initial_setup email verification code.
 * - Does NOT require Current Password.
 * - Preserves existing admin account ID (ADM-PRIMARY), orders, and all business data.
 * - Permanently disables first-time setup after saving.
 */
function handleInitialSetupComplete_(ss, payload) {
  if (!isInitialAdminSetupEligible_(ss)) {
    throw new Error('SETUP_DISABLED: Admin account is already initialized. Please use Forgot Password.');
  }

  var username = normalizeUsername_(payload.username || SUNVILOZ_CONFIG.INITIAL_ADMIN_USERNAME);
  var newPassword = String(payload.new_password || '');
  var confirmPassword = String(payload.confirm_password || '');
  var code = String(payload.code || '').trim();

  if (username.length < 3 || /\s/.test(username)) {
    throw new Error('Admin username must be at least 3 characters with no spaces.');
  }
  if (newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters.');
  }
  if (newPassword.length > 128) {
    throw new Error('New password must be 128 characters or fewer.');
  }
  if (newPassword !== confirmPassword) {
    throw new Error('New password and Confirm Password do not match.');
  }

  var existingAdmin = findPrimaryAdmin_(ss);
  var conflict = findAccountByUsername_(ss, username);
  if (conflict && (!existingAdmin || String(conflict.id) !== String(existingAdmin.id))) {
    throw new Error('That username is already in use by another account.');
  }

  // Verify and atomically consume the initial_setup one-time code
  verifyOtpCode_(ss, AUTH_CONFIG.PURPOSE_INITIAL_SETUP, code, true);

  var now = getNowDhakaTimestamp_();
  var passwordHash = hashPasswordGas_(newPassword);
  var accountId = existingAdmin ? String(existingAdmin.id) : SUNVILOZ_CONFIG.INITIAL_ADMIN_ID;

  if (existingAdmin) {
    var nextTv = (parseInt(String(existingAdmin.token_version || '1'), 10) || 1) + 1;
    updateSheetObjectByKey_(ss, 'Accounts', 'id', existingAdmin.id, {
      username: username,
      password_hash: passwordHash,
      is_active: 1,
      token_version: nextTv,
      updated_at: now
    });
    revokeSessionsForUser_(ss, existingAdmin.id, 'initial_setup_completed', null);
  } else {
    appendSheetObject_(ss, 'Accounts', {
      id: accountId,
      role: 'admin',
      name: 'SUNVILOZ Admin',
      username: username,
      phone_display: '',
      password_hash: passwordHash,
      is_active: 1,
      token_version: 1,
      created_at: now,
      updated_at: now
    });
  }

  // Permanently disable first-time setup once password is set
  setSetting_(ss, 'admin_password_initialized', '1');
  invalidateActiveCodesForPurpose_(ss, AUTH_CONFIG.PURPOSE_INITIAL_SETUP);
  bumpSyncRevision_(ss);

  return {
    initialized: true,
    account_id: accountId,
    username: username,
    message: 'Admin account setup complete. First-time setup is now disabled. Please sign in with your new credentials.'
  };
}

/**
 * Fresh Sign In:
 * Accepts ONLY the currently saved username and exact saved password (no default password,
 * no Google sign-in bypass). Supervisor login and permissions remain completely intact.
 */
function handleLogin_(ss, payload) {
  var username = normalizeUsername_(payload.username);
  var password = String(payload.password || '');
  if (!username || !password) {
    throw new Error('Username and password are required.');
  }

  if (isInitialAdminSetupEligible_(ss)) {
    var maybeSup = findAccountByUsername_(ss, username);
    if (!maybeSup || String(maybeSup.role) !== 'supervisor') {
      throw new Error('BACKEND_SETUP_REQUIRED: Admin account has not been initialized yet. Use "Set Up Admin Account" to finish setup.');
    }
  }

  var account = findAccountByUsername_(ss, username);
  if (!account || !String(account.password_hash || '').trim()) {
    throw new Error('AUTH_FAILED: Invalid username or password.');
  }
  var active = String(account.is_active) === '1' || account.is_active === true || account.is_active === 1;
  if (!active) {
    throw new Error('AUTH_FAILED: This account has been deactivated. Please contact the administrator.');
  }
  if (!verifyPasswordGas_(password, account.password_hash)) {
    throw new Error('AUTH_FAILED: Invalid username or password.');
  }

  var session = createSessionForAccount_(ss, account, payload.device_id, payload.device_label);
  return {
    token: session.token,
    user: session.user,
    deviceId: session.device_id,
    message: 'Welcome back, ' + session.user.name + '!'
  };
}

/**
 * Settings -> Account & Security (Signed-in Admin):
 * - Requires Current Password before changing username, password, or both.
 * - Requires Confirm New Password if a new password is entered.
 * - Blank New Password keeps the existing password unchanged.
 * - Preserves ADM-PRIMARY account ID and all business data.
 * - Revokes ALL previous admin sessions; admin signs in with updated credentials
 *   (after which Android fingerprint / screen-lock unlock may resume).
 */
function handleUpdateAdminCredentials_(ss, authCtx, payload) {
  if (authCtx.user.role !== 'admin') {
    throw new Error('Access denied. Only administrators can update admin credentials.');
  }
  var cur = String(payload.current_password || '');
  if (!cur) {
    throw new Error('Current Password is required before making account changes.');
  }
  if (!verifyPasswordGas_(cur, authCtx.accountRow.password_hash)) {
    throw new Error('Current password is incorrect.');
  }

  var reqUsername = payload.new_username !== undefined ? normalizeUsername_(payload.new_username) : '';
  var reqPassword = payload.new_password !== undefined ? String(payload.new_password) : '';
  var reqConfirm = payload.confirm_new_password !== undefined ? String(payload.confirm_new_password) : '';

  var nextUsername = String(authCtx.accountRow.username);
  var usernameChanged = false;
  if (reqUsername && reqUsername !== normalizeUsername_(authCtx.accountRow.username)) {
    if (reqUsername.length < 3 || /\s/.test(reqUsername)) {
      throw new Error('Admin username must be at least 3 characters with no spaces.');
    }
    var conflict = findAccountByUsername_(ss, reqUsername);
    if (conflict && String(conflict.id) !== String(authCtx.user.id)) {
      throw new Error('That username is already in use by another account.');
    }
    nextUsername = reqUsername;
    usernameChanged = true;
  }

  var nextHash = String(authCtx.accountRow.password_hash);
  var passwordChanged = false;
  if (reqPassword.length > 0) {
    if (reqPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    if (reqPassword.length > 128) {
      throw new Error('New password must be 128 characters or fewer.');
    }
    if (reqPassword !== reqConfirm) {
      throw new Error('New password and Confirm New Password do not match.');
    }
    if (reqPassword === cur) {
      throw new Error('New password must be different from your current password.');
    }
    nextHash = hashPasswordGas_(reqPassword);
    passwordChanged = true;
  }

  if (!usernameChanged && !passwordChanged) {
    throw new Error('Enter a new username or a new password to save changes.');
  }

  var now = getNowDhakaTimestamp_();
  var nextTv = (parseInt(String(authCtx.accountRow.token_version || '1'), 10) || 1) + 1;

  updateSheetObjectByKey_(ss, 'Accounts', 'id', authCtx.user.id, {
    username: nextUsername,
    password_hash: nextHash,
    token_version: nextTv,
    updated_at: now
  });

  // Revoke ALL admin sessions so every device re-authenticates with the updated credentials
  revokeSessionsForUser_(ss, authCtx.user.id, passwordChanged ? 'password_changed' : 'username_changed', null);
  bumpSyncRevision_(ss);

  return {
    requiresSignIn: true,
    usernameChanged: usernameChanged,
    passwordChanged: passwordChanged,
    username: nextUsername,
    message: usernameChanged && passwordChanged
      ? 'Admin username and password updated. All previous sessions have been revoked. Please sign in with your updated credentials.'
      : usernameChanged
      ? 'Admin username updated to ' + nextUsername + '. All previous sessions have been revoked. Please sign in again.'
      : 'Admin password updated. All previous sessions have been revoked. Please sign in with your new password.'
  };
}

function handleChangePassword_(ss, authCtx, payload) {
  var cur = String(payload.current_password || '');
  var next = String(payload.new_password || '');
  var confirm = payload.confirm_new_password !== undefined ? String(payload.confirm_new_password) : next;
  if (!cur) throw new Error('Current password is required.');
  if (next.length < 6) throw new Error('New password must be at least 6 characters.');
  if (next.length > 128) throw new Error('New password must be 128 characters or fewer.');
  if (next !== confirm) throw new Error('New password and Confirm New Password do not match.');
  if (cur === next) throw new Error('New password must be different from your current password.');

  if (!verifyPasswordGas_(cur, authCtx.accountRow.password_hash)) {
    throw new Error('Current password is incorrect.');
  }

  var now = getNowDhakaTimestamp_();
  var nextTv = (parseInt(String(authCtx.accountRow.token_version || '1'), 10) || 1) + 1;
  var nextHash = hashPasswordGas_(next);

  updateSheetObjectByKey_(ss, 'Accounts', 'id', authCtx.user.id, {
    password_hash: nextHash,
    token_version: nextTv,
    updated_at: now
  });

  revokeSessionsForUser_(ss, authCtx.user.id, 'password_changed', null);
  bumpSyncRevision_(ss);

  return {
    requiresSignIn: true,
    message: 'Password updated successfully. All previous sessions have been revoked. Please sign in again.'
  };
}

// ============================================================================
// FORGOT PASSWORD (SEPARATE ONE-TIME CODE SENT ONLY TO FIXED sunvilozltd@gmail.com)
// ============================================================================

/**
 * Step 1 of Forgot Password:
 * Accepts current admin username, enforces rate limiting, sends a separate
 * 'password_recovery' code ONLY to the server-fixed sunvilozltd@gmail.com if the
 * username matches the initialized admin account, and always returns a generic response.
 */
function handleRecoveryRequestCode_(ss, payload) {
  var requestedUsername = normalizeUsername_(payload.username);
  if (!requestedUsername) {
    throw new Error('Please enter your current Admin Username.');
  }

  var genericMsg = 'If the username matches an initialized admin account, a 6-digit recovery code has been sent to the registered owner recovery email. The code expires in 10 minutes.';

  if (isInitialAdminSetupEligible_(ss)) {
    // Still return generic response to avoid state/username enumeration
    return { sent: true, message: genericMsg };
  }

  var admin = findPrimaryAdmin_(ss);
  var active = admin && (String(admin.is_active) === '1' || admin.is_active === true || admin.is_active === 1);
  if (!admin || !active || normalizeUsername_(admin.username) !== requestedUsername) {
    // Do NOT send an email or reveal whether the username matched
    return { sent: true, message: genericMsg };
  }

  issueAndSendOtpCode_(ss, AUTH_CONFIG.PURPOSE_PASSWORD_RECOVERY, admin.id);
  return { sent: true, message: genericMsg };
}

/**
 * Step 2a of Forgot Password:
 * Verifies the 6-digit recovery code before letting the admin enter and confirm a new password.
 */
function handleRecoveryVerifyCode_(ss, payload) {
  var requestedUsername = normalizeUsername_(payload.username);
  var code = String(payload.code || '').trim();
  if (!requestedUsername) {
    throw new Error('Admin Username is required.');
  }
  var admin = findPrimaryAdmin_(ss);
  if (!admin || isInitialAdminSetupEligible_(ss) || normalizeUsername_(admin.username) !== requestedUsername) {
    throw new Error('INVALID_CODE: Verification code is invalid or expired.');
  }
  verifyOtpCode_(ss, AUTH_CONFIG.PURPOSE_PASSWORD_RECOVERY, code, false);
  return {
    verified: true,
    message: 'Recovery code verified. You may now set your new Admin password.'
  };
}

/**
 * Step 2b of Forgot Password (executed under LockService.getScriptLock()):
 * - Re-verifies and atomically consumes the 'password_recovery' code.
 * - Preserves existing admin username, ADM-PRIMARY account ID, and all business data.
 * - Replaces salted password hash, revokes ALL previous admin sessions, returns to Sign In.
 * - Old password fails immediately.
 */
function handleRecoveryComplete_(ss, payload) {
  var requestedUsername = normalizeUsername_(payload.username);
  var code = String(payload.code || '').trim();
  var newPassword = String(payload.new_password || '');
  var confirmPassword = String(payload.confirm_password || '');

  if (!requestedUsername) {
    throw new Error('Admin Username is required.');
  }
  if (newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters.');
  }
  if (newPassword.length > 128) {
    throw new Error('New password must be 128 characters or fewer.');
  }
  if (newPassword !== confirmPassword) {
    throw new Error('New password and Confirm New Password do not match.');
  }

  var admin = findPrimaryAdmin_(ss);
  if (!admin || isInitialAdminSetupEligible_(ss) || normalizeUsername_(admin.username) !== requestedUsername) {
    throw new Error('INVALID_CODE: Verification code is invalid or expired.');
  }

  // Verify and consume the recovery code atomically (prevents reuse)
  verifyOtpCode_(ss, AUTH_CONFIG.PURPOSE_PASSWORD_RECOVERY, code, true);

  var now = getNowDhakaTimestamp_();
  var nextTv = (parseInt(String(admin.token_version || '1'), 10) || 1) + 1;
  var nextHash = hashPasswordGas_(newPassword);

  updateSheetObjectByKey_(ss, 'Accounts', 'id', admin.id, {
    password_hash: nextHash,
    token_version: nextTv,
    is_active: 1,
    updated_at: now
  });

  revokeSessionsForUser_(ss, admin.id, 'password_recovered', null);
  invalidateActiveCodesForPurpose_(ss, AUTH_CONFIG.PURPOSE_PASSWORD_RECOVERY);
  bumpSyncRevision_(ss);

  return {
    recovered: true,
    requiresSignIn: true,
    account_id: String(admin.id),
    username: String(admin.username),
    message: 'Admin password has been reset. All previous sessions have been revoked. Please sign in with your new password.'
  };
}
