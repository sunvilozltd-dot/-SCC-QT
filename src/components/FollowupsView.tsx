import { useMemo } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  MessageCircle,
  Phone,
  Repeat,
  RotateCcw,
} from 'lucide-react';
import { OrderRecord } from '../types/order';
import {
  buildTelLink,
  formatBdt,
  formatDateEn,
  translateServiceToEnglish,
} from '../utils/dateAndPhone';
import {
  isOverdueFollowup,
  isTodayFollowup,
  isUpcomingFollowup,
} from '../utils/orderPredicates';

export type FollowupTab = 'today' | 'overdue' | 'upcoming' | 'done';

interface FollowupsViewProps {
  orders: OrderRecord[];
  todayDhaka: string;
  activeTab: FollowupTab;
  onChangeTab: (tab: FollowupTab) => void;
  onSelectOrder: (orderId: string) => void;
  onReschedule: (order: OrderRecord) => void;
  onToggleDone: (orderId: string, isDone: boolean) => Promise<void>;
  onBookAgain: (order: OrderRecord) => void;
  onOpenWhatsApp: (order: OrderRecord) => void;
}

export function FollowupsView({
  orders,
  todayDhaka,
  activeTab,
  onChangeTab,
  onSelectOrder,
  onReschedule,
  onToggleDone,
  onBookAgain,
  onOpenWhatsApp,
}: FollowupsViewProps) {
  const counts = useMemo(() => {
    const today = orders.filter((o) => isTodayFollowup(o, todayDhaka)).length;
    const overdue = orders.filter((o) => isOverdueFollowup(o, todayDhaka)).length;
    const upcoming = orders.filter((o) => isUpcomingFollowup(o, todayDhaka)).length;
    const done = orders.filter(
      (o) => o.status === 'Completed' && !o.is_no_charge_visit && o.followup_done
    ).length;
    return { today, overdue, upcoming, done };
  }, [orders, todayDhaka]);

  const list = useMemo(() => {
    return orders
      .filter((o) => {
        if (activeTab === 'today') return isTodayFollowup(o, todayDhaka);
        if (activeTab === 'overdue') return isOverdueFollowup(o, todayDhaka);
        if (activeTab === 'upcoming') return isUpcomingFollowup(o, todayDhaka);
        return o.status === 'Completed' && !o.is_no_charge_visit && o.followup_done;
      })
      .sort((a, b) => (a.followup_date || '').localeCompare(b.followup_date || ''));
  }, [orders, todayDhaka, activeTab]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0B1F3A]">Service Follow-Ups</h1>
        <p className="text-sm text-slate-500">
          Contact completed customers when their next water tank cleaning is due and book repeat
          services in one click.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: 'today', label: `Due Today (${counts.today})` },
            { key: 'overdue', label: `Overdue (${counts.overdue})` },
            { key: 'upcoming', label: `Upcoming (${counts.upcoming})` },
            { key: 'done', label: `Done (${counts.done})` },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChangeTab(t.key)}
            className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
              activeTab === t.key
                ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No service follow-ups in this category.
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((o) => {
            const isOverdue = !o.followup_done && o.followup_date < todayDhaka;
            return (
              <div
                key={o.order_id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectOrder(o.order_id)}
                        className="font-mono text-xs font-bold text-[#0F766E] hover:underline"
                      >
                        {o.order_id}
                      </button>
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                          o.followup_done
                            ? 'bg-emerald-50 text-emerald-700'
                            : isOverdue
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        Follow-Up: {formatDateEn(o.followup_date)}
                      </span>
                      {o.followup_converted_order_id && (
                        <button
                          type="button"
                          onClick={() => onSelectOrder(o.followup_converted_order_id)}
                          className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-teal-800"
                        >
                          Rebooked: {o.followup_converted_order_id}
                        </button>
                      )}
                    </div>
                    <div className="mt-1 text-base font-bold text-[#0B1F3A]">{o.customer_name}</div>
                    <div className="text-xs text-slate-600">
                      <span className="font-mono font-semibold">{o.phone_display}</span>
                      {o.area ? ` · ${o.area}` : ''}
                      {o.building_name ? ` · ${o.building_name}` : ''}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Previous Service: {translateServiceToEnglish(o.services_text)} · Completed:{' '}
                      <strong>{formatDateEn(o.completion_date)}</strong> · Previous Bill: BDT{' '}
                      {formatBdt(o.price_bdt)}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <a
                      href={buildTelLink(o.phone_e164, o.phone_display)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Call
                    </a>
                    <button
                      type="button"
                      onClick={() => onOpenWhatsApp(o)}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Time to Clean Again
                    </button>
                    <button
                      type="button"
                      onClick={() => onBookAgain(o)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0c6059]"
                    >
                      <Repeat className="h-3.5 w-3.5" />
                      Book Again
                    </button>
                    <button
                      type="button"
                      onClick={() => onReschedule(o)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Reschedule
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleDone(o.order_id, !o.followup_done)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                        o.followup_done
                          ? 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      }`}
                    >
                      {o.followup_done ? (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reopen
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Mark Done
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
