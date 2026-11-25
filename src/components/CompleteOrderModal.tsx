import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Plus, Trash2, Users, X } from 'lucide-react';
import {
  AppSettings,
  FollowupMode,
  FollowupUnit,
  OrderRecord,
  OtherExpenseItem,
} from '../types/order';
import {
  addCalendarDays,
  addCalendarMonths,
  bnToEnDigits,
  formatBdt,
  formatEnDateShort,
  getTodayDhakaIso,
  isValidIsoDate,
} from '../utils/dateAndPhone';
import { getSettlementDirectionLabel } from '../utils/orderPredicates';

interface CompleteOrderModalProps {
  open: boolean;
  order: OrderRecord | null;
  settings: AppSettings;
  onClose: () => void;
  onConfirm: (params: {
    order_id: string;
    completion_date: string;
    transport_cost: number;
    meals_cost: number;
    other_expenses: OtherExpenseItem[];
    full_bill_collected: boolean;
    confirmed_worker_ids?: string[];
    followup_mode: FollowupMode;
    custom_value?: number;
    custom_unit?: FollowupUnit;
    followup_date?: string;
  }) => Promise<void>;
}

export function CompleteOrderModal({
  open,
  order,
  settings,
  onClose,
  onConfirm,
}: CompleteOrderModalProps) {
  const [completionDate, setCompletionDate] = useState(getTodayDhakaIso());
  const [transport, setTransport] = useState('0');
  const [meals, setMeals] = useState('0');
  const [otherRows, setOtherRows] = useState<Array<{ description: string; amount: string }>>([]);
  const [fullBillCollected, setFullBillCollected] = useState(true);
  const [confirmedWorkerIds, setConfirmedWorkerIds] = useState<string[]>([]);
  const [mode, setMode] = useState<FollowupMode>('default');
  const [customVal, setCustomVal] = useState(6);
  const [customUnit, setCustomUnit] = useState<FollowupUnit>('months');
  const [exactDate, setExactDate] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    const base = order.completion_date || getTodayDhakaIso();
    setCompletionDate(base);
    setTransport(String(order.transport_cost || 0));
    setMeals(String(order.meals_cost || 0));
    setOtherRows(
      (order.other_expenses || []).map((it) => ({
        description: it.description,
        amount: String(it.amount),
      }))
    );
    setFullBillCollected(!order.is_no_charge_visit);
    setConfirmedWorkerIds((order.assigned_workers || []).map((w) => w.worker_id));
    setMode('default');
    setCustomVal(settings.default_followup_value || 6);
    setCustomUnit(settings.default_followup_unit || 'months');
    const defDate =
      settings.default_followup_unit === 'days'
        ? addCalendarDays(base, settings.default_followup_value || 6)
        : addCalendarMonths(base, settings.default_followup_value || 6);
    setExactDate(defDate);
    setError('');
    setSubmitting(false);
  }, [open, order, settings]);

  const parseNum = (val: string) => {
    const n = Number(bnToEnDigits(val || '0'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };

  const liveFinancials = useMemo(() => {
    if (!order) return null;
    const t = parseNum(transport);
    const m = parseNum(meals);
    const otherTotal = otherRows.reduce((s, r) => s + parseNum(r.amount), 0);
    const confirmedWorkerPay = (order.assigned_workers || [])
      .filter((w) => confirmedWorkerIds.includes(w.worker_id))
      .reduce((s, w) => s + (Number(w.agreed_pay_bdt) || 0), 0);
    const actualExpenses = t + m + otherTotal + confirmedWorkerPay;
    const collectedAmount = order.is_no_charge_visit ? 0 : order.price_bdt;
    const settlement = collectedAmount + order.advance_given - (t + m + otherTotal);
    const profit = collectedAmount - actualExpenses;
    return {
      confirmedWorkerPay,
      actualExpenses,
      settlement,
      profit,
      direction: getSettlementDirectionLabel(settlement),
    };
  }, [order, transport, meals, otherRows, confirmedWorkerIds]);

  const preview = useMemo(() => {
    if (!isValidIsoDate(completionDate)) return null;
    if (mode === 'exact') {
      return isValidIsoDate(exactDate)
        ? { followupDate: exactDate, ruleNote: 'Exact Date' }
        : null;
    }
    const val = mode === 'custom' ? customVal : settings.default_followup_value || 6;
    const unit = mode === 'custom' ? customUnit : settings.default_followup_unit || 'months';
    if (!Number.isInteger(val) || val < 1) return null;
    if (unit === 'months') {
      const nextDate = addCalendarMonths(completionDate, val);
      return {
        followupDate: nextDate,
        ruleNote: `${val} month${val === 1 ? '' : 's'} (${mode === 'custom' ? 'Custom' : 'Default'})`,
      };
    }
    return {
      followupDate: addCalendarDays(completionDate, val),
      ruleNote: `${val} day${val === 1 ? '' : 's'} (${mode === 'custom' ? 'Custom' : 'Default'})`,
    };
  }, [completionDate, mode, customVal, customUnit, exactDate, settings]);

  if (!open || !order || !liveFinancials) return null;

  const isNoCharge = Boolean(order.is_no_charge_visit);

  const toggleConfirmedWorker = (workerId: string) => {
    setConfirmedWorkerIds((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    if (!isNoCharge && !fullBillCollected) {
      setError('Please confirm that the full job bill has been collected before completing.');
      return;
    }
    if (!isValidIsoDate(completionDate)) {
      setError('Please select a valid completion date.');
      return;
    }
    if (!isNoCharge && mode === 'exact' && !isValidIsoDate(exactDate)) {
      setError('Please select a valid follow-up date.');
      return;
    }

    const parsedOthers: OtherExpenseItem[] = [];
    for (const row of otherRows) {
      const amt = parseNum(row.amount);
      const desc = row.description.trim();
      if (amt === 0 && !desc) continue;
      if (amt > 0 && !desc) {
        setError('Please enter a description for every other expense item.');
        return;
      }
      parsedOthers.push({ description: desc || 'Other', amount: amt });
    }

    setSubmitting(true);
    try {
      await onConfirm({
        order_id: order.order_id,
        completion_date: completionDate,
        transport_cost: parseNum(transport),
        meals_cost: parseNum(meals),
        other_expenses: parsedOthers,
        full_bill_collected: !isNoCharge,
        confirmed_worker_ids: confirmedWorkerIds,
        followup_mode: mode,
        custom_value: customVal,
        custom_unit: customUnit,
        followup_date: exactDate,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save job completion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="complete-modal-heading"
    >
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id="complete-modal-heading" className="text-lg font-bold text-[#0B1F3A]">
            {isNoCharge
              ? 'Complete No-Charge Return Visit'
              : 'Complete Job, Expenses & Follow-Up'}
          </h2>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <div className="text-sm text-slate-600">
              <span className="font-mono font-semibold text-[#0B1F3A]">{order.order_id}</span>
              <span className="mx-1.5">·</span>
              <span className="font-semibold text-[#0B1F3A]">{order.customer_name}</span>
              <span className="mx-1.5">·</span>
              <span className="font-mono tabular-nums">
                Bill: {isNoCharge ? '৳0 (No-Charge)' : `৳${formatBdt(order.price_bdt)}`}
              </span>
              <span className="mx-1.5">·</span>
              <span className="font-mono tabular-nums">
                Advance: ৳{formatBdt(order.advance_given)}
              </span>
            </div>

            {isNoCharge && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <span>
                  This is a <strong>No-Charge Return Visit</strong> linked to{' '}
                  <strong className="font-mono">{order.parent_order_id}</strong>. Customer bill
                  collection is ৳0, no Money Receipt can be issued, no 6-month follow-up is created,
                  and actual expenses will roll up once into the original job's profit/loss.
                </span>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                  Completion Date *
                </label>
                <input
                  type="date"
                  required
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-[#0B1F3A]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                  1. Transport Cost (BDT)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={transport}
                  onChange={(e) => setTransport(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-[#0B1F3A]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                  2. Meals Cost (BDT)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={meals}
                  onChange={(e) => setMeals(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-[#0B1F3A]"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-[#0B1F3A]">
                  3. Other Expenses (Itemized)
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setOtherRows((prev) => [...prev, { description: '', amount: '' }])
                  }
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Item
                </button>
              </div>
              {otherRows.length > 0 && (
                <div className="space-y-2">
                  {otherRows.map((row, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Description (e.g. Bleaching powder)"
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
                            prev.map((r, i) => (i === idx ? { ...r, amount: e.target.value } : r))
                          )
                        }
                        className="h-10 w-24 rounded-lg border border-slate-300 px-2.5 font-mono text-sm tabular-nums text-[#0B1F3A]"
                      />
                      <button
                        type="button"
                        onClick={() => setOtherRows((prev) => prev.filter((_, i) => i !== idx))}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(order.assigned_workers || []).length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="mb-2 flex items-center justify-between text-xs font-bold text-[#0B1F3A]">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-teal-700" />
                    Confirm Participating Workers
                  </span>
                  <span className="font-mono text-teal-800">
                    Labour Pay: ৳{formatBdt(liveFinancials.confirmedWorkerPay)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {order.assigned_workers.map((w) => {
                    const checked = confirmedWorkerIds.includes(w.worker_id);
                    return (
                      <label
                        key={w.id}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleConfirmedWorker(w.worker_id)}
                            className="h-4 w-4 rounded accent-teal-600"
                          />
                          <span className="font-semibold text-[#0B1F3A]">{w.worker_name}</span>
                        </div>
                        <span className="font-mono font-semibold text-slate-600">
                          Pay: ৳{formatBdt(w.agreed_pay_bdt)}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Only checked workers earn their Pay for This Job and are counted once in job
                  labour cost.
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div>
                <div className="text-slate-500">Total Actual Cost</div>
                <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#0B1F3A]">
                  ৳{formatBdt(liveFinancials.actualExpenses)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">{liveFinancials.direction.label}</div>
                <div
                  className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                    liveFinancials.direction.tone === 'negative'
                      ? 'text-red-700'
                      : 'text-[#0B1F3A]'
                  }`}
                >
                  ৳{formatBdt(liveFinancials.direction.amount)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Job Profit / Loss</div>
                <div
                  className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                    liveFinancials.profit < 0 ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  ৳{formatBdt(liveFinancials.profit)}
                </div>
              </div>
            </div>

            {!isNoCharge && (
              <>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5">
                  <input
                    type="checkbox"
                    checked={fullBillCollected}
                    onChange={(e) => setFullBillCollected(e.target.checked)}
                    className="h-4 w-4 rounded accent-teal-600"
                  />
                  <span className="text-sm font-semibold text-[#0B1F3A]">
                    Full job bill (৳{formatBdt(order.price_bdt)}) has been collected
                  </span>
                </label>

                <div className="border-t border-slate-100 pt-3">
                  <label className="mb-2 block text-sm font-semibold text-[#0B1F3A]">
                    Next Repeat Cleaning Follow-Up
                  </label>
                  <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setMode('default')}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        mode === 'default' ? 'bg-white text-[#0B1F3A] shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      Default ({settings.default_followup_value}{' '}
                      {settings.default_followup_unit === 'months' ? 'months' : 'days'})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('custom')}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        mode === 'custom' ? 'bg-white text-[#0B1F3A] shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      Custom Days / Months
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('exact')}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        mode === 'exact' ? 'bg-white text-[#0B1F3A] shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      Exact Date
                    </button>
                  </div>

                  {mode === 'custom' && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <input
                        type="number"
                        min={1}
                        max={3650}
                        value={customVal}
                        onChange={(e) => setCustomVal(Number(e.target.value))}
                        className="h-10 rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-[#0B1F3A]"
                      />
                      <select
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value as FollowupUnit)}
                        className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A]"
                      >
                        <option value="months">Calendar Months</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                  )}

                  {mode === 'exact' && (
                    <input
                      type="date"
                      required
                      value={exactDate}
                      onChange={(e) => setExactDate(e.target.value)}
                      className="mt-3 h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-[#0B1F3A]"
                    />
                  )}

                  <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3.5">
                    <div className="text-xs font-semibold text-teal-800">
                      Calculated Next Follow-Up Date
                    </div>
                    <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-[#0B1F3A]">
                      {preview
                        ? `${formatEnDateShort(preview.followupDate)} (${preview.followupDate})`
                        : '—'}
                    </div>
                    {preview && (
                      <div className="mt-0.5 text-xs text-slate-600">Rule: {preview.ruleNote}</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (!isNoCharge && !fullBillCollected)}
              className="h-10 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Mark as Completed'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
