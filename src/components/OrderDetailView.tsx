import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Edit3,
  ExternalLink,
  HardHat,
  History,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Receipt,
  Repeat,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import {
  BuildingProfile,
  COMPLAINT_STATUSES,
  ComplaintStatus,
  MoneyReceiptRecord,
  OrderComplaintRecord,
  OrderRecord,
  OrderStatus,
  OrderWorkerAssignment,
  OtherExpenseItem,
  PAYMENT_METHODS,
  PaymentMethod,
  StatusHistoryRecord,
  SupervisorAccount,
  SupervisorSettlementEntry,
  VALID_STATUSES,
  WorkerPaymentHistoryRecord,
  WorkerRecord,
  isOrderStatusLocked,
} from '../types/order';
import {
  bnToEnDigits,
  buildTelLink,
  formatBdt,
  formatDateEn,
  formatDateTimeEn,
  formatTime12h,
  getNowDhakaTimestamp,
  getTodayDhakaIso,
  translateServiceToEnglish,
  validateSafeExternalUrl,
} from '../utils/dateAndPhone';
import { getSettlementDirectionLabel } from '../utils/orderPredicates';
import { StatusBadge } from './StatusBadge';

interface OrderDetailViewProps {
  order: OrderRecord;
  allOrders: OrderRecord[];
  building: BuildingProfile | null;
  history: StatusHistoryRecord[];
  receipt: MoneyReceiptRecord | null;
  supervisors: SupervisorAccount[];
  workers: WorkerRecord[];
  settlementEntries: SupervisorSettlementEntry[];
  complaints: OrderComplaintRecord[];
  workerPaymentHistory: WorkerPaymentHistoryRecord[];
  onBack: () => void;
  onEdit: () => void;
  onBookAgain: () => void;
  onOpenOrder: (orderId: string) => void;
  onOpenWhatsApp: (order: OrderRecord, template?: 'booking_confirmed' | 'tomorrow_job' | 'repeat_cleaning_due') => void;
  onChangeStatus: (newStatus: OrderStatus) => Promise<void>;
  onUpdateAdvance: (advanceGiven: number, supervisorId?: string) => Promise<void>;
  onOpenCompleteModal: () => void;
  onCorrectFinancials: (payload: {
    completion_date?: string;
    price_bdt?: number;
    advance_given?: number;
    transport_cost: number;
    meals_cost: number;
    other_expenses: OtherExpenseItem[];
    reason: string;
  }) => Promise<void>;
  onConfirmSettlement: (note: string) => Promise<void>;
  onRecordSettlementEntry: (payload: {
    amount_bdt: number;
    entry_datetime?: string;
    payment_method: PaymentMethod;
    reference?: string;
    note?: string;
  }) => Promise<void>;
  onOpenReschedule: () => void;
  onToggleFollowupDone: (isDone: boolean) => Promise<void>;
  onIssueReceipt: (order: OrderRecord) => void;
  onPreviewReceipt: (receipt: MoneyReceiptRecord) => void;
  onUpdateOrderWorkers: (payload: {
    assigned_workers: Array<{
      worker_id: string;
      agreed_pay_bdt: number;
      confirmed_worked: boolean;
    }>;
    reason?: string;
  }) => Promise<void>;
  onMarkWorkerPaid: (
    orderWorkerId: string,
    payload: {
      payment_date: string;
      payment_method: PaymentMethod;
      paid_by_role: 'admin' | 'supervisor';
      reference?: string;
      note?: string;
    }
  ) => Promise<void>;
  onCorrectWorkerPayment: (
    orderWorkerId: string,
    payload: {
      action: 'CORRECTED' | 'MARK_UNPAID';
      agreed_pay_bdt?: number;
      payment_date?: string;
      payment_method?: PaymentMethod;
      paid_by_role?: 'admin' | 'supervisor';
      reference?: string;
      reason: string;
    }
  ) => Promise<void>;
  onCreateComplaint: (payload: {
    complaint_date: string;
    issue: string;
    action_taken?: string;
    notes?: string;
    status?: ComplaintStatus;
  }) => Promise<void>;
  onUpdateComplaint: (
    complaintId: string,
    payload: {
      issue?: string;
      action_taken?: string;
      notes?: string;
      status?: ComplaintStatus;
    }
  ) => Promise<void>;
  onScheduleReturnVisit: (
    complaintId: string,
    payload: {
      scheduled_date: string;
      scheduled_time?: string;
      estimated_duration_mins?: number;
      assigned_supervisor_id?: string;
      assigned_workers?: Array<{ worker_id: string; agreed_pay_bdt: number }>;
      is_no_charge: boolean;
      price_bdt?: number;
      instructions?: string;
    }
  ) => Promise<void>;
}

export function OrderDetailView({
  order,
  allOrders,
  building,
  history,
  receipt,
  supervisors,
  workers,
  settlementEntries,
  complaints,
  workerPaymentHistory,
  onBack,
  onEdit,
  onBookAgain,
  onOpenOrder,
  onOpenWhatsApp,
  onChangeStatus,
  onUpdateAdvance,
  onOpenCompleteModal,
  onCorrectFinancials,
  onConfirmSettlement,
  onRecordSettlementEntry,
  onOpenReschedule,
  onToggleFollowupDone,
  onIssueReceipt,
  onPreviewReceipt,
  onUpdateOrderWorkers,
  onMarkWorkerPaid,
  onCorrectWorkerPayment,
  onCreateComplaint,
  onUpdateComplaint,
  onScheduleReturnVisit,
}: OrderDetailViewProps) {
  const [busyStatus, setBusyStatus] = useState(false);

  // Advance form
  const [advanceInput, setAdvanceInput] = useState(String(order.advance_given || 0));
  const [advanceSupId, setAdvanceSupId] = useState(
    order.advance_supervisor_id || order.assigned_supervisor_id || ''
  );
  const [savingAdvance, setSavingAdvance] = useState(false);

  // Settlement entry form
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDateTime, setEntryDateTime] = useState(getNowDhakaTimestamp());
  const [entryMethod, setEntryMethod] = useState<PaymentMethod>('Cash');
  const [entryRef, setEntryRef] = useState('');
  const [entryNote, setEntryNote] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);
  const [quickSettleNote, setQuickSettleNote] = useState('');
  const [savingQuickSettle, setSavingQuickSettle] = useState(false);

  // Financial correction modal
  const [corrOpen, setCorrOpen] = useState(false);
  const [corrDate, setCorrDate] = useState(order.completion_date || getTodayDhakaIso());
  const [corrPrice, setCorrPrice] = useState(String(order.price_bdt || 0));
  const [corrAdvance, setCorrAdvance] = useState(String(order.advance_given || 0));
  const [corrTransport, setCorrTransport] = useState(String(order.transport_cost || 0));
  const [corrMeals, setCorrMeals] = useState(String(order.meals_cost || 0));
  const [corrOther, setCorrOther] = useState<Array<{ description: string; amount: string }>>(
    (order.other_expenses || []).map((x) => ({ description: x.description, amount: String(x.amount) }))
  );
  const [corrReason, setCorrReason] = useState('');
  const [savingCorr, setSavingCorr] = useState(false);

  // Team / Workers editor modal
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamDraft, setTeamDraft] = useState<
    Array<{ worker_id: string; agreed_pay_bdt: string; confirmed_worked: boolean }>
  >([]);
  const [teamReason, setTeamReason] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);

  // Mark worker paid modal
  const [payTarget, setPayTarget] = useState<OrderWorkerAssignment | null>(null);
  const [payDate, setPayDate] = useState(getTodayDhakaIso());
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Cash');
  const [payByRole, setPayByRole] = useState<'admin' | 'supervisor'>('admin');
  const [payRef, setPayRef] = useState('');
  const [payNote, setPayNote] = useState('');
  const [savingPay, setSavingPay] = useState(false);

  // Correct worker payment modal
  const [corrPayTarget, setCorrPayTarget] = useState<OrderWorkerAssignment | null>(null);
  const [corrPayAction, setCorrPayAction] = useState<'CORRECTED' | 'MARK_UNPAID'>('CORRECTED');
  const [corrPayAmount, setCorrPayAmount] = useState('');
  const [corrPayDate, setCorrPayDate] = useState(getTodayDhakaIso());
  const [corrPayMethod, setCorrPayMethod] = useState<PaymentMethod>('Cash');
  const [corrPayByRole, setCorrPayByRole] = useState<'admin' | 'supervisor'>('admin');
  const [corrPayRef, setCorrPayRef] = useState('');
  const [corrPayReason, setCorrPayReason] = useState('');
  const [savingCorrPay, setSavingCorrPay] = useState(false);

  // Complaint modal
  const [complaintModalOpen, setComplaintModalOpen] = useState(false);
  const [compDate, setCompDate] = useState(getTodayDhakaIso());
  const [compIssue, setCompIssue] = useState('');
  const [compAction, setCompAction] = useState('');
  const [compNotes, setCompNotes] = useState('');
  const [savingComp, setSavingComp] = useState(false);

  // Return visit modal
  const [returnTarget, setReturnTarget] = useState<OrderComplaintRecord | null>(null);
  const [rvDate, setRvDate] = useState(getTodayDhakaIso());
  const [rvTime, setRvTime] = useState('10:00');
  const [rvDuration, setRvDuration] = useState('90');
  const [rvSupId, setRvSupId] = useState(order.assigned_supervisor_id || '');
  const [rvNoCharge, setRvNoCharge] = useState(true);
  const [rvPrice, setRvPrice] = useState('0');
  const [rvInstructions, setRvInstructions] = useState('');
  const [savingRv, setSavingRv] = useState(false);

  const settlementInfo = getSettlementDirectionLabel(order.supervisor_settlement);
  const activeSupervisors = useMemo(() => supervisors.filter((s) => s.is_active), [supervisors]);
  const activeWorkers = useMemo(() => workers.filter((w) => w.is_active), [workers]);

  const linkedReturnOrders = useMemo(
    () => allOrders.filter((o) => o.parent_order_id === order.order_id),
    [allOrders, order.order_id]
  );

  const nonWorkerExpenses = useMemo(
    () =>
      (order.transport_cost || 0) +
      (order.meals_cost || 0) +
      (order.other_expenses_total || 0),
    [order]
  );

  const safeMapsUrl = building?.maps_url ? validateSafeExternalUrl(building.maps_url) : '';

  const openTeamEditor = () => {
    setTeamDraft(
      (order.assigned_workers || []).map((w) => ({
        worker_id: w.worker_id,
        agreed_pay_bdt: String(w.agreed_pay_bdt || 0),
        confirmed_worked: w.confirmed_worked,
      }))
    );
    setTeamReason('');
    setTeamModalOpen(true);
  };

  const openFinancialCorrection = () => {
    setCorrDate(order.completion_date || getTodayDhakaIso());
    setCorrPrice(String(order.price_bdt || 0));
    setCorrAdvance(String(order.advance_given || 0));
    setCorrTransport(String(order.transport_cost || 0));
    setCorrMeals(String(order.meals_cost || 0));
    setCorrOther(
      (order.other_expenses || []).map((x) => ({
        description: x.description,
        amount: String(x.amount),
      }))
    );
    setCorrReason('');
    setCorrOpen(true);
  };

  const openMarkPaid = (w: OrderWorkerAssignment) => {
    setPayTarget(w);
    setPayDate(getTodayDhakaIso());
    setPayMethod('Cash');
    setPayByRole('admin');
    setPayRef('');
    setPayNote('');
  };

  const openCorrectPay = (w: OrderWorkerAssignment) => {
    setCorrPayTarget(w);
    setCorrPayAction('CORRECTED');
    setCorrPayAmount(String(w.agreed_pay_bdt || 0));
    setCorrPayDate(w.payment_date || getTodayDhakaIso());
    setCorrPayMethod((PAYMENT_METHODS.includes(w.payment_method as PaymentMethod)
      ? w.payment_method
      : 'Cash') as PaymentMethod);
    setCorrPayByRole(w.paid_by_role === 'supervisor' ? 'supervisor' : 'admin');
    setCorrPayRef(w.payment_reference || '');
    setCorrPayReason('');
  };

  const openReturnModal = (c: OrderComplaintRecord) => {
    setReturnTarget(c);
    setRvDate(getTodayDhakaIso());
    setRvTime('10:00');
    setRvDuration('90');
    setRvSupId(order.assigned_supervisor_id || '');
    setRvNoCharge(true);
    setRvPrice('0');
    setRvInstructions(`Return visit for complaint: ${c.issue}`);
  };

  const statusLocked = Boolean(order.status_locked) || isOrderStatusLocked(order);

  const handleStatusClick = async (next: OrderStatus) => {
    if (statusLocked || next === order.status) return;
    if (next === 'Completed') {
      onOpenCompleteModal();
      return;
    }
    setBusyStatus(true);
    try {
      await onChangeStatus(next);
    } finally {
      setBusyStatus(false);
    }
  };

  const handleSaveAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Math.max(0, Number(bnToEnDigits(advanceInput)) || 0);
    setSavingAdvance(true);
    try {
      await onUpdateAdvance(val, advanceSupId || undefined);
    } finally {
      setSavingAdvance(false);
    }
  };

  const handleAddSettlementEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(bnToEnDigits(entryAmount));
    if (!Number.isFinite(amt) || amt <= 0) return;
    setSavingEntry(true);
    try {
      await onRecordSettlementEntry({
        amount_bdt: amt,
        entry_datetime: entryDateTime.trim() || getNowDhakaTimestamp(),
        payment_method: entryMethod,
        reference: entryRef.trim(),
        note: entryNote.trim(),
      });
      setEntryAmount('');
      setEntryRef('');
      setEntryNote('');
      setEntryDateTime(getNowDhakaTimestamp());
    } finally {
      setSavingEntry(false);
    }
  };

  const handleQuickConfirmSettlement = async () => {
    setSavingQuickSettle(true);
    try {
      await onConfirmSettlement(quickSettleNote.trim());
      setQuickSettleNote('');
    } finally {
      setSavingQuickSettle(false);
    }
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!corrReason.trim()) return;
    setSavingCorr(true);
    try {
      await onCorrectFinancials({
        completion_date: corrDate,
        price_bdt: Math.max(0, Number(bnToEnDigits(corrPrice)) || 0),
        advance_given: Math.max(0, Number(bnToEnDigits(corrAdvance)) || 0),
        transport_cost: Math.max(0, Number(bnToEnDigits(corrTransport)) || 0),
        meals_cost: Math.max(0, Number(bnToEnDigits(corrMeals)) || 0),
        other_expenses: corrOther
          .filter((r) => r.description.trim() || Number(r.amount) > 0)
          .map((r) => ({
            description: r.description.trim() || 'Other Expense',
            amount: Math.max(0, Number(bnToEnDigits(r.amount)) || 0),
          })),
        reason: corrReason.trim(),
      });
      setCorrOpen(false);
    } finally {
      setSavingCorr(false);
    }
  };

  const handleSaveTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTeam(true);
    try {
      const cleaned = teamDraft
        .filter((r) => r.worker_id)
        .map((r) => ({
          worker_id: r.worker_id,
          agreed_pay_bdt: Math.max(0, Number(bnToEnDigits(r.agreed_pay_bdt)) || 0),
          confirmed_worked: r.confirmed_worked,
        }));
      await onUpdateOrderWorkers({
        assigned_workers: cleaned,
        reason: teamReason.trim() || undefined,
      });
      setTeamModalOpen(false);
    } finally {
      setSavingTeam(false);
    }
  };

  const handleSubmitMarkPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    setSavingPay(true);
    try {
      await onMarkWorkerPaid(payTarget.id, {
        payment_date: payDate,
        payment_method: payMethod,
        paid_by_role: payByRole,
        reference: payRef.trim(),
        note: payNote.trim(),
      });
      setPayTarget(null);
    } finally {
      setSavingPay(false);
    }
  };

  const handleSubmitCorrectPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!corrPayTarget || !corrPayReason.trim()) return;
    setSavingCorrPay(true);
    try {
      await onCorrectWorkerPayment(corrPayTarget.id, {
        action: corrPayAction,
        agreed_pay_bdt:
          corrPayAction === 'CORRECTED'
            ? Math.max(0, Number(bnToEnDigits(corrPayAmount)) || 0)
            : undefined,
        payment_date: corrPayAction === 'CORRECTED' ? corrPayDate : undefined,
        payment_method: corrPayAction === 'CORRECTED' ? corrPayMethod : undefined,
        paid_by_role: corrPayAction === 'CORRECTED' ? corrPayByRole : undefined,
        reference: corrPayAction === 'CORRECTED' ? corrPayRef.trim() : undefined,
        reason: corrPayReason.trim(),
      });
      setCorrPayTarget(null);
    } finally {
      setSavingCorrPay(false);
    }
  };

  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compIssue.trim()) return;
    setSavingComp(true);
    try {
      await onCreateComplaint({
        complaint_date: compDate,
        issue: compIssue.trim(),
        action_taken: compAction.trim(),
        notes: compNotes.trim(),
        status: 'Open',
      });
      setComplaintModalOpen(false);
      setCompIssue('');
      setCompAction('');
      setCompNotes('');
    } finally {
      setSavingComp(false);
    }
  };

  const handleSubmitReturnVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget || !rvDate) return;
    setSavingRv(true);
    try {
      await onScheduleReturnVisit(returnTarget.complaint_id, {
        scheduled_date: rvDate,
        scheduled_time: rvTime,
        estimated_duration_mins: Math.max(30, Number(rvDuration) || 90),
        assigned_supervisor_id: rvSupId || undefined,
        is_no_charge: rvNoCharge,
        price_bdt: rvNoCharge ? 0 : Math.max(0, Number(bnToEnDigits(rvPrice)) || 0),
        instructions: rvInstructions.trim(),
      });
      setReturnTarget(null);
    } finally {
      setSavingRv(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-bold text-[#0B1F3A]">{order.order_id}</h1>
              <StatusBadge status={order.status} />
              {statusLocked && (
                <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                  <Lock className="h-3 w-3" />
                  Status Locked
                </span>
              )}
              {order.is_no_charge_visit ? (
                <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
                  No-Charge Return Visit
                </span>
              ) : order.is_return_visit ? (
                <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                  Return Visit
                </span>
              ) : null}
              {order.previous_order_id && (
                <span className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">
                  <Repeat className="h-3 w-3" />
                  Repeat Booking
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {order.customer_name} · {order.phone_display}
              {order.area ? ` · ${order.area}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={buildTelLink(order.phone_e164, order.phone_display)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Phone className="h-3.5 w-3.5" />
            Call
          </a>
          <button
            type="button"
            onClick={() => onOpenWhatsApp(order, 'booking_confirmed')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp
          </button>
          <button
            type="button"
            onClick={onBookAgain}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100"
          >
            <Repeat className="h-3.5 w-3.5" />
            Book Again
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Edit Order
          </button>
          {order.status !== 'Completed' && order.status !== 'Cancelled' && (
            <button
              type="button"
              onClick={onOpenCompleteModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0c6059]"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Completed
            </button>
          )}
        </div>
      </div>

      {/* Parent / Previous Order Links */}
      {(order.parent_order_id || order.previous_order_id) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
          {order.parent_order_id && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Original Job:</span>
              <button
                type="button"
                onClick={() => onOpenOrder(order.parent_order_id)}
                className="font-mono font-bold text-[#0F766E] underline"
              >
                {order.parent_order_id}
              </button>
              {order.is_no_charge_visit && (
                <span className="text-amber-700">
                  (No-charge visit — expenses count under original job profit)
                </span>
              )}
            </div>
          )}
          {order.previous_order_id && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Previous Order:</span>
              <button
                type="button"
                onClick={() => onOpenOrder(order.previous_order_id)}
                className="font-mono font-bold text-[#0F766E] underline"
              >
                {order.previous_order_id}
              </button>
              {order.previous_work_date && (
                <span className="text-slate-600">
                  · Previous Work Date: <strong>{formatDateEn(order.previous_work_date)}</strong>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Key Dates & Status Bar */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Core Order Summary */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
                Customer & Service Details
              </h2>
              <div className="mt-1.5 text-lg font-bold text-[#0B1F3A]">{order.customer_name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                <span className="font-mono font-medium">{order.phone_display}</span>
                {order.lead_source && (
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                    Source: {order.lead_source}
                  </span>
                )}
                {order.referral_contact_name && (
                  <span className="text-xs text-slate-500">
                    Referred by {order.referral_contact_type || 'contact'}:{' '}
                    <strong>{order.referral_contact_name}</strong>
                    {order.referral_contact_phone ? ` (${order.referral_contact_phone})` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-400">Agreed Bill</div>
              <div className="text-2xl font-bold tabular-nums text-[#0B1F3A]">
                BDT {formatBdt(order.price_bdt)}
              </div>
              {order.is_no_charge_visit && (
                <div className="text-xs font-semibold text-amber-700">No-Charge Service</div>
              )}
            </div>
          </div>

          {/* Dates Grid */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {order.previous_work_date && (
              <div className="rounded-lg border border-teal-100 bg-teal-50/60 p-3">
                <div className="text-[11px] font-semibold uppercase text-teal-700">
                  Previous Work Date
                </div>
                <div className="mt-0.5 text-sm font-bold text-[#0B1F3A]">
                  {formatDateEn(order.previous_work_date)}
                </div>
              </div>
            )}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">
                Order Booking Date
              </div>
              <div className="mt-0.5 text-sm font-bold text-[#0B1F3A]">
                {formatDateEn(order.booking_date)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">
                Scheduled Work Date & Time
              </div>
              <div className="mt-0.5 text-sm font-bold text-[#0B1F3A]">
                {formatDateEn(order.scheduled_date)}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-600">
                <Clock className="h-3.5 w-3.5" />
                {formatTime12h(order.scheduled_time)}
                {order.scheduled_end_time ? ` – ${formatTime12h(order.scheduled_end_time)}` : ''}
                {order.estimated_duration_mins ? ` (${order.estimated_duration_mins} min)` : ''}
              </div>
            </div>
            {order.completion_date && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[11px] font-semibold uppercase text-emerald-700">
                  Completion Date
                </div>
                <div className="mt-0.5 text-sm font-bold text-emerald-900">
                  {formatDateEn(order.completion_date)}
                </div>
                {order.completed_by_name && (
                  <div className="text-[11px] text-emerald-700">By {order.completed_by_name}</div>
                )}
              </div>
            )}
          </div>

          {/* Address, Building & Services */}
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-start gap-2 text-slate-700">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <div className="font-medium text-[#0B1F3A]">
                  {order.address || 'No address recorded'}
                </div>
                {order.area && <div className="text-xs text-slate-500">Area: {order.area}</div>}
              </div>
            </div>

            {building && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#0B1F3A]">
                    <Building2 className="h-4 w-4 text-[#0F766E]" />
                    Building Profile: {building.name}
                  </div>
                  {safeMapsUrl && (
                    <a
                      href={safeMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                    >
                      Google Maps
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-700 sm:grid-cols-2">
                  <div>
                    <span className="font-semibold">Overhead Tanks:</span>{' '}
                    {building.overhead_tank_qty} qty
                    {building.overhead_tank_capacity_litres
                      ? ` · ${formatBdt(building.overhead_tank_capacity_litres)} L`
                      : ''}
                    {building.overhead_tank_material ? ` · ${building.overhead_tank_material}` : ''}
                  </div>
                  <div>
                    <span className="font-semibold">Reserve Tanks:</span>{' '}
                    {building.reserve_tank_qty} qty
                    {building.reserve_tank_capacity_litres
                      ? ` · ${formatBdt(building.reserve_tank_capacity_litres)} L`
                      : ''}
                    {building.reserve_tank_material ? ` · ${building.reserve_tank_material}` : ''}
                  </div>
                </div>
                {building.access_instructions && (
                  <div className="mt-1.5 text-xs text-slate-600">
                    <span className="font-semibold">Access Instructions:</span>{' '}
                    {building.access_instructions}
                  </div>
                )}
                {building.tank_notes && (
                  <div className="mt-1 text-xs text-slate-600">
                    <span className="font-semibold">Tank Notes:</span> {building.tank_notes}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Services</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {order.services.map((svc, idx) => (
                  <span
                    key={`${svc}-${idx}`}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-[#0B1F3A]"
                  >
                    {translateServiceToEnglish(svc)}
                  </span>
                ))}
              </div>
            </div>

            {order.instructions && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
                <span className="font-bold">Work Instructions (Visible to Supervisor): </span>
                {order.instructions}
              </div>
            )}

            {order.notes && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <span className="font-bold">Internal Notes (Admin Only): </span>
                {order.notes}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Status, Supervisor & Money Receipt */}
        <div className="space-y-4">
          {/* Status Switcher */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Order Status
              </h3>
              {statusLocked && (
                <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                  <Lock className="h-3 w-3" />
                  Status Locked
                </span>
              )}
            </div>
            {statusLocked && (
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
                Completed and full customer payment confirmed. Reopen, Cancel, and other status
                changes are disabled. Money Receipt, Settlement, and Follow-Up actions remain
                available.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {VALID_STATUSES.map((st) => {
                const active = order.status === st;
                const isDisabled = busyStatus || statusLocked;
                return (
                  <button
                    key={st}
                    type="button"
                    disabled={isDisabled}
                    title={
                      statusLocked
                        ? 'Order status is locked because this order is Completed and full payment is confirmed.'
                        : undefined
                    }
                    onClick={() => handleStatusClick(st)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[#0F766E] bg-[#0F766E] text-white'
                        : statusLocked
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {st}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Assigned Supervisor & Advance */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Assigned Supervisor & Advance
              </h3>
              <UserCheck className="h-4 w-4 text-[#0F766E]" />
            </div>
            <div className="mt-2 text-sm font-bold text-[#0B1F3A]">
              {order.assigned_supervisor_name || 'Unassigned'}
            </div>
            {order.advance_given > 0 && (
              <div className="mt-1 text-xs text-slate-600">
                Advance Holder:{' '}
                <strong>{order.advance_supervisor_name || order.assigned_supervisor_name || 'Recorded'}</strong>
              </div>
            )}

            <form onSubmit={handleSaveAdvance} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">
                    Advance Given (BDT)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={advanceInput}
                    onChange={(e) => setAdvanceInput(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-semibold tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">
                    Received By
                  </label>
                  <select
                    value={advanceSupId}
                    onChange={(e) => setAdvanceSupId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">Assigned Supervisor</option>
                    {activeSupervisors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                disabled={savingAdvance}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                {savingAdvance ? 'Saving...' : 'Save Advance'}
              </button>
            </form>
          </div>

          {/* Money Receipt & Follow-Up */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Money Receipt & Follow-Up
            </h3>
            {order.is_no_charge_visit ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                Money Receipt is disabled for No-Charge Return Visits.
              </div>
            ) : receipt ? (
              <button
                type="button"
                onClick={() => onPreviewReceipt(receipt)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <Receipt className="h-4 w-4" />
                View Receipt ({receipt.receipt_id})
              </button>
            ) : order.status === 'Completed' ? (
              <button
                type="button"
                onClick={() => onIssueReceipt(order)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0B1F3A] px-3 py-2 text-xs font-semibold text-white hover:bg-[#132f55]"
              >
                <Receipt className="h-4 w-4" />
                Issue Money Receipt
              </button>
            ) : (
              <div className="text-xs text-slate-500">
                Complete this order to issue a Money Receipt.
              </div>
            )}

            {order.status === 'Completed' && !order.is_no_charge_visit && (
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-600">Next Follow-Up:</span>
                  <span className="font-bold text-[#0B1F3A]">
                    {order.followup_date ? formatDateEn(order.followup_date) : 'Not set'}
                  </span>
                </div>
                {order.followup_rule_note && (
                  <div className="mt-0.5 text-[11px] text-slate-500">{order.followup_rule_note}</div>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={onOpenReschedule}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                    Reschedule
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleFollowupDone(!order.followup_done)}
                    className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                      order.followup_done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {order.followup_done ? 'Marked Done' : 'Mark Done'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Assigned Workers & Per-Job Worker Pay Panel */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
              <HardHat className="h-5 w-5 text-[#0F766E]" />
              Assigned Workers & Per-Job Pay
            </h2>
            <p className="text-xs text-slate-500">
              Confirmed worker pay is counted once in job expenses. Payments marked as paid by
              Supervisor automatically reduce the supervisor's expected cash deposit.
            </p>
          </div>
          <button
            type="button"
            onClick={openTeamEditor}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Manage Team & Pay
          </button>
        </div>

        {(order.assigned_workers || []).length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
            No workers assigned to this job yet. Click "Manage Team & Pay" to assign workers and
            set their per-job pay.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                  <th className="px-3 py-2.5">Worker</th>
                  <th className="px-3 py-2.5">Attendance</th>
                  <th className="px-3 py-2.5 text-right">Pay for This Job</th>
                  <th className="px-3 py-2.5">Payment Status</th>
                  <th className="px-3 py-2.5">Paid Details</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.assigned_workers.map((w) => (
                  <tr key={w.id}>
                    <td className="px-3 py-2.5 font-semibold text-[#0B1F3A]">{w.worker_name}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {w.confirmed_worked ? (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                          Confirmed Worked
                        </span>
                      ) : (
                        <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">
                          Not Confirmed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-[#0B1F3A]">
                      BDT {formatBdt(w.agreed_pay_bdt)}
                    </td>
                    <td className="px-3 py-2.5">
                      {w.payment_status === 'Paid' ? (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                          Paid
                        </span>
                      ) : (
                        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          Unpaid
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {w.payment_status === 'Paid' ? (
                        <div>
                          <div>
                            {formatDateEn(w.payment_date)} · {w.payment_method || 'Cash'} · Paid by{' '}
                            <strong className="capitalize">{w.paid_by_role || 'admin'}</strong>
                          </div>
                          {w.payment_reference && (
                            <div className="text-[11px] text-slate-500">Ref: {w.payment_reference}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {w.payment_status !== 'Paid' ? (
                        <button
                          type="button"
                          disabled={!w.confirmed_worked}
                          onClick={() => openMarkPaid(w)}
                          className="rounded-lg bg-[#0F766E] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-40"
                        >
                          Mark as Paid
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openCorrectPay(w)}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Correct Payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {workerPaymentHistory.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Worker Payment Audit Trail
            </div>
            <div className="mt-2 space-y-1.5">
              {workerPaymentHistory.map((h) => (
                <div
                  key={h.history_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700"
                >
                  <div>
                    <strong className="text-[#0B1F3A]">{h.worker_name}</strong> —{' '}
                    <span className="font-semibold">{h.action}</span> (BDT {formatBdt(h.amount_bdt)}
                    {h.paid_by_role ? `, by ${h.paid_by_role}` : ''})
                    {h.reason ? ` · Reason: ${h.reason}` : ''}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {h.changed_by} · {formatDateTimeEn(h.changed_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Financial Summary & Supervisor Settlement Verification */}
      {order.status === 'Completed' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Job Financials Breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
                <Wallet className="h-5 w-5 text-[#0F766E]" />
                Job Financials & Profit
              </h2>
              <button
                type="button"
                onClick={openFinancialCorrection}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Correct Financials
              </button>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Agreed Job Bill</span>
                <span className="font-semibold tabular-nums text-[#0B1F3A]">
                  BDT {formatBdt(order.price_bdt)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Full Bill Collected</span>
                <span className="font-semibold text-[#0B1F3A]">
                  {order.is_no_charge_visit
                    ? 'N/A (No-Charge)'
                    : order.full_bill_collected
                    ? 'Yes'
                    : 'No'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Advance Given</span>
                <span className="font-semibold tabular-nums text-[#0B1F3A]">
                  BDT {formatBdt(order.advance_given)}
                </span>
              </div>

              <div className="border-t border-slate-100 pt-2">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Transport Cost</span>
                  <span className="tabular-nums">BDT {formatBdt(order.transport_cost)}</span>
                </div>
                <div className="mt-1 flex justify-between text-xs text-slate-600">
                  <span>Meals Cost</span>
                  <span className="tabular-nums">BDT {formatBdt(order.meals_cost)}</span>
                </div>
                {(order.other_expenses || []).map((ex, i) => (
                  <div key={i} className="mt-1 flex justify-between text-xs text-slate-600">
                    <span>Other: {ex.description}</span>
                    <span className="tabular-nums">BDT {formatBdt(ex.amount)}</span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between text-xs text-slate-600">
                  <span>Worker Labour Pay (Confirmed)</span>
                  <span className="tabular-nums">BDT {formatBdt(order.worker_pay_total)}</span>
                </div>
                {order.supervisor_paid_worker_total > 0 && (
                  <div className="mt-0.5 flex justify-between text-[11px] text-teal-700">
                    <span>↳ Paid by Supervisor from Job Cash</span>
                    <span className="tabular-nums">
                      BDT {formatBdt(order.supervisor_paid_worker_total)}
                    </span>
                  </div>
                )}
                {!order.is_no_charge_visit && (
                  <div className="mt-1.5 flex justify-between border-t border-slate-100 pt-1.5 text-xs font-semibold text-slate-700">
                    <span>Regular Job Costs</span>
                    <span className="tabular-nums">BDT {formatBdt(order.actual_expenses)}</span>
                  </div>
                )}
                {!order.is_no_charge_visit && (order.return_visit_expenses_total > 0 || linkedReturnOrders.length > 0) && (
                  <div className="mt-1 flex justify-between text-xs font-semibold text-amber-700">
                    <span>
                      Linked No-Charge Return Visit Costs
                      {linkedReturnOrders.filter((r) => r.is_no_charge_visit && r.status === 'Completed').length > 0
                        ? ` (${linkedReturnOrders.filter((r) => r.is_no_charge_visit && r.status === 'Completed').length} completed)`
                        : ''}
                    </span>
                    <span className="tabular-nums">
                      BDT {formatBdt(order.return_visit_expenses_total || 0)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-between border-t border-slate-200 pt-2 font-bold">
                <span className="text-slate-700">
                  {order.is_no_charge_visit ? 'Actual Return Visit Costs' : 'Total Lifetime Job Costs'}
                </span>
                <span className="tabular-nums text-red-700">
                  BDT {formatBdt(order.actual_expenses + (order.is_no_charge_visit ? 0 : order.return_visit_expenses_total || 0))}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold">
                <span className="text-[#0B1F3A]">
                  {order.is_no_charge_visit ? 'Return Visit Net Cost' : 'Lifetime Job Profit / Loss'}
                </span>
                <span
                  className={`tabular-nums ${
                    order.job_profit_or_loss >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  BDT {formatBdt(order.job_profit_or_loss)}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                Non-worker expenses: BDT {formatBdt(nonWorkerExpenses)} · Worker pay (counted once): BDT{' '}
                {formatBdt(order.worker_pay_total)}
                {!order.is_no_charge_visit && order.return_visit_expenses_total > 0
                  ? ' · Monthly report attributes return-visit costs to each visit’s completion month.'
                  : ''}
              </div>
            </div>
          </div>

          {/* Supervisor Settlement Verification Panel */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-[#0B1F3A]">
                Supervisor Settlement Verification
              </h2>
              <StatusBadge status={order.settlement_status} />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2.5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-semibold text-slate-500">Expected Settlement</div>
                <div className="mt-0.5 text-sm font-bold tabular-nums text-[#0B1F3A]">
                  BDT {formatBdt(Math.abs(order.supervisor_settlement))}
                </div>
                <div className="mt-0.5 text-[10px] font-semibold text-slate-500">
                  {settlementInfo.label}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[11px] font-semibold text-emerald-700">Actually Settled</div>
                <div className="mt-0.5 text-sm font-bold tabular-nums text-emerald-900">
                  BDT {formatBdt(order.settlement_actual_total)}
                </div>
                <div className="mt-0.5 text-[10px] text-emerald-700">
                  {settlementEntries.length} {settlementEntries.length === 1 ? 'entry' : 'entries'}
                </div>
              </div>
              <div
                className={`rounded-lg border p-3 ${
                  order.settlement_remaining > 0
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="text-[11px] font-semibold text-slate-600">Remaining</div>
                <div className="mt-0.5 text-sm font-bold tabular-nums text-[#0B1F3A]">
                  BDT {formatBdt(order.settlement_remaining)}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {order.settlement_remaining === 0 ? 'Cleared' : 'Balance Due'}
                </div>
              </div>
            </div>

            {/* Record Partial or Full Deposit / Reimbursement */}
            {order.supervisor_settlement !== 0 && order.settlement_remaining > 0 && (
              <form
                onSubmit={handleAddSettlementEntry}
                className="mt-4 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5"
              >
                <div className="text-xs font-bold text-[#0B1F3A]">
                  {order.supervisor_settlement > 0
                    ? 'Record Deposit Received from Supervisor'
                    : 'Record Reimbursement Paid to Supervisor'}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600">Amount (BDT)</label>
                    <input
                      type="number"
                      min="1"
                      required
                      placeholder={String(order.settlement_remaining)}
                      value={entryAmount}
                      onChange={(e) => setEntryAmount(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600">Method</label>
                    <select
                      value={entryMethod}
                      onChange={(e) => setEntryMethod(e.target.value as PaymentMethod)}
                      className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600">Date & Time</label>
                    <input
                      type="text"
                      value={entryDateTime}
                      onChange={(e) => setEntryDateTime(e.target.value)}
                      placeholder="YYYY-MM-DD HH:mm"
                      className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={entryRef}
                    onChange={(e) => setEntryRef(e.target.value)}
                    placeholder="bKash / Bank Ref (optional)"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="text"
                    value={entryNote}
                    onChange={(e) => setEntryNote(e.target.value)}
                    placeholder="Note (optional)"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={savingEntry}
                    className="rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                  >
                    {savingEntry ? 'Recording...' : 'Record Entry'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryAmount(String(order.settlement_remaining))}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Fill Full Remaining (BDT {formatBdt(order.settlement_remaining)})
                  </button>
                </div>
              </form>
            )}

            {/* Quick Full Confirmation Fallback */}
            {order.settlement_status === 'Pending' && order.settlement_remaining > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={quickSettleNote}
                  onChange={(e) => setQuickSettleNote(e.target.value)}
                  placeholder="Quick settle note (optional)"
                  className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={savingQuickSettle}
                  onClick={handleQuickConfirmSettlement}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {savingQuickSettle ? 'Confirming...' : 'Confirm Full Settlement'}
                </button>
              </div>
            )}

            {/* Settlement Entries Ledger */}
            {settlementEntries.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Recorded Entries
                </div>
                {settlementEntries.map((ent) => (
                  <div
                    key={ent.entry_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-bold text-[#0B1F3A]">
                        BDT {formatBdt(ent.amount_bdt)}
                      </span>{' '}
                      <span className="text-slate-600">
                        ({ent.entry_type === 'deposit_received' ? 'Deposit Received' : 'Reimbursement Paid'} ·{' '}
                        {ent.payment_method})
                      </span>
                      {ent.reference && (
                        <span className="ml-1.5 font-mono text-[11px] text-slate-500">
                          Ref: {ent.reference}
                        </span>
                      )}
                      {ent.note && <div className="text-[11px] text-slate-500">{ent.note}</div>}
                    </div>
                    <div className="text-right text-[11px] text-slate-500">
                      <div>{formatDateTimeEn(ent.entry_datetime)}</div>
                      <div>By {ent.recorded_by}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Complaints & Return Visits Panel */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              Complaints & No-Charge Return Visits
            </h2>
            <p className="text-xs text-slate-500">
              Log post-service complaints and schedule no-charge return visits linked to this order.
            </p>
          </div>
          {!order.is_return_visit && (
            <button
              type="button"
              onClick={() => setComplaintModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              <Plus className="h-3.5 w-3.5" />
              Log Complaint
            </button>
          )}
        </div>

        {complaints.length === 0 && linkedReturnOrders.length === 0 ? (
          <div className="mt-3 text-xs text-slate-500">No complaints recorded for this order.</div>
        ) : (
          <div className="mt-4 space-y-3">
            {complaints.map((c) => (
              <div
                key={c.complaint_id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#0B1F3A]">{c.issue}</span>
                      <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        {c.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      Reported: {formatDateEn(c.complaint_date)}
                      {c.action_taken ? ` · Action: ${c.action_taken}` : ''}
                    </div>
                    {c.notes && <div className="mt-1 text-xs text-slate-600">{c.notes}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={c.status}
                      onChange={(e) =>
                        onUpdateComplaint(c.complaint_id, {
                          status: e.target.value as ComplaintStatus,
                        })
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold"
                    >
                      {COMPLAINT_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    {c.return_visit_order_id ? (
                      <button
                        type="button"
                        onClick={() => onOpenOrder(c.return_visit_order_id)}
                        className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                      >
                        Open Return Visit ({c.return_visit_order_id})
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openReturnModal(c)}
                        className="rounded-lg bg-[#0B1F3A] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#132f55]"
                      >
                        Schedule Return Visit
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {linkedReturnOrders.length > 0 && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                <div className="text-xs font-bold text-[#0B1F3A]">Linked Return Visit Jobs</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {linkedReturnOrders.map((rv) => (
                    <button
                      key={rv.order_id}
                      type="button"
                      onClick={() => onOpenOrder(rv.order_id)}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1F3A] hover:bg-blue-50"
                    >
                      <span className="font-mono font-bold text-[#0F766E]">{rv.order_id}</span>
                      <span>{formatDateEn(rv.scheduled_date)}</span>
                      <StatusBadge status={rv.status} />
                      {rv.actual_expenses > 0 && (
                        <span className="text-amber-700">
                          Exp: BDT {formatBdt(rv.actual_expenses)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Order Status & Audit History */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-[#0B1F3A]">
          <History className="h-5 w-5 text-slate-500" />
          Order History & Audit Log
        </h2>
        {history.length === 0 ? (
          <div className="mt-3 text-xs text-slate-500">No history entries yet.</div>
        ) : (
          <div className="mt-3 space-y-2">
            {history.map((h) => (
              <div
                key={h.history_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-bold text-[#0B1F3A]">
                    {h.previous_status ? `${h.previous_status} → ${h.new_status}` : h.new_status}
                  </span>
                  {h.note && <span className="ml-2 text-slate-600">{h.note}</span>}
                </div>
                <div className="text-[11px] text-slate-500">
                  {h.changed_by} · {formatDateTimeEn(h.changed_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Financial Correction */}
      {corrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-[#0B1F3A]">Correct Completed Financials</h3>
              <button
                type="button"
                onClick={() => setCorrOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveCorrection} className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Completion Date</label>
                  <input
                    type="date"
                    value={corrDate}
                    onChange={(e) => setCorrDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Agreed Bill (BDT)</label>
                  <input
                    type="number"
                    min="0"
                    value={corrPrice}
                    onChange={(e) => setCorrPrice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Advance Given (BDT)</label>
                  <input
                    type="number"
                    min="0"
                    value={corrAdvance}
                    onChange={(e) => setCorrAdvance(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Transport Cost (BDT)</label>
                  <input
                    type="number"
                    min="0"
                    value={corrTransport}
                    onChange={(e) => setCorrTransport(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Meals Cost (BDT)</label>
                  <input
                    type="number"
                    min="0"
                    value={corrMeals}
                    onChange={(e) => setCorrMeals(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">Other Expenses</label>
                  <button
                    type="button"
                    onClick={() =>
                      setCorrOther((prev) => [...prev, { description: '', amount: '0' }])
                    }
                    className="text-xs font-semibold text-[#0F766E] hover:underline"
                  >
                    + Add Item
                  </button>
                </div>
                <div className="mt-1.5 space-y-2">
                  {corrOther.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Description"
                        value={row.description}
                        onChange={(e) =>
                          setCorrOther((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, description: e.target.value } : r
                            )
                          )
                        }
                        className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                      <input
                        type="number"
                        min="0"
                        value={row.amount}
                        onChange={(e) =>
                          setCorrOther((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, amount: e.target.value } : r))
                          )
                        }
                        className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setCorrOther((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Correction Reason (Required) *
                </label>
                <input
                  type="text"
                  required
                  value={corrReason}
                  onChange={(e) => setCorrReason(e.target.value)}
                  placeholder="Explain why financial values were corrected..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCorrOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCorr}
                  className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {savingCorr ? 'Saving...' : 'Save Correction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Manage Team & Per-Job Pay */}
      {teamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-[#0B1F3A]">Manage Assigned Workers & Pay</h3>
              <button
                type="button"
                onClick={() => setTeamModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveTeam} className="mt-4 space-y-3 text-sm">
              <div className="space-y-2">
                {teamDraft.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 sm:grid-cols-12 sm:items-center"
                  >
                    <select
                      value={row.worker_id}
                      onChange={(e) =>
                        setTeamDraft((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, worker_id: e.target.value } : r))
                        )
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs sm:col-span-5"
                    >
                      <option value="">Select worker...</option>
                      {activeWorkers.map((w) => (
                        <option key={w.worker_id} value={w.worker_id}>
                          {w.name}
                          {w.phone_display ? ` (${w.phone_display})` : ''}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      placeholder="Pay (BDT)"
                      value={row.agreed_pay_bdt}
                      onChange={(e) =>
                        setTeamDraft((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, agreed_pay_bdt: e.target.value } : r
                          )
                        )
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold sm:col-span-3"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 sm:col-span-3">
                      <input
                        type="checkbox"
                        checked={row.confirmed_worked}
                        onChange={(e) =>
                          setTeamDraft((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, confirmed_worked: e.target.checked } : r
                            )
                          )
                        }
                        className="h-4 w-4 rounded border-slate-300 text-[#0F766E]"
                      />
                      Worked
                    </label>
                    <button
                      type="button"
                      onClick={() => setTeamDraft((prev) => prev.filter((_, i) => i !== idx))}
                      className="justify-self-end rounded-lg p-1.5 text-red-500 hover:bg-red-50 sm:col-span-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setTeamDraft((prev) => [
                    ...prev,
                    { worker_id: '', agreed_pay_bdt: '0', confirmed_worked: true },
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Worker
              </button>

              <div>
                <label className="text-xs font-semibold text-slate-700">Note (Optional)</label>
                <input
                  type="text"
                  value={teamReason}
                  onChange={(e) => setTeamReason(e.target.value)}
                  placeholder="Reason for updating team or pay..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTeamModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTeam}
                  className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {savingTeam ? 'Saving...' : 'Save Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Mark Worker Paid */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0B1F3A]">Mark Worker as Paid</h3>
                <p className="text-xs text-slate-500">
                  {payTarget.worker_name} · BDT {formatBdt(payTarget.agreed_pay_bdt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitMarkPaid} className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Payment Date</label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Payment Method</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Paid By</label>
                <select
                  value={payByRole}
                  onChange={(e) => setPayByRole(e.target.value as 'admin' | 'supervisor')}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                >
                  <option value="admin">Admin (Office Cash / Account)</option>
                  <option value="supervisor">Supervisor (Deducted from Job Cash)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  bKash / Bank Reference (Optional)
                </label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Note (Optional)</label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPay}
                  className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {savingPay ? 'Saving...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Correct Worker Payment */}
      {corrPayTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0B1F3A]">Correct Worker Payment</h3>
                <p className="text-xs text-slate-500">{corrPayTarget.worker_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setCorrPayTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitCorrectPay} className="mt-4 space-y-3 text-sm">
              <div>
                <label className="text-xs font-semibold text-slate-700">Correction Action</label>
                <select
                  value={corrPayAction}
                  onChange={(e) =>
                    setCorrPayAction(e.target.value as 'CORRECTED' | 'MARK_UNPAID')
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                >
                  <option value="CORRECTED">Update Payment Details / Amount</option>
                  <option value="MARK_UNPAID">Revert to Unpaid</option>
                </select>
              </div>
              {corrPayAction === 'CORRECTED' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">
                        Corrected Pay (BDT)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={corrPayAmount}
                        onChange={(e) => setCorrPayAmount(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Payment Date</label>
                      <input
                        type="date"
                        value={corrPayDate}
                        onChange={(e) => setCorrPayDate(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Method</label>
                      <select
                        value={corrPayMethod}
                        onChange={(e) => setCorrPayMethod(e.target.value as PaymentMethod)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Paid By</label>
                      <select
                        value={corrPayByRole}
                        onChange={(e) =>
                          setCorrPayByRole(e.target.value as 'admin' | 'supervisor')
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
                      >
                        <option value="admin">Admin</option>
                        <option value="supervisor">Supervisor</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700">Reference</label>
                    <input
                      type="text"
                      value={corrPayRef}
                      onChange={(e) => setCorrPayRef(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="text-xs font-semibold text-slate-700">Reason (Required) *</label>
                <input
                  type="text"
                  required
                  value={corrPayReason}
                  onChange={(e) => setCorrPayReason(e.target.value)}
                  placeholder="Reason for correction..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCorrPayTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCorrPay}
                  className="rounded-lg bg-[#0B1F3A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132f55] disabled:opacity-50"
                >
                  {savingCorrPay ? 'Saving...' : 'Save Correction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Log Complaint */}
      {complaintModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-[#0B1F3A]">Log Customer Complaint</h3>
              <button
                type="button"
                onClick={() => setComplaintModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitComplaint} className="mt-4 space-y-3 text-sm">
              <div>
                <label className="text-xs font-semibold text-slate-700">Complaint Date</label>
                <input
                  type="date"
                  required
                  value={compDate}
                  onChange={(e) => setCompDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Issue Summary *</label>
                <input
                  type="text"
                  required
                  value={compIssue}
                  onChange={(e) => setCompIssue(e.target.value)}
                  placeholder="e.g., Sediment left near reserve tank corner"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Action Taken</label>
                <input
                  type="text"
                  value={compAction}
                  onChange={(e) => setCompAction(e.target.value)}
                  placeholder="e.g., Called customer and arranged inspection"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Notes</label>
                <textarea
                  rows={2}
                  value={compNotes}
                  onChange={(e) => setCompNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setComplaintModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingComp}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {savingComp ? 'Saving...' : 'Save Complaint'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Schedule Return Visit */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0B1F3A]">Schedule Return Visit</h3>
                <p className="text-xs text-slate-500">Linked to {order.order_id}</p>
              </div>
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitReturnVisit} className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Visit Date *</label>
                  <input
                    type="date"
                    required
                    value={rvDate}
                    onChange={(e) => setRvDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Start Time</label>
                  <input
                    type="time"
                    value={rvTime}
                    onChange={(e) => setRvTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Duration (mins)</label>
                  <input
                    type="number"
                    min="30"
                    value={rvDuration}
                    onChange={(e) => setRvDuration(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Supervisor</label>
                  <select
                    value={rvSupId}
                    onChange={(e) => setRvSupId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs"
                  >
                    <option value="">Unassigned</option>
                    {activeSupervisors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-900">
                <input
                  type="checkbox"
                  checked={rvNoCharge}
                  onChange={(e) => setRvNoCharge(e.target.checked)}
                  className="h-4 w-4 rounded border-amber-400 text-amber-600"
                />
                No-Charge Return Visit (BDT 0 bill; expenses attributed to original job)
              </label>

              {!rvNoCharge && (
                <div>
                  <label className="text-xs font-semibold text-slate-700">Charge (BDT)</label>
                  <input
                    type="number"
                    min="0"
                    value={rvPrice}
                    onChange={(e) => setRvPrice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-700">Instructions</label>
                <textarea
                  rows={2}
                  value={rvInstructions}
                  onChange={(e) => setRvInstructions(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReturnTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRv}
                  className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {savingRv ? 'Scheduling...' : 'Schedule Return Visit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
