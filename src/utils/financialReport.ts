import type {
  OrderRecord,
  OverheadExpenseRecord,
  SupervisorSettlementEntry,
} from '../types/order.ts';
import { translateServiceToEnglish } from './dateAndPhone.ts';
import { isSettlementPending } from './orderPredicates.ts';

export interface MonthlyFinancialFilter {
  dateFrom: string;
  dateTo: string;
  area?: string;
  service?: string;
  supervisorId?: string;
}

export interface MonthlyFinancialOrderRow {
  order: OrderRecord;
  service_label: string;
  collection_date: string;
  collected_amount_bdt: number;
  period_revenue_bdt: number;
  period_cost_bdt: number;
  period_profit_or_loss_bdt: number;
}

export interface MonthlyIncomeCollectionRow {
  order: OrderRecord;
  service_label: string;
  collection_date: string;
  collected_amount_bdt: number;
  collected_by_name: string;
  receipt_id: string;
}

export interface MonthlyFinancialReportResult {
  filter: MonthlyFinancialFilter;
  hasJobFilter: boolean;
  matchingCompletedOrders: OrderRecord[];
  orderRows: MonthlyFinancialOrderRow[];
  billableCompletedJobs: OrderRecord[];
  billableOrderRows: MonthlyFinancialOrderRow[];
  noChargeReturnVisits: OrderRecord[];
  noChargeOrderRows: MonthlyFinancialOrderRow[];
  matchingCollections: MonthlyIncomeCollectionRow[];
  matchingSettlementEntries: SupervisorSettlementEntry[];
  depositSettlementEntries: SupervisorSettlementEntry[];
  reimbursementSettlementEntries: SupervisorSettlementEntry[];
  pendingSettlementOrders: OrderRecord[];
  matchingGeneralExpenses: OverheadExpenseRecord[];
  totals: {
    completedJobsCount: number;
    noChargeReturnVisitsCount: number;
    totalRecordsCount: number;
    collectionsCount: number;
    totalIncomeCollected: number;
    totalCompletedJobBills: number;
    /** Alias preserved for backward compatibility with existing callers/tests */
    totalFullJobBills: number;
    totalActualJobCosts: number;
    totalJobProfit: number;
    totalGeneralBusinessExpenses: number;
    /** Company-wide Net Business Profit (null when an area/service/supervisor filter is active) */
    netBusinessProfit: number | null;
    /** Unfiltered company-wide Net Business Profit reference value */
    companyWideNetBusinessProfit: number | null;
    totalDepositsReceived: number;
    totalReimbursementsPaid: number;
    pendingSettlementsCount: number;
    pendingSettlementsRemaining: number;
    pendingDepositsCount: number;
    pendingDepositsRemaining: number;
    pendingReimbursementsCount: number;
    pendingReimbursementsRemaining: number;
    expectedSettlementForPeriodJobs: number;
    actualSettledForPeriodJobs: number;
    remainingSettlementForPeriodJobs: number;
  };
}

/**
 * Computes exact Asia/Dhaka YYYY-MM-01 to YYYY-MM-DD (actual last day of month) bounds.
 */
export function getMonthDateBounds(year: number, month1To12: number): {
  monthKey: string;
  dateFrom: string;
  dateTo: string;
} {
  const safeYear = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : 2026;
  const safeMonth =
    Number.isInteger(month1To12) && month1To12 >= 1 && month1To12 <= 12 ? month1To12 : 1;
  const mm = String(safeMonth).padStart(2, '0');
  const lastDay = new Date(Date.UTC(safeYear, safeMonth, 0)).getUTCDate();
  const monthKey = `${safeYear}-${mm}`;
  return {
    monthKey,
    dateFrom: `${monthKey}-01`,
    dateTo: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Resolves the single confirmed collection date (YYYY-MM-DD, Asia/Dhaka) for a billable completed order.
 * - No-charge return visits never produce a collection date or income.
 * - Issuing or reprinting a Money Receipt never creates an additional collection record.
 */
export function getOrderCollectionDate(order: OrderRecord): string {
  if (order.status !== 'Completed' || order.is_no_charge_visit || !order.full_bill_collected) {
    return '';
  }
  const rawCollected = String(order.payment_collected_at || '').trim();
  const match = rawCollected.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  return String(order.completion_date || '').trim();
}

/**
 * Single shared calculation for BOTH the on-screen "Reports → Monthly Jobs & Income" view
 * and the Excel (.xlsx) export so rows and totals are guaranteed 100% identical.
 *
 * Rules enforced:
 * - Completed jobs and Completed Job Bills are counted by actual completion_date.
 * - Confirmed collections (Income Collected) are counted once by collection date
 *   (from the single full-bill-at-completion collection record; receipt issuance/reprinting
 *   never adds income; no customer dues).
 * - Completed no-charge return visits contribute BDT 0 revenue / BDT 0 income and their
 *   actual_expenses are attributed once to the return visit's completion_date month.
 * - Actual Job Costs include transport, meals, other job expenses, and confirmed worker pay
 *   counted ONCE (marking a worker paid never adds a second expense).
 * - Job Profit / Loss = Completed Job Bills − Actual Job Costs.
 * - Net Business Profit = Job Profit / Loss − General Business Expenses (shown ONLY in the
 *   unfiltered company-wide view; null when area/service/supervisor filters are active).
 * - Supervisor advances, deposits received, reimbursements paid, and pending settlements are
 *   strictly excluded from income and job costs and reported separately.
 */
export function computeMonthlyFinancialReport(
  data: {
    orders: OrderRecord[];
    overhead: OverheadExpenseRecord[];
    settlementEntries: SupervisorSettlementEntry[];
  },
  filter: MonthlyFinancialFilter
): MonthlyFinancialReportResult {
  const dateFrom = String(filter.dateFrom || '').trim();
  const dateTo = String(filter.dateTo || '').trim();
  const area = String(filter.area || '').trim().toLowerCase();
  const service = String(filter.service || '').trim().toLowerCase();
  const supervisorId = String(filter.supervisorId || '').trim();
  const hasJobFilter = Boolean(area || service || supervisorId);

  const matchesOrderFilters = (o: OrderRecord): boolean => {
    if (area && o.area.trim().toLowerCase() !== area) return false;
    if (service) {
      const hasMatch =
        (o.services || []).some(
          (s) => translateServiceToEnglish(s).trim().toLowerCase() === service
        ) || translateServiceToEnglish(o.services_text || '').toLowerCase().includes(service);
      if (!hasMatch) return false;
    }
    if (supervisorId && o.assigned_supervisor_id !== supervisorId) return false;
    return true;
  };

  // 1) Completed Jobs & No-Charge Return Visits by actual completion_date
  const matchingCompletedOrders = (data.orders || [])
    .filter((o) => {
      if (o.status !== 'Completed') return false;
      const compDate = o.completion_date || '';
      if (!compDate || compDate < dateFrom || compDate > dateTo) return false;
      return matchesOrderFilters(o);
    })
    .sort((a, b) => {
      const cmp = (b.completion_date || '').localeCompare(a.completion_date || '');
      return cmp !== 0 ? cmp : b.order_id.localeCompare(a.order_id);
    });

  const billableCompletedJobs = matchingCompletedOrders.filter((o) => !o.is_no_charge_visit);
  const noChargeReturnVisits = matchingCompletedOrders.filter((o) => o.is_no_charge_visit);

  const orderRows: MonthlyFinancialOrderRow[] = matchingCompletedOrders.map((order) => {
    const periodRevenue = order.is_no_charge_visit ? 0 : Math.max(0, Number(order.price_bdt) || 0);
    const periodCost = Math.max(0, Number(order.actual_expenses) || 0);
    const collectionDate = getOrderCollectionDate(order);
    const collectedAmount =
      !order.is_no_charge_visit && order.full_bill_collected ? periodRevenue : 0;
    return {
      order,
      service_label: translateServiceToEnglish(order.services_text || '') || '—',
      collection_date: collectionDate,
      collected_amount_bdt: collectedAmount,
      period_revenue_bdt: periodRevenue,
      period_cost_bdt: periodCost,
      period_profit_or_loss_bdt: periodRevenue - periodCost,
    };
  });

  const billableOrderRows = orderRows.filter((r) => !r.order.is_no_charge_visit);
  const noChargeOrderRows = orderRows.filter((r) => r.order.is_no_charge_visit);

  const totalCompletedJobBills = orderRows.reduce((s, r) => s + r.period_revenue_bdt, 0);
  const totalActualJobCosts = orderRows.reduce((s, r) => s + r.period_cost_bdt, 0);
  const totalJobProfit = totalCompletedJobBills - totalActualJobCosts;

  // 2) Confirmed Income Collected by collection date (recorded once per billable completed job)
  const matchingCollections: MonthlyIncomeCollectionRow[] = (data.orders || [])
    .filter((o) => {
      if (o.status !== 'Completed' || o.is_no_charge_visit || !o.full_bill_collected) return false;
      const colDate = getOrderCollectionDate(o);
      if (!colDate || colDate < dateFrom || colDate > dateTo) return false;
      return matchesOrderFilters(o);
    })
    .map((order) => ({
      order,
      service_label: translateServiceToEnglish(order.services_text || '') || '—',
      collection_date: getOrderCollectionDate(order),
      collected_amount_bdt: Math.max(0, Number(order.price_bdt) || 0),
      collected_by_name: order.collected_by_name || order.completed_by_name || '—',
      receipt_id: order.receipt_id || '',
    }))
    .sort((a, b) => {
      const cmp = b.collection_date.localeCompare(a.collection_date);
      return cmp !== 0 ? cmp : b.order.order_id.localeCompare(a.order.order_id);
    });

  const totalIncomeCollected = matchingCollections.reduce((s, r) => s + r.collected_amount_bdt, 0);

  // 3) Separate Supervisor Settlement Cash Flow (by actual settlement date) & Pending Settlements
  const orderMap = new Map((data.orders || []).map((o) => [o.order_id, o]));
  const matchingSettlementEntries = (data.settlementEntries || [])
    .filter((e) => {
      const entryDate = String(e.entry_date || e.entry_datetime || '').slice(0, 10);
      if (!entryDate || entryDate < dateFrom || entryDate > dateTo) return false;
      if (supervisorId && e.supervisor_id !== supervisorId) return false;
      const ord = orderMap.get(e.order_id);
      if (ord) {
        if (area && ord.area.trim().toLowerCase() !== area) return false;
        if (service) {
          const hasMatch =
            (ord.services || []).some(
              (s) => translateServiceToEnglish(s).trim().toLowerCase() === service
            ) || translateServiceToEnglish(ord.services_text || '').toLowerCase().includes(service);
          if (!hasMatch) return false;
        }
      }
      return true;
    })
    .sort((a, b) => (b.entry_datetime || b.entry_date || '').localeCompare(a.entry_datetime || a.entry_date || ''));

  const depositSettlementEntries = matchingSettlementEntries.filter(
    (e) => e.entry_type === 'deposit_received'
  );
  const reimbursementSettlementEntries = matchingSettlementEntries.filter(
    (e) => e.entry_type === 'reimbursement_paid'
  );
  const totalDepositsReceived = depositSettlementEntries.reduce(
    (s, e) => s + (Number(e.amount_bdt) || 0),
    0
  );
  const totalReimbursementsPaid = reimbursementSettlementEntries.reduce(
    (s, e) => s + (Number(e.amount_bdt) || 0),
    0
  );

  const pendingSettlementOrders = matchingCompletedOrders.filter((o) => isSettlementPending(o));
  const pendingDepositsOrders = pendingSettlementOrders.filter((o) => o.supervisor_settlement > 0);
  const pendingReimbursementsOrders = pendingSettlementOrders.filter(
    (o) => o.supervisor_settlement < 0
  );
  const pendingDepositsRemaining = pendingDepositsOrders.reduce(
    (s, o) => s + (Number(o.settlement_remaining) || 0),
    0
  );
  const pendingReimbursementsRemaining = pendingReimbursementsOrders.reduce(
    (s, o) => s + (Number(o.settlement_remaining) || 0),
    0
  );
  const pendingSettlementsRemaining = pendingSettlementOrders.reduce(
    (s, o) => s + (Number(o.settlement_remaining) || 0),
    0
  );

  // 4) Company-Wide General Business Expenses in period (unfiltered by area/service/supervisor)
  const matchingGeneralExpenses = (data.overhead || [])
    .filter((e) => e.expense_date >= dateFrom && e.expense_date <= dateTo)
    .sort((a, b) => b.expense_date.localeCompare(a.expense_date));

  const totalGeneralBusinessExpenses = matchingGeneralExpenses.reduce(
    (s, e) => s + (Number(e.amount_bdt) || 0),
    0
  );

  // Company-wide Net Business Profit is ONLY valid and displayed when no job filter is active
  const netBusinessProfit = hasJobFilter
    ? null
    : totalJobProfit - totalGeneralBusinessExpenses;

  return {
    filter: { dateFrom, dateTo, area: filter.area, service: filter.service, supervisorId },
    hasJobFilter,
    matchingCompletedOrders,
    orderRows,
    billableCompletedJobs,
    billableOrderRows,
    noChargeReturnVisits,
    noChargeOrderRows,
    matchingCollections,
    matchingSettlementEntries,
    depositSettlementEntries,
    reimbursementSettlementEntries,
    pendingSettlementOrders,
    matchingGeneralExpenses,
    totals: {
      completedJobsCount: billableCompletedJobs.length,
      noChargeReturnVisitsCount: noChargeReturnVisits.length,
      totalRecordsCount: matchingCompletedOrders.length,
      collectionsCount: matchingCollections.length,
      totalIncomeCollected,
      totalCompletedJobBills,
      totalFullJobBills: totalCompletedJobBills,
      totalActualJobCosts,
      totalJobProfit,
      totalGeneralBusinessExpenses,
      netBusinessProfit,
      companyWideNetBusinessProfit: netBusinessProfit,
      totalDepositsReceived,
      totalReimbursementsPaid,
      pendingSettlementsCount: pendingSettlementOrders.length,
      pendingSettlementsRemaining,
      pendingDepositsCount: pendingDepositsOrders.length,
      pendingDepositsRemaining,
      pendingReimbursementsCount: pendingReimbursementsOrders.length,
      pendingReimbursementsRemaining,
      expectedSettlementForPeriodJobs: matchingCompletedOrders.reduce(
        (s, o) => s + (Number(o.supervisor_settlement) || 0),
        0
      ),
      actualSettledForPeriodJobs: matchingCompletedOrders.reduce(
        (s, o) => s + (Number(o.settlement_actual_total) || 0),
        0
      ),
      remainingSettlementForPeriodJobs: matchingCompletedOrders.reduce(
        (s, o) => s + (Number(o.settlement_remaining) || 0),
        0
      ),
    },
  };
}
