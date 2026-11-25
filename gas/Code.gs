/**
 * SUNVILOZ Clean Care — Unified Google Apps Script JSON API Router (Code.gs)
 *
 * Serves BOTH the native Android Kotlin/Jetpack Compose app and the Web preview
 * from the exact same private Google Sheet and private Google Drive backend.
 *
 * Security notes:
 * - Owner-only Editor helpers (provisionWorkspaceAndTriggers, testRecoveryEmailDelivery)
 *   are NEVER routable from doGet/doPost.
 * - First-time admin setup and email-code password recovery require 6-digit codes sent
 *   exclusively to sunvilozltd@gmail.com and execute under LockService.getScriptLock().
 * - Every write request is serialized with LockService.getScriptLock() and supports
 *   idempotent request_id replay via the RequestLocks sheet.
 * - Admin vs. Supervisor permissions are strictly enforced server-side on every action.
 */

function doGet(e) {
  try {
    var ss = getOrCreateSpreadsheet_();
    var status = handleAuthStatus_(ss);
    return jsonResponse_({
      ok: true,
      service: 'SUNVILOZ Clean Care Apps Script API',
      version: '3.0.0',
      timezone: SUNVILOZ_CONFIG.TIMEZONE,
      todayDhaka: getTodayDhakaIso_(),
      data: status
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      code: 'BACKEND_ERROR',
      error: err && err.message ? err.message : String(err)
    });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    var rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var req = JSON.parse(rawBody);
    var action = String(req.action || '').trim();
    var token = String(req.token || '').trim();
    var requestId = String(req.request_id || '').trim();
    var payload = (req.payload && typeof req.payload === 'object') ? req.payload : {};

    if (!action) {
      return jsonResponse_({ ok: false, code: 'BAD_REQUEST', error: 'Missing API action.' });
    }

    var ss = getOrCreateSpreadsheet_();

    // Public (unauthenticated) auth endpoints — all writes serialized under LockService
    if (action === 'auth.status') {
      return jsonResponse_({ ok: true, data: handleAuthStatus_(ss) });
    }
    if (action === 'auth.initial_setup_request_code') {
      lock.waitLock(25000);
      lockAcquired = true;
      return jsonResponse_({ ok: true, data: handleInitialSetupRequestCode_(ss) });
    }
    if (action === 'auth.initial_setup_complete') {
      lock.waitLock(25000);
      lockAcquired = true;
      return jsonResponse_({ ok: true, data: handleInitialSetupComplete_(ss, payload) });
    }
    if (action === 'auth.login') {
      lock.waitLock(25000);
      lockAcquired = true;
      var loginData = handleLogin_(ss, payload);
      return jsonResponse_({ ok: true, data: loginData });
    }
    if (action === 'auth.recovery_request_code') {
      lock.waitLock(25000);
      lockAcquired = true;
      return jsonResponse_({ ok: true, data: handleRecoveryRequestCode_(ss, payload) });
    }
    if (action === 'auth.recovery_verify_code') {
      lock.waitLock(25000);
      lockAcquired = true;
      return jsonResponse_({ ok: true, data: handleRecoveryVerifyCode_(ss, payload) });
    }
    if (action === 'auth.recovery_complete') {
      lock.waitLock(25000);
      lockAcquired = true;
      return jsonResponse_({ ok: true, data: handleRecoveryComplete_(ss, payload) });
    }

    // All remaining actions require a valid, non-revoked session token
    var authCtx = authenticateSessionToken_(ss, token);
    var actor = authCtx.user;

    // Read-only authenticated endpoints (no script write lock required)
    if (action === 'auth.me') {
      return jsonResponse_({ ok: true, data: { user: actor } });
    }
    if (action === 'supervisor.jobs') {
      if (actor.role !== 'supervisor') {
        return jsonResponse_({ ok: false, code: 'FORBIDDEN', error: 'This endpoint is restricted to supervisor accounts.' });
      }
      return jsonResponse_({ ok: true, data: getSupervisorEligibleJobsGas_(ss, actor.id) });
    }
    if (action === 'bootstrap') {
      requireAdminRole_(actor);
      return jsonResponse_({ ok: true, data: getAdminBootstrapGas_(ss) });
    }
    if (action === 'reports.monthly') {
      requireAdminRole_(actor);
      return jsonResponse_({ ok: true, data: handleMonthlyReport_(ss, payload) });
    }
    if (action === 'backup.export_payload') {
      requireAdminRole_(actor);
      return jsonResponse_({ ok: true, data: buildSanitizedBackupPackage_(ss, actor.name) });
    }
    if (action === 'backup.validate') {
      requireAdminRole_(actor);
      return jsonResponse_({ ok: true, data: validateBackupPackageGas_(payload.backup || payload) });
    }

    // Mutating endpoints: acquire script lock + check idempotent request_id
    lock.waitLock(25000);
    lockAcquired = true;

    if (requestId) {
      var cached = getIdempotentResponse_(ss, requestId, actor.id, action);
      if (cached) {
        return jsonResponse_(cached.body);
      }
    }

    var responseObj = dispatchAuthenticatedMutation_(ss, authCtx, action, payload);
    if (requestId && responseObj && responseObj.ok) {
      storeIdempotentResponse_(ss, requestId, actor.id, action, 200, responseObj);
    }
    return jsonResponse_(responseObj);
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    var code = 'SERVER_ERROR';
    var knownPrefixes = [
      'STATUS_LOCKED:', 'AUTH_FAILED:', 'AUTH_REQUIRED:', 'SESSION_REVOKED:',
      'BACKEND_SETUP_REQUIRED:', 'SETUP_DISABLED:', 'INVALID_CODE:',
      'CODE_EXPIRED:', 'RATE_LIMITED:', 'EMAIL_DELIVERY_FAILED:'
    ];
    for (var pi = 0; pi < knownPrefixes.length; pi++) {
      var pref = knownPrefixes[pi];
      if (msg.indexOf(pref) === 0) {
        code = pref.slice(0, -1);
        msg = msg.slice(pref.length).trim();
        break;
      }
    }
    if (code === 'SERVER_ERROR' && msg.indexOf('Access denied') === 0) {
      code = 'FORBIDDEN';
    }
    return jsonResponse_({ ok: false, code: code, error: msg });
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
    return { ok: true, data: { signedOut: true } };
  }
  if (action === 'auth.logout_all') {
    revokeSessionsForUser_(ss, actor.id, 'logout_all', null);
    return { ok: true, data: { signedOutAll: true } };
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
        message: 'Order completed and permanently status-locked.'
      }
    };
  }

  // All remaining mutations are strictly ADMIN-ONLY
  requireAdminRole_(actor);

  if (action === 'orders.create') {
    var created = handleCreateOrder_(ss, actor, payload);
    return { ok: true, data: { order: created, message: 'Order ' + created.order_id + ' saved.' } };
  }
  if (action === 'orders.update') {
    var updated = handleUpdateOrder_(ss, actor, payload);
    return { ok: true, data: { order: updated, message: 'Order ' + updated.order_id + ' updated.' } };
  }
  if (action === 'orders.status') {
    var stOrder = handleChangeOrderStatus_(ss, actor, payload);
    return { ok: true, data: { order: stOrder, message: 'Order status updated to ' + stOrder.status + '.' } };
  }
  if (action === 'orders.followup_done') {
    var orderIdF = String(payload.order_id || '');
    var doneFlag = Boolean(payload.followup_done);
    updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderIdF, {
      followup_done: doneFlag ? 1 : 0,
      followup_done_at: doneFlag ? now : '',
      updated_at: now
    });
    bumpSyncRevision_(ss);
    return { ok: true, data: { order: getOrderByIdGas_(ss, orderIdF) } };
  }
  if (action === 'orders.followup_reschedule') {
    var orderIdR = String(payload.order_id || '');
    var existingR = getOrderByIdGas_(ss, orderIdR);
    if (!existingR) throw new Error('Order not found.');
    var nextDate = String(payload.followup_date || '').trim();
    if (!isValidIsoDate_(nextDate)) throw new Error('Valid follow-up date is required.');
    updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderIdR, {
      followup_date: nextDate,
      followup_rule_note: String(payload.followup_rule_note || 'Rescheduled'),
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
    return { ok: true, data: { order: getOrderByIdGas_(ss, orderIdR) } };
  }
  if (action === 'orders.settlement_confirm') {
    var orderIdS = String(payload.order_id || '');
    updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderIdS, {
      settlement_confirmed: 1,
      settlement_confirmed_at: now,
      settlement_confirmed_by: actor.name,
      updated_at: now
    });
    bumpSyncRevision_(ss);
    return { ok: true, data: { order: getOrderByIdGas_(ss, orderIdS) } };
  }
  if (action === 'orders.settlement_entry') {
    var entry = {
      entry_id: makeUid_('SET'),
      order_id: String(payload.order_id || ''),
      supervisor_id: String(payload.supervisor_id || ''),
      supervisor_name: String(payload.supervisor_name || ''),
      amount_bdt: parseNonNegativeAmount_(payload.amount_bdt || 0, 'Settlement Amount'),
      direction: String(payload.direction || 'from_supervisor'),
      payment_method: String(payload.payment_method || 'Cash'),
      entry_date: isValidIsoDate_(payload.entry_date) ? payload.entry_date : getTodayDhakaIso_(),
      note: String(payload.note || '').trim(),
      recorded_by: actor.name,
      created_at: now
    };
    appendSheetObject_(ss, 'SettlementEntries', entry);
    bumpSyncRevision_(ss);
    return { ok: true, data: { entry: entry, order: getOrderByIdGas_(ss, entry.order_id) } };
  }

  // Quotations (exact 5 services, multiple priced rows, convert to order)
  if (action === 'quotations.save') {
    var qId = String(payload.quotation_id || '').trim();
    var items = Array.isArray(payload.items) ? payload.items : [];
    var subtotal = 0;
    for (var qi = 0; qi < items.length; qi++) {
      subtotal += parseNonNegativeAmount_(items[qi].amount_bdt || items[qi].price_bdt || 0, 'Service Price');
    }
    var discount = parseNonNegativeAmount_(payload.discount_bdt || 0, 'Discount');
    var total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
    if (qId) {
      updateSheetObjectByKey_(ss, 'Quotations', 'quotation_id', qId, {
        customer_name: String(payload.customer_name || '').trim(),
        phone_display: normalizePhoneBD_(payload.phone || payload.phone_display || '').display,
        address: String(payload.address || '').trim(),
        area: String(payload.area || '').trim(),
        items_json: JSON.stringify(items),
        subtotal_bdt: subtotal,
        discount_bdt: discount,
        total_bdt: total,
        valid_until: String(payload.valid_until || ''),
        followup_date: String(payload.followup_date || ''),
        status: String(payload.status || 'Draft'),
        notes: String(payload.notes || '').trim(),
        updated_at: now
      });
    } else {
      var qSeq = incrementSequence_(ss, 'quotation_sequence');
      qId = makeUid_('QTN');
      appendSheetObject_(ss, 'Quotations', {
        quotation_id: qId,
        quotation_number: 'SCC-QTN-' + String(1000 + qSeq),
        lead_id: String(payload.lead_id || ''),
        customer_id: String(payload.customer_id || ''),
        building_id: String(payload.building_id || ''),
        customer_name: String(payload.customer_name || '').trim(),
        phone_display: normalizePhoneBD_(payload.phone || payload.phone_display || '').display,
        address: String(payload.address || '').trim(),
        area: String(payload.area || '').trim(),
        items_json: JSON.stringify(items),
        subtotal_bdt: subtotal,
        discount_bdt: discount,
        total_bdt: total,
        valid_until: String(payload.valid_until || addDaysIso_(getTodayDhakaIso_(), 15)),
        followup_date: String(payload.followup_date || ''),
        status: String(payload.status || 'Sent'),
        converted_order_id: '',
        notes: String(payload.notes || '').trim(),
        pdf_file_id: '',
        created_at: now,
        updated_at: now
      });
    }
    bumpSyncRevision_(ss);
    return { ok: true, data: { quotation_id: qId, message: 'Quotation saved.' } };
  }
  if (action === 'quotations.convert') {
    var quotes = readSheetObjects_(ss, 'Quotations');
    var targetQ = null;
    for (var qk = 0; qk < quotes.length; qk++) {
      if (String(quotes[qk].quotation_id) === String(payload.quotation_id)) {
        targetQ = quotes[qk];
        break;
      }
    }
    if (!targetQ) throw new Error('Quotation not found.');
    var qItems = [];
    try { qItems = JSON.parse(String(targetQ.items_json || '[]')); } catch (eQ) {}
    var serviceNames = [];
    for (var si = 0; si < qItems.length; si++) {
      if (qItems[si].service_type) serviceNames.push(String(qItems[si].service_type));
    }
    var combinedService = serviceNames.length > 0 ? serviceNames.join(' + ') : SUNVILOZ_CONFIG.DEFAULT_SERVICES[0];
    var newOrder = handleCreateOrder_(ss, actor, {
      customer_id: targetQ.customer_id,
      building_id: targetQ.building_id,
      lead_id: targetQ.lead_id,
      customer_name: targetQ.customer_name,
      phone: targetQ.phone_display,
      address: targetQ.address,
      area: targetQ.area,
      service_type: combinedService,
      price_bdt: Number(targetQ.total_bdt || 0),
      scheduled_date: payload.scheduled_date || getTodayDhakaIso_(),
      scheduled_time: payload.scheduled_time || '10:00',
      assigned_supervisor_id: payload.assigned_supervisor_id || '',
      notes: 'Converted from ' + targetQ.quotation_number + (targetQ.notes ? ' · ' + targetQ.notes : '')
    });
    updateSheetObjectByKey_(ss, 'Quotations', 'quotation_id', targetQ.quotation_id, {
      status: 'Accepted',
      converted_order_id: newOrder.order_id,
      updated_at: now
    });
    return { ok: true, data: { order: newOrder, message: 'Converted to Order ' + newOrder.order_id } };
  }

  // Money Receipts (issuing or reprinting NEVER adds extra income)
  if (action === 'receipts.issue') {
    var ord = getOrderByIdGas_(ss, String(payload.order_id || ''));
    if (!ord) throw new Error('Order not found.');
    var rSeq = incrementSequence_(ss, 'receipt_sequence');
    var receipt = {
      receipt_id: makeUid_('RCP'),
      receipt_number: 'SCC-MR-' + String(1000 + rSeq),
      order_id: ord.order_id,
      customer_name: ord.customer_name,
      phone_display: ord.phone_display,
      address: ord.address,
      service_type: ord.service_type,
      amount_bdt: ord.is_no_charge_visit ? 0 : ord.price_bdt,
      payment_method: String(payload.payment_method || 'Cash'),
      payment_date: isValidIsoDate_(payload.payment_date) ? payload.payment_date : (ord.completion_date || getTodayDhakaIso_()),
      received_by: String(payload.received_by || actor.name),
      notes: String(payload.notes || '').trim(),
      pdf_file_id: '',
      created_at: now
    };
    appendSheetObject_(ss, 'Receipts', receipt);
    bumpSyncRevision_(ss);
    return { ok: true, data: { receipt: receipt } };
  }

  // Customers, Buildings & Leads
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
    return { ok: true, data: { customer: cRec } };
  }
  if (action === 'buildings.save') {
    var bId = String(payload.building_id || '').trim();
    var bRec = {
      building_id: bId || makeUid_('BLD'),
      customer_id: String(payload.customer_id || '').trim(),
      name: String(payload.name || '').trim(),
      address: String(payload.address || '').trim(),
      area: String(payload.area || '').trim(),
      overhead_tank_count: parseInt(String(payload.overhead_tank_count || '0'), 10) || 0,
      overhead_tank_capacity_liters: parseInt(String(payload.overhead_tank_capacity_liters || '0'), 10) || 0,
      reserve_tank_count: parseInt(String(payload.reserve_tank_count || '0'), 10) || 0,
      reserve_tank_capacity_liters: parseInt(String(payload.reserve_tank_capacity_liters || '0'), 10) || 0,
      floors: parseInt(String(payload.floors || '0'), 10) || 0,
      caretaker_name: String(payload.caretaker_name || '').trim(),
      caretaker_phone: String(payload.caretaker_phone || '').trim(),
      access_notes: String(payload.access_notes || '').trim(),
      updated_at: now
    };
    if (bId) {
      updateSheetObjectByKey_(ss, 'Buildings', 'building_id', bId, bRec);
    } else {
      bRec.created_at = now;
      appendSheetObject_(ss, 'Buildings', bRec);
    }
    bumpSyncRevision_(ss);
    return { ok: true, data: { building: bRec } };
  }
  if (action === 'leads.save') {
    var lId = String(payload.lead_id || '').trim();
    var lPhone = normalizePhoneBD_(payload.phone || payload.phone_display || '');
    var lRec = {
      lead_id: lId || ('LEAD-' + String(1000 + incrementSequence_(ss, 'lead_sequence'))),
      customer_name: String(payload.customer_name || '').trim(),
      phone_display: lPhone.display,
      phone_e164: lPhone.e164,
      address: String(payload.address || '').trim(),
      area: String(payload.area || '').trim(),
      service_type: String(payload.service_type || SUNVILOZ_CONFIG.DEFAULT_SERVICES[0]).trim(),
      quoted_price_bdt: parseNonNegativeAmount_(payload.quoted_price_bdt || 0, 'Quoted Price'),
      channel: String(payload.channel || 'Phone'),
      stage: String(payload.stage || 'New'),
      followup_date: String(payload.followup_date || ''),
      followup_done: payload.followup_done ? 1 : 0,
      followup_done_at: payload.followup_done ? now : '',
      agent_name: String(payload.agent_name || '').trim(),
      agent_phone_display: String(payload.agent_phone_display || '').trim(),
      agent_note: String(payload.agent_note || '').trim(),
      caretaker_name: String(payload.caretaker_name || '').trim(),
      caretaker_phone_display: String(payload.caretaker_phone_display || '').trim(),
      caretaker_note: String(payload.caretaker_note || '').trim(),
      converted_order_id: String(payload.converted_order_id || ''),
      notes: String(payload.notes || '').trim(),
      updated_at: now
    };
    if (!lRec.customer_name) throw new Error('Prospect name is required.');
    if (lId) {
      updateSheetObjectByKey_(ss, 'Leads', 'lead_id', lId, lRec);
    } else {
      lRec.created_at = now;
      appendSheetObject_(ss, 'Leads', lRec);
    }
    bumpSyncRevision_(ss);
    return { ok: true, data: { lead: lRec } };
  }

  // Workers & Worker Pay (recording payment does NOT double-count labour cost)
  if (action === 'workers.save') {
    var wId = String(payload.worker_id || '').trim();
    var wRec = {
      worker_id: wId || makeUid_('WRK'),
      name: String(payload.name || '').trim(),
      phone_display: normalizePhoneBD_(payload.phone || payload.phone_display || '').display,
      role_label: String(payload.role_label || 'Cleaner').trim(),
      default_daily_wage_bdt: parseNonNegativeAmount_(payload.default_daily_wage_bdt || 0, 'Daily Wage'),
      is_active: payload.is_active === false ? 0 : 1,
      notes: String(payload.notes || '').trim(),
      updated_at: now
    };
    if (!wRec.name) throw new Error('Worker name is required.');
    if (wId) {
      updateSheetObjectByKey_(ss, 'Workers', 'worker_id', wId, wRec);
    } else {
      wRec.created_at = now;
      appendSheetObject_(ss, 'Workers', wRec);
    }
    bumpSyncRevision_(ss);
    return { ok: true, data: { worker: wRec } };
  }
  if (action === 'workers.mark_paid') {
    var assignId = String(payload.assignment_id || '').trim();
    var owRows = readSheetObjects_(ss, 'OrderWorkers');
    var targetOw = null;
    for (var oi = 0; oi < owRows.length; oi++) {
      if (String(owRows[oi].assignment_id) === assignId) {
        targetOw = owRows[oi];
        break;
      }
    }
    if (!targetOw) throw new Error('Worker assignment not found.');
    updateSheetObjectByKey_(ss, 'OrderWorkers', 'assignment_id', assignId, {
      paid: 1,
      paid_at: now,
      paid_by: actor.name,
      payment_note: String(payload.payment_note || '').trim(),
      updated_at: now
    });
    appendSheetObject_(ss, 'WorkerPayHistory', {
      pay_history_id: makeUid_('WPH'),
      assignment_id: assignId,
      order_id: String(targetOw.order_id),
      worker_id: String(targetOw.worker_id),
      worker_name: String(targetOw.worker_name),
      amount_bdt: Number(targetOw.wage_bdt || 0),
      action_type: 'paid',
      note: String(payload.payment_note || '').trim(),
      actor_name: actor.name,
      created_at: now
    });
    bumpSyncRevision_(ss);
    return { ok: true, data: { order: getOrderByIdGas_(ss, String(targetOw.order_id)) } };
  }

  // General Business / Overhead Expenses
  if (action === 'overhead.create') {
    var ohRec = {
      expense_id: makeUid_('OVH'),
      expense_date: isValidIsoDate_(payload.expense_date) ? payload.expense_date : getTodayDhakaIso_(),
      category: String(payload.category || 'General').trim(),
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
    return { ok: true, data: { expense: ohRec } };
  }
  if (action === 'overhead.delete') {
    deleteSheetRowsByKey_(ss, 'OverheadExpenses', 'expense_id', String(payload.expense_id || ''));
    bumpSyncRevision_(ss);
    return { ok: true, data: { deleted: true } };
  }

  // Supervisor Account Management (Admin-only)
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
    return { ok: true, data: { supervisor: toPublicAccount_(sRec) } };
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
    if (payload.new_password && String(payload.new_password).length > 0) {
      patchSup.password_hash = hashPasswordGas_(String(payload.new_password));
      nextTvSup += 1;
      patchSup.token_version = nextTvSup;
      shouldRevoke = true;
    }
    updateSheetObjectByKey_(ss, 'Accounts', 'id', supIdU, patchSup);
    if (shouldRevoke) revokeSessionsForUser_(ss, supIdU, 'admin_updated', null);
    bumpSyncRevision_(ss);
    return { ok: true, data: { supervisor: toPublicAccount_(findAccountById_(ss, supIdU)) } };
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
    return { ok: true, data: savedL };
  }
  if (action === 'pads.save') {
    var padType = String(payload.pad_type || '').trim();
    if (['quotation', 'receipt'].indexOf(padType) === -1) throw new Error('Invalid pad_type.');
    var foldersP = getPrivateDriveFolders_();
    var savedP = saveBase64FileToDrive_(
      foldersP.pads,
      String(payload.file_name || (padType + '_pad.png')),
      String(payload.mime_type || 'image/png'),
      String(payload.data_url || ''),
      ''
    );
    var padPatch = {
      pad_type: padType,
      file_name: savedP.file_name,
      mime_type: String(payload.mime_type || 'image/png'),
      drive_file_id: savedP.file_id,
      fields_json: JSON.stringify(payload.fields || []),
      updated_by: actor.name,
      updated_at: now
    };
    var updPad = updateSheetObjectByKey_(ss, 'DocumentPads', 'pad_type', padType, padPatch);
    if (!updPad) appendSheetObject_(ss, 'DocumentPads', padPatch);
    bumpSyncRevision_(ss);
    return { ok: true, data: padPatch };
  }
  if (action === 'pdfs.archive') {
    var foldersF = getPrivateDriveFolders_();
    var savedF = saveBase64FileToDrive_(
      foldersF.pdfs,
      String(payload.file_name || 'document.pdf'),
      'application/pdf',
      String(payload.data_url || ''),
      ''
    );
    var pdfRec = {
      pdf_id: makeUid_('PDF'),
      doc_type: String(payload.doc_type || 'quotation'),
      doc_id: String(payload.doc_id || ''),
      doc_number: String(payload.doc_number || ''),
      file_name: savedF.file_name,
      drive_file_id: savedF.file_id,
      size_bytes: savedF.size_bytes,
      issued_by: actor.name,
      created_at: now
    };
    appendSheetObject_(ss, 'IssuedPdfs', pdfRec);
    bumpSyncRevision_(ss);
    return { ok: true, data: pdfRec };
  }

  // Settings, Backup & Restore
  if (action === 'settings.save') {
    var allowedKeys = ['default_followup_value', 'default_followup_unit', 'reminder_email', 'daily_reminder_hour', 'reminders_paused_after_restore', 'secondary_drive_folder_name'];
    for (var sk = 0; sk < allowedKeys.length; sk++) {
      var k = allowedKeys[sk];
      if (payload[k] !== undefined) setSetting_(ss, k, payload[k]);
    }
    bumpSyncRevision_(ss);
    return { ok: true, data: { saved: true } };
  }
  if (action === 'backup.configure_secondary') {
    configureSecondaryBackupBridge_(
      ss,
      payload.secondary_drive_email,
      payload.secondary_drive_webapp_url,
      payload.secondary_drive_sync_secret,
      payload.auto_backup_enabled,
      payload.auto_backup_hour
    );
    return { ok: true, data: { configured: true } };
  }
  if (action === 'backup.record_status') {
    var recB = recordBackupHistoryGas_(ss, {
      source: payload.source || 'android_secondary_drive',
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
    return { ok: true, data: recB };
  }
  if (action === 'backup.run_scheduled_now') {
    var runRes = executeScheduledSecondaryBackupGas_(ss, actor.name);
    return { ok: runRes.status === 'verified', data: runRes, error: runRes.error_message || undefined };
  }
  if (action === 'backup.restore') {
    var resRestore = restoreBackupPackageGas_(ss, actor, payload.backup || payload);
    return { ok: true, data: resRestore };
  }

  throw new Error('Unknown API action: ' + action);
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
