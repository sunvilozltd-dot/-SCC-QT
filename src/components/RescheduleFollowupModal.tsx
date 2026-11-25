import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { AppSettings, FollowupMode, FollowupUnit, OrderRecord } from '../types/order';
import {
  addCalendarDays,
  addCalendarMonths,
  formatEnDateShort,
  getTodayDhakaIso,
  isValidIsoDate,
} from '../utils/dateAndPhone';

interface RescheduleFollowupModalProps {
  open: boolean;
  order: OrderRecord | null;
  settings: AppSettings;
  onClose: () => void;
  onConfirm: (params: {
    order_id: string;
    followup_mode: FollowupMode;
    base_date?: string;
    custom_value?: number;
    custom_unit?: FollowupUnit;
    followup_date?: string;
  }) => Promise<void> | void;
}

export function RescheduleFollowupModal({
  open,
  order,
  onClose,
  onConfirm,
}: RescheduleFollowupModalProps) {
  const [mode, setMode] = useState<'exact' | 'custom'>('exact');
  const [exactDate, setExactDate] = useState('');
  const [baseDate, setBaseDate] = useState('');
  const [customVal, setCustomVal] = useState(3);
  const [customUnit, setCustomUnit] = useState<FollowupUnit>('months');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setMode('exact');
    setExactDate(order.followup_date || getTodayDhakaIso());
    setBaseDate(order.completion_date || getTodayDhakaIso());
    setCustomVal(3);
    setCustomUnit('months');
    setError('');
    setSubmitting(false);
  }, [open, order]);

  const previewDate = useMemo(() => {
    if (mode === 'exact') {
      return isValidIsoDate(exactDate) ? exactDate : '';
    }
    const base = isValidIsoDate(baseDate) ? baseDate : getTodayDhakaIso();
    const val = Number(customVal);
    if (!Number.isInteger(val) || val < 1) return '';
    try {
      return customUnit === 'days'
        ? addCalendarDays(base, val)
        : addCalendarMonths(base, val);
    } catch {
      return '';
    }
  }, [mode, exactDate, baseDate, customVal, customUnit]);

  if (!open || !order) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'exact' && !isValidIsoDate(exactDate)) {
      setError('Please select a valid follow-up date.');
      return;
    }
    if (mode === 'custom' && (!Number.isInteger(Number(customVal)) || Number(customVal) < 1)) {
      setError('Please enter a valid number of days or months.');
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm({
        order_id: order.order_id,
        followup_mode: mode,
        base_date: baseDate,
        custom_value: customVal,
        custom_unit: customUnit,
        followup_date: exactDate,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reschedule follow-up date.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-modal-heading"
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id="reschedule-modal-heading" className="text-lg font-bold text-[#0B1F3A]">
            Reschedule Follow-Up Date
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-6 py-5">
            <div className="text-sm text-slate-600">
              <span className="font-mono font-semibold text-[#0B1F3A]">{order.order_id}</span>
              <span className="mx-1.5">·</span>
              <span className="font-semibold text-[#0B1F3A]">{order.customer_name}</span>
              <span className="mx-1.5">·</span>
              <span>Current Follow-Up: {formatEnDateShort(order.followup_date)}</span>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMode('exact')}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  mode === 'exact'
                    ? 'bg-white text-[#0B1F3A] shadow-sm'
                    : 'text-slate-600 hover:text-[#0B1F3A]'
                }`}
              >
                Exact Date
              </button>
              <button
                type="button"
                onClick={() => setMode('custom')}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  mode === 'custom'
                    ? 'bg-white text-[#0B1F3A] shadow-sm'
                    : 'text-slate-600 hover:text-[#0B1F3A]'
                }`}
              >
                Custom Days / Months
              </button>
            </div>

            {mode === 'exact' ? (
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                  New Follow-Up Date *
                </label>
                <input
                  type="date"
                  required
                  value={exactDate}
                  onChange={(e) => setExactDate(e.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-300 px-3.5 font-mono text-sm tabular-nums text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Calculate From Date
                  </label>
                  <input
                    type="date"
                    value={baseDate}
                    onChange={(e) => setBaseDate(e.target.value)}
                    className="h-11 w-full rounded-lg border border-slate-300 px-3.5 font-mono text-sm tabular-nums text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Duration
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={customVal}
                      onChange={(e) => setCustomVal(Number(e.target.value))}
                      className="h-11 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-[#0B1F3A]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">Unit</label>
                    <select
                      value={customUnit}
                      onChange={(e) => setCustomUnit(e.target.value as FollowupUnit)}
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A]"
                    >
                      <option value="months">Calendar Months</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
              <div className="text-xs font-semibold text-teal-800">New Follow-Up Date</div>
              <div className="mt-1 font-mono text-lg font-bold tabular-nums text-[#0B1F3A]">
                {previewDate ? `${formatEnDateShort(previewDate)} (${previewDate})` : '—'}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Updating the date creates a fresh reminder version so the Gmail reminder can send on
                the new date without duplicates.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
            >
              {submitting ? 'Saving...' : 'Save New Date'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
