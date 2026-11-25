/**
 * SUNVILOZ Clean Care — Core Business Logic & Reporting (BusinessLogic.gs)
 *
 * Implements all SUNVILOZ Clean Care business rules server-side in Apps Script:
 * - Exact 5 standardized services in exact order (preserving legacy saved strings)
 * - Permanent order status lock when Completed AND full customer payment confirmed
 * - Atomic completion with worker pay counted once and 6-month default follow-up
 * - Strict Supervisor RBAC (only assigned jobs from today through today + 6 days)
 * - Shared Monthly Jobs & Income calculation (matches Excel export identically)
 */

function isOrderStatusLockedGas_(order) {
  if (!order) return false;
  var st = String(order.status || '').trim();
  var paid = String(order.full_bill_collected) === '1' || order.full_bill_collected === true || order.full_bill_collected === 1;
  var explicitLock = String(order.status_locked) === '1' || order.status_locked === true || order.status_locked === 1;
  return explicitLock || (st === 'Completed' && paid);
}

function toCleanStr_(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

function toCleanBool_(v) {
  return String(v) === '1' || v === true || v === 1 || String(v).toLowerCase() === 'true';
}

function hydrateOrder_(row, workersByOrder, historyByOrder, settlementsByOrder, complaintsByOrder) {
  var o = {};
  var keys = SHEET_SCHEMAS.Orders;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var raw = row[k];
    o[k] = raw === undefined || raw === null ? '' : String(raw);
  }
  // Ensure phone_display always retains leading 0 if an earlier Sheet write stripped it
  if (/^1[3-9]\d{8}$/.test(o.phone_display)) {
    o.phone_display = '0' + o.phone_display;
  }
  if (/^8801[3-9]\d{8}$/.test(o.phone_e164)) {
    o.phone_e164 = '+' + o.phone_e164;
  }
  o.price_bdt = Number(row.price_bdt || 0) || 0;
  o.advance_given = Number(row.advance_given || 0) || 0;
  o.transport_cost = Number(row.transport_cost || 0) || 0;
  o.meals_cost = Number(row.meals_cost || 0) || 0;
  o.other_expenses_total = Number(row.other_expenses_total || 0) || 0;
  o.worker_pay_total = Number(row.worker_pay_total || 0) || 0;
  o.actual_expenses = Number(row.actual_expenses || 0) || 0;
  o.job_profit = Number(row.job_profit || 0) || 0;
  o.supervisor_settlement = Number(row.supervisor_settlement || 0) || 0;
  o.full_bill_collected = toCleanBool_(row.full_bill_collected);
  o.status_locked = isOrderStatusLockedGas_(o);
  o.settlement_confirmed = toCleanBool_(row.settlement_confirmed);
  o.reminder_sent = toCleanBool_(row.reminder_sent);
  o.followup_done = toCleanBool_(row.followup_done);
  o.is_no_charge_visit = toCleanBool_(row.is_no_charge_visit);
  o.followup_version = parseInt(String(row.followup_version || '0'), 10) || 0;
  o.reminder_sent_version = parseInt(String(row.reminder_sent_version || '0'), 10) || 0;
  o.return_visit_costs_total = Number(row.return_visit_costs_total || 0) || 0;
  o.lifetime_job_profit = row.lifetime_job_profit !== undefined
    ? (Number(row.lifetime_job_profit || 0) || 0)
    : (o.is_no_charge_visit ? -o.actual_expenses : Math.round((o.price_bdt - o.actual_expenses - o.return_visit_costs_total) * 100) / 100);
  try {
    var parsedOther = JSON.parse(String(o.other_expenses_json || '[]'));
    o.other_expenses = Array.isArray(parsedOther) ? parsedOther.map(function (it) {
      return {
        description: toCleanStr_(it && it.description),
        amount: Number((it && it.amount) || 0) || 0
      };
    }) : [];
  } catch (err) {
    o.other_expenses = [];
  }
  o.workers = workersByOrder ? (workersByOrder[o.order_id] || []) : [];
  o.history = historyByOrder ? (historyByOrder[o.order_id] || []) : [];
  o.settlement_entries = settlementsByOrder ? (settlementsByOrder[o.order_id] || []) : [];
  o.complaints = complaintsByOrder ? (complaintsByOrder[o.order_id] || []) : [];
  return o;
}

function getAllHydratedOrders_(ss) {
  var orderRows = readSheetObjects_(ss, 'Orders');
  var owRows = readSheetObjects_(ss, 'OrderWorkers');
  var histRows = readSheetObjects_(ss, 'StatusHistory');
  var setRows = readSheetObjects_(ss, 'SettlementEntries');
  var compRows = readSheetObjects_(ss, 'Complaints');

  var workersByOrder = {};
  for (var i = 0; i < owRows.length; i++) {
    var w = owRows[i];
    if (!workersByOrder[w.order_id]) workersByOrder[w.order_id] = [];
    workersByOrder[w.order_id].push({
      assignment_id: String(w.assignment_id),
      order_id: String(w.order_id),
      worker_id: String(w.worker_id),
      worker_name: String(w.worker_name),
      wage_bdt: Number(w.wage_bdt || 0),
      confirmed: String(w.confirmed) === '1' || w.confirmed === true || w.confirmed === 1,
      paid: String(w.paid) === '1' || w.paid === true || w.paid === 1,
      paid_at: String(w.paid_at || ''),
      paid_by: String(w.paid_by || ''),
      payment_note: String(w.payment_note || '')
    });
  }

  var historyByOrder = {};
  for (var h = 0; h < histRows.length; h++) {
    var hr = histRows[h];
    if (!historyByOrder[hr.order_id]) historyByOrder[hr.order_id] = [];
    historyByOrder[hr.order_id].push(hr);
  }

  var settlementsByOrder = {};
  for (var s = 0; s < setRows.length; s++) {
    var sr = setRows[s];
    if (!settlementsByOrder[sr.order_id]) settlementsByOrder[sr.order_id] = [];
    settlementsByOrder[sr.order_id].push({
      entry_id: String(sr.entry_id),
      order_id: String(sr.order_id),
      supervisor_id: String(sr.supervisor_id),
      supervisor_name: String(sr.supervisor_name),
      amount_bdt: Number(sr.amount_bdt || 0),
      direction: String(sr.direction || 'from_supervisor'),
      payment_method: String(sr.payment_method || 'Cash'),
      entry_date: String(sr.entry_date || ''),
      note: String(sr.note || ''),
      recorded_by: String(sr.recorded_by || ''),
      created_at: String(sr.created_at || '')
    });
  }

  var complaintsByOrder = {};
  for (var c = 0; c < compRows.length; c++) {
    var cr = compRows[c];
    if (!complaintsByOrder[cr.order_id]) complaintsByOrder[cr.order_id] = [];
    complaintsByOrder[cr.order_id].push(cr);
  }

  var out = [];
  for (var k = 0; k < orderRows.length; k++) {
    out.push(hydrateOrder_(orderRows[k], workersByOrder, historyByOrder, settlementsByOrder, complaintsByOrder));
  }
  // Attach linked no-charge return visit cost & lifetime profit to parent orders
  var returnCostsByParent = {};
  for (var r = 0; r < out.length; r++) {
    if (out[r].is_no_charge_visit && out[r].parent_order_id && out[r].status === 'Completed') {
      returnCostsByParent[out[r].parent_order_id] =
        (returnCostsByParent[out[r].parent_order_id] || 0) + Number(out[r].actual_expenses || 0);
    }
  }
  for (var p = 0; p < out.length; p++) {
    var rvCost = returnCostsByParent[out[p].order_id] || 0;
    out[p].return_visit_costs_total = Math.round(rvCost * 100) / 100;
    out[p].lifetime_job_profit = out[p].is_no_charge_visit
      ? -out[p].actual_expenses
      : Math.round((out[p].price_bdt - out[p].actual_expenses - rvCost) * 100) / 100;
  }
  return out;
}

function getOrderByIdGas_(ss, orderId) {
  var all = getAllHydratedOrders_(ss);
  for (var i = 0; i < all.length; i++) {
    if (all[i].order_id === orderId) return all[i];
  }
  return null;
}

function appendOrderHistory_(ss, orderId, fromStatus, toStatus, note, actorName) {
  appendSheetObject_(ss, 'StatusHistory', {
    history_id: makeUid_('HIS'),
    order_id: orderId,
    from_status: String(fromStatus || ''),
    to_status: String(toStatus || ''),
    note: String(note || ''),
    actor_name: String(actorName || ''),
    created_at: getNowDhakaTimestamp_()
  });
}

function recomputeOrderFinancials_(ss, orderId) {
  var order = getOrderByIdGas_(ss, orderId);
  if (!order) return null;
  var workerPayTotal = 0;
  for (var i = 0; i < order.workers.length; i++) {
    var w = order.workers[i];
    // Confirmed worker pay is counted ONCE as a labour cost
    if (w.confirmed) {
      workerPayTotal += Number(w.wage_bdt || 0);
    }
  }
  var actualExpenses = Math.round((
    Number(order.transport_cost || 0) +
    Number(order.meals_cost || 0) +
    Number(order.other_expenses_total || 0) +
    workerPayTotal
  ) * 100) / 100;
  var revenue = order.is_no_charge_visit ? 0 : Number(order.price_bdt || 0);
  var jobProfit = Math.round((revenue - actualExpenses) * 100) / 100;
  var expectedSettlement = Math.round((
    (order.full_bill_collected ? revenue : 0) +
    Number(order.advance_given || 0) -
    actualExpenses
  ) * 100) / 100;

  updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, {
    worker_pay_total: workerPayTotal,
    actual_expenses: actualExpenses,
    job_profit: jobProfit,
    supervisor_settlement: expectedSettlement,
    updated_at: getNowDhakaTimestamp_()
  });
  return getOrderByIdGas_(ss, orderId);
}

function projectSupervisorJobGas_(order, buildingsMap) {
  var bld = order.building_id ? buildingsMap[order.building_id] : null;
  return {
    order_id: order.order_id,
    customer_name: order.customer_name,
    phone_display: order.phone_display,
    address: order.address,
    area: order.area,
    service_type: order.service_type,
    price_bdt: order.price_bdt,
    scheduled_date: order.scheduled_date,
    scheduled_time: order.scheduled_time,
    status: order.status,
    status_locked: order.status_locked,
    status_locked_at: order.status_locked_at,
    advance_given: order.advance_given,
    is_no_charge_visit: order.is_no_charge_visit,
    parent_order_id: order.parent_order_id,
    notes: order.notes,
    full_bill_collected: order.full_bill_collected,
    completion_date: order.completion_date,
    transport_cost: order.transport_cost,
    meals_cost: order.meals_cost,
    other_expenses: order.other_expenses,
    workers: order.workers,
    building_info: bld ? {
      name: String(bld.name || ''),
      overhead_tank_count: Number(bld.overhead_tank_count || 0),
      overhead_tank_capacity_liters: Number(bld.overhead_tank_capacity_liters || 0),
      reserve_tank_count: Number(bld.reserve_tank_count || 0),
      reserve_tank_capacity_liters: Number(bld.reserve_tank_capacity_liters || 0),
      floors: Number(bld.floors || 0),
      caretaker_name: String(bld.caretaker_name || ''),
      caretaker_phone: String(bld.caretaker_phone || ''),
      access_notes: String(bld.access_notes || '')
    } : null
  };
}

function getSupervisorEligibleJobsGas_(ss, supervisorId) {
  var today = getTodayDhakaIso_();
  var endDate = addDaysIso_(today, 6);
  var orders = getAllHydratedOrders_(ss);
  var buildings = readSheetObjects_(ss, 'Buildings');
  var bMap = {};
  for (var b = 0; b < buildings.length; b++) bMap[buildings[b].building_id] = buildings[b];

  var jobs = [];
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (String(o.assigned_supervisor_id) !== String(supervisorId)) continue;
    if (o.status === 'Cancelled') continue;
    if (o.scheduled_date >= today && o.scheduled_date <= endDate) {
      jobs.push(projectSupervisorJobGas_(o, bMap));
    }
  }
  jobs.sort(function (a, b) {
    return (a.scheduled_date + ' ' + a.scheduled_time).localeCompare(b.scheduled_date + ' ' + b.scheduled_time);
  });

  var settings = getSettingsMap_(ss);
  var logoDataUrl = settings.company_logo_file_id
    ? readDriveFileAsDataUrl_(settings.company_logo_file_id, settings.company_logo_mime_type)
    : '';

  return {
    todayDhaka: today,
    endDateDhaka: endDate,
    jobs: jobs,
    companyLogoDataUrl: logoDataUrl
  };
}

function handleCreateOrder_(ss, actor, payload) {
  var customerName = String(payload.customer_name || '').trim();
  if (!customerName) throw new Error('Customer name is required.');
  var phone = normalizePhoneBD_(payload.phone || payload.phone_display || '');
  if (!phone.display) throw new Error('Customer phone number is required.');
  var serviceType = String(payload.service_type || '').trim();
  if (!serviceType) throw new Error('Please select a service option.');
  var scheduledDate = String(payload.scheduled_date || '').trim();
  if (!isValidIsoDate_(scheduledDate)) throw new Error('Please select a valid Scheduled Work Date.');
  var bookingDate = isValidIsoDate_(payload.booking_date) ? String(payload.booking_date).trim() : getTodayDhakaIso_();
  var isNoCharge = Boolean(payload.is_no_charge_visit);
  var priceBdt = isNoCharge ? 0 : parseNonNegativeAmount_(payload.price_bdt || 0, 'Agreed Price');
  var advanceGiven = parseNonNegativeAmount_(payload.advance_given || 0, 'Advance Given');

  var seq = incrementSequenceAndSync_(ss, 'order_sequence');
  var orderId = 'ORD-' + String(1000 + seq);
  var now = getNowDhakaTimestamp_();

  var supId = String(payload.assigned_supervisor_id || '').trim();
  var supName = String(payload.assigned_supervisor_name || '').trim();
  if (supId && !supName) {
    var supAcc = findAccountById_(ss, supId);
    if (supAcc) supName = String(supAcc.name || '');
  }

  var row = {
    order_id: orderId,
    booking_date: bookingDate,
    lead_id: String(payload.lead_id || '').trim(),
    customer_id: String(payload.customer_id || '').trim(),
    building_id: String(payload.building_id || '').trim(),
    customer_name: customerName,
    phone_display: phone.display,
    phone_e164: phone.e164,
    address: String(payload.address || '').trim(),
    area: String(payload.area || '').trim(),
    service_type: serviceType,
    price_bdt: priceBdt,
    scheduled_date: scheduledDate,
    scheduled_time: String(payload.scheduled_time || '10:00').trim(),
    status: 'Confirmed',
    status_locked: 0,
    status_locked_at: '',
    assigned_supervisor_id: supId,
    assigned_supervisor_name: supName,
    advance_given: advanceGiven,
    advance_supervisor_id: advanceGiven > 0 ? supId : '',
    advance_supervisor_name: advanceGiven > 0 ? supName : '',
    advance_given_at: advanceGiven > 0 ? now : '',
    completion_date: '',
    completed_at: '',
    completed_by_user_id: '',
    completed_by_name: '',
    full_bill_collected: 0,
    payment_collected_at: '',
    collected_by_name: '',
    transport_cost: 0,
    meals_cost: 0,
    other_expenses_json: '[]',
    other_expenses_total: 0,
    worker_pay_total: 0,
    actual_expenses: 0,
    job_profit: priceBdt,
    supervisor_settlement: advanceGiven,
    settlement_confirmed: 0,
    settlement_confirmed_at: '',
    settlement_confirmed_by: '',
    followup_date: '',
    followup_rule_note: '',
    followup_version: 0,
    reminder_sent: 0,
    reminder_sent_at: '',
    reminder_sent_for_date: '',
    reminder_sent_version: 0,
    followup_done: 0,
    followup_done_at: '',
    is_no_charge_visit: isNoCharge ? 1 : 0,
    parent_order_id: String(payload.parent_order_id || '').trim(),
    complaint_id: String(payload.complaint_id || '').trim(),
    return_visit_reason: String(payload.return_visit_reason || '').trim(),
    notes: String(payload.notes || '').trim(),
    created_at: now,
    updated_at: now
  };

  appendSheetObject_(ss, 'Orders', row);

  // Assign initial workers if provided
  var workerIds = Array.isArray(payload.worker_assignments) ? payload.worker_assignments : [];
  var createdWorkers = [];
  for (var i = 0; i < workerIds.length; i++) {
    var wa = workerIds[i];
    var assignmentRow = {
      assignment_id: makeUid_('OW'),
      order_id: orderId,
      worker_id: String(wa.worker_id || ''),
      worker_name: String(wa.worker_name || ''),
      wage_bdt: parseNonNegativeAmount_(wa.wage_bdt || 0, 'Worker Wage'),
      confirmed: 0,
      paid: 0,
      paid_at: '',
      paid_by: '',
      payment_note: '',
      created_at: now,
      updated_at: now
    };
    appendSheetObject_(ss, 'OrderWorkers', assignmentRow);
    createdWorkers.push({
      assignment_id: assignmentRow.assignment_id,
      order_id: orderId,
      worker_id: assignmentRow.worker_id,
      worker_name: assignmentRow.worker_name,
      wage_bdt: assignmentRow.wage_bdt,
      confirmed: false,
      paid: false,
      paid_at: '',
      paid_by: '',
      payment_note: ''
    });
  }

  var historyNote = 'Order created (' + serviceType + ', BDT ' + priceBdt + ')';
  var historyRow = {
    history_id: makeUid_('HIS'),
    order_id: orderId,
    from_status: '',
    to_status: 'Confirmed',
    note: historyNote,
    actor_name: String(actor.name || ''),
    created_at: now
  };
  appendSheetObject_(ss, 'StatusHistory', historyRow);

  // Return hydrated order directly from in-memory records instead of re-reading 5 entire sheets
  var workersMap = {};
  workersMap[orderId] = createdWorkers;
  var historyMap = {};
  historyMap[orderId] = [historyRow];
  return hydrateOrder_(row, workersMap, historyMap, {}, {});
}

function handleUpdateOrder_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var existing = getOrderByIdGas_(ss, orderId);
  if (!existing) throw new Error('Order not found.');

  // Enforce permanent status lock across all update paths
  if (payload.status !== undefined && String(payload.status) !== existing.status) {
    if (existing.status_locked) {
      throw new Error('STATUS_LOCKED: Order status is locked because this order is Completed and full customer payment is confirmed.');
    }
  }

  var now = getNowDhakaTimestamp_();
  var patch = { updated_at: now };
  if (payload.customer_name !== undefined) patch.customer_name = String(payload.customer_name).trim();
  if (payload.phone !== undefined || payload.phone_display !== undefined) {
    var ph = normalizePhoneBD_(payload.phone !== undefined ? payload.phone : payload.phone_display);
    patch.phone_display = ph.display;
    patch.phone_e164 = ph.e164;
  }
  if (payload.address !== undefined) patch.address = String(payload.address).trim();
  if (payload.area !== undefined) patch.area = String(payload.area).trim();
  if (payload.service_type !== undefined) patch.service_type = String(payload.service_type).trim();
  if (payload.booking_date !== undefined && isValidIsoDate_(payload.booking_date)) patch.booking_date = String(payload.booking_date).trim();
  if (payload.scheduled_date !== undefined && isValidIsoDate_(payload.scheduled_date)) patch.scheduled_date = String(payload.scheduled_date).trim();
  if (payload.scheduled_time !== undefined) patch.scheduled_time = String(payload.scheduled_time).trim();
  if (payload.price_bdt !== undefined && !existing.is_no_charge_visit) {
    patch.price_bdt = parseNonNegativeAmount_(payload.price_bdt, 'Agreed Price');
  }
  if (payload.assigned_supervisor_id !== undefined) {
    var supId = String(payload.assigned_supervisor_id || '').trim();
    var supAcc = supId ? findAccountById_(ss, supId) : null;
    patch.assigned_supervisor_id = supId;
    patch.assigned_supervisor_name = supAcc ? String(supAcc.name || '') : String(payload.assigned_supervisor_name || '');
  }
  if (payload.advance_given !== undefined) {
    patch.advance_given = parseNonNegativeAmount_(payload.advance_given, 'Advance Given');
  }
  if (payload.notes !== undefined) patch.notes = String(payload.notes).trim();

  updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, patch);
  recomputeOrderFinancials_(ss, orderId);
  appendOrderHistory_(ss, orderId, existing.status, existing.status, 'Order details updated', actor.name);
  bumpSyncRevision_(ss);
  return getOrderByIdGas_(ss, orderId);
}

function handleChangeOrderStatus_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var nextStatus = String(payload.status || '').trim();
  var allowed = ['Confirmed', 'In Progress', 'Rescheduled', 'Cancelled'];
  if (allowed.indexOf(nextStatus) === -1) {
    throw new Error('Invalid status transition. Use the Completion workflow to mark an order Completed.');
  }
  var existing = getOrderByIdGas_(ss, orderId);
  if (!existing) throw new Error('Order not found.');
  if (existing.status_locked) {
    throw new Error('STATUS_LOCKED: Order status is locked because this order is Completed and full customer payment is confirmed.');
  }
  var now = getNowDhakaTimestamp_();
  updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, {
    status: nextStatus,
    updated_at: now
  });
  appendOrderHistory_(ss, orderId, existing.status, nextStatus, String(payload.note || 'Status updated'), actor.name);
  bumpSyncRevision_(ss);
  return getOrderByIdGas_(ss, orderId);
}

function handleCompleteOrder_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var existing = getOrderByIdGas_(ss, orderId);
  if (!existing) throw new Error('Order not found.');

  if (actor.role === 'supervisor') {
    if (String(existing.assigned_supervisor_id) !== String(actor.id)) {
      throw new Error('Access denied. This order is not assigned to your supervisor account.');
    }
    var today = getTodayDhakaIso_();
    var endDate = addDaysIso_(today, 6);
    if (existing.scheduled_date < today || existing.scheduled_date > endDate) {
      throw new Error('Access denied. Supervisors can only access assigned jobs from today through the next 6 days.');
    }
  }

  if (existing.status_locked) {
    throw new Error('STATUS_LOCKED: Order status is locked because this order is Completed and full customer payment is confirmed.');
  }
  if (existing.status === 'Cancelled') {
    throw new Error('Cancelled orders cannot be completed.');
  }
  if (existing.status === 'Completed') {
    throw new Error('This order has already been marked as Completed.');
  }
  if (!existing.is_no_charge_visit && payload.full_bill_collected !== true) {
    throw new Error('Please confirm "Full job bill collected" before completing this order.');
  }

  var transportCost = parseNonNegativeAmount_(payload.transport_cost || 0, 'Transport Cost');
  var mealsCost = parseNonNegativeAmount_(payload.meals_cost || 0, 'Meals Cost');
  var otherList = Array.isArray(payload.other_expenses) ? payload.other_expenses : [];
  var cleanOther = [];
  var otherTotal = 0;
  for (var i = 0; i < otherList.length; i++) {
    var amt = parseNonNegativeAmount_(otherList[i].amount || 0, 'Other Expense');
    var desc = String(otherList[i].description || '').trim();
    if (amt > 0 || desc) {
      cleanOther.push({ description: desc || 'Other', amount: amt });
      otherTotal += amt;
    }
  }

  var todayDhaka = getTodayDhakaIso_();
  var completionDate = (actor.role === 'admin' && isValidIsoDate_(payload.completion_date))
    ? String(payload.completion_date).trim()
    : todayDhaka;
  var collectionDate = (actor.role === 'admin' && isValidIsoDate_(payload.payment_collection_date))
    ? String(payload.payment_collection_date).trim()
    : completionDate;

  var settings = getSettingsMap_(ss);
  var followupDate = '';
  var followupRule = 'No-Charge Return Visit';
  if (!existing.is_no_charge_visit) {
    var defVal = parseInt(settings.default_followup_value || '6', 10) || 6;
    var defUnit = settings.default_followup_unit === 'days' ? 'days' : 'months';
    if (actor.role === 'admin' && payload.followup_mode === 'exact' && isValidIsoDate_(payload.followup_date)) {
      followupDate = String(payload.followup_date).trim();
      followupRule = 'Exact Date';
    } else if (actor.role === 'admin' && payload.followup_mode === 'custom' && Number(payload.custom_value) >= 1) {
      var cv = parseInt(String(payload.custom_value), 10);
      var cu = payload.custom_unit === 'days' ? 'days' : 'months';
      followupDate = cu === 'months' ? addCalendarMonthsIso_(completionDate, cv) : addDaysIso_(completionDate, cv);
      followupRule = cv + ' ' + cu + ' (Custom)';
    } else {
      followupDate = defUnit === 'months' ? addCalendarMonthsIso_(completionDate, defVal) : addDaysIso_(completionDate, defVal);
      followupRule = defVal + ' ' + defUnit + ' (Default)';
    }
  }

  var now = getNowDhakaTimestamp_();
  var isPaidCompletion = !existing.is_no_charge_visit && payload.full_bill_collected === true;
  var nextFollowupVer = existing.is_no_charge_visit ? existing.followup_version : (existing.followup_version + 1);

  // Confirm assigned workers
  var confirmedIds = Array.isArray(payload.confirmed_worker_ids) ? payload.confirmed_worker_ids : null;
  for (var w = 0; w < existing.workers.length; w++) {
    var aw = existing.workers[w];
    var shouldConfirm = confirmedIds === null ? true : (confirmedIds.indexOf(aw.assignment_id) !== -1 || confirmedIds.indexOf(aw.worker_id) !== -1);
    updateSheetObjectByKey_(ss, 'OrderWorkers', 'assignment_id', aw.assignment_id, {
      confirmed: shouldConfirm ? 1 : 0,
      updated_at: now
    });
  }

  updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, {
    status: 'Completed',
    completion_date: completionDate,
    completed_at: now,
    completed_by_user_id: actor.id,
    completed_by_name: actor.name,
    full_bill_collected: isPaidCompletion ? 1 : 0,
    status_locked: isPaidCompletion ? 1 : 0,
    status_locked_at: isPaidCompletion ? now : '',
    payment_collected_at: isPaidCompletion ? (collectionDate + ' ' + now.slice(11)) : '',
    collected_by_name: isPaidCompletion ? actor.name : '',
    transport_cost: transportCost,
    meals_cost: mealsCost,
    other_expenses_json: JSON.stringify(cleanOther),
    other_expenses_total: Math.round(otherTotal * 100) / 100,
    followup_date: followupDate,
    followup_rule_note: followupRule,
    followup_version: nextFollowupVer,
    reminder_sent: 0,
    reminder_sent_at: '',
    reminder_sent_for_date: '',
    reminder_sent_version: 0,
    followup_done: existing.is_no_charge_visit ? 1 : 0,
    followup_done_at: '',
    updated_at: now
  });

  var updated = recomputeOrderFinancials_(ss, orderId);
  appendOrderHistory_(
    ss,
    orderId,
    existing.status,
    'Completed',
    'Completed on ' + completionDate + ' · Bill Collected: BDT ' + (isPaidCompletion ? updated.price_bdt : 0) +
      ' · Actual Cost: BDT ' + updated.actual_expenses +
      (followupDate ? ' · Follow-up: ' + followupDate : ''),
    actor.name
  );
  bumpSyncRevision_(ss);
  return updated;
}

function handleMonthlyReport_(ss, payload) {
  var today = getTodayDhakaIso_();
  var year = parseInt(String(payload.year || today.slice(0, 4)), 10);
  var month = parseInt(String(payload.month || today.slice(5, 7)), 10);
  var ym = year + '-' + (month < 10 ? '0' + month : String(month));
  var areaFilter = String(payload.area || '').trim().toLowerCase();
  var serviceFilter = String(payload.service || '').trim().toLowerCase();
  var supervisorFilter = String(payload.supervisor_id || '').trim();
  var hasJobFilter = Boolean(areaFilter || serviceFilter || supervisorFilter);

  var orders = getAllHydratedOrders_(ss);
  var overhead = readSheetObjects_(ss, 'OverheadExpenses');

  var completedJobs = 0;
  var noChargeVisits = 0;
  var completedJobBills = 0;
  var incomeCollected = 0;
  var actualJobCosts = 0;
  var rows = [];

  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (o.status !== 'Completed') continue;
    if (areaFilter && String(o.area || '').toLowerCase() !== areaFilter) continue;
    if (serviceFilter && String(o.service_type || '').toLowerCase() !== serviceFilter) continue;
    if (supervisorFilter && String(o.assigned_supervisor_id || '') !== supervisorFilter) continue;

    var compYm = String(o.completion_date || '').slice(0, 7);
    var collYm = String(o.payment_collected_at || '').slice(0, 7);

    var inCompMonth = compYm === ym;
    var inCollMonth = o.full_bill_collected && !o.is_no_charge_visit && collYm === ym;

    if (inCompMonth) {
      if (o.is_no_charge_visit) {
        noChargeVisits++;
      } else {
        completedJobs++;
        completedJobBills += Number(o.price_bdt || 0);
      }
      actualJobCosts += Number(o.actual_expenses || 0);
      rows.push({
        order_id: o.order_id,
        completion_date: o.completion_date,
        payment_collection_date: String(o.payment_collected_at || '').slice(0, 10),
        customer_name: o.customer_name,
        area: o.area,
        service_type: o.service_type,
        supervisor_name: o.assigned_supervisor_name,
        is_no_charge_visit: o.is_no_charge_visit,
        parent_order_id: o.parent_order_id,
        bill_bdt: o.is_no_charge_visit ? 0 : o.price_bdt,
        collected_bdt: inCollMonth ? o.price_bdt : 0,
        transport_cost: o.transport_cost,
        meals_cost: o.meals_cost,
        other_expenses_total: o.other_expenses_total,
        worker_pay_total: o.worker_pay_total,
        actual_job_cost: o.actual_expenses,
        job_profit: (o.is_no_charge_visit ? 0 : o.price_bdt) - o.actual_expenses
      });
    }
    if (inCollMonth) {
      incomeCollected += Number(o.price_bdt || 0);
    }
  }

  var generalBusinessExpenses = 0;
  var overheadRows = [];
  for (var j = 0; j < overhead.length; j++) {
    var oh = overhead[j];
    if (String(oh.expense_date || '').slice(0, 7) === ym) {
      var amt = Number(oh.amount_bdt || 0);
      generalBusinessExpenses += amt;
      overheadRows.push({
        expense_id: String(oh.expense_id),
        expense_date: String(oh.expense_date),
        category: String(oh.category),
        description: String(oh.description),
        amount_bdt: amt,
        payment_method: String(oh.payment_method || 'Cash')
      });
    }
  }

  var jobProfitLoss = Math.round((completedJobBills - actualJobCosts) * 100) / 100;
  var netBusinessProfit = hasJobFilter
    ? null
    : Math.round((jobProfitLoss - generalBusinessExpenses) * 100) / 100;

  return {
    period: ym,
    year: year,
    month: month,
    filtersApplied: hasJobFilter,
    summary: {
      completed_jobs: completedJobs,
      no_charge_return_visits: noChargeVisits,
      income_collected: Math.round(incomeCollected * 100) / 100,
      completed_job_bills: Math.round(completedJobBills * 100) / 100,
      actual_job_costs: Math.round(actualJobCosts * 100) / 100,
      job_profit_loss: jobProfitLoss,
      general_business_expenses: Math.round(generalBusinessExpenses * 100) / 100,
      net_business_profit: netBusinessProfit
    },
    rows: rows,
    overhead_rows: overheadRows
  };
}

function normalizeRowStrings_(row, numericKeys, booleanKeys) {
  var out = {};
  var keys = Object.keys(row || {});
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === '_rowIndex') continue;
    var val = row[k];
    if (numericKeys && numericKeys[k]) {
      out[k] = Number(val || 0) || 0;
    } else if (booleanKeys && booleanKeys[k]) {
      out[k] = toCleanBool_(val);
    } else {
      out[k] = val === undefined || val === null ? '' : String(val);
    }
  }
  return out;
}

function normalizeRowsCollection_(rows, numericKeys, booleanKeys) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push(normalizeRowStrings_(rows[i], numericKeys, booleanKeys));
  }
  return out;
}

function getAdminBootstrapGas_(ss) {
  var orders = getAllHydratedOrders_(ss);
  var settings = getSettingsMap_(ss);
  var accounts = readSheetObjects_(ss, 'Accounts');
  var supervisors = [];
  for (var i = 0; i < accounts.length; i++) {
    if (String(accounts[i].role) === 'supervisor') {
      supervisors.push(toPublicAccount_(accounts[i]));
    }
  }

  var logoDataUrl = settings.company_logo_file_id
    ? readDriveFileAsDataUrl_(settings.company_logo_file_id, settings.company_logo_mime_type)
    : '';

  return {
    todayDhaka: getTodayDhakaIso_(),
    services: SUNVILOZ_CONFIG.DEFAULT_SERVICES,
    orders: orders,
    customers: normalizeRowsCollection_(readSheetObjects_(ss, 'Customers'), null, null),
    buildings: normalizeRowsCollection_(readSheetObjects_(ss, 'Buildings'), {
      overhead_tank_count: true,
      overhead_tank_capacity_liters: true,
      reserve_tank_count: true,
      reserve_tank_capacity_liters: true,
      floors: true
    }, null),
    leads: normalizeRowsCollection_(readSheetObjects_(ss, 'Leads'), {
      quoted_price_bdt: true
    }, null),
    leadNotes: normalizeRowsCollection_(readSheetObjects_(ss, 'LeadNotes'), null, null),
    quotations: normalizeRowsCollection_(readSheetObjects_(ss, 'Quotations'), {
      subtotal_bdt: true,
      discount_bdt: true,
      total_bdt: true
    }, null),
    receipts: normalizeRowsCollection_(readSheetObjects_(ss, 'Receipts'), {
      amount_bdt: true
    }, null),
    workers: normalizeRowsCollection_(readSheetObjects_(ss, 'Workers'), {
      default_daily_wage_bdt: true
    }, {
      is_active: true
    }),
    overheadExpenses: normalizeRowsCollection_(readSheetObjects_(ss, 'OverheadExpenses'), {
      amount_bdt: true
    }, null),
    documentPads: normalizeRowsCollection_(readSheetObjects_(ss, 'DocumentPads'), {
      size_bytes: true
    }, {
      is_active: true
    }),
    issuedPdfs: normalizeRowsCollection_(readSheetObjects_(ss, 'IssuedPdfs'), {
      size_bytes: true
    }, null),
    reminderLogs: normalizeRowsCollection_(readSheetObjects_(ss, 'ReminderLog'), {
      followup_version: true
    }, null),
    backupHistory: normalizeRowsCollection_(readSheetObjects_(ss, 'BackupHistory'), {
      size_bytes: true
    }, null),
    supervisors: supervisors,
    settings: {
      default_followup_value: toCleanStr_(settings.default_followup_value || '6'),
      default_followup_unit: toCleanStr_(settings.default_followup_unit || 'months'),
      reminder_email: toCleanStr_(settings.reminder_email),
      primary_owner_google_email: toCleanStr_(settings.primary_owner_google_email),
      daily_reminder_hour: toCleanStr_(settings.daily_reminder_hour || '9'),
      sync_revision: parseInt(settings.sync_revision || '1', 10) || 1,
      reminder_trigger_status: toCleanStr_(settings.reminder_trigger_status),
      reminders_paused_after_restore: settings.reminders_paused_after_restore === '1',
      company_logo_file_id: toCleanStr_(settings.company_logo_file_id),
      company_logo_file_name: toCleanStr_(settings.company_logo_file_name),
      company_logo_data_url: toCleanStr_(logoDataUrl),
      secondary_drive_email: toCleanStr_(settings.secondary_drive_email),
      secondary_drive_folder_name: toCleanStr_(settings.secondary_drive_folder_name || 'SUNVILOZ Clean Care Backups'),
      auto_backup_enabled: settings.auto_backup_enabled === '1',
      auto_backup_hour: toCleanStr_(settings.auto_backup_hour || '2'),
      last_verified_backup_at: toCleanStr_(settings.last_verified_backup_at),
      last_verified_backup_file: toCleanStr_(settings.last_verified_backup_file),
      last_backup_error: toCleanStr_(settings.last_backup_error)
    }
  };
}
