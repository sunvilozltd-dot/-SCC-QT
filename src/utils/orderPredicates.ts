import { OrderRecord, QuotationRecord } from '../types/order';
import { addCalendarDays } from './dateAndPhone';

export type OrdersPresetFilter =
  | ''
  | 'today'
  | 'ongoing'
  | 'today_or_ongoing'
  | 'next7days'
  | 'settlement_pending';

export function isSettlementPending(order: OrderRecord): boolean {
  if (order.status !== 'Completed') return false;
  if (Number(order.supervisor_settlement || 0) === 0) return false;
  if (order.settlement_status === 'Settled' || order.settlement_status === 'Balanced') return false;
  const remaining = Math.max(
    0,
    Math.abs(Number(order.supervisor_settlement || 0)) - Number(order.settlement_actual_total || 0)
  );
  return remaining > 0;
}

export function isTodayWork(order: OrderRecord, todayDhaka: string): boolean {
  return order.scheduled_date === todayDhaka && order.status !== 'Cancelled';
}

export function isOngoingWork(order: OrderRecord): boolean {
  return (
    order.status === 'New' ||
    order.status === 'Confirmed' ||
    order.status === 'In Progress'
  );
}

export function isTodayOrOngoingWork(order: OrderRecord, todayDhaka: string): boolean {
  return isTodayWork(order, todayDhaka) || isOngoingWork(order);
}

export function isNext7DaysWork(order: OrderRecord, todayDhaka: string): boolean {
  if (order.status === 'Cancelled') return false;
  if (!order.scheduled_date) return false;
  const endDate = addCalendarDays(todayDhaka, 6);
  return order.scheduled_date >= todayDhaka && order.scheduled_date <= endDate;
}

export function isActiveFollowup(order: OrderRecord): boolean {
  return (
    order.status === 'Completed' &&
    !order.is_no_charge_visit &&
    !order.followup_done &&
    Boolean(order.followup_date)
  );
}

export function isTodayFollowup(order: OrderRecord, todayDhaka: string): boolean {
  return isActiveFollowup(order) && order.followup_date === todayDhaka;
}

export function isOverdueFollowup(order: OrderRecord, todayDhaka: string): boolean {
  return isActiveFollowup(order) && order.followup_date < todayDhaka;
}

export function isUpcomingFollowup(order: OrderRecord, todayDhaka: string): boolean {
  return isActiveFollowup(order) && order.followup_date > todayDhaka;
}

export function isQuotationFollowupDueOrOverdue(
  q: QuotationRecord,
  todayDhaka: string
): boolean {
  return (
    q.status === 'Sent' &&
    !q.followup_done &&
    Boolean(q.followup_date) &&
    q.followup_date <= todayDhaka
  );
}

export function isQuotationFollowupDue(
  q: QuotationRecord,
  todayDhaka: string
): boolean {
  return isQuotationFollowupDueOrOverdue(q, todayDhaka);
}

export function getSettlementDirectionLabel(settlement: number): {
  label: string;
  amount: number;
  tone: 'positive' | 'negative' | 'zero';
} {
  if (settlement > 0) {
    return { label: 'Supervisor to Deposit', amount: settlement, tone: 'positive' };
  }
  if (settlement < 0) {
    return { label: 'Admin to Reimburse', amount: Math.abs(settlement), tone: 'negative' };
  }
  return { label: 'Balanced', amount: 0, tone: 'zero' };
}
