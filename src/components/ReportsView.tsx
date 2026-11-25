import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  HardHat,
  Plus,
  Receipt,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  DEFAULT_SERVICES,
  GENERAL_EXPENSE_CATEGORIES,
  LEAD_SOURCES,
  LeadRecord,
  OrderRecord,
  OverheadExpenseRecord,
  SupervisorAccount,
  SupervisorSettlementEntry,
  WorkerPaymentHistoryRecord,
  WorkerRecord,
} from '../types/order';
import {
  formatBdt,
  formatDateEn,
  translateServiceToEnglish,
} from '../utils/dateAndPhone';
import {
  computeMonthlyFinancialReport,
  getMonthDateBounds,
} from '../utils/financialReport';
import { api } from '../services/apiClient';
import { StatusBadge } from './StatusBadge';

type ReportTab = 'financial' | 'expenses' | 'leads' | 'team' | 'worker_pay';

type FinancialSupportingKind =
  | 'completed_jobs'
  | 'no_charge_visits'
  | 'income_collected'
  | 'completed_job_bills'
  | 'actual_job_costs'
  | 'job_profit'
  | 'general_expenses'
  | 'net_profit'
  | 'deposits_received'
  | 'reimbursements_paid'
  | 'pending_settlements';

const MONTH_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

interface ReportsViewProps {
  todayDhaka: string;
  orders: OrderRecord[];
  leads: LeadRecord[];
  supervisors: SupervisorAccount[];
  workers: WorkerRecord[];
  overhead: OverheadExpenseRecord[];
  settlementEntries: SupervisorSettlementEntry[];
  workerPaymentHistory: WorkerPaymentHistoryRecord[];
  onCreateOverhead: (payload: {
    expense_date: string;
    category: string;
    description: string;
    amount_bdt: number | string;
  }) => Promise<void>;
  onDeleteOverhead: (id: string) => Promise<void>;
  onOpenOrder: (orderId: string) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  todayDhaka,
  orders,
  leads,
  supervisors,
  workers,
  overhead,
  settlementEntries,
  onCreateOverhead,
  onDeleteOverhead,
  onOpenOrder,
  onNotify,
}) => {
  const defaultMonth = todayDhaka.slice(0, 7);
  const defaultYearNum = Number(todayDhaka.slice(0, 4)) || 2026;
  const defaultMonthNum = Number(todayDhaka.slice(5, 7)) || 1;
  const defaultBounds = getMonthDateBounds(defaultYearNum, defaultMonthNum);

  const [activeTab, setActiveTab] = useState<ReportTab>('financial');
  const [exporting, setExporting] = useState(false);

  // Monthly Jobs & Income Filters (Default: current Asia/Dhaka month & year)
  const [finMode, setFinMode] = useState<'month' | 'custom'>('month');
  const [finYear, setFinYear] = useState<number>(defaultYearNum);
  const [finMonthNum, setFinMonthNum] = useState<number>(defaultMonthNum);
  const [finDateFrom, setFinDateFrom] = useState(defaultBounds.dateFrom);
  const [finDateTo, setFinDateTo] = useState(defaultBounds.dateTo);
  const [finArea, setFinArea] = useState('');
  const [finService, setFinService] = useState('');
  const [finSupId, setFinSupId] = useState('');
  const [finSupportingKind, setFinSupportingKind] = useState<FinancialSupportingKind | null>(null);

  // General Business Expenses Form
  const [expDate, setExpDate] = useState(todayDhaka);
  const [expCategory, setExpCategory] = useState<string>(GENERAL_EXPENSE_CATEGORIES[0]);
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [savingExp, setSavingExp] = useState(false);

  // Lead Source Filters
  const [leadFrom, setLeadFrom] = useState(`${defaultMonth}-01`);
  const [leadTo, setLeadTo] = useState(todayDhaka);

  // Team Report Filters
  const [teamMonth, setTeamMonth] = useState(defaultMonth);
  const [teamSupId, setTeamSupId] = useState('');
  const [teamWorkerId, setTeamWorkerId] = useState('');
  const [supportingModal, setSupportingModal] = useState<{
    title: string;
    subtitle: string;
    orders: OrderRecord[];
  } | null>(null);

  // Worker Payments Filters
  const [wpMonth, setWpMonth] = useState(defaultMonth);
  const [wpWorkerId, setWpWorkerId] = useState('');
  const [wpDetailWorkerId, setWpDetailWorkerId] = useState<string | null>(null);

  const selectedMonthBounds = useMemo(
    () => getMonthDateBounds(finYear, finMonthNum),
    [finYear, finMonthNum]
  );
  const effectiveFinFrom = finMode === 'month' ? selectedMonthBounds.dateFrom : finDateFrom;
  const effectiveFinTo = finMode === 'month' ? selectedMonthBounds.dateTo : finDateTo;

  const availableYears = useMemo(() => {
    const years = new Set<number>([
      defaultYearNum - 2,
      defaultYearNum - 1,
      defaultYearNum,
      defaultYearNum + 1,
    ]);
    orders.forEach((o) => {
      [o.completion_date, o.scheduled_date, String(o.payment_collected_at || '').slice(0, 10)].forEach(
        (d) => {
          const y = Number(String(d || '').slice(0, 4));
          if (Number.isInteger(y) && y >= 2020 && y <= 2100) years.add(y);
        }
      );
    });
    overhead.forEach((e) => {
      const y = Number(String(e.expense_date || '').slice(0, 4));
      if (Number.isInteger(y) && y >= 2020 && y <= 2100) years.add(y);
    });
    settlementEntries.forEach((e) => {
      const y = Number(String(e.entry_date || e.entry_datetime || '').slice(0, 4));
      if (Number.isInteger(y) && y >= 2020 && y <= 2100) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [defaultYearNum, orders, overhead, settlementEntries]);

  const uniqueAreas = useMemo(() => {
    const s = new Set<string>();
    orders.forEach((o) => {
      if (o.area.trim()) s.add(o.area.trim());
    });
    return Array.from(s).sort();
  }, [orders]);

  const uniqueServices = useMemo(() => {
    const legacy = new Set<string>();
    orders.forEach((o) => {
      o.services.forEach((srv) => {
        const clean = translateServiceToEnglish(srv).trim();
        if (clean && !DEFAULT_SERVICES.includes(clean)) {
          legacy.add(clean);
        }
      });
    });
    return [...DEFAULT_SERVICES, ...Array.from(legacy).sort()];
  }, [orders]);

  // --------------------------------------------------------------------------
  // 1. MONTHLY JOBS & INCOME REPORT DATA (SHARED WITH EXCEL .XLSX EXPORT)
  // --------------------------------------------------------------------------
  const financialReport = useMemo(
    () =>
      computeMonthlyFinancialReport(
        { orders, overhead, settlementEntries },
        {
          dateFrom: effectiveFinFrom,
          dateTo: effectiveFinTo,
          area: finArea,
          service: finService,
          supervisorId: finSupId,
        }
      ),
    [
      orders,
      overhead,
      settlementEntries,
      effectiveFinFrom,
      effectiveFinTo,
      finArea,
      finService,
      finSupId,
    ]
  );

  const selectedPeriodLabel = useMemo(() => {
    if (finMode === 'month') {
      const mLabel = MONTH_OPTIONS.find((m) => m.value === finMonthNum)?.label || String(finMonthNum);
      return `${mLabel} ${finYear}`;
    }
    return `${formatDateEn(effectiveFinFrom)} to ${formatDateEn(effectiveFinTo)}`;
  }, [finMode, finMonthNum, finYear, effectiveFinFrom, effectiveFinTo]);

  // --------------------------------------------------------------------------
  // 2. LEAD SOURCE & CONVERSION DATA
  // --------------------------------------------------------------------------
  const leadSourceData = useMemo(() => {
    const orderById = new Map(orders.map((o) => [o.order_id, o]));
    return LEAD_SOURCES.map((source) => {
      const newProspects = leads.filter((l) => {
        const created = String(l.created_at || '').slice(0, 10);
        return (
          (l.lead_source || 'Not Specified') === source &&
          created >= leadFrom &&
          created <= leadTo
        );
      });

      const convertedIds = new Set<string>();
      for (const l of newProspects) {
        const linked = l.linked_order_id ? orderById.get(l.linked_order_id) : undefined;
        const matchingByLead =
          linked ||
          orders.find(
            (o) =>
              o.lead_id === l.lead_id &&
              o.status !== 'Cancelled' &&
              !o.is_no_charge_visit
          );
        if (matchingByLead && matchingByLead.status !== 'Cancelled') {
          const bDate =
            matchingByLead.booking_date || String(matchingByLead.created_at || '').slice(0, 10);
          if (bDate <= leadTo) {
            convertedIds.add(l.lead_id);
          }
        }
      }

      const confirmedOrders = orders.filter((o) => {
        if (o.status === 'Cancelled' || o.is_no_charge_visit) return false;
        const bDate = o.booking_date || String(o.created_at || '').slice(0, 10);
        return (
          (o.lead_source || 'Not Specified') === source && bDate >= leadFrom && bDate <= leadTo
        );
      });

      const convPct =
        newProspects.length > 0
          ? Math.round((convertedIds.size / newProspects.length) * 1000) / 10
          : 0;

      return {
        source,
        newProspects: newProspects.length,
        convertedProspects: convertedIds.size,
        conversionPct: convPct,
        confirmedOrders: confirmedOrders.length,
      };
    });
  }, [leads, orders, leadFrom, leadTo]);

  // --------------------------------------------------------------------------
  // 3. MONTHLY TEAM REPORT DATA
  // --------------------------------------------------------------------------
  const teamReportData = useMemo(() => {
    const completedInMonth = orders.filter(
      (o) => o.status === 'Completed' && (o.completion_date || '').startsWith(teamMonth)
    );

    const regularOrders = completedInMonth.filter((o) => !o.is_no_charge_visit);
    const noChargeReturnVisits = completedInMonth.filter((o) => o.is_no_charge_visit);

    // Supervisor performance
    const supRows = supervisors
      .filter((s) => !teamSupId || s.id === teamSupId)
      .map((s) => {
        const supJobs = completedInMonth.filter((o) => o.assigned_supervisor_id === s.id);
        const regular = supJobs.filter((o) => !o.is_no_charge_visit);
        const noCharge = supJobs.filter((o) => o.is_no_charge_visit);
        return {
          id: s.id,
          name: s.name,
          isActive: s.is_active,
          regularCount: regular.length,
          noChargeCount: noCharge.length,
          totalJobs: supJobs.length,
          totalBills: regular.reduce((sum, o) => sum + o.price_bdt, 0),
          totalExpenses: supJobs.reduce((sum, o) => sum + o.actual_expenses, 0),
          orders: supJobs,
        };
      })
      .filter((r) => r.totalJobs > 0 || teamSupId === r.id);

    // Unassigned completed jobs
    const unassignedJobs = completedInMonth.filter((o) => !o.assigned_supervisor_id);
    if (!teamSupId && unassignedJobs.length > 0) {
      supRows.push({
        id: 'unassigned',
        name: 'Unassigned / Admin Direct',
        isActive: true,
        regularCount: unassignedJobs.filter((o) => !o.is_no_charge_visit).length,
        noChargeCount: unassignedJobs.filter((o) => o.is_no_charge_visit).length,
        totalJobs: unassignedJobs.length,
        totalBills: unassignedJobs
          .filter((o) => !o.is_no_charge_visit)
          .reduce((sum, o) => sum + o.price_bdt, 0),
        totalExpenses: unassignedJobs.reduce((sum, o) => sum + o.actual_expenses, 0),
        orders: unassignedJobs,
      });
    }

    // Worker participation (confirmed_worked only)
    const workerRows = workers
      .filter((w) => !teamWorkerId || w.worker_id === teamWorkerId)
      .map((w) => {
        const participatedOrders = completedInMonth.filter((o) =>
          (o.assigned_workers || []).some(
            (ow) => ow.worker_id === w.worker_id && ow.confirmed_worked
          )
        );
        const regular = participatedOrders.filter((o) => !o.is_no_charge_visit);
        const noCharge = participatedOrders.filter((o) => o.is_no_charge_visit);
        const earned = participatedOrders.reduce((sum, o) => {
          const row = (o.assigned_workers || []).find(
            (ow) => ow.worker_id === w.worker_id && ow.confirmed_worked
          );
          return sum + (row?.agreed_pay_bdt || 0);
        }, 0);
        return {
          workerId: w.worker_id,
          name: w.name,
          isActive: w.is_active,
          regularCount: regular.length,
          noChargeCount: noCharge.length,
          totalJobs: participatedOrders.length,
          earned,
          orders: participatedOrders,
        };
      })
      .filter((r) => r.totalJobs > 0 || teamWorkerId === r.workerId);

    return {
      distinctTotalJobs: completedInMonth.length,
      distinctRegularJobs: regularOrders.length,
      distinctNoChargeVisits: noChargeReturnVisits.length,
      supRows,
      workerRows,
    };
  }, [orders, supervisors, workers, teamMonth, teamSupId, teamWorkerId]);

  // --------------------------------------------------------------------------
  // 4. MONTHLY WORKER PAYMENTS DATA (EXACT 4-COLUMN SIMPLIFIED MODEL)
  // --------------------------------------------------------------------------
  const workerPaymentsData = useMemo(() => {
    const monthEnd = `${wpMonth}-31`;
    const rows = workers
      .filter((w) => !wpWorkerId || w.worker_id === wpWorkerId)
      .map((w) => {
        let completedJobs = 0;
        let earnedThisMonth = 0;
        let paidThisMonth = 0;
        let unpaidAtMonthEnd = 0;
        const ledger: Array<{
          orderId: string;
          customerName: string;
          completionDate: string;
          agreedPay: number;
          paymentStatus: string;
          paymentDate: string;
          paymentMethod: string;
          paidByRole: string;
          isEarnedInMonth: boolean;
          isPaidInMonth: boolean;
        }> = [];

        for (const o of orders) {
          if (o.status !== 'Completed') continue;
          const compDate = o.completion_date || o.scheduled_date;
          const ow = (o.assigned_workers || []).find(
            (x) => x.worker_id === w.worker_id && x.confirmed_worked
          );
          if (!ow) continue;

          const isEarnedInMonth = compDate.startsWith(wpMonth);
          const isPaidInMonth =
            ow.payment_status === 'Paid' && (ow.payment_date || '').startsWith(wpMonth);
          const isUnpaidAtMonthEnd =
            compDate <= monthEnd &&
            (ow.payment_status !== 'Paid' ||
              (ow.payment_date && ow.payment_date > monthEnd));

          if (isEarnedInMonth) {
            completedJobs += 1;
            earnedThisMonth += ow.agreed_pay_bdt;
          }
          if (isPaidInMonth) {
            paidThisMonth += ow.agreed_pay_bdt;
          }
          if (isUnpaidAtMonthEnd) {
            unpaidAtMonthEnd += ow.agreed_pay_bdt;
          }

          if (isEarnedInMonth || isPaidInMonth || isUnpaidAtMonthEnd) {
            ledger.push({
              orderId: o.order_id,
              customerName: o.customer_name,
              completionDate: compDate,
              agreedPay: ow.agreed_pay_bdt,
              paymentStatus: ow.payment_status,
              paymentDate: ow.payment_date,
              paymentMethod: ow.payment_method,
              paidByRole: ow.paid_by_role,
              isEarnedInMonth,
              isPaidInMonth,
            });
          }
        }

        return {
          worker: w,
          completedJobs,
          earnedThisMonth,
          paidThisMonth,
          unpaidAtMonthEnd,
          ledger: ledger.sort((a, b) => b.completionDate.localeCompare(a.completionDate)),
        };
      })
      .filter(
        (r) =>
          r.completedJobs > 0 ||
          r.earnedThisMonth > 0 ||
          r.paidThisMonth > 0 ||
          r.unpaidAtMonthEnd > 0 ||
          wpWorkerId === r.worker.worker_id
      );

    return rows;
  }, [workers, orders, wpMonth, wpWorkerId]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingExp(true);
    try {
      await onCreateOverhead({
        expense_date: expDate,
        category: expCategory,
        description: expDesc,
        amount_bdt: expAmount,
      });
      setExpDesc('');
      setExpAmount('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add expense.', true);
    } finally {
      setSavingExp(false);
    }
  };

  const handleExportXlsx = async (
    reportType: 'monthly_financial' | 'monthly_team' | 'monthly_worker_payments' | 'lead_source'
  ) => {
    setExporting(true);
    try {
      let filters: Record<string, string> = {};
      if (reportType === 'monthly_financial') {
        filters = {
          dateFrom: effectiveFinFrom,
          dateTo: effectiveFinTo,
          year: String(finYear),
          month: String(finMonthNum),
          area: finArea,
          service: finService,
          supervisorId: finSupId,
        };
      } else if (reportType === 'monthly_team') {
        filters = {
          month: teamMonth,
          supervisorId: teamSupId,
          workerId: teamWorkerId,
        };
      } else if (reportType === 'monthly_worker_payments') {
        filters = {
          month: wpMonth,
          workerId: wpWorkerId,
        };
      } else if (reportType === 'lead_source') {
        filters = {
          dateFrom: leadFrom,
          dateTo: leadTo,
        };
      }
      const fileName = await api.downloadReportXlsx(reportType, filters, `${reportType}.xlsx`);
      onNotify(`Excel report downloaded: ${fileName}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Excel export failed.', true);
    } finally {
      setExporting(false);
    }
  };

  const activeWpDetail = wpDetailWorkerId
    ? workerPaymentsData.find((r) => r.worker.worker_id === wpDetailWorkerId) || null
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0b1f3a]">Reports & Financial Analytics</h1>
          <p className="text-sm text-slate-500">
            Monthly Jobs & Income, general business expenses, lead conversion, team performance, worker payments, and Excel (.xlsx) exports.
          </p>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {(
          [
            { id: 'financial', label: 'Monthly Jobs & Income', icon: TrendingUp },
            { id: 'expenses', label: 'General Business Expenses', icon: Receipt },
            { id: 'leads', label: 'Lead Source & Conversion', icon: BarChart3 },
            { id: 'team', label: 'Monthly Team Report', icon: Users },
            { id: 'worker_pay', label: 'Monthly Worker Payments', icon: Wallet },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-[#0b1f3a] text-white shadow-xs'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: MONTHLY JOBS & INCOME */}
      {/* ==================================================================== */}
      {activeTab === 'financial' && (
        <div className="space-y-5">
          {/* Filter Bar */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Period</label>
                  <select
                    value={finMode}
                    onChange={(e) => setFinMode(e.target.value as 'month' | 'custom')}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                  >
                    <option value="month">Month & Year</option>
                    <option value="custom">Custom Range</option>
                  </select>
                </div>

                {finMode === 'month' ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Month
                      </label>
                      <select
                        value={finMonthNum}
                        onChange={(e) => setFinMonthNum(Number(e.target.value))}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                      >
                        {MONTH_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Year
                      </label>
                      <select
                        value={finYear}
                        onChange={(e) => setFinYear(Number(e.target.value))}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                      >
                        {availableYears.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">From</label>
                      <input
                        type="date"
                        value={finDateFrom}
                        onChange={(e) => setFinDateFrom(e.target.value)}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">To</label>
                      <input
                        type="date"
                        value={finDateTo}
                        onChange={(e) => setFinDateTo(e.target.value)}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Area</label>
                  <select
                    value={finArea}
                    onChange={(e) => setFinArea(e.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                  >
                    <option value="">All Areas</option>
                    {uniqueAreas.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Service</label>
                  <select
                    value={finService}
                    onChange={(e) => setFinService(e.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                  >
                    <option value="">All Services</option>
                    {uniqueServices.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Supervisor</label>
                  <select
                    value={finSupId}
                    onChange={(e) => setFinSupId(e.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                  >
                    <option value="">All Supervisors</option>
                    {supervisors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {financialReport.hasJobFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setFinArea('');
                      setFinService('');
                      setFinSupId('');
                    }}
                    className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Clear Job Filters
                  </button>
                )}
              </div>

              <button
                type="button"
                disabled={exporting}
                onClick={() => handleExportXlsx('monthly_financial')}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {exporting ? 'Exporting...' : 'Export Excel (.xlsx)'}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
              <span>
                Showing <strong className="text-[#0b1f3a]">{selectedPeriodLabel}</strong> ({formatDateEn(effectiveFinFrom)} – {formatDateEn(effectiveFinTo)}, Asia/Dhaka). Click any summary card to inspect its supporting records.
              </span>
              {financialReport.hasJobFilter && (
                <span className="font-semibold text-amber-700">
                  Job filter active — job figures are filtered; company-wide expenses are labeled separately.
                </span>
              )}
            </div>
          </div>

          {/* Primary Job & Income Summary Cards (6 Job-Level Cards) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <button
              type="button"
              onClick={() => setFinSupportingKind('completed_jobs')}
              className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-teal-400 hover:shadow-sm"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>Completed Jobs</span>
                <span className="text-[10px] font-semibold text-teal-700 opacity-75 group-hover:opacity-100">
                  View →
                </span>
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-[#0b1f3a]">
                {financialReport.totals.completedJobsCount}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">By completion date</div>
            </button>

            <button
              type="button"
              onClick={() => setFinSupportingKind('no_charge_visits')}
              className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-amber-400 hover:shadow-sm"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>No-Charge Return Visits</span>
                <span className="text-[10px] font-semibold text-amber-700 opacity-75 group-hover:opacity-100">
                  View →
                </span>
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-amber-700">
                {financialReport.totals.noChargeReturnVisitsCount}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                BDT 0 revenue · Costs in visit month
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFinSupportingKind('income_collected')}
              className="group rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 text-left transition hover:border-emerald-400 hover:shadow-sm"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
                <span>Income Collected</span>
                <span className="text-[10px] font-semibold text-emerald-700 opacity-75 group-hover:opacity-100">
                  View →
                </span>
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-800">
                BDT {formatBdt(financialReport.totals.totalIncomeCollected)}
              </div>
              <div className="mt-0.5 text-[11px] text-emerald-700/80">
                By collection date ({financialReport.totals.collectionsCount} confirmed)
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFinSupportingKind('completed_job_bills')}
              className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-teal-400 hover:shadow-sm"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>Completed Job Bills</span>
                <span className="text-[10px] font-semibold text-teal-700 opacity-75 group-hover:opacity-100">
                  View →
                </span>
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-[#0b1f3a]">
                BDT {formatBdt(financialReport.totals.totalCompletedJobBills)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">By completion date</div>
            </button>

            <button
              type="button"
              onClick={() => setFinSupportingKind('actual_job_costs')}
              className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-rose-400 hover:shadow-sm"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>Actual Job Costs</span>
                <span className="text-[10px] font-semibold text-rose-700 opacity-75 group-hover:opacity-100">
                  View →
                </span>
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-rose-700">
                BDT {formatBdt(financialReport.totals.totalActualJobCosts)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                Transport, meals, other & worker pay once
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFinSupportingKind('job_profit')}
              className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-teal-400 hover:shadow-sm"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>Job Profit / Loss</span>
                <span className="text-[10px] font-semibold text-teal-700 opacity-75 group-hover:opacity-100">
                  View →
                </span>
              </div>
              <div
                className={`mt-1 text-2xl font-bold tabular-nums ${
                  financialReport.totals.totalJobProfit >= 0 ? 'text-teal-700' : 'text-rose-700'
                }`}
              >
                BDT {formatBdt(financialReport.totals.totalJobProfit)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                Completed Job Bills − Actual Job Costs
              </div>
            </button>
          </div>

          {/* Company-Wide Expenses & Net Business Profit Cards */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setFinSupportingKind('general_expenses')}
              className={`group rounded-2xl border p-4 text-left transition hover:shadow-sm ${
                financialReport.hasJobFilter
                  ? 'border-amber-300 bg-amber-50/50 hover:border-amber-400'
                  : 'border-slate-200 bg-white hover:border-rose-400'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    General Business Expenses
                  </span>
                  {financialReport.hasJobFilter && (
                    <span className="rounded bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                      Company-Wide · Unfiltered
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-semibold text-slate-600 opacity-80 group-hover:opacity-100">
                  View {financialReport.matchingGeneralExpenses.length} expense(s) →
                </span>
              </div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums text-rose-700">
                BDT {formatBdt(financialReport.totals.totalGeneralBusinessExpenses)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {financialReport.hasJobFilter
                  ? 'Company-wide overhead for the selected period (not filtered by Area, Service, or Supervisor).'
                  : 'Overhead recorded by expense date and deducted once from Job Profit / Loss.'}
              </div>
            </button>

            {financialReport.hasJobFilter ? (
              <div className="flex flex-col justify-between rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">
                      Net Business Profit (Company-Wide Only)
                    </span>
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                      Unfiltered View Only
                    </span>
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-slate-700">
                    Clear Area, Service, and Supervisor filters to view company-wide Net Business Profit.
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    Company-wide overhead is never subtracted from filtered job profit.
                  </div>
                </div>
                <div className="mt-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFinArea('');
                      setFinService('');
                      setFinSupId('');
                    }}
                    className="rounded-lg bg-[#0b1f3a] px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Show Unfiltered Company-Wide Net Profit
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setFinSupportingKind('net_profit')}
                className="group rounded-2xl border-2 border-[#0b1f3a] bg-[#0b1f3a] p-4 text-left text-white transition hover:bg-slate-900"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-teal-200">
                  <span>Net Business Profit</span>
                  <span className="text-[10px] font-semibold text-teal-200 opacity-80 group-hover:opacity-100">
                    View P&amp;L Breakdown →
                  </span>
                </div>
                <div className="mt-1.5 text-2xl font-bold tabular-nums">
                  BDT {formatBdt(financialReport.totals.netBusinessProfit ?? 0)}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-300">
                  Job Profit / Loss − General Business Expenses (Company-wide)
                </div>
              </button>
            )}
          </div>

          {/* Supervisor Settlement Cash Flow Summary (Explicitly Separate from Income & Job Costs) */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[#0b1f3a]">
                  Supervisor Settlements (Excluded from Income &amp; Job Costs)
                </h3>
                <p className="text-xs text-slate-600">
                  Supervisor advances, deposits received, reimbursements paid, and pending settlements are tracked separately and never counted as income or job expenses.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
              <button
                type="button"
                onClick={() => setFinSupportingKind('deposits_received')}
                className="group rounded-xl border border-blue-200/80 bg-white p-3.5 text-left transition hover:border-emerald-400 hover:shadow-xs"
              >
                <div className="flex items-center justify-between text-slate-500">
                  <span className="font-semibold">Supervisor Deposits Received</span>
                  <span className="text-[10px] font-semibold text-emerald-700">View →</span>
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums text-emerald-700">
                  BDT {formatBdt(financialReport.totals.totalDepositsReceived)}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  By actual settlement date ({financialReport.depositSettlementEntries.length} entry(ies))
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFinSupportingKind('reimbursements_paid')}
                className="group rounded-xl border border-blue-200/80 bg-white p-3.5 text-left transition hover:border-rose-400 hover:shadow-xs"
              >
                <div className="flex items-center justify-between text-slate-500">
                  <span className="font-semibold">Supervisor Reimbursements Paid</span>
                  <span className="text-[10px] font-semibold text-rose-700">View →</span>
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums text-rose-700">
                  BDT {formatBdt(financialReport.totals.totalReimbursementsPaid)}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  By actual settlement date ({financialReport.reimbursementSettlementEntries.length} entry(ies))
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFinSupportingKind('pending_settlements')}
                className="group rounded-xl border border-amber-200 bg-white p-3.5 text-left transition hover:border-amber-400 hover:shadow-xs"
              >
                <div className="flex items-center justify-between text-slate-500">
                  <span className="font-semibold">Pending Settlements (Period Jobs)</span>
                  <span className="text-[10px] font-semibold text-amber-700">View →</span>
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums text-amber-700">
                  {financialReport.totals.pendingSettlementsCount} job(s) · BDT{' '}
                  {formatBdt(financialReport.totals.pendingSettlementsRemaining)}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  Deposits due: BDT {formatBdt(financialReport.totals.pendingDepositsRemaining)} · Reimbursements due: BDT{' '}
                  {formatBdt(financialReport.totals.pendingReimbursementsRemaining)}
                </div>
              </button>
            </div>
          </div>

          {/* Completed Jobs & No-Charge Return Visits Table (Matches Excel Sheet 2 Row-for-Row) */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-[#0b1f3a]">
                  Completed Jobs &amp; Return Visits ({financialReport.orderRows.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Matches Excel export row-for-row · Click any Order ID to inspect full job details, costs, and settlement.
                </p>
              </div>
            </div>
            {financialReport.orderRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No completed jobs or no-charge return visits match the selected period and filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                    <tr>
                      <th className="px-3.5 py-2.5">Order ID</th>
                      <th className="px-3.5 py-2.5">Customer</th>
                      <th className="px-3.5 py-2.5">Completion Date</th>
                      <th className="px-3.5 py-2.5">Service</th>
                      <th className="px-3.5 py-2.5">Supervisor</th>
                      <th className="px-3.5 py-2.5 text-right">Bill (BDT)</th>
                      <th className="px-3.5 py-2.5 text-right">Cost (BDT)</th>
                      <th className="px-3.5 py-2.5 text-right">Profit / Loss (BDT)</th>
                      <th className="px-3.5 py-2.5 text-right">Settlement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {financialReport.orderRows.map(
                      ({
                        order: o,
                        service_label,
                        period_revenue_bdt,
                        period_cost_bdt,
                        period_profit_or_loss_bdt,
                      }) => (
                        <tr key={o.order_id} className="hover:bg-slate-50">
                          <td className="px-3.5 py-2.5">
                            <button
                              type="button"
                              onClick={() => onOpenOrder(o.order_id)}
                              className="font-mono font-bold text-teal-700 hover:underline"
                            >
                              {o.order_id}
                            </button>
                            {o.is_no_charge_visit && (
                              <div className="mt-0.5 text-[10px] font-semibold text-amber-700">
                                No-Charge Return Visit
                                {o.parent_order_id ? ` (${o.parent_order_id})` : ''}
                              </div>
                            )}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <div className="font-semibold text-[#0b1f3a]">{o.customer_name}</div>
                            <div className="text-[11px] text-slate-500">{o.area || '—'}</div>
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600">
                            {formatDateEn(o.completion_date)}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700 max-w-[200px]">
                            <div className="truncate" title={service_label}>
                              {service_label}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700">
                            {o.assigned_supervisor_name || 'Unassigned'}
                          </td>
                          <td className="px-3.5 py-2.5 text-right tabular-nums font-medium">
                            {formatBdt(period_revenue_bdt)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right tabular-nums text-rose-700">
                            <div>{formatBdt(period_cost_bdt)}</div>
                            <div className="text-[10px] text-slate-400">
                              T:{o.transport_cost} · M:{o.meals_cost} · O:{o.other_expenses_total} · W:{o.worker_pay_total}
                            </div>
                          </td>
                          <td
                            className={`px-3.5 py-2.5 text-right tabular-nums font-bold ${
                              period_profit_or_loss_bdt >= 0 ? 'text-teal-700' : 'text-rose-700'
                            }`}
                          >
                            {formatBdt(period_profit_or_loss_bdt)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            <StatusBadge status={o.settlement_status} />
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold text-[#0b1f3a]">
                    <tr>
                      <td colSpan={5} className="px-3.5 py-2.5">
                        TOTAL ({financialReport.orderRows.length} Records)
                      </td>
                      <td className="px-3.5 py-2.5 text-right tabular-nums">
                        {formatBdt(financialReport.totals.totalCompletedJobBills)}
                      </td>
                      <td className="px-3.5 py-2.5 text-right tabular-nums text-rose-700">
                        {formatBdt(financialReport.totals.totalActualJobCosts)}
                      </td>
                      <td
                        className={`px-3.5 py-2.5 text-right tabular-nums ${
                          financialReport.totals.totalJobProfit >= 0
                            ? 'text-teal-700'
                            : 'text-rose-700'
                        }`}
                      >
                        {formatBdt(financialReport.totals.totalJobProfit)}
                      </td>
                      <td className="px-3.5 py-2.5 text-right text-[11px] font-medium text-slate-500">
                        Matches Excel
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: GENERAL BUSINESS EXPENSES */}
      {/* ==================================================================== */}
      {activeTab === 'expenses' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-base font-bold text-[#0b1f3a]">Add General Business Expense</h3>
            <p className="mt-1 text-xs text-slate-500">
              Recorded separately from per-job costs and deducted once from Total Job Profit to calculate Net Business Profit.
            </p>
            <form onSubmit={handleAddExpense} className="mt-4 space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Date *</label>
                <input
                  type="date"
                  required
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Category *</label>
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  {GENERAL_EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Description *
                </label>
                <input
                  type="text"
                  required
                  value={expDesc}
                  onChange={(e) => setExpDesc(e.target.value)}
                  placeholder="e.g., Facebook Ads boost, pressure pump repair"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Amount (BDT) *
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={savingExp}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {savingExp ? 'Saving...' : 'Save Expense'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-bold text-[#0b1f3a]">
                Saved General Business Expenses ({overhead.length})
              </h3>
              <span className="text-sm font-bold tabular-nums text-rose-700">
                Total: {formatBdt(overhead.reduce((s, x) => s + x.amount_bdt, 0))}
              </span>
            </div>
            {overhead.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                No general business expenses recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Category</th>
                      <th className="px-4 py-2.5">Description</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                      <th className="px-4 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overhead.map((ov) => (
                      <tr key={ov.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-600">
                          {formatDateEn(ov.expense_date)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                            {ov.category}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[#0b1f3a] font-medium">{ov.description}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-rose-700">
                          {formatBdt(ov.amount_bdt)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => onDeleteOverhead(ov.id)}
                            className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"
                            title="Delete Expense"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: LEAD SOURCE & CONVERSION REPORT */}
      {/* ==================================================================== */}
      {activeTab === 'leads' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Date From</label>
                <input
                  type="date"
                  value={leadFrom}
                  onChange={(e) => setLeadFrom(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Date To</label>
                <input
                  type="date"
                  value={leadTo}
                  onChange={(e) => setLeadTo(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleExportXlsx('lead_source')}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Excel (.xlsx)
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Lead Source</th>
                    <th className="px-4 py-3 text-right">New Prospects</th>
                    <th className="px-4 py-3 text-right">
                      Prospects Converted to Confirmed Bookings
                    </th>
                    <th className="px-4 py-3 text-right">Conversion %</th>
                    <th className="px-4 py-3 text-right">Confirmed Orders (By Booking Date)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leadSourceData.map((row) => (
                    <tr key={row.source} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-[#0b1f3a]">{row.source}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.newProspects}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-teal-700">
                        {row.convertedProspects}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.conversionPct}%</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {row.confirmedOrders}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
              Note: Each prospect is counted once when converted to a non-cancelled booking by the period end date.
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: MONTHLY TEAM REPORT */}
      {/* ==================================================================== */}
      {activeTab === 'team' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Month</label>
                <input
                  type="month"
                  value={teamMonth}
                  onChange={(e) => setTeamMonth(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Supervisor</label>
                <select
                  value={teamSupId}
                  onChange={(e) => setTeamSupId(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                >
                  <option value="">All Supervisors</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Worker</label>
                <select
                  value={teamWorkerId}
                  onChange={(e) => setTeamWorkerId(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                >
                  <option value="">All Workers</option>
                  {workers.map((w) => (
                    <option key={w.worker_id} value={w.worker_id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleExportXlsx('monthly_team')}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Excel (.xlsx)
            </button>
          </div>

          {/* Distinct Overall Totals Strip */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold text-slate-500">
                Distinct Completed Jobs (Overall Total)
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-[#0b1f3a]">
                {teamReportData.distinctTotalJobs}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                Each order ID counted once across teams
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold text-slate-500">Paid Regular Completed Jobs</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-teal-700">
                {teamReportData.distinctRegularJobs}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold text-slate-500">
                No-Charge Return Visits Completed
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-amber-700">
                {teamReportData.distinctNoChargeVisits}
              </div>
            </div>
          </div>

          {/* Supervisor Performance Table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-bold text-[#0b1f3a]">Supervisor Performance</h3>
            </div>
            {teamReportData.supRows.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No completed jobs recorded for supervisors in {teamMonth}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Supervisor</th>
                      <th className="px-4 py-2.5 text-right">Regular Jobs</th>
                      <th className="px-4 py-2.5 text-right">No-Charge Return Visits</th>
                      <th className="px-4 py-2.5 text-right">Total Jobs</th>
                      <th className="px-4 py-2.5 text-right">Full Bills</th>
                      <th className="px-4 py-2.5 text-right">Job Costs</th>
                      <th className="px-4 py-2.5 text-right">Supporting List</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {teamReportData.supRows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-semibold text-[#0b1f3a]">{r.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.regularCount}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">
                          {r.noChargeCount}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold">
                          {r.totalJobs}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatBdt(r.totalBills)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatBdt(r.totalExpenses)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setSupportingModal({
                                title: `Jobs Supervised by ${r.name}`,
                                subtitle: `Month: ${teamMonth} · ${r.totalJobs} completed job(s)`,
                                orders: r.orders,
                              })
                            }
                            className="font-semibold text-teal-700 hover:underline"
                          >
                            View Jobs ({r.totalJobs})
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Worker Participation Table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-[#0b1f3a]">
                <HardHat className="h-4 w-4 text-teal-600" />
                Worker Participation (Confirmed Worked Only)
              </h3>
            </div>
            {teamReportData.workerRows.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No confirmed worker participation recorded in {teamMonth}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Worker</th>
                      <th className="px-4 py-2.5 text-right">Regular Jobs</th>
                      <th className="px-4 py-2.5 text-right">No-Charge Return Visits</th>
                      <th className="px-4 py-2.5 text-right">Total Jobs Worked</th>
                      <th className="px-4 py-2.5 text-right">Confirmed Pay Earned</th>
                      <th className="px-4 py-2.5 text-right">Supporting List</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {teamReportData.workerRows.map((r) => (
                      <tr key={r.workerId} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-semibold text-[#0b1f3a]">{r.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.regularCount}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">
                          {r.noChargeCount}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold">
                          {r.totalJobs}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-teal-700">
                          {formatBdt(r.earned)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setSupportingModal({
                                title: `Jobs Worked by ${r.name}`,
                                subtitle: `Month: ${teamMonth} · ${r.totalJobs} completed job(s)`,
                                orders: r.orders,
                              })
                            }
                            className="font-semibold text-teal-700 hover:underline"
                          >
                            View Jobs ({r.totalJobs})
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 5: MONTHLY WORKER PAYMENTS */}
      {/* ==================================================================== */}
      {activeTab === 'worker_pay' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Month</label>
                <input
                  type="month"
                  value={wpMonth}
                  onChange={(e) => setWpMonth(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Worker</label>
                <select
                  value={wpWorkerId}
                  onChange={(e) => setWpWorkerId(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
                >
                  <option value="">All Workers</option>
                  {workers.map((w) => (
                    <option key={w.worker_id} value={w.worker_id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleExportXlsx('monthly_worker_payments')}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Excel (.xlsx)
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Worker</th>
                    <th className="px-4 py-3 text-right">Completed Jobs</th>
                    <th className="px-4 py-3 text-right">Earned This Month</th>
                    <th className="px-4 py-3 text-right">Paid This Month</th>
                    <th className="px-4 py-3 text-right">Unpaid at Month End</th>
                    <th className="px-4 py-3 text-right">Ledger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workerPaymentsData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-xs text-slate-500">
                        No worker earnings or payments recorded for {wpMonth}.
                      </td>
                    </tr>
                  ) : (
                    workerPaymentsData.map((r) => (
                      <tr key={r.worker.worker_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-[#0b1f3a]">
                          {r.worker.name}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.completedJobs}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">
                          {formatBdt(r.earnedThisMonth)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">
                          {formatBdt(r.paidThisMonth)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-700">
                          {formatBdt(r.unpaidAtMonthEnd)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setWpDetailWorkerId(r.worker.worker_id)}
                            className="text-xs font-semibold text-teal-700 hover:underline"
                          >
                            View Breakdown ({r.ledger.length})
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
              Earned This Month uses Job Completion Date. Paid This Month uses Actual Payment Date (including payments made this month for earlier-month jobs).
            </div>
          </div>
        </div>
      )}

      {/* Supporting Records Modal (Monthly Jobs & Income — Every Total Drill-Down) */}
      {finSupportingKind && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-[#0b1f3a]">
                  {finSupportingKind === 'completed_jobs' && 'Supporting Records — Completed Jobs'}
                  {finSupportingKind === 'no_charge_visits' &&
                    'Supporting Records — No-Charge Return Visits'}
                  {finSupportingKind === 'income_collected' &&
                    'Supporting Records — Income Collected (By Collection Date)'}
                  {finSupportingKind === 'completed_job_bills' &&
                    'Supporting Records — Completed Job Bills'}
                  {finSupportingKind === 'actual_job_costs' &&
                    'Supporting Records — Actual Job Costs Breakdown'}
                  {finSupportingKind === 'job_profit' &&
                    'Supporting Records — Job Profit / Loss Breakdown'}
                  {finSupportingKind === 'general_expenses' &&
                    `Supporting Records — General Business Expenses${
                      financialReport.hasJobFilter ? ' (Company-Wide · Unfiltered)' : ''
                    }`}
                  {finSupportingKind === 'net_profit' &&
                    'Supporting Reconciliation — Net Business Profit'}
                  {finSupportingKind === 'deposits_received' &&
                    'Supporting Records — Supervisor Deposits Received'}
                  {finSupportingKind === 'reimbursements_paid' &&
                    'Supporting Records — Supervisor Reimbursements Paid'}
                  {finSupportingKind === 'pending_settlements' &&
                    'Supporting Records — Pending Supervisor Settlements'}
                </h3>
                <p className="text-xs text-slate-500">
                  Period: {selectedPeriodLabel} ({formatDateEn(effectiveFinFrom)} –{' '}
                  {formatDateEn(effectiveFinTo)}, Asia/Dhaka)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFinSupportingKind(null)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* 1. Completed Jobs / Completed Job Bills / No-Charge Return Visits / Job Profit */}
              {(finSupportingKind === 'completed_jobs' ||
                finSupportingKind === 'completed_job_bills' ||
                finSupportingKind === 'no_charge_visits' ||
                finSupportingKind === 'job_profit') &&
                (() => {
                  const rows =
                    finSupportingKind === 'no_charge_visits'
                      ? financialReport.noChargeOrderRows
                      : finSupportingKind === 'job_profit'
                      ? financialReport.orderRows
                      : financialReport.billableOrderRows;
                  if (rows.length === 0) {
                    return (
                      <div className="py-10 text-center text-sm text-slate-500">
                        No supporting records for this metric in the selected period.
                      </div>
                    );
                  }
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Order ID</th>
                            <th className="px-3 py-2">Customer</th>
                            <th className="px-3 py-2">Completion Date</th>
                            <th className="px-3 py-2">Service</th>
                            <th className="px-3 py-2">Supervisor</th>
                            <th className="px-3 py-2 text-right">Bill (BDT)</th>
                            <th className="px-3 py-2 text-right">Cost (BDT)</th>
                            <th className="px-3 py-2 text-right">Profit / Loss</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.map((r) => (
                            <tr key={r.order.order_id} className="hover:bg-slate-50">
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFinSupportingKind(null);
                                    onOpenOrder(r.order.order_id);
                                  }}
                                  className="font-mono font-bold text-teal-700 hover:underline"
                                >
                                  {r.order.order_id}
                                </button>
                                {r.order.is_no_charge_visit && (
                                  <div className="text-[10px] font-semibold text-amber-700">
                                    Return Visit ({r.order.parent_order_id || 'Linked'})
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-semibold text-[#0b1f3a]">
                                  {r.order.customer_name}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {r.order.area || '—'}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {formatDateEn(r.order.completion_date)}
                              </td>
                              <td className="px-3 py-2 text-slate-700">{r.service_label}</td>
                              <td className="px-3 py-2 text-slate-700">
                                {r.order.assigned_supervisor_name || 'Unassigned'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatBdt(r.period_revenue_bdt)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                                {formatBdt(r.period_cost_bdt)}
                              </td>
                              <td
                                className={`px-3 py-2 text-right tabular-nums font-bold ${
                                  r.period_profit_or_loss_bdt >= 0
                                    ? 'text-teal-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {formatBdt(r.period_profit_or_loss_bdt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                          <tr>
                            <td colSpan={5} className="px-3 py-2">
                              TOTAL ({rows.length} record{rows.length === 1 ? '' : 's'})
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatBdt(rows.reduce((s, r) => s + r.period_revenue_bdt, 0))}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                              {formatBdt(rows.reduce((s, r) => s + r.period_cost_bdt, 0))}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[#0b1f3a]">
                              {formatBdt(rows.reduce((s, r) => s + r.period_profit_or_loss_bdt, 0))}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  );
                })()}

              {/* 2. Income Collected (By Collection Date) */}
              {finSupportingKind === 'income_collected' && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2 text-xs text-emerald-900">
                    Confirmed collections are counted once by collection date from the full-bill-at-completion record. Issuing or reprinting a Money Receipt never adds extra income.
                  </div>
                  {financialReport.matchingCollections.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500">
                      No confirmed collections in the selected period.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Order ID</th>
                            <th className="px-3 py-2">Collection Date</th>
                            <th className="px-3 py-2">Completion Date</th>
                            <th className="px-3 py-2">Customer</th>
                            <th className="px-3 py-2">Service</th>
                            <th className="px-3 py-2">Collected By</th>
                            <th className="px-3 py-2">Receipt Ref</th>
                            <th className="px-3 py-2 text-right">Amount (BDT)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {financialReport.matchingCollections.map((c) => (
                            <tr key={c.order.order_id} className="hover:bg-slate-50">
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFinSupportingKind(null);
                                    onOpenOrder(c.order.order_id);
                                  }}
                                  className="font-mono font-bold text-teal-700 hover:underline"
                                >
                                  {c.order.order_id}
                                </button>
                              </td>
                              <td className="px-3 py-2 font-semibold text-emerald-800">
                                {formatDateEn(c.collection_date)}
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {formatDateEn(c.order.completion_date)}
                              </td>
                              <td className="px-3 py-2 font-semibold text-[#0b1f3a]">
                                {c.order.customer_name}
                              </td>
                              <td className="px-3 py-2 text-slate-700">{c.service_label}</td>
                              <td className="px-3 py-2 text-slate-600">{c.collected_by_name}</td>
                              <td className="px-3 py-2 font-mono text-slate-500">
                                {c.receipt_id || '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-800">
                                {formatBdt(c.collected_amount_bdt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                          <tr>
                            <td colSpan={7} className="px-3 py-2">
                              TOTAL ({financialReport.matchingCollections.length} confirmed collection
                              {financialReport.matchingCollections.length === 1 ? '' : 's'})
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-emerald-800">
                              {formatBdt(financialReport.totals.totalIncomeCollected)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* 3. Actual Job Costs Breakdown */}
              {finSupportingKind === 'actual_job_costs' && (
                <div>
                  {financialReport.orderRows.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-500">
                      No job costs recorded in the selected period.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Order ID</th>
                            <th className="px-3 py-2">Customer</th>
                            <th className="px-3 py-2">Completion Date</th>
                            <th className="px-3 py-2 text-right">Transport</th>
                            <th className="px-3 py-2 text-right">Meals</th>
                            <th className="px-3 py-2 text-right">Other</th>
                            <th className="px-3 py-2 text-right">Worker Pay</th>
                            <th className="px-3 py-2 text-right">Total Cost (BDT)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {financialReport.orderRows.map(({ order: o, period_cost_bdt }) => (
                            <tr key={o.order_id} className="hover:bg-slate-50">
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFinSupportingKind(null);
                                    onOpenOrder(o.order_id);
                                  }}
                                  className="font-mono font-bold text-teal-700 hover:underline"
                                >
                                  {o.order_id}
                                </button>
                                {o.is_no_charge_visit && (
                                  <div className="text-[10px] font-semibold text-amber-700">
                                    No-Charge Return Visit
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 font-semibold text-[#0b1f3a]">
                                {o.customer_name}
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {formatDateEn(o.completion_date)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatBdt(o.transport_cost)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatBdt(o.meals_cost)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatBdt(o.other_expenses_total)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatBdt(o.worker_pay_total)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-700">
                                {formatBdt(period_cost_bdt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                          <tr>
                            <td colSpan={3} className="px-3 py-2">
                              TOTAL
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatBdt(
                                financialReport.matchingCompletedOrders.reduce(
                                  (s, o) => s + o.transport_cost,
                                  0
                                )
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatBdt(
                                financialReport.matchingCompletedOrders.reduce(
                                  (s, o) => s + o.meals_cost,
                                  0
                                )
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatBdt(
                                financialReport.matchingCompletedOrders.reduce(
                                  (s, o) => s + o.other_expenses_total,
                                  0
                                )
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatBdt(
                                financialReport.matchingCompletedOrders.reduce(
                                  (s, o) => s + o.worker_pay_total,
                                  0
                                )
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                              {formatBdt(financialReport.totals.totalActualJobCosts)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* 4. General Business Expenses */}
              {finSupportingKind === 'general_expenses' && (
                <div>
                  {financialReport.matchingGeneralExpenses.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-500">
                      No general business expenses recorded in this period.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Category</th>
                            <th className="px-3 py-2">Description</th>
                            <th className="px-3 py-2">Recorded By</th>
                            <th className="px-3 py-2 text-right">Amount (BDT)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {financialReport.matchingGeneralExpenses.map((ex) => (
                            <tr key={ex.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-600">
                                {formatDateEn(ex.expense_date)}
                              </td>
                              <td className="px-3 py-2 font-semibold text-slate-700">
                                {ex.category}
                              </td>
                              <td className="px-3 py-2 text-[#0b1f3a]">{ex.description}</td>
                              <td className="px-3 py-2 text-slate-500">{ex.created_by}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-700">
                                {formatBdt(ex.amount_bdt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                          <tr>
                            <td colSpan={4} className="px-3 py-2">
                              TOTAL ({financialReport.matchingGeneralExpenses.length} expense
                              {financialReport.matchingGeneralExpenses.length === 1 ? '' : 's'})
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                              {formatBdt(financialReport.totals.totalGeneralBusinessExpenses)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* 5. Net Business Profit Reconciliation */}
              {finSupportingKind === 'net_profit' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Completed Job Bills</span>
                      <span className="font-mono font-semibold text-[#0b1f3a]">
                        BDT {formatBdt(financialReport.totals.totalCompletedJobBills)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Less: Actual Job Costs</span>
                      <span className="font-mono font-semibold text-rose-700">
                        − BDT {formatBdt(financialReport.totals.totalActualJobCosts)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-bold">
                      <span className="text-[#0b1f3a]">Job Profit / Loss</span>
                      <span className="font-mono text-teal-700">
                        BDT {formatBdt(financialReport.totals.totalJobProfit)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Less: General Business Expenses</span>
                      <span className="font-mono font-semibold text-rose-700">
                        − BDT {formatBdt(financialReport.totals.totalGeneralBusinessExpenses)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t-2 border-[#0b1f3a] pt-2 text-base font-bold">
                      <span className="text-[#0b1f3a]">Net Business Profit</span>
                      <span className="font-mono text-[#0b1f3a]">
                        BDT {formatBdt(financialReport.totals.netBusinessProfit ?? 0)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setFinSupportingKind('job_profit')}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Inspect Job Profit Records ({financialReport.orderRows.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFinSupportingKind('general_expenses')}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Inspect General Expenses ({financialReport.matchingGeneralExpenses.length})
                    </button>
                  </div>
                </div>
              )}

              {/* 6. Supervisor Deposits Received / Reimbursements Paid */}
              {(finSupportingKind === 'deposits_received' ||
                finSupportingKind === 'reimbursements_paid') &&
                (() => {
                  const entries =
                    finSupportingKind === 'deposits_received'
                      ? financialReport.depositSettlementEntries
                      : financialReport.reimbursementSettlementEntries;
                  if (entries.length === 0) {
                    return (
                      <div className="py-10 text-center text-sm text-slate-500">
                        No settlement entries recorded in this period.
                      </div>
                    );
                  }
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Settlement Date</th>
                            <th className="px-3 py-2">Order ID</th>
                            <th className="px-3 py-2">Supervisor</th>
                            <th className="px-3 py-2">Method</th>
                            <th className="px-3 py-2">Reference / Note</th>
                            <th className="px-3 py-2 text-right">Amount (BDT)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {entries.map((e) => (
                            <tr key={e.entry_id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-600">{e.entry_datetime}</td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFinSupportingKind(null);
                                    onOpenOrder(e.order_id);
                                  }}
                                  className="font-mono font-bold text-teal-700 hover:underline"
                                >
                                  {e.order_id}
                                </button>
                              </td>
                              <td className="px-3 py-2 font-semibold text-[#0b1f3a]">
                                {e.supervisor_name}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{e.payment_method}</td>
                              <td className="px-3 py-2 text-slate-500">
                                {[e.reference, e.note].filter(Boolean).join(' · ') || '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-bold">
                                {formatBdt(e.amount_bdt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                          <tr>
                            <td colSpan={5} className="px-3 py-2">
                              TOTAL ({entries.length} entry(ies))
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatBdt(entries.reduce((s, e) => s + e.amount_bdt, 0))}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  );
                })()}

              {/* 7. Pending Settlements */}
              {finSupportingKind === 'pending_settlements' && (
                <div>
                  {financialReport.pendingSettlementOrders.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-500">
                      All completed jobs in this period are settled.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Order ID</th>
                            <th className="px-3 py-2">Customer</th>
                            <th className="px-3 py-2">Supervisor</th>
                            <th className="px-3 py-2 text-right">Expected</th>
                            <th className="px-3 py-2 text-right">Settled</th>
                            <th className="px-3 py-2 text-right">Remaining</th>
                            <th className="px-3 py-2">Direction</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {financialReport.pendingSettlementOrders.map((o) => (
                            <tr key={o.order_id} className="hover:bg-slate-50">
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFinSupportingKind(null);
                                    onOpenOrder(o.order_id);
                                  }}
                                  className="font-mono font-bold text-teal-700 hover:underline"
                                >
                                  {o.order_id}
                                </button>
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-semibold text-[#0b1f3a]">
                                  {o.customer_name}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {formatDateEn(o.completion_date)}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-slate-700">
                                {o.assigned_supervisor_name || 'Unassigned'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatBdt(o.supervisor_settlement)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatBdt(o.settlement_actual_total)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-bold text-amber-700">
                                {formatBdt(o.settlement_remaining)}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                                    o.supervisor_settlement > 0
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {o.supervisor_settlement > 0
                                    ? 'Admin to Receive Deposit'
                                    : 'Admin to Pay Reimbursement'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Supporting Jobs Modal (Team Report) */}
      {supportingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-[#0b1f3a]">{supportingModal.title}</h3>
                <p className="text-xs text-slate-500">{supportingModal.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setSupportingModal(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="divide-y divide-slate-100 p-4">
              {supportingModal.orders.map((o) => (
                <div
                  key={o.order_id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                >
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setSupportingModal(null);
                        onOpenOrder(o.order_id);
                      }}
                      className="font-mono font-bold text-teal-700 hover:underline"
                    >
                      {o.order_id}
                    </button>
                    <span className="ml-2 font-semibold text-[#0b1f3a]">{o.customer_name}</span>
                    {o.is_no_charge_visit && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        No-Charge Return Visit
                      </span>
                    )}
                    <div className="text-slate-500">
                      Completed: {formatDateEn(o.completion_date)} · {o.area || o.address}
                    </div>
                  </div>
                  <div className="text-right font-semibold tabular-nums text-[#0b1f3a]">
                    {o.is_no_charge_visit ? '0 BDT' : formatBdt(o.price_bdt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Worker Payment Breakdown Drawer */}
      {activeWpDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-[#0b1f3a]">
                  Worker Payment Ledger — {activeWpDetail.worker.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Month: {wpMonth} · Earned: {formatBdt(activeWpDetail.earnedThisMonth)} · Paid:{' '}
                  {formatBdt(activeWpDetail.paidThisMonth)} · Unpaid at Month End:{' '}
                  {formatBdt(activeWpDetail.unpaidAtMonthEnd)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWpDetailWorkerId(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-x-auto p-4">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2">Completion Date</th>
                    <th className="px-3 py-2 text-right">Pay Amount</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Payment Date</th>
                    <th className="px-3 py-2">Paid By / Method</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeWpDetail.ledger.map((item) => (
                    <tr key={item.orderId} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => {
                            setWpDetailWorkerId(null);
                            onOpenOrder(item.orderId);
                          }}
                          className="font-mono font-bold text-teal-700 hover:underline"
                        >
                          {item.orderId}
                        </button>
                        <div className="text-[11px] text-slate-500">{item.customerName}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {formatDateEn(item.completionDate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">
                        {formatBdt(item.agreedPay)}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={item.paymentStatus} />
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {item.paymentDate ? formatDateEn(item.paymentDate) : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {item.paymentStatus === 'Paid'
                          ? `${item.paidByRole === 'supervisor' ? 'Supervisor' : 'Admin'} · ${item.paymentMethod || 'Cash'}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
