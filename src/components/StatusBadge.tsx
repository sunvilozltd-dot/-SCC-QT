import { OrderStatus } from '../types/order';
import { normalizeOrderStatus } from '../utils/dateAndPhone';

interface StatusBadgeProps {
  status: OrderStatus | string;
}

const STATUS_STYLE: Record<string, string> = {
  New: 'bg-blue-50 text-blue-700 border-blue-200',
  Confirmed: 'bg-teal-50 text-teal-700 border-teal-200',
  'In Progress': 'bg-amber-50 text-amber-800 border-amber-200',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Cancelled: 'bg-red-50 text-red-700 border-red-200',
  Draft: 'bg-slate-100 text-slate-700 border-slate-200',
  Sent: 'bg-blue-50 text-blue-700 border-blue-200',
  Accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Pending: 'bg-amber-50 text-amber-800 border-amber-200',
  Settled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Balanced: 'bg-slate-100 text-slate-700 border-slate-200',
  'Not Applicable': 'bg-slate-50 text-slate-500 border-slate-200',
  Open: 'bg-red-50 text-red-700 border-red-200',
  'Return Visit Scheduled': 'bg-amber-50 text-amber-800 border-amber-200',
  Resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Unpaid: 'bg-amber-50 text-amber-800 border-amber-200',
  Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const display = STATUS_STYLE[status] ? status : normalizeOrderStatus(status);
  const cls = STATUS_STYLE[display] || 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-md border whitespace-nowrap shrink-0 ${cls}`}
    >
      {display}
    </span>
  );
}
