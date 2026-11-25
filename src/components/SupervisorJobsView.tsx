import React, { useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { AuthUser, OtherExpenseItem, SupervisorJobView, isOrderStatusLocked } from '../types/order';
import { BrandLogo } from './BrandLogo';
import { PWAInstallButton } from './PWAInstallButton';
import { StatusBadge } from './StatusBadge';
import {
  bnToEnDigits,
  buildTelLink,
  buildWhatsAppLink,
  formatBdt,
  formatEnDateShort,
  formatTime12h,
  translateServiceToEnglish,
  validateSafeExternalUrl,
} from '../utils/dateAndPhone';
import { getSettlementDirectionLabel } from '../utils/orderPredicates';

interface SupervisorJobsViewProps {
  user: AuthUser;
  todayDhaka: string;
  endDateDhaka: string;
  jobs: SupervisorJobView[];
  companyLogoDataUrl?: string;
  loading: boolean;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenChangePassword?: () => void;
  onOpenDeviceSecurity?: () => void;
  onNotify?: (msg: string, tone?: 'success' | 'error') => void;
  onCompleteJob: (
    orderId: string,
    payload: {
      transport_cost: number;
      meals_cost: number;
      other_expenses: OtherExpenseItem[];
      full_bill_collected: boolean;
      confirmed_worker_ids?: string[];
    }
  ) => Promise<void>;
}

export function SupervisorJobsView({
  user,
  todayDhaka,
  endDateDhaka,
  jobs,
  companyLogoDataUrl = '',
  loading,
  onRefresh,
  onLogout,
  onOpenChangePassword,
  onOpenDeviceSecurity,
  onNotify,
  onCompleteJob,
}: SupervisorJobsViewProps) {
  const [activeJob, setActiveJob] = useState<SupervisorJobView | null>(null);
  const [transport, setTransport] = useState('0');
  const [meals, setMeals] = useState('0');
  const [otherRows, setOtherRows] = useState<Array<{ description: string; amount: string }>>([]);
  const [fullBillChecked, setFullBillChecked] = useState(false);
  const [confirmedWorkerIds, setConfirmedWorkerIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const groupedByDate = useMemo(() => {
    const map = new Map<string, SupervisorJobView[]>();
    for (const job of jobs) {
      const list = map.get(job.scheduled_date) || [];
      list.push(job);
      map.set(job.scheduled_date, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [jobs]);

  const openCompleteModal = (job: SupervisorJobView) => {
    setActiveJob(job);
    setTransport('0');
    setMeals('0');
    setOtherRows([]);
    setFullBillChecked(!job.is_no_charge_visit);
    setConfirmedWorkerIds((job.assigned_workers || []).map((w) => w.worker_id));
    setFormError('');
  };

  const parseNum = (val: string) => {
    const n = Number(bnToEnDigits(val || '0'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };

  const liveCalc = useMemo(() => {
    if (!activeJob) return null;
    const t = parseNum(transport);
    const m = parseNum(meals);
    const otherTotal = otherRows.reduce((s, r) => s + parseNum(r.amount), 0);
    const actualExpenses = t + m + otherTotal;
    const collected = activeJob.is_no_charge_visit ? 0 : activeJob.price_bdt;
    const settlement = collected + activeJob.advance_given - actualExpenses;
    const direction = getSettlementDirectionLabel(settlement);
    return { t, m, otherTotal, actualExpenses, settlement, direction };
  }, [activeJob, transport, meals, otherRows]);

  const toggleWorker = (workerId: string) => {
    setConfirmedWorkerIds((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId]
    );
  };

  const handleSubmitCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeJob || submitting) return;
    setFormError('');

    const isNoCharge = Boolean(activeJob.is_no_charge_visit);
    if (!isNoCharge && !fullBillChecked) {
      setFormError('Please confirm that the full job bill has been collected.');
      return;
    }

    const parsedOthers: OtherExpenseItem[] = [];
    for (const row of otherRows) {
      const amt = parseNum(row.amount);
      const desc = row.description.trim();
      if (amt === 0 && !desc) continue;
      if (amt > 0 && !desc) {
        setFormError('Please enter a description for every other expense item.');
        return;
      }
      parsedOthers.push({ description: desc || 'Other', amount: amt });
    }

    setSubmitting(true);
    try {
      await onCompleteJob(activeJob.order_id, {
        transport_cost: parseNum(transport),
        meals_cost: parseNum(meals),
        other_expenses: parsedOthers,
        full_bill_collected: !isNoCharge,
        confirmed_worker_ids: confirmedWorkerIds,
      });
      setActiveJob(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to submit job completion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 sm:px-6">
        <BrandLogo
          logoDataUrl={companyLogoDataUrl}
          variant="light"
          compact
          subtitle={`My Jobs · ${user.name}`}
        />

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <PWAInstallButton variant="header" onNotify={onNotify} />
          {onOpenDeviceSecurity && (
            <button
              type="button"
              onClick={onOpenDeviceSecurity}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
              title="Device Unlock & Active Sessions"
            >
              <Fingerprint className="h-3.5 w-3.5 text-[#0F766E]" />
              <span className="hidden md:inline">Device Unlock</span>
            </button>
          )}
          {onOpenChangePassword && (
            <button
              type="button"
              onClick={onOpenChangePassword}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
              title="Change Password"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#0F766E]" />
              <span className="hidden sm:inline">Password</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
            title="Refresh Jobs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 text-xs font-semibold text-slate-600 hover:text-red-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-[#0B1F3A]">My Jobs</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Assigned jobs for the next 7 days ({formatEnDateShort(todayDhaka)} –{' '}
              {formatEnDateShort(endDateDhaka)})
            </p>
          </div>
          <div className="font-mono text-xs font-semibold tabular-nums text-teal-800">
            Total Jobs: {jobs.length}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-slate-500">
            <div className="mb-3 h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
            <span>Loading your assigned jobs...</span>
          </div>
        ) : groupedByDate.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
            <h2 className="text-base font-bold text-[#0B1F3A]">
              No assigned jobs for the next 7 days
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Jobs assigned to you by the admin for today through the next 6 days will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedByDate.map(([dateStr, dayJobs]) => (
              <section key={dateStr} className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h2 className="text-sm font-bold text-[#0B1F3A]">
                    {dateStr === todayDhaka
                      ? `Today · ${formatEnDateShort(dateStr)}`
                      : formatEnDateShort(dateStr)}
                  </h2>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {dayJobs.length} job{dayJobs.length === 1 ? '' : 's'}
                  </span>
                </div>

                {dayJobs.map((job) => {
                  const settlementInfo = getSettlementDirectionLabel(job.supervisor_settlement);
                  const safeMapsUrl = job.building_summary?.maps_url
                    ? validateSafeExternalUrl(job.building_summary.maps_url)
                    : '';

                  return (
                    <article
                      key={job.order_id}
                      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums text-slate-500">
                            <span className="font-semibold text-[#0B1F3A]">{job.order_id}</span>
                            <span>·</span>
                            <span>Time: {formatTime12h(job.scheduled_time || '10:00')}</span>
                            {job.is_no_charge_visit && (
                              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-amber-800">
                                No-Charge Return Visit
                              </span>
                            )}
                          </div>
                          <h3 className="mt-1 text-base font-bold text-[#0B1F3A]">
                            {job.customer_name}
                          </h3>
                          <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-600">
                            {job.phone_display}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <StatusBadge status={job.status} />
                          {(job.status_locked || isOrderStatusLocked(job)) && (
                            <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                              <Lock className="h-2.5 w-2.5" />
                              Status Locked
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <div className="flex items-start gap-2">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <span>
                            {job.area ? `${job.area} — ` : ''}
                            {job.address}
                          </span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">Services: </span>
                          {translateServiceToEnglish(job.services_text)}
                        </div>
                        {job.instructions && (
                          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                            <span className="font-semibold text-[#0B1F3A]">Instructions: </span>
                            {job.instructions}
                          </div>
                        )}
                      </div>

                      {/* Read-Only Building & Water Tank Info for Supervisor */}
                      {job.building_summary && (
                        <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50/50 p-3 text-xs text-slate-700">
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 font-bold text-[#0B1F3A]">
                              <Building2 className="h-3.5 w-3.5 text-teal-700" />
                              {job.building_summary.name} (Building & Tank Details)
                            </span>
                            {safeMapsUrl && (
                              <a
                                href={safeMapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline"
                              >
                                Google Maps
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            <div className="rounded bg-white/80 px-2.5 py-1.5 border border-teal-100">
                              <span className="font-semibold text-slate-500">Overhead Tank: </span>
                              <span className="font-semibold text-[#0B1F3A]">
                                {job.building_summary.overhead_tank_qty > 0
                                  ? `${job.building_summary.overhead_tank_qty}x${
                                      job.building_summary.overhead_tank_capacity_litres
                                        ? ` ${job.building_summary.overhead_tank_capacity_litres}L`
                                        : ''
                                    } (${job.building_summary.overhead_tank_material})`
                                  : 'None'}
                              </span>
                            </div>
                            <div className="rounded bg-white/80 px-2.5 py-1.5 border border-teal-100">
                              <span className="font-semibold text-slate-500">Reserve Tank: </span>
                              <span className="font-semibold text-[#0B1F3A]">
                                {job.building_summary.reserve_tank_qty > 0
                                  ? `${job.building_summary.reserve_tank_qty}x${
                                      job.building_summary.reserve_tank_capacity_litres
                                        ? ` ${job.building_summary.reserve_tank_capacity_litres}L`
                                        : ''
                                    } (${job.building_summary.reserve_tank_material})`
                                  : 'None'}
                              </span>
                            </div>
                          </div>
                          {job.building_summary.access_instructions && (
                            <div className="mt-1.5">
                              <span className="font-semibold text-slate-500">Access: </span>
                              {job.building_summary.access_instructions}
                            </div>
                          )}
                          {job.building_summary.tank_notes && (
                            <div className="mt-1">
                              <span className="font-semibold text-slate-500">Tank Notes: </span>
                              {job.building_summary.tank_notes}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Assigned Workers (Names Only) */}
                      {(job.assigned_workers || []).length > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-500">
                            <Users className="h-3.5 w-3.5 text-teal-700" />
                            Assigned Workers:
                          </span>
                          {job.assigned_workers.map((w) => (
                            <span
                              key={w.id}
                              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold text-[#0B1F3A]"
                            >
                              {w.worker_name}
                              {job.status === 'Completed' && w.confirmed_worked ? ' ✓' : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-3.5 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-xs">
                        <div>
                          <div className="text-slate-500">Agreed Full Bill</div>
                          <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-[#0B1F3A]">
                            {job.is_no_charge_visit
                              ? '৳0 (No-Charge)'
                              : `৳${formatBdt(job.price_bdt)}`}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Advance Given</div>
                          <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-teal-800">
                            ৳{formatBdt(job.advance_given)}
                          </div>
                        </div>
                      </div>

                      {job.status === 'Completed' ? (
                        <div className="mt-3.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-slate-700">
                          <div className="font-bold text-emerald-800">
                            {job.is_no_charge_visit
                              ? 'No-Charge Return Visit Completed'
                              : 'Job Completed & Full Bill Collection Recorded'}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono tabular-nums">
                            <span>Actual Cost: ৳{formatBdt(job.actual_expenses)}</span>
                            <span>·</span>
                            <span>
                              {settlementInfo.label}: ৳{formatBdt(settlementInfo.amount)}
                            </span>
                            <span>·</span>
                            <span className="font-sans font-semibold text-[#0B1F3A]">
                              {job.settlement_status}
                            </span>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3.5">
                        <a
                          href={buildTelLink(job.phone_e164, job.phone_display)}
                          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-xs font-semibold text-[#0B1F3A]"
                        >
                          <Phone className="h-4 w-4" />
                          Call
                        </a>
                        <a
                          href={buildWhatsAppLink(job)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 text-xs font-semibold text-emerald-700"
                        >
                          <MessageCircle className="h-4 w-4" />
                          WhatsApp
                        </a>

                        {job.status !== 'Completed' && !(job.status_locked || isOrderStatusLocked(job)) && (
                          <button
                            type="button"
                            onClick={() => openCompleteModal(job)}
                            className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-lg bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Complete Job
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </main>

      {/* Supervisor Completion Modal */}
      {activeJob && liveCalc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sup-complete-title"
        >
          <div className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 id="sup-complete-title" className="text-lg font-bold text-[#0B1F3A]">
                Complete Job ({activeJob.order_id})
              </h2>
              <button
                type="button"
                onClick={() => !submitting && setActiveJob(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleSubmitCompletion}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <div className="space-y-4 overflow-y-auto px-5 py-4">
                <div className="text-sm font-semibold text-[#0B1F3A]">
                  {activeJob.customer_name} ·{' '}
                  <span className="font-mono">{activeJob.phone_display}</span>
                </div>

                {/* Read-only Bill & Advance */}
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
                  <div>
                    <div className="text-slate-500">Agreed Full Bill (Read-Only)</div>
                    <div className="mt-1 font-mono text-lg font-bold tabular-nums text-[#0B1F3A]">
                      {activeJob.is_no_charge_visit
                        ? '৳0 (No-Charge)'
                        : `৳${formatBdt(activeJob.price_bdt)}`}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Advance Given (Read-Only)</div>
                    <div className="mt-1 font-mono text-lg font-bold tabular-nums text-teal-800">
                      ৳{formatBdt(activeJob.advance_given)}
                    </div>
                  </div>
                </div>

                {formError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                      1. Transport Cost (BDT)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={transport}
                      onChange={(e) => setTransport(e.target.value)}
                      className="h-11 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                      2. Meals Cost (BDT)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={meals}
                      onChange={(e) => setMeals(e.target.value)}
                      className="h-11 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Other Expenses */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-sm font-semibold text-[#0B1F3A]">
                      3. Other Expenses (Itemized)
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setOtherRows((prev) => [...prev, { description: '', amount: '' }])
                      }
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Expense
                    </button>
                  </div>

                  {otherRows.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Leave empty if there are no other expenses.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {otherRows.map((row, idx) => (
                        <div key={idx} className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Description (e.g. Bleaching / Brush)"
                            value={row.description}
                            onChange={(e) =>
                              setOtherRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, description: e.target.value } : r
                                )
                              )
                            }
                            className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm text-[#0B1F3A]"
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="BDT"
                            value={row.amount}
                            onChange={(e) =>
                              setOtherRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, amount: e.target.value } : r
                                )
                              )
                            }
                            className="h-10 w-24 rounded-lg border border-slate-300 px-2.5 font-mono text-sm tabular-nums text-[#0B1F3A]"
                          />
                          <button
                            type="button"
                            aria-label="Remove item"
                            onClick={() =>
                              setOtherRows((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Confirm Participating Workers */}
                {(activeJob.assigned_workers || []).length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-bold text-[#0B1F3A]">
                      Confirm Which Workers Worked on This Job
                    </div>
                    <div className="space-y-1.5">
                      {activeJob.assigned_workers.map((w) => (
                        <label
                          key={w.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#0B1F3A]"
                        >
                          <input
                            type="checkbox"
                            checked={confirmedWorkerIds.includes(w.worker_id)}
                            onChange={() => toggleWorker(w.worker_id)}
                            className="h-4 w-4 rounded accent-teal-600"
                          />
                          <span>{w.worker_name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Live Calculated Summary */}
                <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Total Job Expenses</span>
                    <span className="font-mono font-bold tabular-nums text-[#0B1F3A]">
                      ৳{formatBdt(liveCalc.actualExpenses)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-teal-200 pt-2">
                    <span className="font-semibold text-teal-900">
                      {liveCalc.direction.label}
                    </span>
                    <span
                      className={`font-mono text-lg font-bold tabular-nums ${
                        liveCalc.direction.tone === 'negative'
                          ? 'text-red-700'
                          : 'text-[#0B1F3A]'
                      }`}
                    >
                      ৳{formatBdt(liveCalc.direction.amount)}
                    </span>
                  </div>
                </div>

                {/* Mandatory Full Bill Confirmation (skipped for no-charge visits) */}
                {!activeJob.is_no_charge_visit ? (
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
                    <input
                      type="checkbox"
                      checked={fullBillChecked}
                      onChange={(e) => setFullBillChecked(e.target.checked)}
                      className="mt-0.5 h-5 w-5 rounded accent-teal-600"
                    />
                    <span className="text-sm font-semibold text-[#0B1F3A]">
                      I have collected the full job bill (৳{formatBdt(activeJob.price_bdt)})
                    </span>
                  </label>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900">
                    No-Charge Return Visit: Do not collect payment from the customer.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setActiveJob(null)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || (!activeJob.is_no_charge_visit && !fullBillChecked)}
                  className="h-10 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Confirm Completion'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
