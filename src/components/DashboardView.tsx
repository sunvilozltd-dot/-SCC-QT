import { useMemo, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  MessageCircle,
  Phone,
  Plus,
  Repeat,
  UserCheck,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { LeadRecord, OrderRecord, QuotationRecord, SupervisorAccount } from '../types/order';
import {
  addCalendarDays,
  buildLeadWhatsAppLink,
  buildTelLink,
  formatBdt,
  formatBdt2,
  formatDateEn,
  formatTime12h,
  translateServiceToEnglish,
} from '../utils/dateAndPhone';
import {
  isNext7DaysWork,
  isOngoingWork,
  isOverdueFollowup,
  isQuotationFollowupDue,
  isSettlementPending,
  isTodayFollowup,
  isTodayOrOngoingWork,
  isTodayWork,
} from '../utils/orderPredicates';
import { OrdersTableAndCards } from './OrdersTableAndCards';
import { StatusBadge } from './StatusBadge';

interface DashboardViewProps {
  orders: OrderRecord[];
  leads: LeadRecord[];
  quotations: QuotationRecord[];
  supervisors: SupervisorAccount[];
  todayDhaka: string;
  onSelectOrder: (orderId: string) => void;
  onNewOrder: () => void;
  onNavigateOrdersPreset: (
    preset: 'today' | 'ongoing' | 'next7days' | 'settlement_pending'
  ) => void;
  onNavigateFollowups: (tab: 'today' | 'overdue') => void;
  onNavigateLeads: () => void;
  onNavigateQuotationsDue: () => void;
  onOpenWhatsAppOrder: (
    order: OrderRecord,
    template: 'booking_confirmed' | 'tomorrow_job' | 'repeat_cleaning_due'
  ) => void;
  onOpenWhatsAppQuotation: (quotation: QuotationRecord) => void;
  onBookAgainOrder: (order: OrderRecord) => void;
}

export function DashboardView({
  orders,
  leads,
  quotations,
  supervisors,
  todayDhaka,
  onSelectOrder,
  onNewOrder,
  onNavigateOrdersPreset,
  onNavigateFollowups,
  onNavigateLeads,
  onNavigateQuotationsDue,
  onOpenWhatsAppOrder,
  onOpenWhatsAppQuotation,
  onBookAgainOrder,
}: DashboardViewProps) {
  const [scheduleSupFilter, setScheduleSupFilter] = useState<string>('');
  const tomorrowDhaka = addCalendarDays(todayDhaka, 1);

  const todayJobs = useMemo(
    () => orders.filter((o) => isTodayWork(o, todayDhaka)),
    [orders, todayDhaka]
  );

  const ongoingJobs = useMemo(() => orders.filter((o) => isOngoingWork(o)), [orders]);

  const settlementPendingJobs = useMemo(
    () => orders.filter((o) => isSettlementPending(o)),
    [orders]
  );

  const settlementPendingRemainingTotal = useMemo(
    () =>
      settlementPendingJobs.reduce((sum, o) => {
        const rem = Math.max(
          0,
          Math.abs(Number(o.supervisor_settlement || 0)) - Number(o.settlement_actual_total || 0)
        );
        return sum + rem;
      }, 0),
    [settlementPendingJobs]
  );

  const todayOrOngoingJobs = useMemo(
    () =>
      orders
        .filter((o) => isTodayOrOngoingWork(o, todayDhaka))
        .sort((a, b) =>
          `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(
            `${b.scheduled_date} ${b.scheduled_time}`
          )
        ),
    [orders, todayDhaka]
  );

  const next7DaysGrouped = useMemo(() => {
    const filtered = orders
      .filter((o) => isNext7DaysWork(o, todayDhaka))
      .filter((o) => {
        if (scheduleSupFilter === '__unassigned__') return !o.assigned_supervisor_id;
        if (scheduleSupFilter) return o.assigned_supervisor_id === scheduleSupFilter;
        return true;
      })
      .sort((a, b) =>
        `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(
          `${b.scheduled_date} ${b.scheduled_time}`
        )
      );

    const map = new Map<string, OrderRecord[]>();
    for (const o of filtered) {
      const list = map.get(o.scheduled_date) || [];
      list.push(o);
      map.set(o.scheduled_date, list);
    }
    return Array.from(map.entries());
  }, [orders, todayDhaka, scheduleSupFilter]);

  const todayFollowups = useMemo(
    () => orders.filter((o) => isTodayFollowup(o, todayDhaka)),
    [orders, todayDhaka]
  );

  const overdueFollowups = useMemo(
    () => orders.filter((o) => isOverdueFollowup(o, todayDhaka)),
    [orders, todayDhaka]
  );

  const dueQuotationFollowups = useMemo(
    () =>
      quotations
        .filter((q) => isQuotationFollowupDue(q, todayDhaka))
        .sort((a, b) => a.followup_date.localeCompare(b.followup_date)),
    [quotations, todayDhaka]
  );

  const dueLeads = useMemo(
    () =>
      leads
        .filter(
          (l) =>
            !l.followup_done &&
            l.stage !== 'Confirmed' &&
            l.stage !== 'Not Interested' &&
            Boolean(l.next_followup_date) &&
            l.next_followup_date <= todayDhaka
        )
        .sort((a, b) => a.next_followup_date.localeCompare(b.next_followup_date)),
    [leads, todayDhaka]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1F3A]">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Today (Asia/Dhaka): <strong className="text-[#0B1F3A]">{formatDateEn(todayDhaka)}</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={onNewOrder}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0F766E] px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-[#0c6059]"
        >
          <Plus className="h-4 w-4" />
          New Order
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => onNavigateOrdersPreset('today')}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-[#0F766E]"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Today's Jobs</span>
            <CalendarDays className="h-4 w-4 text-[#0F766E]" />
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-[#0B1F3A]">
            {todayJobs.length}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateOrdersPreset('ongoing')}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-400"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Ongoing Jobs</span>
            <ClipboardList className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-[#0B1F3A]">
            {ongoingJobs.length}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateOrdersPreset('settlement_pending')}
          className={`rounded-xl border bg-white p-4 text-left transition-colors ${
            settlementPendingJobs.length > 0
              ? 'border-amber-300 hover:border-amber-500'
              : 'border-slate-200 hover:border-[#0F766E]'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Settlement Pending</span>
            <Wallet className="h-4 w-4 text-amber-600" />
          </div>
          <div
            className={`mt-2 text-3xl font-bold tabular-nums ${
              settlementPendingJobs.length > 0 ? 'text-amber-700' : 'text-[#0B1F3A]'
            }`}
          >
            {settlementPendingJobs.length}
          </div>
          <div className="mt-1 text-[11px] font-medium text-slate-500">
            {settlementPendingJobs.length > 0
              ? `BDT ${formatBdt(settlementPendingRemainingTotal)} unsettled`
              : 'All supervisor cash settled'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateFollowups('today')}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-amber-400"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Today's Follow-Ups</span>
            <BellRing className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-[#0B1F3A]">
            {todayFollowups.length}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateFollowups('overdue')}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-red-400"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Overdue Follow-Ups</span>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-red-700">
            {overdueFollowups.length}
          </div>
        </button>
      </div>

      {/* Quotation Follow-Ups Due Widget */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#0F766E]" />
            <h2 className="text-base font-bold text-[#0B1F3A]">
              Quotation Follow-Ups Due ({dueQuotationFollowups.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={onNavigateQuotationsDue}
            className="text-xs font-semibold text-[#0F766E] hover:underline"
          >
            View All Quotations →
          </button>
        </div>

        {dueQuotationFollowups.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            No sent quotations are overdue or due for follow-up today.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {dueQuotationFollowups.slice(0, 6).map((q) => {
              const isOverdue = q.followup_date < todayDhaka;
              return (
                <div
                  key={q.quotation_id}
                  className={`rounded-xl border p-3.5 ${
                    isOverdue ? 'border-red-200 bg-red-50/40' : 'border-amber-200 bg-amber-50/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#0B1F3A]">
                          {q.quotation_id}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            isOverdue
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isOverdue ? 'Overdue' : 'Due Today'}: {formatDateEn(q.followup_date)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm font-bold text-[#0B1F3A]">{q.customer_name}</div>
                      <div className="text-xs text-slate-600">
                        {q.phone_display} · Total: BDT {formatBdt2(q.total_bdt)}
                      </div>
                      {q.followup_note && (
                        <div className="mt-1 text-xs text-slate-600">Note: {q.followup_note}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenWhatsAppQuotation(q)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={onNavigateQuotationsDue}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Follow Up
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Today & Ongoing Work */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#0B1F3A]">
            Today & Ongoing Jobs ({todayOrOngoingJobs.length})
          </h2>
          <button
            type="button"
            onClick={() => onNavigateOrdersPreset('ongoing')}
            className="text-xs font-semibold text-[#0F766E] hover:underline"
          >
            See All Orders →
          </button>
        </div>
        <OrdersTableAndCards
          orders={todayOrOngoingJobs.slice(0, 10)}
          onSelectOrder={onSelectOrder}
          onOpenWhatsApp={(order) =>
            onOpenWhatsAppOrder(
              order,
              order.scheduled_date === tomorrowDhaka ? 'tomorrow_job' : 'booking_confirmed'
            )
          }
          emptyTitle="No active jobs right now"
          emptyDescription="All scheduled jobs for today and ongoing work are clear."
        />
      </section>

      {/* Next 7 Days Schedule */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-[#0F766E]" />
            <h2 className="text-base font-bold text-[#0B1F3A]">Next 7 Days Schedule</h2>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={scheduleSupFilter}
              onChange={(e) => setScheduleSupFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
            >
              <option value="">All Supervisors</option>
              <option value="__unassigned__">Unassigned Only</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onNavigateOrdersPreset('next7days')}
              className="text-xs font-semibold text-[#0F766E] hover:underline"
            >
              Open Full List
            </button>
          </div>
        </div>

        {next7DaysGrouped.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            No scheduled jobs in the next 7 days matching this filter.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {next7DaysGrouped.map(([dateIso, dayOrders]) => {
              const isTomorrow = dateIso === tomorrowDhaka;
              const isToday = dateIso === todayDhaka;
              return (
                <div key={dateIso}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <span>{formatDateEn(dateIso)}</span>
                    {isToday && (
                      <span className="rounded bg-[#0F766E] px-1.5 py-0.5 text-[10px] text-white">
                        Today
                      </span>
                    )}
                    {isTomorrow && (
                      <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] text-white">
                        Tomorrow
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                    {dayOrders.map((o) => (
                      <div
                        key={o.order_id}
                        onClick={() => onSelectOrder(o.order_id)}
                        className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 transition-colors hover:border-[#0F766E] hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-[#0B1F3A]">
                              {o.order_id}
                            </span>
                            <StatusBadge status={o.status} />
                          </div>
                          <div className="mt-1 font-semibold text-[#0B1F3A]">{o.customer_name}</div>
                          <div className="mt-0.5 text-xs text-slate-600">
                            {translateServiceToEnglish(o.services_text)}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {formatTime12h(o.scheduled_time)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <UserCheck className="h-3.5 w-3.5 text-[#0F766E]" />
                              {o.assigned_supervisor_name || 'Unassigned'}
                            </span>
                            <span className="font-semibold text-[#0B1F3A]">
                              BDT {formatBdt(o.price_bdt)}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenWhatsAppOrder(
                              o,
                              isTomorrow ? 'tomorrow_job' : 'booking_confirmed'
                            );
                          }}
                          className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                          title={isTomorrow ? "Send Tomorrow's Reminder" : 'Send Booking Confirmation'}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Bottom 2-Column Follow-Ups: Completed Service Follow-Ups & Prospect Follow-Ups */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Service Follow-Ups Due/Overdue */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
              <CheckCircle2 className="h-5 w-5 text-amber-600" />
              Service Follow-Ups Due ({todayFollowups.length + overdueFollowups.length})
            </h2>
            <button
              type="button"
              onClick={() => onNavigateFollowups(overdueFollowups.length > 0 ? 'overdue' : 'today')}
              className="text-xs font-semibold text-[#0F766E] hover:underline"
            >
              Open Follow-Ups →
            </button>
          </div>
          {todayFollowups.length + overdueFollowups.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">
              No completed service follow-ups are due today or overdue.
            </p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {[...overdueFollowups, ...todayFollowups].slice(0, 5).map((o) => (
                <div
                  key={o.order_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelectOrder(o.order_id)}
                      className="text-left text-sm font-bold text-[#0B1F3A] hover:text-[#0F766E]"
                    >
                      {o.customer_name}
                    </button>
                    <div className="text-xs text-slate-500">
                      {o.phone_display} · Due: <strong>{formatDateEn(o.followup_date)}</strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenWhatsAppOrder(o, 'repeat_cleaning_due')}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => onBookAgainOrder(o)}
                      className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                    >
                      <Repeat className="h-3.5 w-3.5" />
                      Book Again
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Prospect Follow-Ups Due/Overdue */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
              <UserPlus className="h-5 w-5 text-blue-600" />
              Prospect Follow-Ups Due ({dueLeads.length})
            </h2>
            <button
              type="button"
              onClick={onNavigateLeads}
              className="text-xs font-semibold text-[#0F766E] hover:underline"
            >
              Open Prospects →
            </button>
          </div>
          {dueLeads.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">
              No prospect follow-ups are due today or overdue.
            </p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {dueLeads.slice(0, 5).map((l) => (
                <div
                  key={l.lead_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                >
                  <div>
                    <div className="text-sm font-bold text-[#0B1F3A]">{l.name}</div>
                    <div className="text-xs text-slate-500">
                      {l.phone_display} · {l.stage} · Due:{' '}
                      <strong>{formatDateEn(l.next_followup_date)}</strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={buildTelLink(l.phone_e164, l.phone_display)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Call
                    </a>
                    <a
                      href={buildLeadWhatsAppLink(l)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
