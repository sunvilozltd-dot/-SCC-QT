import { Building2, Clock, Lock, MapPin, MessageCircle, Phone, Repeat, UserCheck, Users } from 'lucide-react';
import { OrderRecord, isOrderStatusLocked } from '../types/order';
import {
  buildTelLink,
  buildWhatsAppLink,
  formatBdt,
  formatEnDateShort,
  formatTime12h,
  translateServiceToEnglish,
} from '../utils/dateAndPhone';
import { StatusBadge } from './StatusBadge';

interface OrdersTableAndCardsProps {
  orders: OrderRecord[];
  onSelectOrder: (orderId: string) => void;
  onOpenWhatsApp?: (order: OrderRecord) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function OrdersTableAndCards({
  orders,
  onSelectOrder,
  onOpenWhatsApp,
  emptyTitle = 'No orders found',
  emptyDescription = 'Create a new order or adjust your filters to see matching jobs.',
}: OrdersTableAndCardsProps) {
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
        <h3 className="text-base font-bold text-[#0B1F3A]">{emptyTitle}</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white lg:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">Customer & Location</th>
                <th className="px-4 py-3">Service & Schedule</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3 text-right">Agreed Bill</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {orders.map((order) => (
                <tr
                  key={order.order_id}
                  onClick={() => onSelectOrder(order.order_id)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap px-4 py-3.5 align-top">
                    <div className="font-mono text-xs font-bold tabular-nums text-[#0B1F3A]">
                      {order.order_id}
                    </div>
                    {order.quotation_id && (
                      <div className="mt-0.5 font-mono text-[11px] text-teal-700">
                        {order.quotation_id}
                      </div>
                    )}
                    {order.is_no_charge_visit ? (
                      <span className="mt-1 inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        No-Charge Return
                      </span>
                    ) : order.is_return_visit ? (
                      <span className="mt-1 inline-block rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                        Return Visit
                      </span>
                    ) : null}
                    {order.previous_order_id && (
                      <span className="mt-1 inline-flex items-center gap-0.5 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
                        <Repeat className="h-2.5 w-2.5" />
                        Repeat
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3.5 align-top">
                    <div className="font-semibold text-[#0B1F3A]">{order.customer_name}</div>
                    <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-600">
                      {order.phone_display}
                    </div>
                    {order.building_name && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-800">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {order.building_name}
                      </div>
                    )}
                    {(order.area || order.address) && (
                      <div className="mt-0.5 line-clamp-1 max-w-[230px] text-xs text-slate-500">
                        {order.area ? `${order.area} — ` : ''}
                        {order.address}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3.5 align-top">
                    <div className="line-clamp-2 max-w-[230px] text-sm text-slate-700">
                      {translateServiceToEnglish(order.services_text)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
                      <span className="font-semibold text-[#0B1F3A]">Work:</span>
                      <span className="font-mono tabular-nums">
                        {formatEnDateShort(order.scheduled_date)}
                        {order.scheduled_time ? ` · ${formatTime12h(order.scheduled_time)}` : ''}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      Booked:{' '}
                      <span className="font-mono tabular-nums">
                        {order.booking_date ? formatEnDateShort(order.booking_date) : 'Not recorded'}
                      </span>
                    </div>
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5 align-top">
                    {order.assigned_supervisor_name ? (
                      <div>
                        <div className="text-xs font-semibold text-[#0B1F3A]">
                          {order.assigned_supervisor_name}
                        </div>
                        {order.advance_given > 0 && (
                          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
                            Advance: ৳{formatBdt(order.advance_given)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Unassigned</span>
                    )}
                    {(order.assigned_workers || []).length > 0 && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-600">
                        <Users className="h-3 w-3 text-teal-700" />
                        {order.assigned_workers.length} worker
                        {order.assigned_workers.length > 1 ? 's' : ''}
                      </div>
                    )}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5 text-right align-top">
                    <div className="font-mono text-sm font-bold tabular-nums text-[#0B1F3A]">
                      {order.is_no_charge_visit ? '৳0 (No-Charge)' : `৳${formatBdt(order.price_bdt)}`}
                    </div>
                    {order.status === 'Completed' && (
                      <div
                        className={`mt-0.5 text-[11px] font-semibold ${
                          order.settlement_status === 'Settled' ||
                          order.settlement_status === 'Balanced'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {order.settlement_status}
                      </div>
                    )}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3.5 align-top">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={order.status} />
                      {(order.status_locked || isOrderStatusLocked(order)) && (
                        <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                          <Lock className="h-2.5 w-2.5" />
                          Status Locked
                        </span>
                      )}
                    </div>
                  </td>

                  <td
                    className="whitespace-nowrap px-4 py-3.5 text-right align-top"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex items-center gap-1.5">
                      <a
                        href={buildTelLink(order.phone_e164, order.phone_display)}
                        title="Call Customer"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#0B1F3A] hover:bg-slate-100"
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </a>
                      {onOpenWhatsApp ? (
                        <button
                          type="button"
                          onClick={() => onOpenWhatsApp(order)}
                          title="Send WhatsApp Message"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <a
                          href={buildWhatsAppLink(order)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="WhatsApp"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectOrder(order.order_id)}
                        className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                      >
                        Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 lg:hidden">
        {orders.map((order) => (
          <div
            key={order.order_id}
            onClick={() => onSelectOrder(order.order_id)}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition-colors active:bg-slate-50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold tabular-nums text-slate-500">
                  <span>{order.order_id}</span>
                  {order.is_no_charge_visit && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-amber-800 border border-amber-200">
                      No-Charge Return
                    </span>
                  )}
                  {order.previous_order_id && (
                    <span className="rounded bg-teal-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-teal-800 border border-teal-200">
                      Repeat
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-base font-bold text-[#0B1F3A]">
                  {order.customer_name}
                </div>
                <div className="font-mono text-xs tabular-nums text-slate-600">
                  {order.phone_display}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={order.status} />
                {(order.status_locked || isOrderStatusLocked(order)) && (
                  <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                    <Lock className="h-2.5 w-2.5" />
                    Status Locked
                  </span>
                )}
              </div>
            </div>

            <div className="mt-2.5 text-sm text-slate-700">
              {translateServiceToEnglish(order.services_text)}
            </div>

            {(order.building_name || order.area || order.address) && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="line-clamp-2">
                  {order.building_name ? `${order.building_name} · ` : ''}
                  {order.area ? `${order.area} — ` : ''}
                  {order.address}
                </span>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-600">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    Work: {formatEnDateShort(order.scheduled_date)}
                    {order.scheduled_time ? `, ${formatTime12h(order.scheduled_time)}` : ''}
                  </span>
                  <span className="inline-flex items-center gap-1 text-slate-700">
                    <UserCheck className="h-3.5 w-3.5 text-teal-600" />
                    {order.assigned_supervisor_name || 'Unassigned'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Booked:{' '}
                  <span className="font-mono tabular-nums">
                    {order.booking_date ? formatEnDateShort(order.booking_date) : 'Not recorded'}
                  </span>
                  {(order.assigned_workers || []).length > 0 && (
                    <span className="ml-2">
                      · {order.assigned_workers.length} worker
                      {order.assigned_workers.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              <span className="font-mono text-sm font-bold tabular-nums text-[#0B1F3A]">
                {order.is_no_charge_visit ? '৳0' : `৳${formatBdt(order.price_bdt)}`}
              </span>
            </div>

            <div
              className="mt-3 flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <a
                href={buildTelLink(order.phone_e164, order.phone_display)}
                className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-100"
              >
                <Phone className="h-3.5 w-3.5" />
                Call
              </a>
              {onOpenWhatsApp ? (
                <button
                  type="button"
                  onClick={() => onOpenWhatsApp(order)}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                </button>
              ) : (
                <a
                  href={buildWhatsAppLink(order)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                </a>
              )}
              <button
                type="button"
                onClick={() => onSelectOrder(order.order_id)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-[#0B1F3A] text-xs font-semibold text-white hover:bg-[#163056]"
              >
                Details
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
