/**
 * SUNVILOZ Clean Care — Core Business Logic & Reporting (BusinessLogic.gs)
 *
 * Implements all SUNVILOZ Clean Care business rules server-side in Google Apps Script:
 * - Exact 5 standardized services in exact order (preserving legacy saved strings)
 * - Permanent order status lock when Completed AND full customer payment confirmed
 * - Atomic completion with worker pay counted once and adjustable 6-month default follow-up
 * - Strict Supervisor RBAC (only assigned jobs from today through today + 6 days)
 * - Full web app parity for Orders, Quotations, Receipts, Leads, Customers, Buildings,
 *   Workers, Settlements, Complaints & No-Charge Return Visits, Overhead, Pads, Branding,
 *   Issued PDFs, Reminders, and Reports.
 */

function isOrderStatusLockedGas_(order) {
  if (!order) return false;
  var st = String(order.status || '').trim();
  var paid = toCleanBool_(order.full_bill_collected);
  var explicitLock = toCleanBool_(order.status_locked);
  return explicitLock || ((st === 'Completed' || st === 'সম্পন্ন') && paid);
}

function toCleanStr_(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

function toCleanBool_(v) {
  return String(v) === '1' || v === true || v === 1 || String(v).toLowerCase() === 'true';
}

function toCleanNum_(v, fallback) {
  var n = Number(v);
  return isFinite(n) ? n : (fallback !== undefined ? fallback : 0);
}

function parseJsonSafe_(str, fallback) {
  try {
    if (!str) return fallback;
    if (typeof str === 'object') return str;
    return JSON.parse(String(str));
  } catch (err) {
    return fallback;
  }
}

function timeToMins_(hhmm) {
  var parts = String(hhmm || '').split(':');
  if (parts.length < 2) return 600;
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return 600;
  return h * 60 + m;
}

function minsToTime_(totalMins) {
  var clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMins)));
  var h = Math.floor(clamped / 60);
  var m = clamped % 60;
  return (h < 10 ? '0' + h : String(h)) + ':' + (m < 10 ? '0' + m : String(m));
}

function computeEndTime_(startTime, durationMins) {
  var dur = Math.max(15, parseInt(String(durationMins || '120'), 10) || 120);
  return minsToTime_(timeToMins_(startTime || '10:00') + dur);
}

function parseServicesArray_(rowOrPayload) {
  if (Array.isArray(rowOrPayload.services) && rowOrPayload.services.length > 0) {
    return rowOrPayload.services.map(function (s) { return String(s || '').trim(); }).filter(Boolean);
  }
  if (rowOrPayload.services_json) {
    var parsed = parseJsonSafe_(rowOrPayload.services_json, []);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(function (s) { return String(s || '').trim(); }).filter(Boolean);
    }
  }
  var st = String(rowOrPayload.service_type || rowOrPayload.services_text || '').trim();
  if (!st) return [];
  if (st.indexOf(' + ') !== -1) {
    return st.split(' + ').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  return [st];
}

function hydrateOrderWorker_(w) {
  var agreed = toCleanNum_(w.wage_bdt, 0);
  var confirmed = toCleanBool_(w.confirmed);
  var isPaid = toCleanBool_(w.paid);
  var paidAmt = isPaid ? (toCleanNum_(w.paid_amount_bdt, 0) || agreed) : 0;
  return {
    id: String(w.assignment_id || ''),
    assignment_id: String(w.assignment_id || ''),
    order_id: String(w.order_id || ''),
    worker_id: String(w.worker_id || ''),
    worker_name: String(w.worker_name || ''),
    agreed_pay_bdt: agreed,
    wage_bdt: agreed,
    confirmed_worked: confirmed,
    confirmed: confirmed,
    payment_status: isPaid ? 'Paid' : 'Unpaid',
    paid: isPaid,
    paid_amount_bdt: paidAmt,
    payment_date: String(w.payment_date || (w.paid_at ? String(w.paid_at).slice(0, 10) : '')),
    payment_method: String(w.payment_method || (isPaid ? 'Cash' : '')),
    paid_by_role: String(w.paid_by_role || (isPaid ? 'admin' : '')),
    payment_reference: String(w.payment_reference || ''),
    payment_note: String(w.payment_note || ''),
    paid_at: String(w.paid_at || ''),
    paid_by_name: String(w.paid_by || ''),
    created_at: String(w.created_at || ''),
    updated_at: String(w.updated_at || '')
  };
}

function hydrateSettlementEntry_(sr) {
  var dir = String(sr.direction || 'from_supervisor');
  var entryType = String(sr.entry_type || (dir === 'to_supervisor' ? 'reimbursement_paid' : 'deposit_received'));
  var eDate = String(sr.entry_date || String(sr.entry_datetime || sr.created_at || '').slice(0, 10));
  var eDt = String(sr.entry_datetime || (eDate ? eDate + ' 12:00' : sr.created_at || ''));
  return {
    entry_id: String(sr.entry_id || ''),
    order_id: String(sr.order_id || ''),
    supervisor_id: String(sr.supervisor_id || ''),
    supervisor_name: String(sr.supervisor_name || ''),
    entry_type: entryType,
    direction: dir,
    amount_bdt: toCleanNum_(sr.amount_bdt, 0),
    entry_datetime: eDt,
    entry_date: eDate,
    payment_method: String(sr.payment_method || 'Cash'),
    reference: String(sr.reference || ''),
    note: String(sr.note || ''),
    recorded_by: String(sr.recorded_by || ''),
    created_at: String(sr.created_at || '')
  };
}

function hydrateOrder_(row, workersByOrder, settlementsByOrder, buildingsById) {
  var services = parseServicesArray_(row);
  var servicesText = services.join(', ') || String(row.service_type || '');
  var phoneDisp = String(row.phone_display || '');
  if (/^1[3-9]\d{8}$/.test(phoneDisp)) phoneDisp = '0' + phoneDisp;
  var phoneE164 = String(row.phone_e164 || '');
  if (/^8801[3-9]\d{8}$/.test(phoneE164)) phoneE164 = '+' + phoneE164;

  var assignedWorkers = workersByOrder ? (workersByOrder[row.order_id] || []) : [];
  var entries = settlementsByOrder ? (settlementsByOrder[row.order_id] || []) : [];
  var bld = (buildingsById && row.building_id) ? buildingsById[row.building_id] : null;

  var priceBdt = toCleanNum_(row.price_bdt, 0);
  var advanceGiven = toCleanNum_(row.advance_given, 0);
  var transportCost = toCleanNum_(row.transport_cost, 0);
  var mealsCost = toCleanNum_(row.meals_cost, 0);
  var otherParsed = parseJsonSafe_(row.other_expenses_json, []);
  var otherExpenses = Array.isArray(otherParsed) ? otherParsed.map(function (it) {
    return { description: toCleanStr_(it && it.description), amount: toCleanNum_(it && it.amount, 0) };
  }) : [];
  var otherTotal = toCleanNum_(row.other_expenses_total, 0);
  if (otherTotal === 0 && otherExpenses.length > 0) {
    for (var oi = 0; oi < otherExpenses.length; oi++) otherTotal += otherExpenses[oi].amount;
    otherTotal = Math.round(otherTotal * 100) / 100;
  }

  var workerPayTotal = 0;
  var supPaidWorkerTotal = 0;
  for (var wi = 0; wi < assignedWorkers.length; wi++) {
    var aw = assignedWorkers[wi];
    if (aw.confirmed_worked) {
      workerPayTotal += aw.agreed_pay_bdt;
      if (aw.payment_status === 'Paid' && aw.paid_by_role === 'supervisor') {
        supPaidWorkerTotal += (aw.paid_amount_bdt || aw.agreed_pay_bdt);
      }
    }
  }
  workerPayTotal = Math.round(workerPayTotal * 100) / 100;
  supPaidWorkerTotal = Math.round(supPaidWorkerTotal * 100) / 100;

  var isNoCharge = toCleanBool_(row.is_no_charge_visit);
  var isReturnVisit = toCleanBool_(row.is_return_visit) || isNoCharge || Boolean(row.parent_order_id);
  var fullBillCollected = toCleanBool_(row.full_bill_collected);
  var statusStr = String(row.status || 'Confirmed');
  var actualExpenses = Math.round((transportCost + mealsCost + otherTotal + workerPayTotal) * 100) / 100;
  var revenue = isNoCharge ? 0 : priceBdt;
  var expectedSettlement = Math.round((
    (fullBillCollected ? revenue : 0) + advanceGiven - (transportCost + mealsCost + otherTotal + supPaidWorkerTotal)
  ) * 100) / 100;

  var targetEntryType = expectedSettlement >= 0 ? 'deposit_received' : 'reimbursement_paid';
  var settledActual = 0;
  for (var si = 0; si < entries.length; si++) {
    if (entries[si].entry_type === targetEntryType) {
      settledActual += entries[si].amount_bdt;
    }
  }
  settledActual = Math.round(settledActual * 100) / 100;
  var settlementConfirmed = toCleanBool_(row.settlement_confirmed);
  if (settlementConfirmed && settledActual === 0 && Math.abs(expectedSettlement) > 0) {
    settledActual = Math.abs(expectedSettlement);
  }
  var settlementRemaining = Math.max(0, Math.round((Math.abs(expectedSettlement) - settledActual) * 100) / 100);
  var settlementStatus = 'Not Applicable';
  if (statusStr === 'Completed') {
    if (Math.abs(expectedSettlement) < 0.01) {
      settlementStatus = 'Balanced';
    } else if (settlementConfirmed || settlementRemaining < 0.01) {
      settlementStatus = 'Settled';
      settlementRemaining = 0;
    } else {
      settlementStatus = 'Pending';
    }
  }

  var durMins = parseInt(String(row.estimated_duration_mins || '120'), 10) || 120;
  var schedTime = String(row.scheduled_time || '10:00');
  var schedEndTime = String(row.scheduled_end_time || computeEndTime_(schedTime, durMins));
  var returnVisitExpenses = toCleanNum_(row.return_visit_expenses_total, 0);
  var jobProfit = Math.round((revenue - actualExpenses - returnVisitExpenses) * 100) / 100;

  return {
    order_id: String(row.order_id || ''),
    quotation_id: String(row.quotation_id || ''),
    receipt_id: String(row.receipt_id || ''),
    previous_order_id: String(row.previous_order_id || ''),
    previous_work_date: String(row.previous_work_date || ''),
    followup_converted_order_id: String(row.followup_converted_order_id || ''),
    lead_id: String(row.lead_id || ''),
    customer_id: String(row.customer_id || ''),
    building_id: String(row.building_id || ''),
    building_name: String(row.building_name || (bld ? bld.name : '') || ''),
    customer_name: String(row.customer_name || ''),
    phone_display: phoneDisp,
    phone_e164: phoneE164,
    address: String(row.address || ''),
    area: String(row.area || ''),
    services: services,
    services_text: servicesText,
    service_type: String(row.service_type || servicesText),
    booking_date: String(row.booking_date || String(row.created_at || '').slice(0, 10)),
    scheduled_date: String(row.scheduled_date || ''),
    scheduled_time: schedTime,
    estimated_duration_mins: durMins,
    scheduled_end_time: schedEndTime,
    price_bdt: priceBdt,
    instructions: String(row.instructions || ''),
    notes: String(row.notes || ''),
    lead_source: String(row.lead_source || 'Not Specified'),
    referral_contact_type: String(row.referral_contact_type || ''),
    referral_contact_name: String(row.referral_contact_name || ''),
    referral_contact_phone: String(row.referral_contact_phone || ''),
    assigned_supervisor_id: String(row.assigned_supervisor_id || ''),
    assigned_supervisor_name: String(row.assigned_supervisor_name || ''),
    status: statusStr,
    status_locked: isOrderStatusLockedGas_({ status: statusStr, full_bill_collected: fullBillCollected, status_locked: row.status_locked }),
    status_locked_at: String(row.status_locked_at || ''),
    parent_order_id: String(row.parent_order_id || ''),
    is_return_visit: isReturnVisit,
    is_no_charge_visit: isNoCharge,
    complaint_id: String(row.complaint_id || ''),
    advance_given: advanceGiven,
    advance_supervisor_id: String(row.advance_supervisor_id || ''),
    advance_supervisor_name: String(row.advance_supervisor_name || ''),
    advance_given_at: String(row.advance_given_at || ''),
    completion_date: String(row.completion_date || ''),
    completed_at: String(row.completed_at || ''),
    completed_by_user_id: String(row.completed_by_user_id || ''),
    completed_by_name: String(row.completed_by_name || ''),
    full_bill_collected: fullBillCollected,
    payment_collected_at: String(row.payment_collected_at || ''),
    collected_by_name: String(row.collected_by_name || ''),
    transport_cost: transportCost,
    meals_cost: mealsCost,
    other_expenses: otherExpenses,
    other_expenses_total: otherTotal,
    worker_pay_total: workerPayTotal,
    supervisor_paid_worker_total: supPaidWorkerTotal,
    return_visit_expenses_total: returnVisitExpenses,
    actual_expenses: actualExpenses,
    supervisor_settlement: expectedSettlement,
    job_profit_or_loss: jobProfit,
    job_profit: jobProfit,
    settlement_actual_total: settledActual,
    settlement_remaining: settlementRemaining,
    settlement_status: settlementStatus,
    settlement_confirmed: settlementStatus === 'Settled',
    settlement_confirmed_at: String(row.settlement_confirmed_at || ''),
    settlement_confirmed_by: String(row.settlement_confirmed_by || ''),
    settlement_note: String(row.settlement_note || ''),
    assigned_workers: assignedWorkers,
    workers: assignedWorkers,
    followup_date: String(row.followup_date || ''),
    followup_rule_note: String(row.followup_rule_note || ''),
    followup_version: parseInt(String(row.followup_version || '0'), 10) || 0,
    reminder_sent: toCleanBool_(row.reminder_sent),
    reminder_sent_at: String(row.reminder_sent_at || ''),
    reminder_sent_for_date: String(row.reminder_sent_for_date || ''),
    reminder_sent_version: parseInt(String(row.reminder_sent_version || '0'), 10) || 0,
    followup_done: toCleanBool_(row.followup_done),
    followup_done_at: String(row.followup_done_at || ''),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || '')
  };
}

function getAllHydratedOrders_(ss) {
  var orderRows = readSheetObjects_(ss, 'Orders');
  var owRows = readSheetObjects_(ss, 'OrderWorkers');
  var setRows = readSheetObjects_(ss, 'SettlementEntries');
  var bldRows = readSheetObjects_(ss, 'Buildings');

  var workersByOrder = {};
  for (var i = 0; i < owRows.length; i++) {
    var hw = hydrateOrderWorker_(owRows[i]);
    if (!workersByOrder[hw.order_id]) workersByOrder[hw.order_id] = [];
    workersByOrder[hw.order_id].push(hw);
  }

  var settlementsByOrder = {};
  for (var s = 0; s < setRows.length; s++) {
    var hs = hydrateSettlementEntry_(setRows[s]);
    if (!settlementsByOrder[hs.order_id]) settlementsByOrder[hs.order_id] = [];
    settlementsByOrder[hs.order_id].push(hs);
  }

  var buildingsById = {};
  for (var b = 0; b < bldRows.length; b++) {
    buildingsById[String(bldRows[b].building_id)] = bldRows[b];
  }

  var out = [];
  for (var k = 0; k < orderRows.length; k++) {
    out.push(hydrateOrder_(orderRows[k], workersByOrder, settlementsByOrder, buildingsById));
  }

  // Attach linked no-charge return visit expenses once to parent order profit
  var returnCostsByParent = {};
  for (var r = 0; r < out.length; r++) {
    if (out[r].is_no_charge_visit && out[r].parent_order_id && out[r].status === 'Completed') {
      returnCostsByParent[out[r].parent_order_id] =
        (returnCostsByParent[out[r].parent_order_id] || 0) + Number(out[r].actual_expenses || 0);
    }
  }
  for (var p = 0; p < out.length; p++) {
    var rvCost = Math.round((returnCostsByParent[out[p].order_id] || 0) * 100) / 100;
    out[p].return_visit_expenses_total = rvCost;
    out[p].job_profit_or_loss = out[p].is_no_charge_visit
      ? -out[p].actual_expenses
      : Math.round((out[p].price_bdt - out[p].actual_expenses - rvCost) * 100) / 100;
    out[p].job_profit = out[p].job_profit_or_loss;
  }

  out.sort(function (a, b) {
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
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
  updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, {
    worker_pay_total: order.worker_pay_total,
    supervisor_paid_worker_total: order.supervisor_paid_worker_total,
    actual_expenses: order.actual_expenses,
    job_profit: order.job_profit_or_loss,
    supervisor_settlement: order.supervisor_settlement,
    settlement_actual_total: order.settlement_actual_total,
    settlement_remaining: order.settlement_remaining,
    settlement_status: order.settlement_status,
    updated_at: getNowDhakaTimestamp_()
  });
  return getOrderByIdGas_(ss, orderId);
}

function hydrateBuilding_(b) {
  var ohQty = parseInt(String(b.overhead_tank_qty || b.overhead_tank_count || '0'), 10) || 0;
  var ohCapRaw = b.overhead_tank_capacity_litres !== undefined && b.overhead_tank_capacity_litres !== ''
    ? b.overhead_tank_capacity_litres : b.overhead_tank_capacity_liters;
  var ohCap = ohCapRaw !== undefined && ohCapRaw !== '' && ohCapRaw !== null ? toCleanNum_(ohCapRaw, 0) : null;
  var resQty = parseInt(String(b.reserve_tank_qty || b.reserve_tank_count || '0'), 10) || 0;
  var resCapRaw = b.reserve_tank_capacity_litres !== undefined && b.reserve_tank_capacity_litres !== ''
    ? b.reserve_tank_capacity_litres : b.reserve_tank_capacity_liters;
  var resCap = resCapRaw !== undefined && resCapRaw !== '' && resCapRaw !== null ? toCleanNum_(resCapRaw, 0) : null;
  return {
    building_id: String(b.building_id || ''),
    customer_id: String(b.customer_id || ''),
    name: String(b.name || ''),
    address: String(b.address || ''),
    area: String(b.area || ''),
    maps_url: String(b.maps_url || ''),
    access_instructions: String(b.access_instructions || b.access_notes || ''),
    overhead_tank_qty: ohQty,
    overhead_tank_capacity_litres: ohCap,
    overhead_tank_material: String(b.overhead_tank_material || 'Concrete'),
    reserve_tank_qty: resQty,
    reserve_tank_capacity_litres: resCap,
    reserve_tank_material: String(b.reserve_tank_material || 'Concrete'),
    tank_notes: String(b.tank_notes || ''),
    created_at: String(b.created_at || ''),
    updated_at: String(b.updated_at || '')
  };
}

function projectSupervisorJobGas_(order, buildingsMap) {
  var rawBld = order.building_id ? buildingsMap[order.building_id] : null;
  var bld = rawBld ? hydrateBuilding_(rawBld) : null;
  var supWorkers = (order.assigned_workers || []).map(function (w) {
    return {
      id: w.id,
      worker_id: w.worker_id,
      worker_name: w.worker_name,
      confirmed_worked: Boolean(w.confirmed_worked)
    };
  });
  return {
    order_id: order.order_id,
    customer_name: order.customer_name,
    phone_display: order.phone_display,
    phone_e164: order.phone_e164,
    address: order.address,
    area: order.area,
    services: order.services,
    services_text: order.services_text,
    scheduled_date: order.scheduled_date,
    scheduled_time: order.scheduled_time,
    scheduled_end_time: order.scheduled_end_time,
    estimated_duration_mins: order.estimated_duration_mins,
    instructions: order.instructions || order.notes || '',
    price_bdt: order.price_bdt,
    advance_given: order.advance_given,
    status: order.status,
    status_locked: order.status_locked,
    status_locked_at: order.status_locked_at,
    is_return_visit: order.is_return_visit,
    is_no_charge_visit: order.is_no_charge_visit,
    parent_order_id: order.parent_order_id,
    building_summary: bld ? {
      building_id: bld.building_id,
      name: bld.name,
      address: bld.address,
      area: bld.area,
      maps_url: bld.maps_url,
      access_instructions: bld.access_instructions,
      overhead_tank_qty: bld.overhead_tank_qty,
      overhead_tank_capacity_litres: bld.overhead_tank_capacity_litres,
      overhead_tank_material: bld.overhead_tank_material,
      reserve_tank_qty: bld.reserve_tank_qty,
      reserve_tank_capacity_litres: bld.reserve_tank_capacity_litres,
      reserve_tank_material: bld.reserve_tank_material,
      tank_notes: bld.tank_notes
    } : null,
    assigned_workers: supWorkers,
    completion_date: order.completion_date,
    completed_at: order.completed_at,
    full_bill_collected: order.full_bill_collected,
    transport_cost: order.transport_cost,
    meals_cost: order.meals_cost,
    other_expenses: order.other_expenses,
    actual_expenses: order.actual_expenses,
    supervisor_settlement: order.supervisor_settlement,
    settlement_status: order.settlement_status
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

function handleCheckScheduleConflicts_(ss, payload) {
  var supId = String(payload.supervisor_id || '').trim();
  var schedDate = String(payload.scheduled_date || '').trim();
  if (!supId || !isValidIsoDate_(schedDate)) return { conflicts: [] };
  var startMins = timeToMins_(payload.scheduled_time || '10:00');
  var dur = parseInt(String(payload.estimated_duration_mins || '120'), 10) || 120;
  var endMins = payload.scheduled_end_time ? timeToMins_(payload.scheduled_end_time) : (startMins + dur);
  var excludeId = String(payload.exclude_order_id || '').trim();
  var settings = getSettingsMap_(ss);
  var bufferMins = parseInt(String(settings.schedule_conflict_buffer_mins || '30'), 10) || 30;

  var orders = getAllHydratedOrders_(ss);
  var conflicts = [];
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (o.order_id === excludeId) continue;
    if (o.status === 'Cancelled' || o.status === 'Completed') continue;
    if (o.assigned_supervisor_id !== supId) continue;
    if (o.scheduled_date !== schedDate) continue;
    var oStart = timeToMins_(o.scheduled_time);
    var oEnd = timeToMins_(o.scheduled_end_time);
    if (startMins < oEnd + bufferMins && endMins + bufferMins > oStart) {
      conflicts.push({
        order_id: o.order_id,
        customer_name: o.customer_name,
        area: o.area,
        scheduled_date: o.scheduled_date,
        scheduled_time: o.scheduled_time,
        scheduled_end_time: o.scheduled_end_time,
        estimated_duration_mins: o.estimated_duration_mins,
        status: o.status,
        reason: (startMins < oEnd && endMins > oStart)
          ? 'Direct time overlap'
          : ('Within ' + bufferMins + ' min travel buffer')
      });
    }
  }
  return { conflicts: conflicts };
}

function handleCreateOrder_(ss, actor, payload) {
  var customerName = String(payload.customer_name || '').trim();
  if (!customerName) throw new Error('Customer name is required.');
  var phone = normalizePhoneBD_(payload.phone || payload.phone_display || '');
  if (!phone.display) throw new Error('Customer phone number is required.');
  var services = parseServicesArray_(payload);
  if (services.length === 0) throw new Error('Please select at least one service option.');
  var serviceType = services.join(' + ');
  var scheduledDate = String(payload.scheduled_date || '').trim();
  if (!isValidIsoDate_(scheduledDate)) throw new Error('Please select a valid Scheduled Work Date.');
  var bookingDate = isValidIsoDate_(payload.booking_date) ? String(payload.booking_date).trim() : getTodayDhakaIso_();
  var isNoCharge = Boolean(payload.is_no_charge_visit);
  var isReturnVisit = Boolean(payload.is_return_visit) || isNoCharge || Boolean(payload.parent_order_id);
  var priceBdt = isNoCharge ? 0 : parseNonNegativeAmount_(payload.price_bdt || 0, 'Agreed Price');
  var advanceGiven = parseNonNegativeAmount_(payload.advance_given || 0, 'Advance Given');
  var durMins = Math.max(15, parseInt(String(payload.estimated_duration_mins || '120'), 10) || 120);
  var schedTime = String(payload.scheduled_time || '10:00').trim();
  var schedEndTime = String(payload.scheduled_end_time || computeEndTime_(schedTime, durMins));

  var seq = incrementSequenceAndSync_(ss, 'order_sequence');
  var orderId = 'ORD-' + String(1000 + seq);
  var now = getNowDhakaTimestamp_();

  var supId = String(payload.assigned_supervisor_id || '').trim();
  var supName = String(payload.assigned_supervisor_name || '').trim();
  if (supId && !supName) {
    var supAcc = findAccountById_(ss, supId);
    if (supAcc) supName = String(supAcc.name || '');
  }

  var bldId = String(payload.building_id || '').trim();
  var bldName = String(payload.building_name || '').trim();
  if (bldId && !bldName) {
    var blds = readSheetObjects_(ss, 'Buildings');
    for (var bi = 0; bi < blds.length; bi++) {
      if (String(blds[bi].building_id) === bldId) {
        bldName = String(blds[bi].name || '');
        break;
      }
    }
  }

  var prevOrderId = String(payload.previous_order_id || '').trim();
  var prevWorkDate = String(payload.previous_work_date || '').trim();
  if (prevOrderId && !prevWorkDate) {
    var prevOrd = getOrderByIdGas_(ss, prevOrderId);
    if (prevOrd && prevOrd.completion_date) prevWorkDate = prevOrd.completion_date;
  }

  var row = {
    order_id: orderId,
    booking_date: bookingDate,
    lead_id: String(payload.lead_id || '').trim(),
    customer_id: String(payload.customer_id || '').trim(),
    building_id: bldId,
    building_name: bldName,
    quotation_id: String(payload.quotation_id || '').trim(),
    receipt_id: '',
    previous_order_id: prevOrderId,
    previous_work_date: prevWorkDate,
    followup_converted_order_id: '',
    customer_name: customerName,
    phone_display: phone.display,
    phone_e164: phone.e164,
    address: String(payload.address || '').trim(),
    area: String(payload.area || '').trim(),
    service_type: serviceType,
    services_json: JSON.stringify(services),
    price_bdt: priceBdt,
    scheduled_date: scheduledDate,
    scheduled_time: schedTime,
    estimated_duration_mins: durMins,
    scheduled_end_time: schedEndTime,
    instructions: String(payload.instructions || '').trim(),
    lead_source: String(payload.lead_source || 'Not Specified').trim(),
    referral_contact_type: String(payload.referral_contact_type || '').trim(),
    referral_contact_name: String(payload.referral_contact_name || '').trim(),
    referral_contact_phone: String(payload.referral_contact_phone || '').trim(),
    status: String(payload.status || 'Confirmed'),
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
    supervisor_paid_worker_total: 0,
    return_visit_expenses_total: 0,
    actual_expenses: 0,
    job_profit: priceBdt,
    supervisor_settlement: advanceGiven,
    settlement_actual_total: 0,
    settlement_remaining: 0,
    settlement_status: 'Not Applicable',
    settlement_confirmed: 0,
    settlement_confirmed_at: '',
    settlement_confirmed_by: '',
    settlement_note: '',
    followup_date: '',
    followup_rule_note: '',
    followup_version: 0,
    reminder_sent: 0,
    reminder_sent_at: '',
    reminder_sent_for_date: '',
    reminder_sent_version: 0,
    followup_done: 0,
    followup_done_at: '',
    is_return_visit: isReturnVisit ? 1 : 0,
    is_no_charge_visit: isNoCharge ? 1 : 0,
    parent_order_id: String(payload.parent_order_id || '').trim(),
    complaint_id: String(payload.complaint_id || '').trim(),
    return_visit_reason: String(payload.return_visit_reason || '').trim(),
    notes: String(payload.notes || '').trim(),
    created_at: now,
    updated_at: now
  };

  appendSheetObject_(ss, 'Orders', row);

  // Assign workers (accept both assigned_workers and worker_assignments)
  var rawWorkers = Array.isArray(payload.assigned_workers)
    ? payload.assigned_workers
    : (Array.isArray(payload.worker_assignments) ? payload.worker_assignments : []);
  var allWorkers = readSheetObjects_(ss, 'Workers');
  var workerNameById = {};
  for (var wIdx = 0; wIdx < allWorkers.length; wIdx++) {
    workerNameById[String(allWorkers[wIdx].worker_id)] = String(allWorkers[wIdx].name || '');
  }

  for (var i = 0; i < rawWorkers.length; i++) {
    var wa = rawWorkers[i];
    var wId = String(wa.worker_id || '').trim();
    if (!wId) continue;
    var wName = String(wa.worker_name || workerNameById[wId] || '').trim();
    var wage = parseNonNegativeAmount_(wa.agreed_pay_bdt !== undefined ? wa.agreed_pay_bdt : (wa.wage_bdt || 0), 'Worker Pay');
    appendSheetObject_(ss, 'OrderWorkers', {
      assignment_id: makeUid_('OW'),
      order_id: orderId,
      worker_id: wId,
      worker_name: wName,
      wage_bdt: wage,
      confirmed: wa.confirmed_worked ? 1 : 0,
      paid: 0,
      paid_amount_bdt: 0,
      payment_date: '',
      payment_method: '',
      paid_by_role: '',
      payment_reference: '',
      paid_at: '',
      paid_by: '',
      payment_note: '',
      created_at: now,
      updated_at: now
    });
  }

  // Link previous repeat order follow-up if rebooked from follow-up
  if (prevOrderId) {
    updateSheetObjectByKey_(ss, 'Orders', 'order_id', prevOrderId, {
      followup_done: 1,
      followup_done_at: now,
      followup_converted_order_id: orderId,
      updated_at: now
    });
  }

  // Link lead if created from lead
  if (row.lead_id) {
    updateSheetObjectByKey_(ss, 'Leads', 'lead_id', row.lead_id, {
      stage: 'Confirmed',
      converted_order_id: orderId,
      followup_done: 1,
      followup_done_at: now,
      updated_at: now
    });
  }

  appendOrderHistory_(ss, orderId, '', row.status, 'Order created (' + services.join(', ') + ', BDT ' + priceBdt + ')', actor.name);
  return getOrderByIdGas_(ss, orderId);
}

function handleUpdateOrder_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var existing = getOrderByIdGas_(ss, orderId);
  if (!existing) throw new Error('Order not found.');

  if (payload.status !== undefined && String(payload.status) !== existing.status) {
    if (existing.status_locked) {
      throw new Error('STATUS_LOCKED: Order status is locked because this order is Completed and full customer payment is confirmed.');
    }
  }

  var now = getNowDhakaTimestamp_();
  var patch = { updated_at: now };
  if (payload.customer_name !== undefined) patch.customer_name = String(payload.customer_name).trim();
  if (payload.customer_id !== undefined) patch.customer_id = String(payload.customer_id).trim();
  if (payload.building_id !== undefined) patch.building_id = String(payload.building_id).trim();
  if (payload.building_name !== undefined) patch.building_name = String(payload.building_name).trim();
  if (payload.phone !== undefined || payload.phone_display !== undefined) {
    var ph = normalizePhoneBD_(payload.phone !== undefined ? payload.phone : payload.phone_display);
    patch.phone_display = ph.display;
    patch.phone_e164 = ph.e164;
  }
  if (payload.address !== undefined) patch.address = String(payload.address).trim();
  if (payload.area !== undefined) patch.area = String(payload.area).trim();
  if (payload.services !== undefined || payload.service_type !== undefined) {
    var svcs = parseServicesArray_(payload);
    if (svcs.length > 0) {
      patch.services_json = JSON.stringify(svcs);
      patch.service_type = svcs.join(' + ');
    }
  }
  if (payload.booking_date !== undefined && isValidIsoDate_(payload.booking_date)) patch.booking_date = String(payload.booking_date).trim();
  if (payload.scheduled_date !== undefined && isValidIsoDate_(payload.scheduled_date)) patch.scheduled_date = String(payload.scheduled_date).trim();
  if (payload.scheduled_time !== undefined) patch.scheduled_time = String(payload.scheduled_time).trim();
  if (payload.estimated_duration_mins !== undefined) {
    patch.estimated_duration_mins = Math.max(15, parseInt(String(payload.estimated_duration_mins), 10) || 120);
  }
  if (payload.scheduled_end_time !== undefined || payload.scheduled_time !== undefined || payload.estimated_duration_mins !== undefined) {
    var stT = patch.scheduled_time !== undefined ? patch.scheduled_time : existing.scheduled_time;
    var durT = patch.estimated_duration_mins !== undefined ? patch.estimated_duration_mins : existing.estimated_duration_mins;
    patch.scheduled_end_time = payload.scheduled_end_time ? String(payload.scheduled_end_time) : computeEndTime_(stT, durT);
  }
  if (payload.price_bdt !== undefined && !existing.is_no_charge_visit) {
    patch.price_bdt = parseNonNegativeAmount_(payload.price_bdt, 'Agreed Price');
  }
  if (payload.instructions !== undefined) patch.instructions = String(payload.instructions).trim();
  if (payload.notes !== undefined) patch.notes = String(payload.notes).trim();
  if (payload.lead_source !== undefined) patch.lead_source = String(payload.lead_source).trim();
  if (payload.referral_contact_type !== undefined) patch.referral_contact_type = String(payload.referral_contact_type).trim();
  if (payload.referral_contact_name !== undefined) patch.referral_contact_name = String(payload.referral_contact_name).trim();
  if (payload.referral_contact_phone !== undefined) patch.referral_contact_phone = String(payload.referral_contact_phone).trim();
  if (payload.assigned_supervisor_id !== undefined) {
    var supId = String(payload.assigned_supervisor_id || '').trim();
    var supAcc = supId ? findAccountById_(ss, supId) : null;
    patch.assigned_supervisor_id = supId;
    patch.assigned_supervisor_name = supAcc ? String(supAcc.name || '') : String(payload.assigned_supervisor_name || '');
  }
  if (payload.advance_given !== undefined) {
    patch.advance_given = parseNonNegativeAmount_(payload.advance_given, 'Advance Given');
  }

  updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, patch);

  // Sync assigned_workers if provided on edit
  if (Array.isArray(payload.assigned_workers)) {
    syncOrderWorkersList_(ss, orderId, payload.assigned_workers, now);
  }

  recomputeOrderFinancials_(ss, orderId);
  appendOrderHistory_(ss, orderId, existing.status, existing.status, 'Order details updated', actor.name);
  bumpSyncRevision_(ss);
  return getOrderByIdGas_(ss, orderId);
}

function handleUpdateOrderAdvance_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var existing = getOrderByIdGas_(ss, orderId);
  if (!existing) throw new Error('Order not found.');
  var adv = parseNonNegativeAmount_(payload.advance_given || 0, 'Advance Given');
  var supId = String(payload.supervisor_id || existing.assigned_supervisor_id || '').trim();
  var supAcc = supId ? findAccountById_(ss, supId) : null;
  var now = getNowDhakaTimestamp_();
  updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, {
    advance_given: adv,
    advance_supervisor_id: supId,
    advance_supervisor_name: supAcc ? String(supAcc.name || '') : existing.assigned_supervisor_name,
    advance_given_at: adv > 0 ? now : '',
    updated_at: now
  });
  recomputeOrderFinancials_(ss, orderId);
  appendOrderHistory_(ss, orderId, existing.status, existing.status, 'Advance updated to BDT ' + adv, actor.name);
  bumpSyncRevision_(ss);
  return getOrderByIdGas_(ss, orderId);
}

function handleChangeOrderStatus_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var nextStatus = String(payload.new_status || payload.status || '').trim();
  var allowed = ['New', 'Confirmed', 'In Progress', 'Rescheduled', 'Cancelled'];
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

  var confirmedIds = Array.isArray(payload.confirmed_worker_ids) ? payload.confirmed_worker_ids : null;
  for (var w = 0; w < existing.assigned_workers.length; w++) {
    var aw = existing.assigned_workers[w];
    var shouldConfirm = confirmedIds === null
      ? true
      : (confirmedIds.indexOf(aw.id) !== -1 || confirmedIds.indexOf(aw.worker_id) !== -1);
    updateSheetObjectByKey_(ss, 'OrderWorkers', 'assignment_id', aw.id, {
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
  if (updated.is_no_charge_visit && updated.parent_order_id) {
    recomputeOrderFinancials_(ss, updated.parent_order_id);
  }
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

function handleCorrectCompletedFinancials_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var existing = getOrderByIdGas_(ss, orderId);
  if (!existing) throw new Error('Order not found.');
  var reason = String(payload.reason || '').trim();
  if (!reason) throw new Error('A correction reason is required.');

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

  var patch = {
    transport_cost: transportCost,
    meals_cost: mealsCost,
    other_expenses_json: JSON.stringify(cleanOther),
    other_expenses_total: Math.round(otherTotal * 100) / 100,
    updated_at: getNowDhakaTimestamp_()
  };
  if (payload.completion_date && isValidIsoDate_(payload.completion_date)) {
    patch.completion_date = String(payload.completion_date).trim();
  }
  if (payload.price_bdt !== undefined && !existing.is_no_charge_visit) {
    patch.price_bdt = parseNonNegativeAmount_(payload.price_bdt, 'Agreed Price');
  }
  if (payload.advance_given !== undefined) {
    patch.advance_given = parseNonNegativeAmount_(payload.advance_given, 'Advance Given');
  }
  updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, patch);
  var updated = recomputeOrderFinancials_(ss, orderId);
  appendOrderHistory_(ss, orderId, existing.status, existing.status, 'Financial correction: ' + reason, actor.name);
  bumpSyncRevision_(ss);
  return updated;
}

function syncOrderWorkersList_(ss, orderId, workersList, now) {
  var existingRows = readSheetObjects_(ss, 'OrderWorkers').filter(function (r) {
    return String(r.order_id) === String(orderId);
  });
  var existingByWorkerId = {};
  for (var i = 0; i < existingRows.length; i++) {
    existingByWorkerId[String(existingRows[i].worker_id)] = existingRows[i];
  }
  var allWorkers = readSheetObjects_(ss, 'Workers');
  var workerNameById = {};
  for (var w = 0; w < allWorkers.length; w++) {
    workerNameById[String(allWorkers[w].worker_id)] = String(allWorkers[w].name || '');
  }

  var keepWorkerIds = {};
  for (var j = 0; j < workersList.length; j++) {
    var item = workersList[j];
    var wid = String(item.worker_id || '').trim();
    if (!wid) continue;
    keepWorkerIds[wid] = true;
    var wage = parseNonNegativeAmount_(item.agreed_pay_bdt !== undefined ? item.agreed_pay_bdt : (item.wage_bdt || 0), 'Worker Pay');
    var conf = item.confirmed_worked !== undefined ? (item.confirmed_worked ? 1 : 0) : 0;
    var prev = existingByWorkerId[wid];
    if (prev) {
      updateSheetObjectByKey_(ss, 'OrderWorkers', 'assignment_id', prev.assignment_id, {
        wage_bdt: wage,
        confirmed: conf,
        updated_at: now
      });
    } else {
      appendSheetObject_(ss, 'OrderWorkers', {
        assignment_id: makeUid_('OW'),
        order_id: orderId,
        worker_id: wid,
        worker_name: String(item.worker_name || workerNameById[wid] || ''),
        wage_bdt: wage,
        confirmed: conf,
        paid: 0,
        paid_amount_bdt: 0,
        payment_date: '',
        payment_method: '',
        paid_by_role: '',
        payment_reference: '',
        paid_at: '',
        paid_by: '',
        payment_note: '',
        created_at: now,
        updated_at: now
      });
    }
  }
  for (var k = 0; k < existingRows.length; k++) {
    if (!keepWorkerIds[String(existingRows[k].worker_id)]) {
      deleteSheetRowsByKey_(ss, 'OrderWorkers', 'assignment_id', existingRows[k].assignment_id);
    }
  }
}

function handleAdminUpdateOrderWorkers_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var existing = getOrderByIdGas_(ss, orderId);
  if (!existing) throw new Error('Order not found.');
  var now = getNowDhakaTimestamp_();
  syncOrderWorkersList_(ss, orderId, Array.isArray(payload.assigned_workers) ? payload.assigned_workers : [], now);
  var updated = recomputeOrderFinancials_(ss, orderId);
  appendOrderHistory_(ss, orderId, existing.status, existing.status, 'Worker team updated' + (payload.reason ? ': ' + payload.reason : ''), actor.name);
  bumpSyncRevision_(ss);
  return updated;
}

function handleMarkOrderWorkerPaid_(ss, actor, payload) {
  var assignId = String(payload.order_worker_id || payload.assignment_id || '').trim();
  var owRows = readSheetObjects_(ss, 'OrderWorkers');
  var targetOw = null;
  for (var i = 0; i < owRows.length; i++) {
    if (String(owRows[i].assignment_id) === assignId) {
      targetOw = owRows[i];
      break;
    }
  }
  if (!targetOw) throw new Error('Worker assignment not found.');
  var now = getNowDhakaTimestamp_();
  var payDate = isValidIsoDate_(payload.payment_date) ? String(payload.payment_date) : getTodayDhakaIso_();
  var payMethod = String(payload.payment_method || 'Cash');
  var paidByRole = payload.paid_by_role === 'supervisor' ? 'supervisor' : 'admin';
  var ref = String(payload.reference || '').trim();
  var note = String(payload.note || payload.payment_note || '').trim();
  var amount = toCleanNum_(targetOw.wage_bdt, 0);

  updateSheetObjectByKey_(ss, 'OrderWorkers', 'assignment_id', assignId, {
    paid: 1,
    paid_amount_bdt: amount,
    payment_date: payDate,
    payment_method: payMethod,
    paid_by_role: paidByRole,
    payment_reference: ref,
    paid_at: now,
    paid_by: actor.name,
    payment_note: note,
    updated_at: now
  });

  appendSheetObject_(ss, 'WorkerPayHistory', {
    pay_history_id: makeUid_('WPH'),
    assignment_id: assignId,
    order_id: String(targetOw.order_id),
    worker_id: String(targetOw.worker_id),
    worker_name: String(targetOw.worker_name),
    amount_bdt: amount,
    action_type: 'MARK_PAID',
    payment_date: payDate,
    payment_method: payMethod,
    paid_by_role: paidByRole,
    reference: ref,
    note: note,
    actor_name: actor.name,
    created_at: now
  });

  var updatedOrder = recomputeOrderFinancials_(ss, String(targetOw.order_id));
  bumpSyncRevision_(ss);
  var workerRow = null;
  for (var wi = 0; wi < updatedOrder.assigned_workers.length; wi++) {
    if (updatedOrder.assigned_workers[wi].id === assignId) {
      workerRow = updatedOrder.assigned_workers[wi];
      break;
    }
  }
  return { workerRow: workerRow, order: updatedOrder };
}

function handleCorrectOrderWorkerPayment_(ss, actor, payload) {
  var assignId = String(payload.order_worker_id || payload.assignment_id || '').trim();
  var owRows = readSheetObjects_(ss, 'OrderWorkers');
  var targetOw = null;
  for (var i = 0; i < owRows.length; i++) {
    if (String(owRows[i].assignment_id) === assignId) {
      targetOw = owRows[i];
      break;
    }
  }
  if (!targetOw) throw new Error('Worker assignment not found.');
  var reason = String(payload.reason || '').trim();
  if (!reason) throw new Error('Reason is required for payment correction.');
  var now = getNowDhakaTimestamp_();
  var act = payload.action === 'MARK_UNPAID' ? 'MARK_UNPAID' : 'CORRECTED';

  if (act === 'MARK_UNPAID') {
    updateSheetObjectByKey_(ss, 'OrderWorkers', 'assignment_id', assignId, {
      paid: 0,
      paid_amount_bdt: 0,
      payment_date: '',
      payment_method: '',
      paid_by_role: '',
      payment_reference: '',
      paid_at: '',
      paid_by: '',
      payment_note: reason,
      updated_at: now
    });
  } else {
    var nextWage = payload.agreed_pay_bdt !== undefined
      ? parseNonNegativeAmount_(payload.agreed_pay_bdt, 'Worker Pay')
      : toCleanNum_(targetOw.wage_bdt, 0);
    updateSheetObjectByKey_(ss, 'OrderWorkers', 'assignment_id', assignId, {
      wage_bdt: nextWage,
      paid_amount_bdt: toCleanBool_(targetOw.paid) ? nextWage : 0,
      payment_date: payload.payment_date || targetOw.payment_date || '',
      payment_method: payload.payment_method || targetOw.payment_method || '',
      paid_by_role: payload.paid_by_role || targetOw.paid_by_role || '',
      payment_reference: payload.reference !== undefined ? String(payload.reference) : (targetOw.payment_reference || ''),
      payment_note: reason,
      updated_at: now
    });
  }

  appendSheetObject_(ss, 'WorkerPayHistory', {
    pay_history_id: makeUid_('WPH'),
    assignment_id: assignId,
    order_id: String(targetOw.order_id),
    worker_id: String(targetOw.worker_id),
    worker_name: String(targetOw.worker_name),
    amount_bdt: payload.agreed_pay_bdt !== undefined ? toCleanNum_(payload.agreed_pay_bdt, 0) : toCleanNum_(targetOw.wage_bdt, 0),
    action_type: act,
    payment_date: String(payload.payment_date || targetOw.payment_date || ''),
    payment_method: String(payload.payment_method || targetOw.payment_method || ''),
    paid_by_role: String(payload.paid_by_role || targetOw.paid_by_role || ''),
    reference: String(payload.reference || targetOw.payment_reference || ''),
    note: reason,
    actor_name: actor.name,
    created_at: now
  });

  var updatedOrder = recomputeOrderFinancials_(ss, String(targetOw.order_id));
  bumpSyncRevision_(ss);
  var workerRow = null;
  for (var wi = 0; wi < updatedOrder.assigned_workers.length; wi++) {
    if (updatedOrder.assigned_workers[wi].id === assignId) {
      workerRow = updatedOrder.assigned_workers[wi];
      break;
    }
  }
  return { workerRow: workerRow, order: updatedOrder };
}

function handleRecordSettlementEntry_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var ord = getOrderByIdGas_(ss, orderId);
  if (!ord) throw new Error('Order not found.');
  var amt = parseNonNegativeAmount_(payload.amount_bdt || 0, 'Settlement Amount');
  if (amt <= 0) throw new Error('Settlement amount must be greater than 0.');
  var now = getNowDhakaTimestamp_();
  var entryType = ord.supervisor_settlement < 0 ? 'reimbursement_paid' : 'deposit_received';
  var direction = entryType === 'reimbursement_paid' ? 'to_supervisor' : 'from_supervisor';
  var eDt = String(payload.entry_datetime || now.slice(0, 16)).trim();
  var eDate = isValidIsoDate_(payload.entry_date) ? String(payload.entry_date) : eDt.slice(0, 10);

  var entry = {
    entry_id: makeUid_('SET'),
    order_id: orderId,
    supervisor_id: String(payload.supervisor_id || ord.assigned_supervisor_id || ''),
    supervisor_name: String(payload.supervisor_name || ord.assigned_supervisor_name || ''),
    entry_type: entryType,
    direction: direction,
    amount_bdt: amt,
    payment_method: String(payload.payment_method || 'Cash'),
    entry_datetime: eDt,
    entry_date: eDate,
    reference: String(payload.reference || '').trim(),
    note: String(payload.note || '').trim(),
    recorded_by: actor.name,
    created_at: now
  };
  appendSheetObject_(ss, 'SettlementEntries', entry);
  var updated = recomputeOrderFinancials_(ss, orderId);
  if (updated.settlement_status === 'Settled') {
    updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, {
      settlement_confirmed: 1,
      settlement_confirmed_at: now,
      settlement_confirmed_by: actor.name
    });
    updated = getOrderByIdGas_(ss, orderId);
  }
  bumpSyncRevision_(ss);
  return { entry: hydrateSettlementEntry_(entry), order: updated };
}

function handleCreateComplaint_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var ord = getOrderByIdGas_(ss, orderId);
  if (!ord) throw new Error('Order not found.');
  var issue = String(payload.issue || payload.description || '').trim();
  if (!issue) throw new Error('Complaint issue description is required.');
  var now = getNowDhakaTimestamp_();
  var rec = {
    complaint_id: makeUid_('CMP'),
    order_id: orderId,
    customer_name: ord.customer_name,
    phone_display: ord.phone_display,
    complaint_date: isValidIsoDate_(payload.complaint_date) ? String(payload.complaint_date) : getTodayDhakaIso_(),
    description: issue,
    action_taken: String(payload.action_taken || '').trim(),
    resolution_note: String(payload.notes || '').trim(),
    status: String(payload.status || 'Open'),
    return_visit_order_id: '',
    is_no_charge: 0,
    created_by: actor.name,
    created_at: now,
    updated_at: now
  };
  appendSheetObject_(ss, 'Complaints', rec);
  bumpSyncRevision_(ss);
  return hydrateComplaint_(rec);
}

function hydrateComplaint_(c) {
  return {
    complaint_id: String(c.complaint_id || ''),
    order_id: String(c.order_id || ''),
    complaint_date: String(c.complaint_date || String(c.created_at || '').slice(0, 10)),
    issue: String(c.description || ''),
    action_taken: String(c.action_taken || ''),
    notes: String(c.resolution_note || ''),
    status: String(c.status || 'Open'),
    return_visit_order_id: String(c.return_visit_order_id || ''),
    is_no_charge: toCleanBool_(c.is_no_charge),
    created_by: String(c.created_by || ''),
    created_at: String(c.created_at || ''),
    updated_at: String(c.updated_at || '')
  };
}

function handleUpdateComplaint_(ss, payload) {
  var cId = String(payload.complaint_id || '').trim();
  var patch = { updated_at: getNowDhakaTimestamp_() };
  if (payload.issue !== undefined) patch.description = String(payload.issue).trim();
  if (payload.action_taken !== undefined) patch.action_taken = String(payload.action_taken).trim();
  if (payload.notes !== undefined) patch.resolution_note = String(payload.notes).trim();
  if (payload.status !== undefined) patch.status = String(payload.status).trim();
  var upd = updateSheetObjectByKey_(ss, 'Complaints', 'complaint_id', cId, patch);
  if (!upd) throw new Error('Complaint not found.');
  bumpSyncRevision_(ss);
  return hydrateComplaint_(upd);
}

function handleScheduleReturnVisit_(ss, actor, payload) {
  var cId = String(payload.complaint_id || '').trim();
  var complaints = readSheetObjects_(ss, 'Complaints');
  var comp = null;
  for (var i = 0; i < complaints.length; i++) {
    if (String(complaints[i].complaint_id) === cId) { comp = complaints[i]; break; }
  }
  if (!comp) throw new Error('Complaint not found.');
  var parentOrd = getOrderByIdGas_(ss, String(comp.order_id));
  if (!parentOrd) throw new Error('Original order not found.');

  var isNoCharge = payload.is_no_charge !== false;
  var rvOrder = handleCreateOrder_(ss, actor, {
    customer_id: parentOrd.customer_id,
    building_id: parentOrd.building_id,
    building_name: parentOrd.building_name,
    customer_name: parentOrd.customer_name,
    phone: parentOrd.phone_display,
    address: parentOrd.address,
    area: parentOrd.area,
    services: parentOrd.services,
    scheduled_date: payload.scheduled_date,
    scheduled_time: payload.scheduled_time || '10:00',
    estimated_duration_mins: payload.estimated_duration_mins || parentOrd.estimated_duration_mins,
    assigned_supervisor_id: payload.assigned_supervisor_id || parentOrd.assigned_supervisor_id,
    assigned_workers: payload.assigned_workers || [],
    is_return_visit: true,
    is_no_charge_visit: isNoCharge,
    price_bdt: isNoCharge ? 0 : (payload.price_bdt || 0),
    parent_order_id: parentOrd.order_id,
    complaint_id: cId,
    return_visit_reason: String(comp.description || ''),
    instructions: String(payload.instructions || ('Return visit for ' + parentOrd.order_id + ': ' + comp.description)),
    notes: 'Return visit for complaint ' + cId
  });

  updateSheetObjectByKey_(ss, 'Complaints', 'complaint_id', cId, {
    status: 'Return Visit Scheduled',
    return_visit_order_id: rvOrder.order_id,
    is_no_charge: isNoCharge ? 1 : 0,
    updated_at: getNowDhakaTimestamp_()
  });
  bumpSyncRevision_(ss);
  return rvOrder;
}

function hydrateQuotation_(q) {
  var items = parseJsonSafe_(q.items_json, []);
  var statusHist = parseJsonSafe_(q.status_history_json, []);
  var padSnap = parseJsonSafe_(q.pad_snapshot_json, null);
  var phoneDisp = String(q.phone_display || '');
  if (/^1[3-9]\d{8}$/.test(phoneDisp)) phoneDisp = '0' + phoneDisp;
  return {
    quotation_id: String(q.quotation_id || ''),
    quotation_number: String(q.quotation_number || q.quotation_id || ''),
    lead_id: String(q.lead_id || ''),
    customer_id: String(q.customer_id || ''),
    building_id: String(q.building_id || ''),
    quotation_date: String(q.quotation_date || String(q.created_at || '').slice(0, 10)),
    valid_until: String(q.valid_until || ''),
    customer_name: String(q.customer_name || ''),
    phone_display: phoneDisp,
    phone_e164: String(q.phone_e164 || normalizePhoneBD_(phoneDisp).e164),
    address: String(q.address || ''),
    area: String(q.area || ''),
    items: Array.isArray(items) ? items : [],
    subtotal_bdt: toCleanNum_(q.subtotal_bdt, 0),
    discount_enabled: toCleanBool_(q.discount_enabled) || toCleanNum_(q.discount_bdt, 0) > 0,
    discount_type: String(q.discount_type || 'amount'),
    discount_value: toCleanNum_(q.discount_value !== '' && q.discount_value !== undefined ? q.discount_value : q.discount_bdt, 0),
    discount_bdt: toCleanNum_(q.discount_bdt, 0),
    vat_enabled: toCleanBool_(q.vat_enabled),
    vat_type: String(q.vat_type || 'percent'),
    vat_value: toCleanNum_(q.vat_value, 0),
    vat_base: String(q.vat_base || 'after_discount'),
    vat_bdt: toCleanNum_(q.vat_bdt, 0),
    tax_enabled: toCleanBool_(q.tax_enabled),
    tax_type: String(q.tax_type || 'percent'),
    tax_value: toCleanNum_(q.tax_value, 0),
    tax_base: String(q.tax_base || 'after_discount'),
    tax_bdt: toCleanNum_(q.tax_bdt, 0),
    total_bdt: toCleanNum_(q.total_bdt, 0),
    terms: String(q.terms || ''),
    notes: String(q.notes || ''),
    lead_source: String(q.lead_source || 'Not Specified'),
    referral_contact_type: String(q.referral_contact_type || ''),
    referral_contact_name: String(q.referral_contact_name || ''),
    referral_contact_phone: String(q.referral_contact_phone || ''),
    status: String(q.status || 'Draft'),
    status_changed_at: String(q.status_changed_at || q.updated_at || ''),
    status_history: Array.isArray(statusHist) ? statusHist : [],
    followup_date: String(q.followup_date || ''),
    followup_note: String(q.followup_note || ''),
    followup_done: toCleanBool_(q.followup_done),
    followup_done_at: String(q.followup_done_at || ''),
    share_url: String(q.share_url || ''),
    converted_order_id: String(q.converted_order_id || ''),
    pad_snapshot: padSnap,
    created_at: String(q.created_at || ''),
    updated_at: String(q.updated_at || '')
  };
}

function handleSaveQuotation_(ss, actor, payload) {
  var qId = String(payload.quotation_id || '').trim();
  var items = Array.isArray(payload.items) ? payload.items : [];
  var subtotal = 0;
  for (var i = 0; i < items.length; i++) {
    subtotal += parseNonNegativeAmount_(items[i].amount_bdt !== undefined ? items[i].amount_bdt : (items[i].price_bdt || 0), 'Item Amount');
  }
  subtotal = Math.round(subtotal * 100) / 100;

  var discEnabled = Boolean(payload.discount_enabled) || toCleanNum_(payload.discount_bdt, 0) > 0;
  var discType = payload.discount_type === 'percent' ? 'percent' : 'amount';
  var discVal = discEnabled ? parseNonNegativeAmount_(payload.discount_value !== undefined ? payload.discount_value : (payload.discount_bdt || 0), 'Discount') : 0;
  var discBdt = !discEnabled ? 0 : (discType === 'percent' ? Math.round(subtotal * discVal) / 100 : discVal);
  discBdt = Math.min(subtotal, Math.round(discBdt * 100) / 100);
  var afterDiscount = Math.max(0, Math.round((subtotal - discBdt) * 100) / 100);

  var vatEnabled = Boolean(payload.vat_enabled);
  var vatType = payload.vat_type === 'amount' ? 'amount' : 'percent';
  var vatVal = vatEnabled ? parseNonNegativeAmount_(payload.vat_value || 0, 'VAT') : 0;
  var vatBase = payload.vat_base === 'subtotal' ? 'subtotal' : 'after_discount';
  var vatBaseAmt = vatBase === 'subtotal' ? subtotal : afterDiscount;
  var vatBdt = !vatEnabled ? 0 : (vatType === 'percent' ? Math.round(vatBaseAmt * vatVal) / 100 : vatVal);
  vatBdt = Math.round(vatBdt * 100) / 100;

  var taxEnabled = Boolean(payload.tax_enabled);
  var taxType = payload.tax_type === 'amount' ? 'amount' : 'percent';
  var taxVal = taxEnabled ? parseNonNegativeAmount_(payload.tax_value || 0, 'Tax') : 0;
  var taxBase = payload.tax_base || 'after_discount';
  var taxBaseAmt = taxBase === 'subtotal' ? subtotal : (taxBase === 'after_discount_and_vat' ? afterDiscount + vatBdt : afterDiscount);
  var taxBdt = !taxEnabled ? 0 : (taxType === 'percent' ? Math.round(taxBaseAmt * taxVal) / 100 : taxVal);
  taxBdt = Math.round(taxBdt * 100) / 100;

  var total = Math.max(0, Math.round((afterDiscount + vatBdt + taxBdt) * 100) / 100);
  var ph = normalizePhoneBD_(payload.phone || payload.phone_display || '');
  var now = getNowDhakaTimestamp_();
  var statusVal = String(payload.status || 'Draft');

  var existingRows = readSheetObjects_(ss, 'Quotations');
  var existing = null;
  if (qId) {
    for (var ei = 0; ei < existingRows.length; ei++) {
      if (String(existingRows[ei].quotation_id) === qId) { existing = existingRows[ei]; break; }
    }
  }

  var history = existing ? parseJsonSafe_(existing.status_history_json, []) : [];
  if (!Array.isArray(history)) history = [];
  if (!existing || String(existing.status) !== statusVal) {
    history.push({ status: statusVal, changed_at: now, changed_by: actor.name });
  }

  var activePad = getDocumentPadByType_(ss, 'quotation');
  var padSnapJson = existing && existing.pad_snapshot_json
    ? String(existing.pad_snapshot_json)
    : (activePad ? JSON.stringify(activePad) : '');

  var record = {
    lead_id: String(payload.lead_id || (existing ? existing.lead_id : '') || ''),
    customer_id: String(payload.customer_id || (existing ? existing.customer_id : '') || ''),
    building_id: String(payload.building_id || (existing ? existing.building_id : '') || ''),
    quotation_date: isValidIsoDate_(payload.quotation_date) ? String(payload.quotation_date) : (existing && existing.quotation_date ? String(existing.quotation_date) : getTodayDhakaIso_()),
    valid_until: String(payload.valid_until || addDaysIso_(getTodayDhakaIso_(), 15)),
    customer_name: String(payload.customer_name || '').trim(),
    phone_display: ph.display,
    phone_e164: ph.e164,
    address: String(payload.address || '').trim(),
    area: String(payload.area || '').trim(),
    items_json: JSON.stringify(items),
    subtotal_bdt: subtotal,
    discount_enabled: discEnabled ? 1 : 0,
    discount_type: discType,
    discount_value: discVal,
    discount_bdt: discBdt,
    vat_enabled: vatEnabled ? 1 : 0,
    vat_type: vatType,
    vat_value: vatVal,
    vat_base: vatBase,
    vat_bdt: vatBdt,
    tax_enabled: taxEnabled ? 1 : 0,
    tax_type: taxType,
    tax_value: taxVal,
    tax_base: taxBase,
    tax_bdt: taxBdt,
    total_bdt: total,
    terms: String(payload.terms || '').trim(),
    notes: String(payload.notes || '').trim(),
    lead_source: String(payload.lead_source || 'Not Specified'),
    referral_contact_type: String(payload.referral_contact_type || ''),
    referral_contact_name: String(payload.referral_contact_name || ''),
    referral_contact_phone: String(payload.referral_contact_phone || ''),
    status: statusVal,
    status_changed_at: now,
    status_history_json: JSON.stringify(history),
    followup_date: String(payload.followup_date || ''),
    followup_note: String(payload.followup_note || '').trim(),
    followup_done: existing ? (toCleanBool_(existing.followup_done) ? 1 : 0) : 0,
    followup_done_at: existing ? String(existing.followup_done_at || '') : '',
    share_url: String(payload.share_url || ''),
    pad_snapshot_json: padSnapJson,
    updated_at: now
  };

  if (existing) {
    updateSheetObjectByKey_(ss, 'Quotations', 'quotation_id', qId, record);
    record.quotation_id = qId;
    record.quotation_number = existing.quotation_number || qId;
    record.converted_order_id = existing.converted_order_id || '';
    record.created_at = existing.created_at || now;
  } else {
    var qSeq = incrementSequence_(ss, 'quotation_sequence');
    qId = 'SCC-QTN-' + String(1000 + qSeq);
    record.quotation_id = qId;
    record.quotation_number = qId;
    record.converted_order_id = '';
    record.pdf_file_id = '';
    record.created_at = now;
    appendSheetObject_(ss, 'Quotations', record);
    if (record.lead_id) {
      updateSheetObjectByKey_(ss, 'Leads', 'lead_id', record.lead_id, {
        linked_quotation_id: qId,
        stage: 'Quotation Sent',
        updated_at: now
      });
    }
  }
  bumpSyncRevision_(ss);
  return hydrateQuotation_(record);
}

function handleUpdateQuotationFollowup_(ss, actor, payload) {
  var qId = String(payload.quotation_id || '').trim();
  var quotes = readSheetObjects_(ss, 'Quotations');
  var existing = null;
  for (var i = 0; i < quotes.length; i++) {
    if (String(quotes[i].quotation_id) === qId) { existing = quotes[i]; break; }
  }
  if (!existing) throw new Error('Quotation not found.');
  var now = getNowDhakaTimestamp_();
  var patch = { updated_at: now };
  if (payload.status !== undefined && String(payload.status) !== String(existing.status)) {
    var hist = parseJsonSafe_(existing.status_history_json, []);
    if (!Array.isArray(hist)) hist = [];
    hist.push({ status: String(payload.status), changed_at: now, changed_by: actor.name });
    patch.status = String(payload.status);
    patch.status_changed_at = now;
    patch.status_history_json = JSON.stringify(hist);
  }
  if (payload.followup_date !== undefined) patch.followup_date = String(payload.followup_date);
  if (payload.followup_note !== undefined) patch.followup_note = String(payload.followup_note).trim();
  if (payload.followup_done !== undefined) {
    patch.followup_done = payload.followup_done ? 1 : 0;
    patch.followup_done_at = payload.followup_done ? now : '';
  }
  if (payload.share_url !== undefined) patch.share_url = String(payload.share_url).trim();
  var upd = updateSheetObjectByKey_(ss, 'Quotations', 'quotation_id', qId, patch);
  bumpSyncRevision_(ss);
  return hydrateQuotation_(upd);
}

function handleConvertQuotationToOrder_(ss, actor, payload) {
  var qId = String(payload.quotation_id || '').trim();
  var quotes = readSheetObjects_(ss, 'Quotations');
  var targetQ = null;
  for (var i = 0; i < quotes.length; i++) {
    if (String(quotes[i].quotation_id) === qId) { targetQ = quotes[i]; break; }
  }
  if (!targetQ) throw new Error('Quotation not found.');
  if (targetQ.converted_order_id) {
    var existingOrd = getOrderByIdGas_(ss, String(targetQ.converted_order_id));
    if (existingOrd) {
      return { alreadyConverted: true, order: existingOrd, quotation: hydrateQuotation_(targetQ) };
    }
  }
  var qItems = parseJsonSafe_(targetQ.items_json, []);
  var serviceNames = [];
  for (var si = 0; si < qItems.length; si++) {
    var sName = String(qItems[si].service || qItems[si].service_type || '').trim();
    if (sName && serviceNames.indexOf(sName) === -1) serviceNames.push(sName);
  }
  if (serviceNames.length === 0) serviceNames.push(SUNVILOZ_CONFIG.DEFAULT_SERVICES[0]);

  var newOrder = handleCreateOrder_(ss, actor, {
    quotation_id: qId,
    customer_id: targetQ.customer_id,
    building_id: targetQ.building_id,
    lead_id: targetQ.lead_id,
    customer_name: targetQ.customer_name,
    phone: targetQ.phone_display,
    address: targetQ.address,
    area: targetQ.area,
    services: serviceNames,
    price_bdt: toCleanNum_(targetQ.total_bdt, 0),
    booking_date: payload.booking_date || getTodayDhakaIso_(),
    scheduled_date: payload.scheduled_date || getTodayDhakaIso_(),
    scheduled_time: payload.scheduled_time || '10:00',
    assigned_supervisor_id: payload.assigned_supervisor_id || '',
    instructions: payload.instructions || '',
    lead_source: targetQ.lead_source || 'Not Specified',
    referral_contact_type: targetQ.referral_contact_type || '',
    referral_contact_name: targetQ.referral_contact_name || '',
    referral_contact_phone: targetQ.referral_contact_phone || '',
    notes: 'Converted from ' + (targetQ.quotation_number || qId) + (targetQ.notes ? ' · ' + targetQ.notes : '')
  });
  var now = getNowDhakaTimestamp_();
  var hist = parseJsonSafe_(targetQ.status_history_json, []);
  if (!Array.isArray(hist)) hist = [];
  hist.push({ status: 'Accepted', changed_at: now, changed_by: actor.name, note: 'Converted to ' + newOrder.order_id });
  var updQ = updateSheetObjectByKey_(ss, 'Quotations', 'quotation_id', qId, {
    status: 'Accepted',
    status_changed_at: now,
    status_history_json: JSON.stringify(hist),
    converted_order_id: newOrder.order_id,
    followup_done: 1,
    followup_done_at: now,
    updated_at: now
  });
  bumpSyncRevision_(ss);
  return { alreadyConverted: false, order: newOrder, quotation: hydrateQuotation_(updQ) };
}

function hydrateReceipt_(r) {
  return {
    receipt_id: String(r.receipt_id || ''),
    order_id: String(r.order_id || ''),
    receipt_date: String(r.payment_date || String(r.created_at || '').slice(0, 10)),
    customer_name: String(r.customer_name || ''),
    phone_display: String(r.phone_display || ''),
    address: String(r.address || ''),
    services_text: String(r.service_type || ''),
    amount_received: toCleanNum_(r.amount_bdt, 0),
    payment_method: String(r.payment_method || 'Cash'),
    transaction_ref: String(r.transaction_ref || ''),
    received_by: String(r.received_by || ''),
    notes: String(r.notes || ''),
    pad_snapshot: parseJsonSafe_(r.pad_snapshot_json, null),
    created_at: String(r.created_at || '')
  };
}

function handleIssueMoneyReceipt_(ss, actor, payload) {
  var orderId = String(payload.order_id || '').trim();
  var ord = getOrderByIdGas_(ss, orderId);
  if (!ord) throw new Error('Order not found.');
  var existingReceipts = readSheetObjects_(ss, 'Receipts');
  for (var i = 0; i < existingReceipts.length; i++) {
    if (String(existingReceipts[i].order_id) === orderId) {
      return { alreadyIssued: true, receipt: hydrateReceipt_(existingReceipts[i]), order: ord };
    }
  }
  var rSeq = incrementSequence_(ss, 'receipt_sequence');
  var rId = 'SCC-MR-' + String(1000 + rSeq);
  var now = getNowDhakaTimestamp_();
  var activePad = getDocumentPadByType_(ss, 'receipt');
  var receiptRow = {
    receipt_id: rId,
    receipt_number: rId,
    order_id: ord.order_id,
    customer_name: ord.customer_name,
    phone_display: ord.phone_display,
    address: ord.address,
    service_type: ord.services_text || ord.service_type,
    amount_bdt: ord.is_no_charge_visit ? 0 : ord.price_bdt,
    payment_method: String(payload.payment_method || 'Cash'),
    payment_date: isValidIsoDate_(payload.receipt_date || payload.payment_date)
      ? String(payload.receipt_date || payload.payment_date)
      : (ord.completion_date || getTodayDhakaIso_()),
    transaction_ref: String(payload.transaction_ref || '').trim(),
    received_by: String(payload.received_by || actor.name),
    notes: String(payload.notes || '').trim(),
    pad_snapshot_json: activePad ? JSON.stringify(activePad) : '',
    pdf_file_id: '',
    created_at: now
  };
  appendSheetObject_(ss, 'Receipts', receiptRow);
  updateSheetObjectByKey_(ss, 'Orders', 'order_id', orderId, { receipt_id: rId, updated_at: now });
  bumpSyncRevision_(ss);
  return { alreadyIssued: false, receipt: hydrateReceipt_(receiptRow), order: getOrderByIdGas_(ss, orderId) };
}

function hydrateLead_(l) {
  var svcs = parseJsonSafe_(l.interested_services_json, []);
  if (!Array.isArray(svcs) || svcs.length === 0) {
    svcs = l.service_type ? [String(l.service_type)] : [];
  }
  var phDisp = String(l.phone_display || '');
  if (/^1[3-9]\d{8}$/.test(phDisp)) phDisp = '0' + phDisp;
  return {
    lead_id: String(l.lead_id || ''),
    name: String(l.customer_name || ''),
    phone_display: phDisp,
    phone_e164: String(l.phone_e164 || ''),
    area: String(l.area || ''),
    building_org: String(l.building_org || ''),
    address: String(l.address || ''),
    contact_role: String(l.contact_role || ''),
    interested_services: svcs,
    interested_services_text: svcs.join(', '),
    lead_source: String(l.lead_source || 'Not Specified'),
    referral_contact_type: String(l.referral_contact_type || ''),
    stage: String(l.stage || 'New'),
    next_followup_date: String(l.followup_date || ''),
    followup_done: toCleanBool_(l.followup_done),
    followup_done_at: String(l.followup_done_at || ''),
    followup_version: parseInt(String(l.followup_version || '0'), 10) || 0,
    reminder_sent: toCleanBool_(l.reminder_sent),
    reminder_sent_at: String(l.reminder_sent_at || ''),
    reminder_sent_for_date: String(l.reminder_sent_for_date || ''),
    reminder_sent_version: parseInt(String(l.reminder_sent_version || '0'), 10) || 0,
    linked_quotation_id: String(l.linked_quotation_id || ''),
    linked_order_id: String(l.converted_order_id || ''),
    agent_name: String(l.agent_name || ''),
    agent_phone_display: String(l.agent_phone_display || ''),
    agent_phone_e164: String(l.agent_phone_e164 || ''),
    agent_note: String(l.agent_note || ''),
    caretaker_name: String(l.caretaker_name || ''),
    caretaker_phone_display: String(l.caretaker_phone_display || ''),
    caretaker_phone_e164: String(l.caretaker_phone_e164 || ''),
    caretaker_note: String(l.caretaker_note || ''),
    created_at: String(l.created_at || ''),
    updated_at: String(l.updated_at || '')
  };
}

function handleCheckDuplicatePhone_(ss, payload) {
  var raw = String(payload.phone || '').trim();
  var excludeLeadId = String(payload.excludeLeadId || '').trim();
  if (!raw) return { normalized: null, matchingLeads: [], matchingOrders: [] };
  var norm = normalizePhoneBD_(raw);
  var leads = readSheetObjects_(ss, 'Leads');
  var orders = readSheetObjects_(ss, 'Orders');
  var matchingLeads = [];
  for (var i = 0; i < leads.length; i++) {
    var l = hydrateLead_(leads[i]);
    if (excludeLeadId && l.lead_id === excludeLeadId) continue;
    if ((norm.e164 && l.phone_e164 === norm.e164) || (norm.display && l.phone_display === norm.display)) {
      matchingLeads.push({
        lead_id: l.lead_id,
        name: l.name,
        phone_display: l.phone_display,
        area: l.area,
        building_org: l.building_org,
        stage: l.stage
      });
    }
  }
  var matchingOrders = [];
  for (var j = 0; j < orders.length; j++) {
    var o = orders[j];
    var opd = String(o.phone_display || '');
    if (/^1[3-9]\d{8}$/.test(opd)) opd = '0' + opd;
    if ((norm.e164 && String(o.phone_e164 || '') === norm.e164) || (norm.display && opd === norm.display)) {
      matchingOrders.push({
        order_id: String(o.order_id),
        customer_name: String(o.customer_name || ''),
        phone_display: opd,
        area: String(o.area || ''),
        scheduled_date: String(o.scheduled_date || ''),
        status: String(o.status || 'Confirmed')
      });
    }
  }
  return { normalized: norm, matchingLeads: matchingLeads, matchingOrders: matchingOrders };
}

function handleSaveLead_(ss, actor, payload) {
  var lId = String(payload.lead_id || '').trim();
  var name = String(payload.name || payload.customer_name || '').trim();
  if (!name) throw new Error('Prospect name is required.');
  var lPhone = normalizePhoneBD_(payload.phone || payload.phone_display || '');
  var agentPh = normalizePhoneBD_(payload.agent_phone || payload.agent_phone_display || '');
  var carePh = normalizePhoneBD_(payload.caretaker_phone || payload.caretaker_phone_display || '');
  var svcs = Array.isArray(payload.interested_services)
    ? payload.interested_services.map(function (s) { return String(s || '').trim(); }).filter(Boolean)
    : (payload.service_type ? [String(payload.service_type)] : []);
  var now = getNowDhakaTimestamp_();
  var followupDate = String(payload.next_followup_date || payload.followup_date || '').trim();

  var existing = null;
  if (lId) {
    var all = readSheetObjects_(ss, 'Leads');
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].lead_id) === lId) { existing = all[i]; break; }
    }
  }

  var row = {
    lead_id: lId || ('LEAD-' + String(1000 + incrementSequence_(ss, 'lead_sequence'))),
    customer_name: name,
    phone_display: lPhone.display,
    phone_e164: lPhone.e164,
    address: String(payload.address || '').trim(),
    area: String(payload.area || '').trim(),
    building_org: String(payload.building_org || '').trim(),
    contact_role: String(payload.contact_role || '').trim(),
    service_type: svcs.join(', '),
    interested_services_json: JSON.stringify(svcs),
    lead_source: String(payload.lead_source || 'Not Specified'),
    referral_contact_type: String(payload.referral_contact_type || ''),
    quoted_price_bdt: parseNonNegativeAmount_(payload.quoted_price_bdt || 0, 'Quoted Price'),
    channel: String(payload.initial_channel || payload.channel || 'Call'),
    stage: String(payload.stage || 'New'),
    followup_date: followupDate,
    followup_done: existing ? (toCleanBool_(existing.followup_done) ? 1 : 0) : 0,
    followup_done_at: existing ? String(existing.followup_done_at || '') : '',
    followup_version: existing ? (parseInt(String(existing.followup_version || '0'), 10) || 0) : (followupDate ? 1 : 0),
    reminder_sent: existing ? (toCleanBool_(existing.reminder_sent) ? 1 : 0) : 0,
    reminder_sent_at: existing ? String(existing.reminder_sent_at || '') : '',
    reminder_sent_for_date: existing ? String(existing.reminder_sent_for_date || '') : '',
    reminder_sent_version: existing ? (parseInt(String(existing.reminder_sent_version || '0'), 10) || 0) : 0,
    linked_quotation_id: existing ? String(existing.linked_quotation_id || '') : '',
    converted_order_id: existing ? String(existing.converted_order_id || '') : '',
    agent_name: String(payload.agent_name || '').trim(),
    agent_phone_display: agentPh.display,
    agent_phone_e164: agentPh.e164,
    agent_note: String(payload.agent_note || '').trim(),
    caretaker_name: String(payload.caretaker_name || '').trim(),
    caretaker_phone_display: carePh.display,
    caretaker_phone_e164: carePh.e164,
    caretaker_note: String(payload.caretaker_note || '').trim(),
    notes: String(payload.notes || '').trim(),
    created_at: existing ? String(existing.created_at || now) : now,
    updated_at: now
  };

  if (existing) {
    updateSheetObjectByKey_(ss, 'Leads', 'lead_id', lId, row);
  } else {
    appendSheetObject_(ss, 'Leads', row);
    if (payload.initial_note && String(payload.initial_note).trim()) {
      appendSheetObject_(ss, 'LeadNotes', {
        note_id: makeUid_('LNT'),
        lead_id: row.lead_id,
        channel: String(payload.initial_channel || 'Call'),
        note: String(payload.initial_note).trim(),
        actor_name: actor.name,
        created_at: now
      });
    }
  }
  bumpSyncRevision_(ss);
  return hydrateLead_(row);
}

function handleAddLeadNote_(ss, actor, payload) {
  var leadId = String(payload.lead_id || '').trim();
  var noteText = String(payload.note_text || payload.note || '').trim();
  if (!noteText) throw new Error('Note text is required.');
  var now = getNowDhakaTimestamp_();
  var noteRow = {
    note_id: makeUid_('LNT'),
    lead_id: leadId,
    channel: String(payload.channel || 'Call'),
    note: noteText,
    actor_name: actor.name,
    created_at: now
  };
  appendSheetObject_(ss, 'LeadNotes', noteRow);
  var patch = { updated_at: now };
  if (payload.stage) patch.stage = String(payload.stage);
  if (payload.next_followup_date !== undefined) {
    patch.followup_date = String(payload.next_followup_date || '');
    patch.followup_done = 0;
  }
  var upd = updateSheetObjectByKey_(ss, 'Leads', 'lead_id', leadId, patch);
  if (!upd) throw new Error('Prospect not found.');
  bumpSyncRevision_(ss);
  return {
    lead: hydrateLead_(upd),
    note: {
      note_id: noteRow.note_id,
      lead_id: leadId,
      channel: noteRow.channel,
      note_text: noteRow.note,
      created_by: noteRow.actor_name,
      created_at: noteRow.created_at
    }
  };
}

function handleRescheduleLeadFollowup_(ss, actor, payload) {
  var leadId = String(payload.lead_id || '').trim();
  var nextDate = String(payload.next_followup_date || '').trim();
  if (!isValidIsoDate_(nextDate)) throw new Error('Valid next follow-up date is required.');
  var now = getNowDhakaTimestamp_();
  var leads = readSheetObjects_(ss, 'Leads');
  var existing = null;
  for (var i = 0; i < leads.length; i++) {
    if (String(leads[i].lead_id) === leadId) { existing = leads[i]; break; }
  }
  if (!existing) throw new Error('Prospect not found.');
  var upd = updateSheetObjectByKey_(ss, 'Leads', 'lead_id', leadId, {
    followup_date: nextDate,
    followup_done: 0,
    followup_done_at: '',
    followup_version: (parseInt(String(existing.followup_version || '0'), 10) || 0) + 1,
    reminder_sent: 0,
    updated_at: now
  });
  if (payload.note && String(payload.note).trim()) {
    appendSheetObject_(ss, 'LeadNotes', {
      note_id: makeUid_('LNT'),
      lead_id: leadId,
      channel: 'Call',
      note: 'Rescheduled follow-up to ' + nextDate + ': ' + String(payload.note).trim(),
      actor_name: actor.name,
      created_at: now
    });
  }
  bumpSyncRevision_(ss);
  return hydrateLead_(upd);
}

function handleToggleLeadFollowupDone_(ss, actor, payload) {
  var leadId = String(payload.lead_id || '').trim();
  var now = getNowDhakaTimestamp_();
  var patch = { updated_at: now };
  if (payload.next_followup_date && isValidIsoDate_(payload.next_followup_date)) {
    patch.followup_date = String(payload.next_followup_date);
    patch.followup_done = 0;
    patch.followup_done_at = '';
  } else {
    var done = payload.is_done !== false;
    patch.followup_done = done ? 1 : 0;
    patch.followup_done_at = done ? now : '';
  }
  var upd = updateSheetObjectByKey_(ss, 'Leads', 'lead_id', leadId, patch);
  if (!upd) throw new Error('Prospect not found.');
  if (payload.note_text && String(payload.note_text).trim()) {
    appendSheetObject_(ss, 'LeadNotes', {
      note_id: makeUid_('LNT'),
      lead_id: leadId,
      channel: 'Call',
      note: String(payload.note_text).trim(),
      actor_name: actor.name,
      created_at: now
    });
  }
  bumpSyncRevision_(ss);
  return hydrateLead_(upd);
}

function getDocumentPadByType_(ss, padType) {
  var rows = readSheetObjects_(ss, 'DocumentPads');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].pad_type) === String(padType)) {
      return hydrateDocumentPad_(rows[i]);
    }
  }
  return null;
}

function hydrateDocumentPad_(row) {
  var imgUrl = row.drive_file_id ? readDriveFileAsDataUrl_(row.drive_file_id, row.mime_type) : '';
  return {
    pad_type: String(row.pad_type || 'quotation'),
    version: parseInt(String(row.version || '1'), 10) || 1,
    file_name: String(row.file_name || ''),
    mime_type: String(row.mime_type || 'image/png'),
    image_data_url: imgUrl,
    page_width_mm: toCleanNum_(row.page_width_mm, 210) || 210,
    page_height_mm: toCleanNum_(row.page_height_mm, 297) || 297,
    fields: parseJsonSafe_(row.fields_json, []),
    updated_at: String(row.updated_at || ''),
    updated_by: String(row.updated_by || ''),
    drive_file_id: String(row.drive_file_id || '')
  };
}

function buildPublicSettings_(ss) {
  var settings = getSettingsMap_(ss);
  var props = PropertiesService.getScriptProperties();
  var logoDataUrl = settings.company_logo_file_id
    ? readDriveFileAsDataUrl_(settings.company_logo_file_id, settings.company_logo_mime_type)
    : '';
  var ownerEmail = toCleanStr_(settings.primary_owner_google_email || getEffectiveOwnerEmail_() || SUNVILOZ_CONFIG.FIXED_RECOVERY_EMAIL);
  var syncRev = parseInt(settings.sync_revision || '1', 10) || 1;
  var secUrl = String(props.getProperty('SECONDARY_BACKUP_WEBAPP_URL') || '').trim();
  var secSecretSet = String(props.getProperty('SECONDARY_BACKUP_SECRET') || '').trim().length > 0;

  return {
    default_followup_value: parseInt(settings.default_followup_value || '6', 10) || 6,
    default_followup_unit: settings.default_followup_unit === 'days' ? 'days' : 'months',
    reminder_email: toCleanStr_(settings.reminder_email || ownerEmail),
    owner_email: ownerEmail,
    daily_reminder_hour: parseInt(settings.daily_reminder_hour || '9', 10) || 9,
    schedule_conflict_buffer_mins: parseInt(settings.schedule_conflict_buffer_mins || '30', 10) || 30,
    google_webapp_url: '',
    google_sync_configured: true,
    last_google_sync_at: getNowDhakaTimestamp_(),
    last_google_sync_status: 'verified',
    last_google_sync_error: '',
    last_drive_backup_at: toCleanStr_(settings.primary_drive_last_snapshot_at || settings.last_verified_backup_at),
    reminder_trigger_status: toCleanStr_(settings.reminder_trigger_status || 'Configured in Apps Script'),
    reminders_paused_after_restore: settings.reminders_paused_after_restore === '1',
    company_logo_data_url: logoDataUrl,
    company_logo_file_name: toCleanStr_(settings.company_logo_file_name),
    company_logo_mime_type: toCleanStr_(settings.company_logo_mime_type),
    company_logo_updated_at: toCleanStr_(settings.company_logo_updated_at),
    primary_drive_email: ownerEmail,
    primary_drive_folder_label: SUNVILOZ_CONFIG.DRIVE_ROOT_FOLDER + ' (Google Sheets + Drive)',
    primary_drive_file_id: ss.getId(),
    sync_revision: syncRev,
    primary_drive_last_synced_revision: syncRev,
    primary_drive_last_synced_at: toCleanStr_(settings.primary_drive_last_snapshot_at || getNowDhakaTimestamp_()),
    primary_drive_sync_status: 'saved_to_primary_drive',
    primary_drive_last_error: '',
    primary_drive_last_checksum: toCleanStr_(settings.primary_drive_last_checksum),
    secondary_drive_email: toCleanStr_(settings.secondary_drive_email),
    secondary_drive_folder_id: '',
    secondary_drive_folder_name: toCleanStr_(settings.secondary_drive_folder_name || 'SUNVILOZ Clean Care Backups'),
    secondary_drive_webapp_url: secUrl,
    secondary_drive_secret_configured: secSecretSet,
    auto_backup_enabled: settings.auto_backup_enabled === '1',
    auto_backup_hour: parseInt(settings.auto_backup_hour || '2', 10) || 2,
    last_verified_backup_at: toCleanStr_(settings.last_verified_backup_at),
    last_verified_backup_file: toCleanStr_(settings.last_verified_backup_file),
    last_backup_error: toCleanStr_(settings.last_backup_error)
  };
}

function getAdminBootstrapGas_(ss) {
  var orders = getAllHydratedOrders_(ss);
  var accounts = readSheetObjects_(ss, 'Accounts');
  var supervisors = [];
  for (var i = 0; i < accounts.length; i++) {
    if (String(accounts[i].role) === 'supervisor') {
      supervisors.push(toPublicAccount_(accounts[i]));
    }
  }

  var customers = readSheetObjects_(ss, 'Customers').map(function (c) {
    return {
      customer_id: String(c.customer_id || ''),
      name: String(c.name || ''),
      phone_display: String(c.phone_display || ''),
      phone_e164: String(c.phone_e164 || ''),
      lead_source: String(c.lead_source || 'Not Specified'),
      notes: String(c.notes || ''),
      created_at: String(c.created_at || ''),
      updated_at: String(c.updated_at || '')
    };
  });

  var buildings = readSheetObjects_(ss, 'Buildings').map(hydrateBuilding_);
  var leads = readSheetObjects_(ss, 'Leads').map(hydrateLead_);
  var leadNotes = readSheetObjects_(ss, 'LeadNotes').map(function (n) {
    return {
      note_id: String(n.note_id || ''),
      lead_id: String(n.lead_id || ''),
      channel: String(n.channel || 'Call'),
      note_text: String(n.note || ''),
      created_by: String(n.actor_name || ''),
      created_at: String(n.created_at || '')
    };
  });
  var quotations = readSheetObjects_(ss, 'Quotations').map(hydrateQuotation_);
  var receipts = readSheetObjects_(ss, 'Receipts').map(hydrateReceipt_);

  var workers = readSheetObjects_(ss, 'Workers').map(function (w) {
    var ph = String(w.phone_display || '');
    return {
      worker_id: String(w.worker_id || ''),
      name: String(w.name || ''),
      phone_display: ph,
      phone_e164: String(w.phone_e164 || normalizePhoneBD_(ph).e164),
      is_active: toCleanBool_(w.is_active),
      notes: String(w.notes || ''),
      created_at: String(w.created_at || ''),
      updated_at: String(w.updated_at || '')
    };
  });

  var workerPaymentHistory = readSheetObjects_(ss, 'WorkerPayHistory').map(function (h) {
    var act = String(h.action_type || 'MARK_PAID').toUpperCase();
    if (act === 'PAID') act = 'MARK_PAID';
    return {
      history_id: String(h.pay_history_id || ''),
      order_worker_id: String(h.assignment_id || ''),
      order_id: String(h.order_id || ''),
      worker_id: String(h.worker_id || ''),
      worker_name: String(h.worker_name || ''),
      action: act,
      amount_bdt: toCleanNum_(h.amount_bdt, 0),
      payment_date: String(h.payment_date || String(h.created_at || '').slice(0, 10)),
      payment_method: String(h.payment_method || 'Cash'),
      paid_by_role: String(h.paid_by_role || 'admin'),
      reference: String(h.reference || ''),
      reason: String(h.note || ''),
      changed_by: String(h.actor_name || ''),
      changed_at: String(h.created_at || '')
    };
  }).reverse();

  var settlementEntries = readSheetObjects_(ss, 'SettlementEntries').map(hydrateSettlementEntry_).reverse();
  var complaints = readSheetObjects_(ss, 'Complaints').map(hydrateComplaint_).reverse();

  var overhead = readSheetObjects_(ss, 'OverheadExpenses').map(function (o) {
    return {
      id: String(o.expense_id || ''),
      expense_date: String(o.expense_date || ''),
      category: String(o.category || 'Other'),
      description: String(o.description || ''),
      amount_bdt: toCleanNum_(o.amount_bdt, 0),
      created_by: String(o.recorded_by || ''),
      created_at: String(o.created_at || '')
    };
  }).reverse();

  var history = readSheetObjects_(ss, 'StatusHistory').map(function (h) {
    return {
      history_id: String(h.history_id || ''),
      order_id: String(h.order_id || ''),
      previous_status: String(h.from_status || ''),
      new_status: String(h.to_status || ''),
      note: String(h.note || ''),
      changed_by: String(h.actor_name || ''),
      changed_at: String(h.created_at || '')
    };
  }).reverse();

  var reminderLogs = readSheetObjects_(ss, 'ReminderLog').map(function (r) {
    return {
      log_id: String(r.log_id || ''),
      dedupe_key: String(r.dedupe_key || ''),
      order_id: String(r.order_id || ''),
      customer_name: String(r.customer_name || ''),
      phone_display: String(r.phone_display || ''),
      services_text: String(r.services_text || ''),
      completion_date: String(r.completion_date || ''),
      followup_date: String(r.followup_date || ''),
      recipient_email: String(r.recipient_email || ''),
      send_type: String(r.send_type || 'AUTO_DAILY'),
      status: String(r.status || 'SENT').toUpperCase() === 'FAILED' ? 'FAILED' : 'SENT',
      error_message: String(r.error_message || ''),
      sent_at: String(r.sent_at || '')
    };
  }).reverse();

  var issuedPdfs = readSheetObjects_(ss, 'IssuedPdfs').map(function (p) {
    return {
      pdf_id: String(p.pdf_id || ''),
      doc_type: String(p.doc_type || 'quotation'),
      doc_id: String(p.doc_id || ''),
      file_name: String(p.file_name || ''),
      size_bytes: toCleanNum_(p.size_bytes, 0),
      created_by: String(p.issued_by || ''),
      created_at: String(p.created_at || '')
    };
  }).reverse();

  var backupHistory = readSheetObjects_(ss, 'BackupHistory').map(function (b) {
    return {
      backup_id: String(b.backup_id || ''),
      source: String(b.source || 'secondary_drive_scheduler'),
      status: String(b.status) === 'verified' ? 'verified' : 'failed',
      file_name: String(b.file_name || ''),
      drive_file_id: String(b.drive_file_id || ''),
      drive_account_email: String(b.drive_account_email || ''),
      folder_name: String(b.folder_name || ''),
      size_bytes: toCleanNum_(b.size_bytes, 0),
      checksum_sha256: String(b.checksum_sha256 || ''),
      error_message: String(b.error_message || ''),
      created_by: String(b.created_by || ''),
      created_at: String(b.created_at || '')
    };
  }).reverse();

  var padRows = readSheetObjects_(ss, 'DocumentPads');
  var pads = { quotation: null, receipt: null };
  for (var p = 0; p < padRows.length; p++) {
    var pt = String(padRows[p].pad_type || '');
    if (pt === 'quotation' || pt === 'receipt') {
      pads[pt] = hydrateDocumentPad_(padRows[p]);
    }
  }

  return {
    todayDhaka: getTodayDhakaIso_(),
    orders: orders,
    quotations: quotations,
    receipts: receipts,
    leads: leads,
    leadNotes: leadNotes,
    customers: customers,
    buildings: buildings,
    workers: workers,
    workerPaymentHistory: workerPaymentHistory,
    settlementEntries: settlementEntries,
    complaints: complaints,
    supervisors: supervisors,
    overhead: overhead,
    history: history,
    reminderLogs: reminderLogs,
    issuedPdfs: issuedPdfs,
    backupHistory: backupHistory,
    pads: pads,
    settings: buildPublicSettings_(ss)
  };
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
    if (serviceFilter && String(o.services_text || o.service_type || '').toLowerCase().indexOf(serviceFilter) === -1) continue;
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
        service_type: o.services_text || o.service_type,
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
