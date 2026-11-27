/**
 * SUNVILOZ Clean Care — Web App HTML Service & Unified API Router (Code.gs)
 *
 * Serves the complete SUNVILOZ Clean Care web application directly from Google Apps Script
 * (HtmlService + google.script.run) backed by the owner's private Google Sheet and Drive.
 * Users open ONE web app URL and never have to enter a backend URL.
 *
 * Security notes:
 * - Owner-only Editor helpers (provisionWorkspaceAndTriggers, testRecoveryEmailDelivery,
 *   setupInitialAdmin, resetAdminPasswordOwnerOnly) are NEVER routable from apiDispatch/doPost.
 * - Every write request is serialized with LockService.getScriptLock() and supports
 *   idempotent request_id replay via the RequestLocks sheet.
 * - Admin vs. Supervisor permissions are strictly enforced server-side on every action.
 */

function doGet(e) {
  try {
    if (e && e.parameter && String(e.parameter.api || '') === 'status') {
      var ss = getOrCreateSpreadsheet_();
      var status = handleAuthStatus_(ss);
      return jsonResponse_({
        ok: true,
        service: 'SUNVILOZ Clean Care Apps Script Web App',
        version: '3.2.0',
        timezone: SUNVILOZ_CONFIG.TIMEZONE,
        todayDhaka: getTodayDhakaIso_(),
        data: status
      });
    }

    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('SUNVILOZ Clean Care — Order Management')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<h3>SUNVILOZ Clean Care</h3><p>Startup error: ' +
        String(err && err.message ? err.message : err).replace(/</g, '&lt;') +
        '</p>'
    );
  }
}

/**
 * Primary RPC entry point called directly by the web UI via google.script.run.apiDispatch(reqObj).
 * Uses the exact same lock, auth, RBAC, and idempotency pipeline as doPost(e).
 */
function apiDispatch(reqObj) {
  return processApiRequest_(reqObj || {});
}

function doPost(e) {
  var req = {};
  try {
    var rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    req = JSON.parse(rawBody);
  } catch (parseErr) {
    return jsonResponse_({ ok: false, code: 'BAD_REQUEST', error: 'Invalid JSON request body.' });
  }
  return jsonResponse_(processApiRequest_(req));
}

function processApiRequest_(req) {
  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    var action = String(req.action || '').trim();
    var token = String(req.token || '').trim();
    var requestId = String(req.request_id || '').trim();
    var payload = (req.payload && typeof req.payload === 'object') ? req.payload : {};

    if (!action) {
      return { ok: false, code: 'BAD_REQUEST', error: 'Missing API action.' };
    }

    var ss = getOrCreateSpreadsheet_();

    // Public (unauthenticated) auth endpoints
    if (action === 'auth.status') {
      return { ok: true, data: handleAuthStatus_(ss) };
    }
    if (action === 'auth.initial_setup_request_code') {
      lock.waitLock(25000);
      lockAcquired = true;
      return { ok: true, data: handleInitialSetupRequestCode_(ss) };
    }
    if (action === 'auth.initial_setup_complete') {
      lock.waitLock(25000);
      lockAcquired = true;
      return { ok: true, data: handleInitialSetupComplete_(ss, payload) };
    }
    if (action === 'auth.login') {
      lock.waitLock(25000);
      lockAcquired = true;
      return { ok: true, data: handleLogin_(ss, payload) };
    }
    if (action === 'auth.change_password_with_credentials') {
      lock.waitLock(25000);
      lockAcquired = true;
      return { ok: true, data: handleChangePasswordWithCredentials_(ss, payload) };
    }
    if (action === 'auth.recovery_request_code') {
      lock.waitLock(25000);
      lockAcquired = true;
      return { ok: true, data: handleRecoveryRequestCode_(ss, payload) };
    }
    if (action === 'auth.recovery_verify_code') {
      lock.waitLock(25000);
      lockAcquired = true;
      return { ok: true, data: handleRecoveryVerifyCode_(ss, payload) };
    }
    if (action === 'auth.recovery_complete') {
      lock.waitLock(25000);
      lockAcquired = true;
      return { ok: true, data: handleRecoveryComplete_(ss, payload) };
    }

    // All remaining actions require a valid, non-revoked session token
    var authCtx = authenticateSessionToken_(ss, token);
    var actor = authCtx.user;

    // Read-only authenticated endpoints (no write lock required)
    if (action === 'auth.me') {
      return { ok: true, data: { user: actor } };
    }
    if (action === 'auth.devices') {
      return { ok: true, data: handleListSessions_(ss, authCtx) };
    }
    if (action === 'supervisor.jobs') {
      if (actor.role !== 'supervisor') {
        return { ok: false, code: 'FORBIDDEN', error: 'This endpoint is restricted to supervisor accounts.' };
      }
      return { ok: true, data: getSupervisorEligibleJobsGas_(ss, actor.id) };
    }
    if (action === 'bootstrap') {
      requireAdminRole_(actor);
      return { ok: true, data: getAdminBootstrapGas_(ss) };
    }
    if (action === 'orders.check_conflicts') {
      requireAdminRole_(actor);
      return { ok: true, data: handleCheckScheduleConflicts_(ss, payload) };
    }
    if (action === 'leads.check_phone') {
      requireAdminRole_(actor);
      return { ok: true, data: handleCheckDuplicatePhone_(ss, payload) };
    }
    if (action === 'pdfs.get') {
      requireAdminRole_(actor);
      var pdfRows = readSheetObjects_(ss, 'IssuedPdfs');
      var foundPdf = null;
      for (var pi = pdfRows.length - 1; pi >= 0; pi--) {
        if (String(pdfRows[pi].doc_type) === String(payload.doc_type) &&
            String(pdfRows[pi].doc_id) === String(payload.doc_id)) {
          foundPdf = pdfRows[pi];
          break;
        }
      }
      if (!foundPdf) throw new Error('Archived PDF not found.');
      return {
        ok: true,
        data: {
          pdf: {
            pdf_id: String(foundPdf.pdf_id),
            doc_type: String(foundPdf.doc_type),
            doc_id: String(foundPdf.doc_id),
            file_name: String(foundPdf.file_name),
            pdf_base64: readDriveFileAsBase64_(foundPdf.drive_file_id),
            size_bytes: toCleanNum_(foundPdf.size_bytes, 0),
            created_by: String(foundPdf.issued_by || ''),
            created_at: String(foundPdf.created_at || '')
          }
        }
      };
    }
    if (action === 'reports.monthly') {
      requireAdminRole_(actor);
      return { ok: true, data: handleMonthlyReport_(ss, payload) };
    }
    if (action === 'backup.export_payload') {
      requireAdminRole_(actor);
      var pkg = buildSanitizedBackupPackage_(ss, actor.name);
      if (payload.record) {
        recordBackupHistoryGas_(ss, {
          source: 'local_download',
          status: 'verified',
          file_name: 'sunviloz_clean_care_backup_' + getTodayDhakaIso_() + '.json',
          drive_account_email: getEffectiveOwnerEmail_(),
          size_bytes: JSON.stringify(pkg).length,
          checksum_sha256: pkg.checksum_sha256,
          created_by: actor.name
        });
      }
      return { ok: true, data: pkg };
    }
    if (action === 'backup.validate') {
      requireAdminRole_(actor);
      return { ok: true, data: { summary: validateBackupPackageGas_(payload.backup || payload) } };
    }
    if (action === 'primary_drive.list_snapshots') {
      requireAdminRole_(actor);
      return { ok: true, data: { versions: listPrimaryDriveSnapshotsGas_() } };
    }
    if (action === 'primary_drive.read_snapshot') {
      requireAdminRole_(actor);
      return { ok: true, data: { snapshot: readPrimaryDriveSnapshotGas_(payload.file_id) } };
    }
    if (action === 'backup.list_secondary') {
      requireAdminRole_(actor);
      return { ok: true, data: listSecondaryDriveBackupsGas_(ss) };
    }
    if (action === 'backup.download_secondary') {
      requireAdminRole_(actor);
      return { ok: true, data: { backup: readSecondaryDriveBackupGas_(ss, payload.file_id) } };
    }

    // Mutating endpoints: acquire script lock + check idempotent request_id
    lock.waitLock(25000);
    lockAcquired = true;

    if (requestId) {
      var cached = getIdempotentResponse_(ss, requestId, actor.id, action);
      if (cached && cached.body) {
        if (cached.body.data && cached.body.data._bootstrapOmitted && actor.role === 'admin') {
          cached.body.data.bootstrap = getAdminBootstrapGas_(ss);
          delete cached.body.data._bootstrapOmitted;
        }
        return cached.body;
      }
    }

    var responseObj = dispatchAuthenticatedMutation_(ss, authCtx, action, payload);
    if (requestId && responseObj && responseObj.ok) {
      storeIdempotentResponse_(ss, requestId, actor.id, action, 200, responseObj);
    }
    return responseObj;
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    var code = 'SERVER_ERROR';
    var knownPrefixes = [
      'STATUS_LOCKED:', 'AUTH_FAILED:', 'AUTH_REQUIRED:', 'SESSION_REVOKED:',
      'BACKEND_SETUP_REQUIRED:', 'SETUP_DISABLED:', 'INVALID_CODE:',
      'CODE_EXPIRED:', 'RATE_LIMITED:', 'EMAIL_DELIVERY_FAILED:'
    ];
    for (var pi2 = 0; pi2 < knownPrefixes.length; pi2++) {
      var pref = knownPrefixes[pi2];
      if (msg.indexOf(pref) === 0) {
        code = pref.slice(0, -1);
        msg = msg.slice(pref.length).trim();
        break;
      }
    }
    if (code === 'SERVER_ERROR' && msg.indexOf('Access denied') === 0) {
      code = 'FORBIDDEN';
    }
    return { ok: false, code: code, error: msg };
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (err2) {}
    }
  }
}

function requireAdminRole_(actor) {
  if (!actor || actor.role !== 'admin') {
    throw new Error('Access denied. Administrator permission is required.');
  }
}

function dispatchAuthenticatedMutation_(ss, authCtx, action, payload) {
  var actor = authCtx.user;
  var now = getNowDhakaTimestamp_();

  // Auth mutations
  if (action === 'auth.logout') {
    updateSheetObjectByKey_(ss, 'Sessions', 'session_id', authCtx.sessionId, {
      revoked_at: now,
      revoked_reason: 'user_logout'
    });
    return { ok: true, data: { ok: true, signedOut: true, message: 'Signed out.' } };
  }
  if (action === 'auth.logout_all') {
    revokeSessionsForUser_(ss, actor.id, 'logout_all', null);
    return { ok: true, data: { ok: true, signedOutAll: true, message: 'Signed out from all sessions.' } };
  }
  if (action === 'auth.revoke_session') {
    return { ok: true, data: handleRevokeSession_(ss, authCtx, payload.session_id) };
  }
  if (action === 'auth.change_password') {
    return { ok: true, data: handleChangePassword_(ss, authCtx, payload) };
  }
  if (action === 'auth.update_admin_credentials') {
    return { ok: true, data: handleUpdateAdminCredentials_(ss, authCtx, payload) };
  }

  // Order completion (allowed for BOTH assigned supervisor within 7 days AND admin)
  if (action === 'orders.complete') {
    var completed = handleCompleteOrder_(ss, actor, payload);
    if (actor.role === 'supervisor') {
      var buildings = readSheetObjects_(ss, 'Buildings');
      var bMap = {};
      for (var b = 0; b < buildings.length; b++) bMap[buildings[b].building_id] = buildings[b];
      return {
        ok: true,
        data: {
          job: projectSupervisorJobGas_(completed, bMap),
          message: 'Job marked as completed and saved.'
        }
      };
    }
    return {
      ok: true,
      data: {
        order: completed,
        bootstrap: getAdminBootstrapGas_(ss),
        message: 'Order completed and permanently status-locked.'
      }
    };
  }

  // All remaining mutations are strictly ADMIN-ONLY
  requireAdminRole_(actor);

  // Orders
  if (action === 'orders.create') {
    var created = handleCreateOrder_(ss, actor, payload);
    return { ok: true, data: { order: created, bootstrap: getAdminBootstrapGas_(ss), message: 'Order ' + created.order_id + ' saved.' } };
  }
  if (action === 'orders.update') {
    var updated = handleUpdateOrder_(ss, actor, payload);
    return { ok: true, data: { order: updated, bootstrap: getAdminBootstrapGas_(ss), message: 'Order ' + updated.order_id + ' updated.' } };
  }
  if (action === 'orders.update_advance') {
    var advOrd = handleUpdateOrderAdvance_(ss, actor, payload);
    return { ok: true, data: { order: advOrd, bootstrap: getAdminBootstrapGas_(ss), message: 'Advance payment updated.' } };
  }
  if (action === 'orders.status') {
    var stOrder = handleChangeOrderStatus_(ss, actor, payload);
    return { ok: true, data: { order: stOrder, bootstrap: getAdminBootstrapGas_(ss), message: 'Order status updated to ' + stOrder.status + '.' } };
  }
  if (action === 'orders.correct_financials') {
    var finOrd = handleCorrectCompletedFinancials_(ss, actor, payload);
    return { ok: true, data: { order: finOrd, bootstrap: getAdminBootstrapGas_(ss), message: 'Completed job financials corrected.' } };
  }
  if (action === 'orders.update_workers') {
    var wrkOrd = handleAdminUpdateOrderWorkers_(ss, actor, payload);
    return { ok: true, data: { order: wrkOrd, bootstrap: getAdminBootstrapGas_(ss), message: 'Worker assignments updated.' } };
  }
  if (action === 'orders.followup_done') {
    var orderIdF = String(payload.order_id || '');
    var doneFlag = payload.is_done !== undefined ? Boolean(payload.is_done) : Boolean(payload.followup_done);
    updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderIdF, {
      followup_done: doneFlag ? 1 : 0,
      followup_done_at: doneFlag ? now : '',
      updated_at: now
    });
    bumpSyncRevision_(ss);
    return { ok: true, data: { order: getOrderByIdGas_(ss, orderIdF), bootstrap: getAdminBootstrapGas_(ss), message: doneFlag ? 'Follow-up marked complete.' : 'Follow-up reopened.' } };
  }
  if (action === 'orders.followup_reschedule') {
    var orderIdR = String(payload.order_id || '');
    var existingR = getOrderByIdGas_(ss, orderIdR);
    if (!existingR) throw new Error('Order not found.');
    var baseDate = isValidIsoDate_(payload.base_date) ? String(payload.base_date) : (existingR.completion_date || getTodayDhakaIso_());
    var nextDate = '';
    var ruleNote = 'Rescheduled';
    if (payload.followup_mode === 'exact' && isValidIsoDate_(payload.followup_date)) {
      nextDate = String(payload.followup_date).trim();
      ruleNote = 'Exact Date (Rescheduled)';
    } else if (payload.followup_mode === 'custom' && Number(payload.custom_value) >= 1) {
      var cv = parseInt(String(payload.custom_value), 10);
      var cu = payload.custom_unit === 'days' ? 'days' : 'months';
      nextDate = cu === 'months' ? addCalendarMonthsIso_(baseDate, cv) : addDaysIso_(baseDate, cv);
      ruleNote = cv + ' ' + cu + ' (Custom)';
    } else if (isValidIsoDate_(payload.followup_date)) {
      nextDate = String(payload.followup_date).trim();
    } else {
      var setsR = getSettingsMap_(ss);
      var dv = parseInt(setsR.default_followup_value || '6', 10) || 6;
      var du = setsR.default_followup_unit === 'days' ? 'days' : 'months';
      nextDate = du === 'months' ? addCalendarMonthsIso_(baseDate, dv) : addDaysIso_(baseDate, dv);
      ruleNote = dv + ' ' + du + ' (Default)';
    }
    updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderIdR, {
      followup_date: nextDate,
      followup_rule_note: String(payload.followup_rule_note || ruleNote),
      followup_version: (existingR.followup_version || 0) + 1,
      reminder_sent: 0,
      reminder_sent_at: '',
      reminder_sent_for_date: '',
      reminder_sent_version: 0,
      followup_done: 0,
      followup_done_at: '',
      updated_at: now
    });
    bumpSyncRevision_(ss);
    return { ok: true, data: { order: getOrderByIdGas_(ss, orderIdR), bootstrap: getAdminBootstrapGas_(ss), message: 'Follow-up rescheduled to ' + nextDate + '.' } };
  }
  if (action === 'orders.settlement_confirm') {
    var orderIdS = String(payload.order_id || '');
    updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderIdS, {
      settlement_confirmed: 1,
      settlement_confirmed_at: now,
      settlement_confirmed_by: actor.name,
      settlement_note: String(payload.note || '').trim(),
      settlement_status: 'Settled',
      settlement_remaining: 0,
      updated_at: now
    });
    bumpSyncRevision_(ss);
    return { ok: true, data: { order: getOrderByIdGas_(ss, orderIdS), bootstrap: getAdminBootstrapGas_(ss), message: 'Settlement confirmed.' } };
  }
  if (action === 'orders.settlement_entry') {
    var sRes = handleRecordSettlementEntry_(ss, actor, payload);
    return { ok: true, data: { entry: sRes.entry, order: sRes.order, bootstrap: getAdminBootstrapGas_(ss), message: 'Settlement entry recorded.' } };
  }

  // Complaints & Return Visits
  if (action === 'complaints.create') {
    var compC = handleCreateComplaint_(ss, actor, payload);
    return { ok: true, data: { complaint: compC, bootstrap: getAdminBootstrapGas_(ss), message: 'Complaint recorded.' } };
  }
  if (action === 'complaints.update') {
    var compU = handleUpdateComplaint_(ss, payload);
    return { ok: true, data: { complaint: compU, bootstrap: getAdminBootstrapGas_(ss), message: 'Complaint updated.' } };
  }
  if (action === 'complaints.schedule_return_visit') {
    var rvOrd = handleScheduleReturnVisit_(ss, actor, payload);
    return { ok: true, data: { order: rvOrd, bootstrap: getAdminBootstrapGas_(ss), message: 'Return visit ' + rvOrd.order_id + ' scheduled.' } };
  }

  // Quotations & Receipts
  if (action === 'quotations.save') {
    var savedQ = handleSaveQuotation_(ss, actor, payload);
    return { ok: true, data: { quotation: savedQ, bootstrap: getAdminBootstrapGas_(ss), message: 'Quotation ' + savedQ.quotation_id + ' saved.' } };
  }
  if (action === 'quotations.followup') {
    var updQ = handleUpdateQuotationFollowup_(ss, actor, payload);
    return { ok: true, data: { quotation: updQ, bootstrap: getAdminBootstrapGas_(ss), message: 'Quotation updated.' } };
  }
  if (action === 'quotations.convert') {
    var convQ = handleConvertQuotationToOrder_(ss, actor, payload);
    return {
      ok: true,
      data: {
        alreadyConverted: convQ.alreadyConverted,
        order: convQ.order,
        quotation: convQ.quotation,
        bootstrap: getAdminBootstrapGas_(ss),
        message: convQ.alreadyConverted ? ('Already converted to ' + convQ.order.order_id) : ('Converted to Order ' + convQ.order.order_id)
      }
    };
  }
  if (action === 'receipts.issue') {
    var rcpRes = handleIssueMoneyReceipt_(ss, actor, payload);
    return {
      ok: true,
      data: {
        alreadyIssued: rcpRes.alreadyIssued,
        receipt: rcpRes.receipt,
        order: rcpRes.order,
        bootstrap: getAdminBootstrapGas_(ss),
        message: rcpRes.alreadyIssued ? ('Money Receipt ' + rcpRes.receipt.receipt_id + ' already issued.') : ('Money Receipt ' + rcpRes.receipt.receipt_id + ' issued.')
      }
    };
  }

  // Customers & Buildings
  if (action === 'customers.save') {
    var cId = String(payload.customer_id || '').trim();
    var cPhone = normalizePhoneBD_(payload.phone || payload.phone_display || '');
    var cRec = {
      customer_id: cId || makeUid_('CUS'),
      name: String(payload.name || '').trim(),
      phone_display: cPhone.display,
      phone_e164: cPhone.e164,
      alt_phone: String(payload.alt_phone || '').trim(),
      address: String(payload.address || '').trim(),
      area: String(payload.area || '').trim(),
      lead_source: String(payload.lead_source || 'Not Specified'),
      notes: String(payload.notes || '').trim(),
      updated_at: now
    };
    if (!cRec.name) throw new Error('Customer name is required.');
    if (cId) {
      updateSheetObjectByKey_(ss, 'Customers', 'customer_id', cId, cRec);
    } else {
      cRec.created_at = now;
      appendSheetObject_(ss, 'Customers', cRec);
    }
    bumpSyncRevision_(ss);
    return { ok: true, data: { customer: cRec, bootstrap: getAdminBootstrapGas_(ss), message: 'Customer saved.' } };
  }
  if (action === 'buildings.save') {
    var bId = String(payload.building_id || '').trim();
    var ohQty = parseInt(String(payload.overhead_tank_qty !== undefined ? payload.overhead_tank_qty : (payload.overhead_tank_count || '0')), 10) || 0;
    var ohCap = payload.overhead_tank_capacity_litres !== undefined && payload.overhead_tank_capacity_litres !== '' && payload.overhead_tank_capacity_litres !== null
      ? toCleanNum_(payload.overhead_tank_capacity_litres, 0) : '';
    var resQty = parseInt(String(payload.reserve_tank_qty !== undefined ? payload.reserve_tank_qty : (payload.reserve_tank_count || '0')), 10) || 0;
    var resCap = payload.reserve_tank_capacity_litres !== undefined && payload.reserve_tank_capacity_litres !== '' && payload.reserve_tank_capacity_litres !== null
      ? toCleanNum_(payload.reserve_tank_capacity_litres, 0) : '';
    var bRec = {
      building_id: bId || makeUid_('BLD'),
      customer_id: String(payload.customer_id || '').trim(),
      name: String(payload.name || '').trim(),
      address: String(payload.address || '').trim(),
      area: String(payload.area || '').trim(),
      maps_url: String(payload.maps_url || '').trim(),
      access_instructions: String(payload.access_instructions || payload.access_notes || '').trim(),
      access_notes: String(payload.access_instructions || payload.access_notes || '').trim(),
      overhead_tank_qty: ohQty,
      overhead_tank_count: ohQty,
      overhead_tank_capacity_litres: ohCap,
      overhead_tank_capacity_liters: ohCap || 0,
      overhead_tank_material: String(payload.overhead_tank_material || 'Concrete'),
      reserve_tank_qty: resQty,
      reserve_tank_count: resQty,
      reserve_tank_capacity_litres: resCap,
      reserve_tank_capacity_liters: resCap || 0,
      reserve_tank_material: String(payload.reserve_tank_material || 'Concrete'),
      tank_notes: String(payload.tank_notes || '').trim(),
      updated_at: now
    };
    if (bId) {
      updateSheetObjectByKey_(ss, 'Buildings', 'building_id', bId, bRec);
    } else {
      bRec.created_at = now;
      appendSheetObject_(ss, 'Buildings', bRec);
    }
    bumpSyncRevision_(ss);
    return { ok: true, data: { building: hydrateBuilding_(bRec), bootstrap: getAdminBootstrapGas_(ss), message: 'Building profile saved.' } };
  }
  if (action === 'buildings.delete') {
    deleteSheetRowsByKey_(ss, 'Buildings', 'building_id', String(payload.building_id || ''));
    bumpSyncRevision_(ss);
    return { ok: true, data: { bootstrap: getAdminBootstrapGas_(ss), message: 'Building deleted.' } };
  }

  // Leads
  if (action === 'leads.save') {
    var savedL = handleSaveLead_(ss, actor, payload);
    return { ok: true, data: { lead: savedL, bootstrap: getAdminBootstrapGas_(ss), message: 'Prospect saved.' } };
  }
  if (action === 'leads.add_note') {
    var lnRes = handleAddLeadNote_(ss, actor, payload);
    return { ok: true, data: { lead: lnRes.lead, note: lnRes.note, bootstrap: getAdminBootstrapGas_(ss), message: 'Activity note added.' } };
  }
  if (action === 'leads.followup_reschedule') {
    var lrLead = handleRescheduleLeadFollowup_(ss, actor, payload);
    return { ok: true, data: { lead: lrLead, bootstrap: getAdminBootstrapGas_(ss), message: 'Prospect follow-up rescheduled.' } };
  }
  if (action === 'leads.followup_done') {
    var ldLead = handleToggleLeadFollowupDone_(ss, actor, payload);
    return { ok: true, data: { lead: ldLead, bootstrap: getAdminBootstrapGas_(ss), message: 'Prospect follow-up updated.' } };
  }

  // Workers
  if (action === 'workers.save') {
    var wId = String(payload.worker_id || '').trim();
    var wPh = normalizePhoneBD_(payload.phone || payload.phone_display || '');
    var existingW = null;
    if (wId) {
      var ws = readSheetObjects_(ss, 'Workers');
      for (var wi = 0; wi < ws.length; wi++) {
        if (String(ws[wi].worker_id) === wId) { existingW = ws[wi]; break; }
      }
    }
    var wRec = {
      worker_id: wId || makeUid_('WRK'),
      name: payload.name !== undefined ? String(payload.name).trim() : (existingW ? String(existingW.name) : ''),
      phone_display: (payload.phone !== undefined || payload.phone_display !== undefined) ? wPh.display : (existingW ? String(existingW.phone_display) : ''),
      phone_e164: (payload.phone !== undefined || payload.phone_display !== undefined) ? wPh.e164 : (existingW ? String(existingW.phone_e164 || '') : ''),
      role_label: String(payload.role_label || (existingW ? existingW.role_label : 'Cleaner')),
      default_daily_wage_bdt: parseNonNegativeAmount_(payload.default_daily_wage_bdt || 0, 'Daily Wage'),
      is_active: payload.is_active !== undefined ? (payload.is_active ? 1 : 0) : (existingW ? (toCleanBool_(existingW.is_active) ? 1 : 0) : 1),
      notes: payload.notes !== undefined ? String(payload.notes).trim() : (existingW ? String(existingW.notes || '') : ''),
      created_at: existingW ? String(existingW.created_at || now) : now,
      updated_at: now
    };
    if (!wRec.name) throw new Error('Worker name is required.');
    if (existingW) {
      updateSheetObjectByKey_(ss, 'Workers', 'worker_id', wId, wRec);
    } else {
      appendSheetObject_(ss, 'Workers', wRec);
    }
    bumpSyncRevision_(ss);
    return { ok: true, data: { worker: { worker_id: wRec.worker_id, name: wRec.name, phone_display: wRec.phone_display, phone_e164: wRec.phone_e164, is_active: wRec.is_active === 1, notes: wRec.notes, created_at: wRec.created_at, updated_at: wRec.updated_at }, bootstrap: getAdminBootstrapGas_(ss), message: 'Worker saved.' } };
  }
  if (action === 'workers.mark_paid') {
    var wpRes = handleMarkOrderWorkerPaid_(ss, actor, payload);
    return { ok: true, data: { workerRow: wpRes.workerRow, order: wpRes.order, bootstrap: getAdminBootstrapGas_(ss), message: 'Worker payment recorded.' } };
  }
  if (action === 'workers.correct_payment') {
    var wcRes = handleCorrectOrderWorkerPayment_(ss, actor, payload);
    return { ok: true, data: { workerRow: wcRes.workerRow, order: wcRes.order, bootstrap: getAdminBootstrapGas_(ss), message: 'Worker payment updated.' } };
  }

  // General Business / Overhead Expenses
  if (action === 'overhead.create') {
    var ohRec = {
      expense_id: makeUid_('OVH'),
      expense_date: isValidIsoDate_(payload.expense_date) ? payload.expense_date : getTodayDhakaIso_(),
      category: String(payload.category || 'Other').trim(),
      description: String(payload.description || '').trim(),
      amount_bdt: parseNonNegativeAmount_(payload.amount_bdt || 0, 'Expense Amount'),
      payment_method: String(payload.payment_method || 'Cash'),
      recorded_by: actor.name,
      created_at: now,
      updated_at: now
    };
    if (!ohRec.description) throw new Error('Expense description is required.');
    appendSheetObject_(ss, 'OverheadExpenses', ohRec);
    bumpSyncRevision_(ss);
    return { ok: true, data: { expense: ohRec, bootstrap: getAdminBootstrapGas_(ss), message: 'General business expense saved.' } };
  }
  if (action === 'overhead.delete') {
    deleteSheetRowsByKey_(ss, 'OverheadExpenses', 'expense_id', String(payload.expense_id || payload.id || ''));
    bumpSyncRevision_(ss);
    return { ok: true, data: { deleted: true, bootstrap: getAdminBootstrapGas_(ss), message: 'Expense deleted.' } };
  }

  // Supervisors
  if (action === 'supervisors.create') {
    var sName = String(payload.name || '').trim();
    var sUser = normalizeUsername_(payload.username);
    var sPass = String(payload.password || '');
    if (!sName || !sUser) throw new Error('Supervisor name and username are required.');
    if (sUser.length < 3 || /\s/.test(sUser)) throw new Error('Username must be at least 3 characters with no spaces.');
    if (findAccountByUsername_(ss, sUser)) throw new Error('That username is already in use.');
    var sRec = {
      id: makeUid_('SUP'),
      role: 'supervisor',
      name: sName,
      username: sUser,
      phone_display: normalizePhoneBD_(payload.phone || '').display,
      password_hash: hashPasswordGas_(sPass),
      is_active: 1,
      token_version: 1,
      created_at: now,
      updated_at: now
    };
    appendSheetObject_(ss, 'Accounts', sRec);
    bumpSyncRevision_(ss);
    return { ok: true, data: { supervisor: toPublicAccount_(sRec), bootstrap: getAdminBootstrapGas_(ss), message: 'Supervisor account created.' } };
  }
  if (action === 'supervisors.update') {
    var supIdU = String(payload.id || '').trim();
    var existingSup = findAccountById_(ss, supIdU);
    if (!existingSup || String(existingSup.role) !== 'supervisor') throw new Error('Supervisor account not found.');
    var patchSup = { updated_at: now };
    var nextTvSup = parseInt(String(existingSup.token_version || '1'), 10) || 1;
    var shouldRevoke = false;
    if (payload.name !== undefined) patchSup.name = String(payload.name).trim();
    if (payload.phone !== undefined) patchSup.phone_display = normalizePhoneBD_(payload.phone).display;
    if (payload.is_active !== undefined) {
      patchSup.is_active = payload.is_active ? 1 : 0;
      if (!payload.is_active) shouldRevoke = true;
    }
    var supNewPass = payload.password !== undefined ? String(payload.password) : String(payload.new_password || '');
    if (supNewPass.length > 0) {
      patchSup.password_hash = hashPasswordGas_(supNewPass);
      nextTvSup += 1;
      patchSup.token_version = nextTvSup;
      shouldRevoke = true;
    }
    updateSheetObjectByKey_(ss, 'Accounts', 'id', supIdU, patchSup);
    if (shouldRevoke) revokeSessionsForUser_(ss, supIdU, 'admin_updated', null);
    bumpSyncRevision_(ss);
    return { ok: true, data: { supervisor: toPublicAccount_(findAccountById_(ss, supIdU)), bootstrap: getAdminBootstrapGas_(ss), message: 'Supervisor account updated.' } };
  }

  // Primary Drive Binary Assets (Logo, Document Pads, Issued PDFs)
  if (action === 'branding.save_logo') {
    var foldersL = getPrivateDriveFolders_();
    var settingsL = getSettingsMap_(ss);
    var savedL = saveBase64FileToDrive_(
      foldersL.logo,
      String(payload.file_name || 'company-logo.png'),
      String(payload.mime_type || 'image/png'),
      String(payload.data_url || ''),
      settingsL.company_logo_file_id
    );
    setSetting_(ss, 'company_logo_file_id', savedL.file_id);
    setSetting_(ss, 'company_logo_file_name', savedL.file_name);
    setSetting_(ss, 'company_logo_mime_type', String(payload.mime_type || 'image/png'));
    setSetting_(ss, 'company_logo_updated_at', now);
    bumpSyncRevision_(ss);
    var bsLogo = getAdminBootstrapGas_(ss);
    return { ok: true, data: { settings: bsLogo.settings, bootstrap: bsLogo, message: 'Company logo saved to Google Drive.' } };
  }
  if (action === 'branding.delete_logo') {
    var settingsDelL = getSettingsMap_(ss);
    if (settingsDelL.company_logo_file_id) {
      try { DriveApp.getFileById(settingsDelL.company_logo_file_id).setTrashed(true); } catch (eDel) {}
    }
    setSetting_(ss, 'company_logo_file_id', '');
    setSetting_(ss, 'company_logo_file_name', '');
    setSetting_(ss, 'company_logo_mime_type', '');
    setSetting_(ss, 'company_logo_updated_at', '');
    bumpSyncRevision_(ss);
    var bsDelL = getAdminBootstrapGas_(ss);
    return { ok: true, data: { settings: bsDelL.settings, bootstrap: bsDelL, message: 'Company logo removed.' } };
  }
  if (action === 'pads.save') {
    var padType = String(payload.pad_type || '').trim();
    if (['quotation', 'receipt'].indexOf(padType) === -1) throw new Error('Invalid pad_type.');
    var foldersP = getPrivateDriveFolders_();
    var existingPad = getDocumentPadByType_(ss, padType);
    var savedP = saveBase64FileToDrive_(
      foldersP.pads,
      String(payload.file_name || (padType + '_pad.png')),
      String(payload.mime_type || 'image/png'),
      String(payload.image_data_url || payload.data_url || ''),
      existingPad ? existingPad.drive_file_id : ''
    );
    var padPatch = {
      pad_type: padType,
      version: existingPad ? (existingPad.version + 1) : 1,
      file_name: savedP.file_name,
      mime_type: String(payload.mime_type || 'image/png'),
      drive_file_id: savedP.file_id,
      page_width_mm: 210,
      page_height_mm: 297,
      fields_json: JSON.stringify(payload.fields || []),
      updated_by: actor.name,
      updated_at: now
    };
    var updPad = updateSheetObjectByKey_(ss, 'DocumentPads', 'pad_type', padType, padPatch);
    if (!updPad) appendSheetObject_(ss, 'DocumentPads', padPatch);
    bumpSyncRevision_(ss);
    var bsPad = getAdminBootstrapGas_(ss);
    return { ok: true, data: { pad: bsPad.pads[padType], bootstrap: bsPad, message: 'Document pad uploaded to Google Drive.' } };
  }
  if (action === 'pads.save_fields') {
    var padTypeF = String(payload.pad_type || '').trim();
    var updPadF = updateSheetObjectByKey_(ss, 'DocumentPads', 'pad_type', padTypeF, {
      fields_json: JSON.stringify(payload.fields || []),
      updated_by: actor.name,
      updated_at: now
    });
    if (!updPadF) throw new Error('Document pad not found.');
    bumpSyncRevision_(ss);
    var bsPadF = getAdminBootstrapGas_(ss);
    return { ok: true, data: { pad: bsPadF.pads[padTypeF], bootstrap: bsPadF, message: 'Pad field positions saved.' } };
  }
  if (action === 'pads.delete') {
    var padTypeD = String(payload.pad_type || '').trim();
    var prevPad = getDocumentPadByType_(ss, padTypeD);
    if (prevPad && prevPad.drive_file_id) {
      try { DriveApp.getFileById(prevPad.drive_file_id).setTrashed(true); } catch (ePd) {}
    }
    deleteSheetRowsByKey_(ss, 'DocumentPads', 'pad_type', padTypeD);
    bumpSyncRevision_(ss);
    return { ok: true, data: { bootstrap: getAdminBootstrapGas_(ss), message: 'Document pad removed.' } };
  }
  if (action === 'pdfs.archive') {
    var foldersF = getPrivateDriveFolders_();
    var savedF = saveBase64FileToDrive_(
      foldersF.pdfs,
      String(payload.file_name || 'document.pdf'),
      'application/pdf',
      String(payload.pdf_base64 || payload.data_url || ''),
      ''
    );
    var pdfRec = {
      pdf_id: makeUid_('PDF'),
      doc_type: String(payload.doc_type || 'quotation'),
      doc_id: String(payload.doc_id || ''),
      doc_number: String(payload.doc_number || payload.doc_id || ''),
      file_name: savedF.file_name,
      drive_file_id: savedF.file_id,
      size_bytes: savedF.size_bytes,
      issued_by: actor.name,
      created_at: now
    };
    appendSheetObject_(ss, 'IssuedPdfs', pdfRec);
    bumpSyncRevision_(ss);
    return {
      ok: true,
      data: {
        pdf: {
          pdf_id: pdfRec.pdf_id,
          doc_type: pdfRec.doc_type,
          doc_id: pdfRec.doc_id,
          file_name: pdfRec.file_name,
          size_bytes: pdfRec.size_bytes,
          created_by: pdfRec.issued_by,
          created_at: pdfRec.created_at
        },
        bootstrap: getAdminBootstrapGas_(ss),
        message: 'PDF archived to Google Drive.'
      }
    };
  }

  // Settings, Reminders, Primary Drive Snapshots & Secondary Backup/Restore
  if (action === 'settings.save') {
    var allowedKeys = [
      'default_followup_value', 'default_followup_unit', 'reminder_email',
      'daily_reminder_hour', 'schedule_conflict_buffer_mins',
      'reminders_paused_after_restore', 'secondary_drive_folder_name',
      'secondary_drive_email'
    ];
    for (var sk = 0; sk < allowedKeys.length; sk++) {
      var k = allowedKeys[sk];
      if (payload[k] !== undefined) setSetting_(ss, k, payload[k]);
    }
    if (payload.auto_backup_enabled !== undefined || payload.auto_backup_hour !== undefined ||
        payload.secondary_drive_webapp_url !== undefined || payload.secondary_drive_secret !== undefined) {
      configureSecondaryBackupBridge_(
        ss,
        payload.secondary_drive_email,
        payload.secondary_drive_webapp_url,
        payload.secondary_drive_secret || payload.secondary_drive_sync_secret,
        payload.auto_backup_enabled,
        payload.auto_backup_hour
      );
    }
    bumpSyncRevision_(ss);
    var bsSet = getAdminBootstrapGas_(ss);
    return { ok: true, data: { settings: bsSet.settings, bootstrap: bsSet, message: 'Settings saved.' } };
  }
  if (action === 'reminders.test_email') {
    var setsEm = getSettingsMap_(ss);
    var recEmail = String(setsEm.reminder_email || setsEm.primary_owner_google_email || getEffectiveOwnerEmail_() || '').trim();
    if (!recEmail || recEmail.indexOf('@') === -1) throw new Error('Configure a valid reminder recipient email first.');
    GmailApp.sendEmail(
      recEmail,
      'SUNVILOZ Clean Care — Test Reminder Email',
      'This is a test email from SUNVILOZ Clean Care (' + now + ' Asia/Dhaka). Automated daily follow-up reminders are ready.'
    );
    appendSheetObject_(ss, 'ReminderLog', {
      log_id: makeUid_('REM'),
      dedupe_key: 'TEST:' + now,
      order_id: 'TEST',
      customer_name: 'Test Delivery',
      phone_display: '',
      services_text: '',
      completion_date: '',
      followup_date: getTodayDhakaIso_(),
      followup_version: 0,
      recipient_email: recEmail,
      send_type: 'TEST_EMAIL',
      status: 'SENT',
      error_message: '',
      sent_at: now
    });
    return { ok: true, data: { bootstrap: getAdminBootstrapGas_(ss), message: 'Test email sent to ' + recEmail + '.' } };
  }
  if (action === 'reminders.check_now') {
    var remRes = runFollowupReminderCheckCore_(ss);
    return { ok: true, data: { bootstrap: getAdminBootstrapGas_(ss), message: remRes.message || ('Sent ' + (remRes.sent || 0) + ' reminder(s).') } };
  }
  if (action === 'reminders.verify_after_restore') {
    setSetting_(ss, 'reminders_paused_after_restore', '0');
    bumpSyncRevision_(ss);
    var bsRem = getAdminBootstrapGas_(ss);
    return { ok: true, data: { settings: bsRem.settings, bootstrap: bsRem, message: 'Automated follow-up reminders resumed.' } };
  }
  if (action === 'primary_drive.save_snapshot') {
    var snap = savePrimaryDriveSnapshotGas_(ss, actor.name, 'sunviloz_primary_snapshot_');
    return { ok: true, data: { snapshot: snap, bootstrap: getAdminBootstrapGas_(ss), message: 'Verified snapshot saved to Primary Google Drive (' + snap.file_name + ').' } };
  }
  if (action === 'primary_drive.restore_snapshot') {
    var snapObj = payload.snapshot || readPrimaryDriveSnapshotGas_(payload.file_id);
    var prRes = restoreBackupPackageGas_(ss, actor, snapObj);
    prRes.bootstrap = getAdminBootstrapGas_(ss);
    return { ok: true, data: prRes };
  }
  if (action === 'backup.configure_secondary') {
    configureSecondaryBackupBridge_(
      ss,
      payload.secondary_drive_email,
      payload.secondary_drive_webapp_url,
      payload.secondary_drive_sync_secret || payload.secondary_drive_secret,
      payload.auto_backup_enabled,
      payload.auto_backup_hour
    );
    var bsSec = getAdminBootstrapGas_(ss);
    return { ok: true, data: { configured: true, bootstrap: bsSec, message: 'Secondary Drive backup settings saved.' } };
  }
  if (action === 'backup.record_status') {
    var recB = recordBackupHistoryGas_(ss, {
      source: payload.source || 'secondary_drive_oauth',
      status: payload.status,
      file_name: payload.file_name,
      drive_file_id: payload.drive_file_id,
      drive_account_email: payload.drive_account_email,
      folder_name: payload.folder_name,
      size_bytes: payload.size_bytes,
      checksum_sha256: payload.checksum_sha256,
      error_message: payload.error_message,
      created_by: actor.name
    });
    return { ok: true, data: { record: recB, bootstrap: getAdminBootstrapGas_(ss) } };
  }
  if (action === 'backup.run_scheduled_now') {
    var runRes = executeScheduledSecondaryBackupGas_(ss, actor.name);
    var bsRun = getAdminBootstrapGas_(ss);
    return {
      ok: runRes.status === 'verified',
      data: {
        ok: runRes.status === 'verified',
        fileName: runRes.file_name,
        pushedToSecondaryDrive: Boolean(PropertiesService.getScriptProperties().getProperty('SECONDARY_BACKUP_WEBAPP_URL')),
        bootstrap: bsRun,
        message: runRes.status === 'verified'
          ? ('Verified backup saved: ' + runRes.file_name)
          : (runRes.error_message || 'Backup failed.')
      },
      error: runRes.error_message || undefined
    };
  }
  if (action === 'backup.restore') {
    var resRestore = restoreBackupPackageGas_(ss, actor, payload.backup || payload);
    resRestore.bootstrap = getAdminBootstrapGas_(ss);
    return { ok: true, data: resRestore };
  }

  throw new Error('Unknown API action: ' + action);
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
