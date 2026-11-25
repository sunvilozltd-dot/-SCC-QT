import { useMemo } from 'react';
import { ArrowRight, Plus, RotateCcw, Search, Wallet, X } from 'lucide-react';
import {
  DEFAULT_SERVICES,
  OrderRecord,
  OrderStatus,
  SupervisorAccount,
  VALID_STATUSES,
} from '../types/order';
import { formatBdt, formatDateEn, translateServiceToEnglish } from '../utils/dateAndPhone';
import {
  isNext7DaysWork,
  isOngoingWork,
  isSettlementPending,
  isTodayOrOngoingWork,
  isTodayWork,
  OrdersPresetFilter,
} from '../utils/orderPredicates';
import { OrdersTableAndCards } from './OrdersTableAndCards';

export interface OrdersFilterState {
  query: string;
  status: OrderStatus | '';
  service: string;
  date: string;
  supervisorId: string;
  preset: OrdersPresetFilter;
}

interface OrdersViewProps {
  orders: OrderRecord[];
  supervisors: SupervisorAccount[];
  todayDhaka: string;
  filters: OrdersFilterState;
  onChangeFilters: (next: OrdersFilterState) => void;
  onSelectOrder: (orderId: string) => void;
  onOpenWhatsApp?: (order: OrderRecord) => void;
  onNewOrder: () => void;
}

const PRESET_LABELS: Record<Exclude<OrdersPresetFilter, ''>, string> = {
  today: "Today's Work",
  ongoing: 'Ongoing Work (New, Confirmed, In Progress)',
  today_or_ongoing: 'Today & Ongoing Work',
  next7days: 'Next 7 Days Work',
  settlement_pending: 'Settlement Pending (Unsettled Supervisor Cash)',
};

export function OrdersView({
  orders,
  supervisors,
  todayDhaka,
  filters,
  onChangeFilters,
  onSelectOrder,
  onOpenWhatsApp,
  onNewOrder,
}: OrdersViewProps) {
  const allServices = useMemo(() => {
    const set = new Set<string>(DEFAULT_SERVICES);
    orders.forEach((o) =>
      o.services.forEach((s) => set.add(translateServiceToEnglish(s)))
    );
    return Array.from(set);
  }, [orders]);

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    const digitsOnly = q.replace(/\D/g, '');

    return orders.filter((order) => {
      if (filters.preset === 'today' && !isTodayWork(order, todayDhaka)) return false;
      if (filters.preset === 'ongoing' && !isOngoingWork(order)) return false;
      if (filters.preset === 'today_or_ongoing' && !isTodayOrOngoingWork(order, todayDhaka)) {
        return false;
      }
      if (filters.preset === 'next7days' && !isNext7DaysWork(order, todayDhaka)) return false;
      if (filters.preset === 'settlement_pending' && !isSettlementPending(order)) return false;

      if (filters.status && order.status !== filters.status) return false;
      if (filters.date && order.scheduled_date !== filters.date) return false;
      if (
        filters.service &&
        !order.services.some((s) => translateServiceToEnglish(s) === filters.service)
      ) {
        return false;
      }
      if (filters.supervisorId === '__unassigned__' && order.assigned_supervisor_id) return false;
      if (
        filters.supervisorId &&
        filters.supervisorId !== '__unassigned__' &&
        order.assigned_supervisor_id !== filters.supervisorId
      ) {
        return false;
      }

      if (q) {
        const workerNames = (order.assigned_workers || []).map((w) => w.worker_name).join(' ');
        const hay = `${order.order_id} ${order.customer_name} ${order.phone_display} ${order.phone_e164} ${order.building_name} ${order.area} ${order.address} ${order.assigned_supervisor_name} ${workerNames}`.toLowerCase();
        const phoneDigits = order.phone_display.replace(/\D/g, '');
        const match =
          hay.includes(q) || (digitsOnly.length >= 3 && phoneDigits.includes(digitsOnly));
        if (!match) return false;
      }

      return true;
    });
  }, [orders, filters, todayDhaka]);

  const hasActiveFilters = Boolean(
    filters.query ||
      filters.status ||
      filters.service ||
      filters.date ||
      filters.supervisorId ||
      filters.preset
  );

  const resetAll = () =>
    onChangeFilters({
      query: '',
      status: '',
      service: '',
      date: '',
      supervisorId: '',
      preset: '',
    });

  return (
    <div className="space-y-5">
      {/* Preset Quick Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 p-1">
          {(
            [
              { key: '', label: 'All Orders' },
              { key: 'today', label: "Today's Work" },
              { key: 'ongoing', label: 'Ongoing' },
              { key: 'today_or_ongoing', label: 'Today & Ongoing' },
              { key: 'next7days', label: 'Next 7 Days' },
              { key: 'settlement_pending', label: 'Settlement Pending' },
            ] as { key: OrdersPresetFilter; label: string }[]
          ).map((tab) => {
            const pendingCount =
              tab.key === 'settlement_pending'
                ? orders.filter((o) => isSettlementPending(o)).length
                : 0;
            return (
              <button
                key={tab.key || 'all'}
                type="button"
                onClick={() => onChangeFilters({ ...filters, preset: tab.key })}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filters.preset === tab.key
                    ? 'bg-white text-[#0B1F3A] shadow-sm'
                    : 'text-slate-600 hover:text-[#0B1F3A]'
                }`}
              >
                {tab.label}
                {tab.key === 'settlement_pending' && pendingCount > 0 && (
                  <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onNewOrder}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" />
          New Order
        </button>
      </div>

      {/* Filter Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
          <div className="relative sm:col-span-2 lg:col-span-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={filters.query}
              onChange={(e) => onChangeFilters({ ...filters, query: e.target.value })}
              placeholder="Order ID, customer, phone, building, area, team..."
              className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
            />
          </div>

          <div className="lg:col-span-2">
            <select
              value={filters.status}
              onChange={(e) =>
                onChangeFilters({ ...filters, status: e.target.value as OrderStatus | '' })
              }
              aria-label="Filter by status"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
            >
              <option value="">All Statuses</option>
              {VALID_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              value={filters.supervisorId}
              onChange={(e) => onChangeFilters({ ...filters, supervisorId: e.target.value })}
              aria-label="Filter by supervisor"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
            >
              <option value="">All Supervisors</option>
              <option value="__unassigned__">Unassigned</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {!s.is_active ? ' (Inactive)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              value={filters.service}
              onChange={(e) => onChangeFilters({ ...filters, service: e.target.value })}
              aria-label="Filter by service"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
            >
              <option value="">All Services</option>
              {allServices.map((srv) => (
                <option key={srv} value={srv}>
                  {srv}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <input
              type="date"
              value={filters.date}
              onChange={(e) => onChangeFilters({ ...filters, date: e.target.value })}
              aria-label="Filter by scheduled work date"
              className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Showing{' '}
              <strong className="font-mono tabular-nums text-[#0B1F3A]">{filtered.length}</strong>{' '}
              order{filtered.length === 1 ? '' : 's'}
            </span>
            {filters.preset && (
              <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-0.5 font-semibold text-teal-800">
                {PRESET_LABELS[filters.preset]}
                <button
                  type="button"
                  onClick={() => onChangeFilters({ ...filters, preset: '' })}
                  className="hover:text-teal-950"
                  aria-label="Clear preset"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-[#0B1F3A]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {filters.preset === 'settlement_pending' ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-amber-50/70 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-amber-700" />
              <h2 className="text-sm font-bold text-[#0B1F3A]">
                Pending Supervisor Settlements ({filtered.length})
              </h2>
            </div>
            <div className="text-xs font-medium text-amber-900">
              Click any order to open its Supervisor Settlement form and record deposit or
              reimbursement.
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-sm font-semibold text-[#0B1F3A]">
                No pending supervisor settlements
              </div>
              <p className="mt-1 text-xs text-slate-500">
                All completed jobs matching your current filters have settled or balanced supervisor
                cash.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                    <th className="px-4 py-3">Order ID</th>
                    <th className="px-4 py-3">Customer / Completed</th>
                    <th className="px-4 py-3">Supervisor</th>
                    <th className="px-4 py-3 text-right">Expected Amount</th>
                    <th className="px-4 py-3 text-right">Amount Settled</th>
                    <th className="px-4 py-3 text-right">Remaining Amount</th>
                    <th className="px-4 py-3">Direction</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((order) => {
                    const expectedAbs = Math.abs(Number(order.supervisor_settlement || 0));
                    const settled = Number(order.settlement_actual_total || 0);
                    const remaining = Math.max(0, expectedAbs - settled);
                    const isReceive = order.supervisor_settlement > 0;
                    return (
                      <tr
                        key={order.order_id}
                        onClick={() => onSelectOrder(order.order_id)}
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                      >
                        <td className="px-4 py-3 font-mono font-bold text-[#0B1F3A]">
                          <div>{order.order_id}</div>
                          {order.is_no_charge_visit && (
                            <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-600">
                              No-Charge Visit
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#0B1F3A]">{order.customer_name}</div>
                          <div className="text-[11px] text-slate-500">
                            Completed: {formatDateEn(order.completion_date || order.scheduled_date)}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700">
                          {order.assigned_supervisor_name || 'Unassigned'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-[#0B1F3A]">
                          BDT {formatBdt(expectedAbs)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                          BDT {formatBdt(settled)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-amber-800">
                          BDT {formatBdt(remaining)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                              isReceive
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-rose-50 text-rose-800 border border-rose-200'
                            }`}
                          >
                            {isReceive
                              ? 'Admin to Receive Deposit'
                              : 'Admin to Pay Reimbursement'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectOrder(order.order_id);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0c6059]"
                          >
                            Record Settlement
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <OrdersTableAndCards
          orders={filtered}
          onSelectOrder={onSelectOrder}
          onOpenWhatsApp={onOpenWhatsApp}
          emptyTitle="No orders match these filters"
          emptyDescription="Try clearing your search text or changing the status, supervisor, or date filter."
        />
      )}
    </div>
  );
}
