import ExcelJS from 'exceljs';
import type {
  AdminBootstrapPayload,
  OrderRecord,
  OverheadExpenseRecord,
  SupervisorSettlementEntry,
} from '../src/types/order.ts';
import {
  formatEnDateShort,
  normalizeLeadSource,
  translateServiceToEnglish,
} from '../src/utils/dateAndPhone.ts';
import {
  computeMonthlyFinancialReport,
  type MonthlyFinancialFilter,
} from '../src/utils/financialReport.ts';

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0B1F3A' },
  };
  row.alignment = { vertical: 'middle', horizontal: 'left' };
  row.height = 24;
}

function styleTotalRow(row: ExcelJS.Row) {
  row.font = { bold: true, size: 11 };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
  row.height = 22;
}

function autoFitColumns(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach((col) => {
    let maxLen = 14;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const val = cell.value === null || cell.value === undefined ? '' : String(cell.value);
      if (val.length + 3 > maxLen) maxLen = Math.min(44, val.length + 3);
    });
    col.width = maxLen;
  });
}

export type { MonthlyFinancialFilter };

export function computeMonthlyFinancialReportData(
  bootstrap: AdminBootstrapPayload,
  filter: MonthlyFinancialFilter
) {
  return computeMonthlyFinancialReport(
    {
      orders: bootstrap.orders,
      overhead: bootstrap.overhead,
      settlementEntries: bootstrap.settlementEntries,
    },
    filter
  );
}

export async function buildMonthlyFinancialXlsx(
  bootstrap: AdminBootstrapPayload,
  filter: MonthlyFinancialFilter
): Promise<Buffer> {
  const report = computeMonthlyFinancialReportData(bootstrap, filter);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SUNVILOZ Clean Care';
  wb.created = new Date();

  const supervisorName = filter.supervisorId
    ? bootstrap.supervisors.find((s) => s.id === filter.supervisorId)?.name || filter.supervisorId
    : 'All';

  // Sheet 1: Executive Summary
  const summary = wb.addWorksheet('Summary');
  summary.addRow(['SUNVILOZ Clean Care — Monthly Jobs & Income Report']);
  summary.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF0B1F3A' } };
  summary.addRow([
    `Period: ${formatEnDateShort(filter.dateFrom)} to ${formatEnDateShort(filter.dateTo)} (Asia/Dhaka)`,
  ]);
  summary.addRow([
    `Filters: Area=${filter.area || 'All'} | Service=${filter.service || 'All'} | Supervisor=${supervisorName}`,
  ]);
  summary.addRow([]);

  const h1 = summary.addRow(['Metric', 'Date Basis / Scope', 'Amount / Count']);
  styleHeaderRow(h1);
  summary.addRow(['Completed Jobs', 'Job Completion Date', report.totals.completedJobsCount]);
  summary.addRow([
    'No-Charge Return Visits',
    'Job Completion Date',
    report.totals.noChargeReturnVisitsCount,
  ]);
  summary.addRow([
    'Income Collected (BDT)',
    'Collection Date (Recorded once at completion; receipts add 0)',
    report.totals.totalIncomeCollected,
  ]);
  summary.addRow([
    'Completed Job Bills (BDT)',
    'Job Completion Date',
    report.totals.totalCompletedJobBills,
  ]);
  summary.addRow([
    'Actual Job Costs (BDT)',
    'Job Completion Date (Transport, meals, other, confirmed worker pay once, period return visits)',
    report.totals.totalActualJobCosts,
  ]);
  const jobProfitRow = summary.addRow([
    'Job Profit / Loss (BDT)',
    'Completed Job Bills - Actual Job Costs',
    report.totals.totalJobProfit,
  ]);
  styleTotalRow(jobProfitRow);

  summary.addRow([]);
  if (report.hasJobFilter) {
    summary.addRow([
      'General Business Expenses (Company-Wide — Unfiltered) (BDT)',
      'Expense Date (Not filtered by Area/Service/Supervisor)',
      report.totals.totalGeneralBusinessExpenses,
    ]);
    summary.addRow([
      'Net Business Profit (BDT)',
      'Company-wide only (Clear Area/Service/Supervisor filters to view)',
      'Unfiltered view only',
    ]);
  } else {
    summary.addRow([
      'General Business Expenses (BDT)',
      'Expense Date (Company-Wide)',
      report.totals.totalGeneralBusinessExpenses,
    ]);
    const netRow = summary.addRow([
      'Net Business Profit (BDT)',
      'Job Profit / Loss - General Business Expenses',
      report.totals.netBusinessProfit ?? 0,
    ]);
    styleTotalRow(netRow);
  }

  summary.addRow([]);
  const sHead = summary.addRow([
    'Supervisor Settlements (Excluded from Income & Job Costs)',
    'Date Basis',
    'Amount / Count',
  ]);
  styleHeaderRow(sHead);
  summary.addRow([
    'Supervisor Deposits Received (BDT)',
    'Actual Settlement Date',
    report.totals.totalDepositsReceived,
  ]);
  summary.addRow([
    'Supervisor Reimbursements Paid (BDT)',
    'Actual Settlement Date',
    report.totals.totalReimbursementsPaid,
  ]);
  summary.addRow([
    'Pending Settlements (Orders Count)',
    'Period Completed Jobs with Unsettled Balance',
    report.totals.pendingSettlementsCount,
  ]);
  summary.addRow([
    'Pending Settlements Remaining (BDT)',
    'Period Completed Jobs with Unsettled Balance',
    report.totals.pendingSettlementsRemaining,
  ]);
  autoFitColumns(summary);

  // Sheet 2: Completed Jobs & No-Charge Return Visits (Matches On-Screen Job List Row-for-Row)
  const jobsSheet = wb.addWorksheet('Completed Jobs');
  const jHeader = jobsSheet.addRow([
    'Order ID',
    'Type',
    'Customer',
    'Area',
    'Completion Date',
    'Service',
    'Supervisor',
    'Bill (BDT)',
    'Transport (BDT)',
    'Meals (BDT)',
    'Other Expenses (BDT)',
    'Confirmed Worker Pay (BDT)',
    'Cost (BDT)',
    'Profit / Loss (BDT)',
    'Collection Date',
    'Income Collected (BDT)',
    'Expected Settlement (BDT)',
    'Actual Settled (BDT)',
    'Remaining Settlement (BDT)',
    'Settlement Status',
  ]);
  styleHeaderRow(jHeader);

  for (const row of report.orderRows) {
    const o = row.order;
    jobsSheet.addRow([
      o.order_id,
      o.is_no_charge_visit ? `No-Charge Return Visit (${o.parent_order_id})` : 'Completed Job',
      o.customer_name,
      o.area,
      o.completion_date,
      row.service_label,
      o.assigned_supervisor_name || 'Unassigned',
      row.period_revenue_bdt,
      o.transport_cost,
      o.meals_cost,
      o.other_expenses_total,
      o.worker_pay_total,
      row.period_cost_bdt,
      row.period_profit_or_loss_bdt,
      row.collection_date || '—',
      row.collected_amount_bdt,
      o.supervisor_settlement,
      o.settlement_actual_total,
      o.settlement_remaining,
      o.settlement_status,
    ]);
  }
  const jTotal = jobsSheet.addRow([
    'TOTAL',
    `${report.orderRows.length} Records`,
    '',
    '',
    '',
    '',
    '',
    report.totals.totalCompletedJobBills,
    report.matchingCompletedOrders.reduce((s, o) => s + o.transport_cost, 0),
    report.matchingCompletedOrders.reduce((s, o) => s + o.meals_cost, 0),
    report.matchingCompletedOrders.reduce((s, o) => s + o.other_expenses_total, 0),
    report.matchingCompletedOrders.reduce((s, o) => s + o.worker_pay_total, 0),
    report.totals.totalActualJobCosts,
    report.totals.totalJobProfit,
    '',
    report.orderRows.reduce((s, r) => s + r.collected_amount_bdt, 0),
    report.totals.expectedSettlementForPeriodJobs,
    report.totals.actualSettledForPeriodJobs,
    report.totals.remainingSettlementForPeriodJobs,
    '',
  ]);
  styleTotalRow(jTotal);
  autoFitColumns(jobsSheet);

  // Sheet 3: Income Collected (By Collection Date)
  const colSheet = wb.addWorksheet('Income Collected');
  const cHeader = colSheet.addRow([
    'Order ID',
    'Collection Date',
    'Completion Date',
    'Customer',
    'Area',
    'Service',
    'Supervisor',
    'Collected By',
    'Receipt ID (Reference Only)',
    'Income Collected (BDT)',
  ]);
  styleHeaderRow(cHeader);
  for (const col of report.matchingCollections) {
    colSheet.addRow([
      col.order.order_id,
      col.collection_date,
      col.order.completion_date,
      col.order.customer_name,
      col.order.area,
      col.service_label,
      col.order.assigned_supervisor_name || 'Unassigned',
      col.collected_by_name,
      col.receipt_id || '—',
      col.collected_amount_bdt,
    ]);
  }
  const cTotal = colSheet.addRow([
    'TOTAL',
    `${report.matchingCollections.length} Confirmed Collections`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    report.totals.totalIncomeCollected,
  ]);
  styleTotalRow(cTotal);
  autoFitColumns(colSheet);

  // Sheet 4: Supervisor Cash Settlements (by Actual Settlement Date)
  const settSheet = wb.addWorksheet('Supervisor Settlements');
  const sHeader = settSheet.addRow([
    'Entry ID',
    'Actual Settlement Date',
    'Order ID',
    'Supervisor',
    'Type',
    'Amount (BDT)',
    'Payment Method',
    'Reference',
    'Note',
    'Recorded By',
  ]);
  styleHeaderRow(sHeader);
  for (const e of report.matchingSettlementEntries) {
    settSheet.addRow([
      e.entry_id,
      e.entry_datetime,
      e.order_id,
      e.supervisor_name,
      e.entry_type === 'deposit_received' ? 'Deposit Received' : 'Reimbursement Paid',
      e.amount_bdt,
      e.payment_method,
      e.reference,
      e.note,
      e.recorded_by,
    ]);
  }
  autoFitColumns(settSheet);

  // Sheet 5: Pending Settlements (Period Completed Jobs with Unsettled Balance)
  const pendSheet = wb.addWorksheet('Pending Settlements');
  const pHeader = pendSheet.addRow([
    'Order ID',
    'Completion Date',
    'Customer',
    'Supervisor',
    'Expected Settlement (BDT)',
    'Amount Settled (BDT)',
    'Remaining Amount (BDT)',
    'Direction',
  ]);
  styleHeaderRow(pHeader);
  for (const o of report.pendingSettlementOrders) {
    pendSheet.addRow([
      o.order_id,
      o.completion_date,
      o.customer_name,
      o.assigned_supervisor_name || 'Unassigned',
      o.supervisor_settlement,
      o.settlement_actual_total,
      o.settlement_remaining,
      o.supervisor_settlement > 0
        ? 'Admin to Receive Deposit'
        : 'Admin to Pay Reimbursement',
    ]);
  }
  const pTotal = pendSheet.addRow([
    'TOTAL',
    `${report.pendingSettlementOrders.length} Pending`,
    '',
    '',
    report.pendingSettlementOrders.reduce((s, o) => s + o.supervisor_settlement, 0),
    report.pendingSettlementOrders.reduce((s, o) => s + o.settlement_actual_total, 0),
    report.totals.pendingSettlementsRemaining,
    '',
  ]);
  styleTotalRow(pTotal);
  autoFitColumns(pendSheet);

  // Sheet 6: General Business Expenses (Company-Wide)
  const expSheet = wb.addWorksheet('General Business Expenses');
  const eHeader = expSheet.addRow(['Date', 'Category', 'Notes / Description', 'Amount (BDT)', 'Recorded By']);
  styleHeaderRow(eHeader);
  for (const ex of report.matchingGeneralExpenses) {
    expSheet.addRow([ex.expense_date, ex.category, ex.description, ex.amount_bdt, ex.created_by]);
  }
  const eTotal = expSheet.addRow([
    'TOTAL',
    '',
    '',
    report.totals.totalGeneralBusinessExpenses,
    '',
  ]);
  styleTotalRow(eTotal);
  autoFitColumns(expSheet);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildMonthlyTeamXlsx(
  bootstrap: AdminBootstrapPayload,
  filter: { month: string; supervisorId?: string; workerId?: string }
): Promise<Buffer> {
  const { month, supervisorId = '', workerId = '' } = filter;
  const completedInMonth = bootstrap.orders.filter(
    (o) => o.status === 'Completed' && o.completion_date.startsWith(month)
  );

  const supMap = new Map<
    string,
    { id: string; name: string; completedJobs: number; noChargeVisits: number; orderIds: Set<string> }
  >();
  for (const s of bootstrap.supervisors) {
    supMap.set(s.id, {
      id: s.id,
      name: s.name,
      completedJobs: 0,
      noChargeVisits: 0,
      orderIds: new Set(),
    });
  }

  const workerMap = new Map<
    string,
    { id: string; name: string; participations: number; noChargeVisits: number; orderIds: Set<string> }
  >();
  for (const w of bootstrap.workers) {
    workerMap.set(w.worker_id, {
      id: w.worker_id,
      name: w.name,
      participations: 0,
      noChargeVisits: 0,
      orderIds: new Set(),
    });
  }

  const distinctOrderIds = new Set<string>();
  const distinctNoChargeIds = new Set<string>();

  for (const o of completedInMonth) {
    const matchesSup = !supervisorId || o.assigned_supervisor_id === supervisorId || o.completed_by_user_id === supervisorId;
    const matchesWorker =
      !workerId || o.assigned_workers.some((w) => w.worker_id === workerId && w.confirmed_worked);
    if (!matchesSup || !matchesWorker) continue;

    if (o.is_no_charge_visit) {
      distinctNoChargeIds.add(o.order_id);
    } else {
      distinctOrderIds.add(o.order_id);
    }

    const effSupId = o.assigned_supervisor_id || o.completed_by_user_id || 'unassigned';
    const effSupName = o.assigned_supervisor_name || o.completed_by_name || 'Admin / Unassigned';
    if (!supMap.has(effSupId)) {
      supMap.set(effSupId, {
        id: effSupId,
        name: effSupName,
        completedJobs: 0,
        noChargeVisits: 0,
        orderIds: new Set(),
      });
    }
    const supEntry = supMap.get(effSupId)!;
    if (!supEntry.orderIds.has(o.order_id)) {
      supEntry.orderIds.add(o.order_id);
      if (o.is_no_charge_visit) supEntry.noChargeVisits += 1;
      else supEntry.completedJobs += 1;
    }

    for (const ow of o.assigned_workers) {
      if (!ow.confirmed_worked) continue;
      if (!workerMap.has(ow.worker_id)) {
        workerMap.set(ow.worker_id, {
          id: ow.worker_id,
          name: ow.worker_name,
          participations: 0,
          noChargeVisits: 0,
          orderIds: new Set(),
        });
      }
      const wEntry = workerMap.get(ow.worker_id)!;
      if (!wEntry.orderIds.has(o.order_id)) {
        wEntry.orderIds.add(o.order_id);
        if (o.is_no_charge_visit) wEntry.noChargeVisits += 1;
        else wEntry.participations += 1;
      }
    }
  }

  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Supervisor Performance');
  s1.addRow([`SUNVILOZ Clean Care — Monthly Team Report (${month})`]);
  s1.getRow(1).font = { bold: true, size: 13 };
  s1.addRow([
    `Distinct Completed Jobs: ${distinctOrderIds.size} | Distinct No-Charge Return Visits: ${distinctNoChargeIds.size}`,
  ]);
  s1.addRow([]);
  const h1 = s1.addRow(['Supervisor', 'Completed Jobs', 'No-Charge Return Visits', 'Order IDs']);
  styleHeaderRow(h1);
  for (const s of supMap.values()) {
    if (supervisorId && s.id !== supervisorId) continue;
    if (s.completedJobs === 0 && s.noChargeVisits === 0) continue;
    s1.addRow([s.name, s.completedJobs, s.noChargeVisits, Array.from(s.orderIds).join(', ')]);
  }
  const t1 = s1.addRow(['OVERALL DISTINCT TOTAL', distinctOrderIds.size, distinctNoChargeIds.size, '']);
  styleTotalRow(t1);
  autoFitColumns(s1);

  const s2 = wb.addWorksheet('Worker Participation');
  const h2 = s2.addRow(['Worker', 'Confirmed Completed Jobs', 'No-Charge Return Visits', 'Order IDs']);
  styleHeaderRow(h2);
  for (const w of workerMap.values()) {
    if (workerId && w.id !== workerId) continue;
    if (w.participations === 0 && w.noChargeVisits === 0) continue;
    s2.addRow([w.name, w.participations, w.noChargeVisits, Array.from(w.orderIds).join(', ')]);
  }
  const t2 = s2.addRow(['OVERALL DISTINCT JOBS', distinctOrderIds.size, distinctNoChargeIds.size, '']);
  styleTotalRow(t2);
  autoFitColumns(s2);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildMonthlyWorkerPaymentsXlsx(
  bootstrap: AdminBootstrapPayload,
  filter: { month: string; workerId?: string }
): Promise<Buffer> {
  const { month, workerId = '' } = filter;
  const monthEndDate = `${month}-31`;

  const workerSummary = new Map<
    string,
    {
      worker_id: string;
      name: string;
      completedJobs: number;
      earnedThisMonth: number;
      paidThisMonth: number;
      unpaidAtMonthEnd: number;
    }
  >();

  for (const w of bootstrap.workers) {
    if (workerId && w.worker_id !== workerId) continue;
    workerSummary.set(w.worker_id, {
      worker_id: w.worker_id,
      name: w.name,
      completedJobs: 0,
      earnedThisMonth: 0,
      paidThisMonth: 0,
      unpaidAtMonthEnd: 0,
    });
  }

  const detailRows: Array<Array<string | number>> = [];

  for (const o of bootstrap.orders) {
    if (o.status !== 'Completed' || !o.completion_date) continue;
    for (const ow of o.assigned_workers) {
      if (!ow.confirmed_worked) continue;
      if (workerId && ow.worker_id !== workerId) continue;

      if (!workerSummary.has(ow.worker_id)) {
        workerSummary.set(ow.worker_id, {
          worker_id: ow.worker_id,
          name: ow.worker_name,
          completedJobs: 0,
          earnedThisMonth: 0,
          paidThisMonth: 0,
          unpaidAtMonthEnd: 0,
        });
      }
      const entry = workerSummary.get(ow.worker_id)!;

      const completedThisMonth = o.completion_date.startsWith(month);
      const completedUpToMonthEnd = o.completion_date <= monthEndDate;
      const paidThisMonth = ow.payment_status === 'Paid' && ow.payment_date.startsWith(month);
      const paidUpToMonthEnd =
        ow.payment_status === 'Paid' && Boolean(ow.payment_date) && ow.payment_date <= monthEndDate;

      if (completedThisMonth) {
        entry.completedJobs += 1;
        entry.earnedThisMonth += ow.agreed_pay_bdt;
      }
      if (paidThisMonth) {
        entry.paidThisMonth += ow.paid_amount_bdt || ow.agreed_pay_bdt;
      }
      if (completedUpToMonthEnd && !paidUpToMonthEnd) {
        entry.unpaidAtMonthEnd += ow.agreed_pay_bdt;
      }

      if (completedThisMonth || paidThisMonth || (completedUpToMonthEnd && !paidUpToMonthEnd)) {
        detailRows.push([
          ow.worker_name,
          o.order_id,
          o.completion_date,
          o.customer_name,
          ow.agreed_pay_bdt,
          ow.payment_status,
          ow.payment_status === 'Paid' ? ow.paid_amount_bdt : 0,
          ow.payment_date || '—',
          ow.payment_method || '—',
          ow.paid_by_role === 'supervisor'
            ? 'Supervisor (Job Cash)'
            : ow.paid_by_role === 'admin'
            ? 'Admin (Direct)'
            : '—',
          ow.payment_reference || '',
        ]);
      }
    }
  }

  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Monthly Worker Payments');
  s1.addRow([`SUNVILOZ Clean Care — Monthly Worker Payments (${month})`]);
  s1.getRow(1).font = { bold: true, size: 13 };
  s1.addRow(['Earnings basis: Job Completion Date | Paid This Month basis: Actual Payment Date']);
  s1.addRow([]);

  const h1 = s1.addRow([
    'Worker',
    'Completed Jobs',
    'Earned This Month (BDT)',
    'Paid This Month (BDT)',
    'Unpaid at Month End (BDT)',
  ]);
  styleHeaderRow(h1);

  let totJobs = 0;
  let totEarned = 0;
  let totPaid = 0;
  let totUnpaid = 0;
  for (const r of workerSummary.values()) {
    totJobs += r.completedJobs;
    totEarned += r.earnedThisMonth;
    totPaid += r.paidThisMonth;
    totUnpaid += r.unpaidAtMonthEnd;
    s1.addRow([r.name, r.completedJobs, r.earnedThisMonth, r.paidThisMonth, r.unpaidAtMonthEnd]);
  }
  const t1 = s1.addRow(['TOTAL', totJobs, totEarned, totPaid, totUnpaid]);
  styleTotalRow(t1);
  autoFitColumns(s1);

  const s2 = wb.addWorksheet('Supporting Job & Payment Ledger');
  const h2 = s2.addRow([
    'Worker',
    'Order ID',
    'Completion Date',
    'Customer',
    'Pay for This Job (BDT)',
    'Status',
    'Paid Amount (BDT)',
    'Payment Date',
    'Method',
    'Paid By',
    'Reference',
  ]);
  styleHeaderRow(h2);
  for (const row of detailRows) s2.addRow(row);
  autoFitColumns(s2);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildLeadSourceXlsx(
  bootstrap: AdminBootstrapPayload,
  filter: { dateFrom: string; dateTo: string }
): Promise<Buffer> {
  const { dateFrom, dateTo } = filter;
  const sources = [
    'Facebook',
    'Google',
    'Existing Customer',
    'Agent Referral',
    'Caretaker Referral',
    'Other',
    'Not Specified',
  ];

  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Lead Source & Conversion');
  s1.addRow([`SUNVILOZ Clean Care — Lead Source & Conversion Report (${dateFrom} to ${dateTo})`]);
  s1.getRow(1).font = { bold: true, size: 13 };
  s1.addRow([
    'Conversion counts unique prospects added in period who booked by period end; Confirmed Orders counted by booking date.',
  ]);
  s1.addRow([]);

  const h1 = s1.addRow([
    'Lead Source',
    'New Prospects',
    'Prospects Converted to Confirmed Bookings',
    'Conversion Rate (%)',
    'Confirmed Orders (by Booking Date)',
  ]);
  styleHeaderRow(h1);

  const orderById = new Map(bootstrap.orders.map((o) => [o.order_id, o]));
  let totalProspects = 0;
  let totalConverted = 0;
  let totalOrders = 0;

  for (const src of sources) {
    const newLeads = bootstrap.leads.filter((l) => {
      const createdDate = (l.created_at || '').slice(0, 10);
      return normalizeLeadSource(l.lead_source) === src && createdDate >= dateFrom && createdDate <= dateTo;
    });

    const convertedLeads = newLeads.filter((l) => {
      const linkedOrders = bootstrap.orders.filter(
        (o) =>
          (o.lead_id === l.lead_id || (l.linked_order_id && o.order_id === l.linked_order_id)) &&
          o.status !== 'Cancelled' &&
          !o.is_no_charge_visit &&
          (o.booking_date || o.created_at.slice(0, 10)) <= dateTo
      );
      if (linkedOrders.length > 0) return true;
      if (l.linked_order_id) {
        const lo = orderById.get(l.linked_order_id);
        if (lo && lo.status !== 'Cancelled' && (lo.booking_date || lo.created_at.slice(0, 10)) <= dateTo) {
          return true;
        }
      }
      return false;
    });

    const confirmedOrders = bootstrap.orders.filter((o) => {
      const bDate = o.booking_date || o.created_at.slice(0, 10);
      return (
        !o.is_no_charge_visit &&
        o.status !== 'Cancelled' &&
        normalizeLeadSource(o.lead_source) === src &&
        bDate >= dateFrom &&
        bDate <= dateTo
      );
    });

    const rate = newLeads.length > 0 ? Number(((convertedLeads.length / newLeads.length) * 100).toFixed(1)) : 0;
    totalProspects += newLeads.length;
    totalConverted += convertedLeads.length;
    totalOrders += confirmedOrders.length;

    s1.addRow([src, newLeads.length, convertedLeads.length, `${rate}%`, confirmedOrders.length]);
  }

  const totalRate = totalProspects > 0 ? Number(((totalConverted / totalProspects) * 100).toFixed(1)) : 0;
  const t1 = s1.addRow(['TOTAL', totalProspects, totalConverted, `${totalRate}%`, totalOrders]);
  styleTotalRow(t1);
  autoFitColumns(s1);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
