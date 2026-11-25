/**
 * SUNVILOZ Clean Care — Time-Driven Triggers & Workspace Provisioning (Triggers.gs)
 *
 * Owner-only provisioning & background automation that runs reliably inside Google Apps Script
 * even when the Android phone app is completely closed:
 * 1. provisionWorkspaceAndTriggers() — creates the private Google Sheet, private Drive folders,
 *    and installs daily time-driven triggers in Asia/Dhaka.
 * 2. checkAndSendFollowupReminders() — daily Gmail reminder for orders whose follow-up date is
 *    due today (default 6 calendar months after completion + admin overrides), with deduplication
 *    and post-restore pause protection.
 * 3. runScheduledSecondaryBackup() — daily scheduled backup to the second Google account's private Drive.
 */

function provisionWorkspaceAndTriggers() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = getOrCreateSpreadsheet_(true);
    var folders = getPrivateDriveFolders_();
    var ownerEmail = getEffectiveOwnerEmail_();
    if (ownerEmail) {
      setSetting_(ss, 'primary_owner_google_email', ownerEmail);
      var settings = getSettingsMap_(ss);
      if (!settings.reminder_email) {
        setSetting_(ss, 'reminder_email', ownerEmail);
      }
    }

    var settingsNow = getSettingsMap_(ss);
    var reminderHour = parseInt(settingsNow.daily_reminder_hour || '9', 10) || 9;
    var backupHour = parseInt(settingsNow.auto_backup_hour || '2', 10) || 2;

    // Remove older duplicate triggers for our handler functions before installing fresh ones
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      var fn = existing[i].getHandlerFunction();
      if (fn === 'checkAndSendFollowupReminders' || fn === 'runScheduledSecondaryBackup') {
        ScriptApp.deleteTrigger(existing[i]);
      }
    }

    ScriptApp.newTrigger('checkAndSendFollowupReminders')
      .timeBased()
      .everyDays(1)
      .atHour(Math.max(0, Math.min(23, reminderHour)))
      .inTimezone(SUNVILOZ_CONFIG.TIMEZONE)
      .create();

    ScriptApp.newTrigger('runScheduledSecondaryBackup')
      .timeBased()
      .everyDays(1)
      .atHour(Math.max(0, Math.min(23, backupHour)))
      .inTimezone(SUNVILOZ_CONFIG.TIMEZONE)
      .create();

    setSetting_(ss, 'reminder_trigger_status', 'Active (Daily ' + reminderHour + ':00 Asia/Dhaka)');

    Logger.log('Workspace provisioned. Spreadsheet ID: %s | Drive Folder ID: %s | Owner: %s',
      ss.getId(), folders.root.getId(), ownerEmail);

    return {
      ok: true,
      spreadsheet_id: ss.getId(),
      spreadsheet_url: ss.getUrl(),
      drive_root_folder_id: folders.root.getId(),
      primary_owner_google_email: ownerEmail,
      triggers_installed: ['checkAndSendFollowupReminders', 'runScheduledSecondaryBackup']
    };
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}

function checkAndSendFollowupReminders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'Lock busy' };
  try {
    var ss = getOrCreateSpreadsheet_();
    var settings = getSettingsMap_(ss);
    if (settings.reminders_paused_after_restore === '1') {
      Logger.log('Follow-up reminders are paused after restore until Admin confirms in Settings.');
      return { ok: true, paused: true, sent: 0 };
    }

    var recipient = String(settings.reminder_email || settings.primary_owner_google_email || getEffectiveOwnerEmail_() || '').trim();
    if (!recipient || recipient.indexOf('@') === -1) {
      Logger.log('Skipping follow-up reminders: no valid recipient email configured.');
      return { ok: false, error: 'No recipient email configured' };
    }

    var today = getTodayDhakaIso_();
    var orders = getAllHydratedOrders_(ss);
    var dueOrders = [];
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (o.status !== 'Completed') continue;
      if (o.is_no_charge_visit) continue;
      if (o.followup_done) continue;
      if (!o.followup_date || o.followup_date > today) continue;
      // Deduplicate by (order_id, followup_date, followup_version)
      if (o.reminder_sent && o.reminder_sent_for_date === o.followup_date &&
          Number(o.reminder_sent_version) === Number(o.followup_version)) {
        continue;
      }
      dueOrders.push(o);
    }

    if (dueOrders.length === 0) {
      return { ok: true, sent: 0 };
    }

    var lines = [
      'SUNVILOZ Clean Care — Daily Service Follow-Up Reminder (' + today + ', Asia/Dhaka)',
      '',
      'The following completed customer jobs are due for their scheduled cleaning follow-up:',
      ''
    ];
    for (var j = 0; j < dueOrders.length; j++) {
      var d = dueOrders[j];
      lines.push(
        (j + 1) + '. ' + d.order_id + ' — ' + d.customer_name + ' (' + d.phone_display + ')' +
        '\n   Service: ' + d.service_type +
        '\n   Area / Address: ' + (d.area ? d.area + ' — ' : '') + d.address +
        '\n   Last Completed: ' + d.completion_date + ' | Follow-Up Due: ' + d.followup_date + ' (' + d.followup_rule_note + ')' +
        '\n   Previous Agreed Bill: BDT ' + d.price_bdt + '\n'
      );
    }
    lines.push('— Sent automatically by SUNVILOZ Clean Care Apps Script Scheduler.');

    var subject = 'SUNVILOZ Clean Care: ' + dueOrders.length + ' Follow-Up Reminder(s) Due (' + today + ')';
    var now = getNowDhakaTimestamp_();
    try {
      GmailApp.sendEmail(recipient, subject, lines.join('\n'));
      for (var k = 0; k < dueOrders.length; k++) {
        var sentOrder = dueOrders[k];
        updateSheetObjectByKey_(ss, 'Orders', 'order_id', sentOrder.order_id, {
          reminder_sent: 1,
          reminder_sent_at: now,
          reminder_sent_for_date: sentOrder.followup_date,
          reminder_sent_version: sentOrder.followup_version,
          updated_at: now
        });
        appendSheetObject_(ss, 'ReminderLog', {
          log_id: makeUid_('REM'),
          order_id: sentOrder.order_id,
          followup_date: sentOrder.followup_date,
          followup_version: sentOrder.followup_version,
          recipient_email: recipient,
          status: 'sent',
          error_message: '',
          sent_at: now
        });
      }
      return { ok: true, sent: dueOrders.length, recipient: recipient };
    } catch (mailErr) {
      var errMsg = mailErr && mailErr.message ? mailErr.message : String(mailErr);
      for (var f = 0; f < dueOrders.length; f++) {
        appendSheetObject_(ss, 'ReminderLog', {
          log_id: makeUid_('REM'),
          order_id: dueOrders[f].order_id,
          followup_date: dueOrders[f].followup_date,
          followup_version: dueOrders[f].followup_version,
          recipient_email: recipient,
          status: 'failed',
          error_message: errMsg,
          sent_at: now
        });
      }
      return { ok: false, error: errMsg };
    }
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}

function runScheduledSecondaryBackup() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'Lock busy' };
  try {
    var ss = getOrCreateSpreadsheet_();
    var settings = getSettingsMap_(ss);
    if (settings.auto_backup_enabled !== '1') {
      return { ok: true, skipped: true, reason: 'Auto backup disabled' };
    }
    var today = getTodayDhakaIso_();
    if (settings.last_auto_backup_date === today) {
      return { ok: true, skipped: true, reason: 'Already backed up today (' + today + ')' };
    }
    return executeScheduledSecondaryBackupGas_(ss, 'Apps Script Daily Trigger');
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}
