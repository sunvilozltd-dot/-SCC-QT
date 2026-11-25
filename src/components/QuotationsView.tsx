import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightCircle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  Eye,
  FileText,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  BuildingProfile,
  CustomerProfile,
  DEFAULT_SERVICES,
  DocumentPadConfig,
  LEAD_SOURCES,
  QUOTATION_STATUSES,
  QuotationChargeMode,
  QuotationItem,
  QuotationRecord,
  QuotationStatus,
  ReferralContactType,
  SERVICE_PACKAGE_INCLUSIONS,
  SupervisorAccount,
  TaxCalculationBase,
  VatCalculationBase,
} from '../types/order';
import {
  DEFAULT_QUOTATION_TERMS,
  FIXED_QUOTATION_INTRO,
  FIXED_QUOTATION_STEPS,
  FIXED_QUOTATION_STEPS_HEADING,
  FIXED_QUOTATION_SUBJECT,
  computeQuotationTotals,
} from '../utils/companyConstants';
import {
  addCalendarDays,
  bnToEnDigits,
  formatBdt2,
  formatDateEn,
  formatDateTimeEn,
  getTodayDhakaIso,
  roundMoney2,
  translateServiceToEnglish,
} from '../utils/dateAndPhone';
import { isQuotationFollowupDue } from '../utils/orderPredicates';
import { DocumentPreviewModal } from './DocumentPreviewModal';

export interface QuotationLeadPrefill {
  lead_id: string;
  customer_name: string;
  phone: string;
  address: string;
  area: string;
  interested_services: string;
  lead_source?: string;
  notes?: string;
}

export interface SaveQuotationPayload {
  quotation_id?: string;
  lead_id?: string;
  customer_id?: string;
  building_id?: string;
  quotation_date: string;
  valid_until: string;
  customer_name: string;
  phone: string;
  address: string;
  area: string;
  items: QuotationItem[];
  discount_enabled: boolean;
  discount_type: QuotationChargeMode;
  discount_value: number;
  discount_bdt: number;
  vat_enabled: boolean;
  vat_type: QuotationChargeMode;
  vat_value: number;
  vat_base: VatCalculationBase;
  vat_bdt: number;
  tax_enabled: boolean;
  tax_type: QuotationChargeMode;
  tax_value: number;
  tax_base: TaxCalculationBase;
  tax_bdt: number;
  terms: string;
  notes: string;
  lead_source?: string;
  referral_contact_type?: ReferralContactType;
  referral_contact_name?: string;
  referral_contact_phone?: string;
  status: QuotationStatus;
  followup_date?: string;
  followup_note?: string;
  share_url?: string;
}

interface QuotationsViewProps {
  quotations: QuotationRecord[];
  supervisors: SupervisorAccount[];
  customers?: CustomerProfile[];
  buildings?: BuildingProfile[];
  activePad: DocumentPadConfig | null;
  companyLogoDataUrl?: string;
  todayDhaka?: string;
  initialFilter?: 'all' | 'due_followups' | QuotationStatus;
  leadPrefill?: QuotationLeadPrefill | null;
  onConsumeLeadPrefill?: () => void;
  onArchivePdf?: (payload: {
    doc_type: 'quotation' | 'receipt';
    doc_id: string;
    file_name: string;
    pdf_base64: string;
  }) => Promise<void>;
  onSaveQuotation: (payload: SaveQuotationPayload) => Promise<void>;
  onUpdateQuotationFollowup?: (
    quotationId: string,
    payload: {
      status?: QuotationStatus;
      followup_date?: string;
      followup_note?: string;
      followup_done?: boolean;
      share_url?: string;
      status_note?: string;
    }
  ) => Promise<void>;
  onConvertQuotation: (
    quotationId: string,
    payload: {
      booking_date: string;
      scheduled_date: string;
      scheduled_time: string;
      assigned_supervisor_id: string;
      instructions: string;
    }
  ) => Promise<void>;
  onOpenWhatsApp?: (quotation: QuotationRecord) => void;
  onOpenOrder: (orderId: string) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

const STATUS_BADGE_MAP: Record<QuotationStatus, string> = {
  Draft: 'border-slate-200 bg-slate-100 text-slate-700',
  Sent: 'border-blue-200 bg-blue-50 text-blue-800',
  Accepted: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  Cancelled: 'border-red-200 bg-red-50 text-red-700',
};

function makeEmptyRow(service = DEFAULT_SERVICES[0]): QuotationItem {
  return {
    service,
    description: '',
    size: '',
    quantity: 1,
    unit_label: '',
    rate_bdt: 0,
    amount_bdt: 0,
  };
}

export function QuotationsView({
  quotations,
  supervisors,
  customers = [],
  buildings = [],
  activePad,
  companyLogoDataUrl,
  todayDhaka,
  initialFilter = 'all',
  leadPrefill,
  onConsumeLeadPrefill,
  onArchivePdf,
  onSaveQuotation,
  onUpdateQuotationFollowup,
  onConvertQuotation,
  onOpenWhatsApp,
  onOpenOrder,
  onNotify,
}: QuotationsViewProps) {
  const today = todayDhaka || getTodayDhakaIso();

  const [filterTab, setFilterTab] = useState<'all' | 'due_followups' | QuotationStatus>(
    initialFilter
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Create / Edit Quotation Modal State
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [linkedLeadId, setLinkedLeadId] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedBuildingId, setSelectedBuildingId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [quotationDate, setQuotationDate] = useState(today);
  const [validUntil, setValidUntil] = useState('');
  const [items, setItems] = useState<QuotationItem[]>([makeEmptyRow()]);

  // Independent optional Discount / VAT / Tax controls (ALL UNCHECKED by default on new quotations)
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountType, setDiscountType] = useState<QuotationChargeMode>('amount');
  const [discountValue, setDiscountValue] = useState('0');

  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatType, setVatType] = useState<QuotationChargeMode>('percent');
  const [vatValue, setVatValue] = useState('0');
  const [vatBase, setVatBase] = useState<VatCalculationBase>('after_discount');

  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxType, setTaxType] = useState<QuotationChargeMode>('percent');
  const [taxValue, setTaxValue] = useState('0');
  const [taxBase, setTaxBase] = useState<TaxCalculationBase>('after_discount');

  const [status, setStatus] = useState<QuotationStatus>('Sent');
  const [leadSource, setLeadSource] = useState('Not Specified');
  const [followupDate, setFollowupDate] = useState('');
  const [followupNote, setFollowupNote] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [showFixedPreview, setShowFixedPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Follow-up & Status Modal
  const [followupTarget, setFollowupTarget] = useState<QuotationRecord | null>(null);
  const [fuStatus, setFuStatus] = useState<QuotationStatus>('Sent');
  const [fuDate, setFuDate] = useState('');
  const [fuNote, setFuNote] = useState('');
  const [fuShareUrl, setFuShareUrl] = useState('');
  const [fuDone, setFuDone] = useState(false);
  const [fuStatusNote, setFuStatusNote] = useState('');

  // Convert to Order Modal
  const [convertTarget, setConvertTarget] = useState<QuotationRecord | null>(null);
  const [convertBookingDate, setConvertBookingDate] = useState(today);
  const [schedDate, setSchedDate] = useState(today);
  const [schedTime, setSchedTime] = useState('10:00');
  const [schedSupervisor, setSchedSupervisor] = useState('');
  const [schedInstructions, setSchedInstructions] = useState('');

  // Document Preview Modal
  const [previewQuotation, setPreviewQuotation] = useState<QuotationRecord | null>(null);

  useEffect(() => {
    setFilterTab(initialFilter);
  }, [initialFilter]);

  const resetOptionalCharges = () => {
    setDiscountEnabled(false);
    setDiscountType('amount');
    setDiscountValue('0');
    setVatEnabled(false);
    setVatType('percent');
    setVatValue('0');
    setVatBase('after_discount');
    setTaxEnabled(false);
    setTaxType('percent');
    setTaxValue('0');
    setTaxBase('after_discount');
  };

  useEffect(() => {
    if (!leadPrefill) return;
    const nowDate = getTodayDhakaIso();
    setEditingId(undefined);
    setLinkedLeadId(leadPrefill.lead_id);
    setSelectedCustomerId('');
    setSelectedBuildingId('');
    setCustomerName(leadPrefill.customer_name || '');
    setPhone(leadPrefill.phone || '');
    setAddress(leadPrefill.address || '');
    setArea(leadPrefill.area || '');
    setQuotationDate(nowDate);
    setValidUntil('');
    const parsedServices = (leadPrefill.interested_services || '')
      .split(',')
      .map((s) => translateServiceToEnglish(s.trim()))
      .filter(Boolean);
    setItems(parsedServices.length > 0 ? parsedServices.map((svc) => makeEmptyRow(svc)) : [makeEmptyRow()]);
    resetOptionalCharges();
    setStatus('Sent');
    setLeadSource(leadPrefill.lead_source || 'Not Specified');
    setFollowupDate(addCalendarDays(nowDate, 2));
    setFollowupNote('');
    setShareUrl('');
    setTerms(DEFAULT_QUOTATION_TERMS);
    setNotes(leadPrefill.notes || '');
    setFormOpen(true);
    onConsumeLeadPrefill?.();
  }, [leadPrefill, onConsumeLeadPrefill]);

  const openCreateForm = () => {
    const nowDate = getTodayDhakaIso();
    setEditingId(undefined);
    setLinkedLeadId('');
    setSelectedCustomerId('');
    setSelectedBuildingId('');
    setCustomerName('');
    setPhone('');
    setAddress('');
    setArea('');
    setQuotationDate(nowDate);
    setValidUntil('');
    setItems([makeEmptyRow('Overhead Tank')]);
    resetOptionalCharges();
    setStatus('Sent');
    setLeadSource('Not Specified');
    setFollowupDate(addCalendarDays(nowDate, 2));
    setFollowupNote('');
    setShareUrl('');
    setTerms(DEFAULT_QUOTATION_TERMS);
    setNotes('');
    setShowFixedPreview(false);
    setFormOpen(true);
  };

  const openEditForm = (q: QuotationRecord) => {
    setEditingId(q.quotation_id);
    setLinkedLeadId(q.lead_id || '');
    setSelectedCustomerId(q.customer_id || '');
    setSelectedBuildingId(q.building_id || '');
    setCustomerName(q.customer_name);
    setPhone(q.phone_display);
    setAddress(q.address);
    setArea(q.area);
    setQuotationDate(q.quotation_date);
    setValidUntil(q.valid_until || '');
    setItems(q.items.length > 0 ? q.items.map((i) => ({ ...i })) : [makeEmptyRow()]);

    setDiscountEnabled(Boolean(q.discount_enabled));
    setDiscountType(q.discount_type || 'amount');
    setDiscountValue(String(q.discount_enabled ? q.discount_value || q.discount_bdt || 0 : 0));

    setVatEnabled(Boolean(q.vat_enabled));
    setVatType(q.vat_type || 'percent');
    setVatValue(String(q.vat_enabled ? q.vat_value || 0 : 0));
    setVatBase(q.vat_base || 'after_discount');

    setTaxEnabled(Boolean(q.tax_enabled));
    setTaxType(q.tax_type || 'percent');
    setTaxValue(String(q.tax_enabled ? q.tax_value || 0 : 0));
    setTaxBase(q.tax_base || 'after_discount');

    setStatus(q.status);
    setLeadSource(q.lead_source || 'Not Specified');
    setFollowupDate(q.followup_date || '');
    setFollowupNote(q.followup_note || '');
    setShareUrl(q.share_url || '');
    setTerms(q.terms || '');
    setNotes(q.notes || '');
    setShowFixedPreview(false);
    setFormOpen(true);
  };

  const customerBuildings = useMemo(
    () => buildings.filter((b) => b.customer_id === selectedCustomerId),
    [buildings, selectedCustomerId]
  );

  const handleSelectCustomer = (custId: string) => {
    setSelectedCustomerId(custId);
    setSelectedBuildingId('');
    const found = customers.find((c) => c.customer_id === custId);
    if (found) {
      setCustomerName(found.name);
      setPhone(found.phone_display);
      if (found.lead_source) setLeadSource(found.lead_source);
    }
  };

  const handleSelectBuilding = (bId: string) => {
    setSelectedBuildingId(bId);
    const found = buildings.find((b) => b.building_id === bId);
    if (!found) return;
    setAddress(found.address);
    setArea(found.area || '');
    const suggested: QuotationItem[] = [];
    if (found.overhead_tank_qty > 0) {
      suggested.push({
        service: 'Overhead Tank Cleaning',
        description: [
          found.overhead_tank_capacity_litres ? `${found.overhead_tank_capacity_litres}L` : '',
          found.overhead_tank_material,
        ]
          .filter(Boolean)
          .join(' '),
        size: '',
        quantity: found.overhead_tank_qty,
        unit_label: '',
        rate_bdt: 0,
        amount_bdt: 0,
      });
    }
    if (found.reserve_tank_qty > 0) {
      suggested.push({
        service: 'Reserve Tank Cleaning',
        description: [
          found.reserve_tank_capacity_litres ? `${found.reserve_tank_capacity_litres}L` : '',
          found.reserve_tank_material,
        ]
          .filter(Boolean)
          .join(' '),
        size: '',
        quantity: found.reserve_tank_qty,
        unit_label: '',
        rate_bdt: 0,
        amount_bdt: 0,
      });
    }
    if (suggested.length > 0) setItems(suggested);
  };

  const applyStandardServiceRows = () => {
    setItems([
      makeEmptyRow('Overhead Tank Cleaning'),
      makeEmptyRow('Reserve Tank Cleaning'),
      makeEmptyRow('Pipeline Cleaning'),
    ]);
  };

  const updateItem = (idx: number, patch: Partial<QuotationItem>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        const qty = Math.max(0, Number(next.quantity) || 0);
        const rate = Math.max(0, Number(next.rate_bdt) || 0);
        next.quantity = qty;
        next.rate_bdt = rate;
        next.amount_bdt = roundMoney2(qty * rate);
        return next;
      })
    );
  };

  const parsedDiscountVal = Math.max(0, Number(bnToEnDigits(discountValue || '0')) || 0);
  const parsedVatVal = Math.max(0, Number(bnToEnDigits(vatValue || '0')) || 0);
  const parsedTaxVal = Math.max(0, Number(bnToEnDigits(taxValue || '0')) || 0);

  const totals = useMemo(
    () =>
      computeQuotationTotals({
        items,
        discount_enabled: discountEnabled,
        discount_type: discountType,
        discount_value: discountEnabled ? parsedDiscountVal : 0,
        vat_enabled: vatEnabled,
        vat_type: vatType,
        vat_value: vatEnabled ? parsedVatVal : 0,
        vat_base: vatBase,
        tax_enabled: taxEnabled,
        tax_type: taxType,
        tax_value: taxEnabled ? parsedTaxVal : 0,
        tax_base: taxBase,
      }),
    [
      items,
      discountEnabled,
      discountType,
      parsedDiscountVal,
      vatEnabled,
      vatType,
      parsedVatVal,
      vatBase,
      taxEnabled,
      taxType,
      parsedTaxVal,
      taxBase,
    ]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (items.length === 0 || items.every((i) => !i.service.trim())) {
      onNotify('Please add at least one service row.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await onSaveQuotation({
        quotation_id: editingId,
        lead_id: linkedLeadId || undefined,
        customer_id: selectedCustomerId || undefined,
        building_id: selectedBuildingId || undefined,
        quotation_date: quotationDate,
        valid_until: validUntil,
        customer_name: customerName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        area: area.trim(),
        items,
        discount_enabled: discountEnabled,
        discount_type: discountType,
        discount_value: discountEnabled ? parsedDiscountVal : 0,
        discount_bdt: totals.discount_bdt,
        vat_enabled: vatEnabled,
        vat_type: vatType,
        vat_value: vatEnabled ? parsedVatVal : 0,
        vat_base: vatBase,
        vat_bdt: totals.vat_bdt,
        tax_enabled: taxEnabled,
        tax_type: taxType,
        tax_value: taxEnabled ? parsedTaxVal : 0,
        tax_base: taxBase,
        tax_bdt: totals.tax_bdt,
        terms,
        notes,
        lead_source: leadSource,
        status,
        followup_date: status === 'Accepted' || status === 'Cancelled' ? '' : followupDate,
        followup_note: followupNote,
        share_url: shareUrl.trim(),
      });
      setFormOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const openFollowupModal = (q: QuotationRecord) => {
    setFollowupTarget(q);
    setFuStatus(q.status);
    setFuDate(q.followup_date || '');
    setFuNote(q.followup_note || '');
    setFuShareUrl(q.share_url || '');
    setFuDone(Boolean(q.followup_done));
    setFuStatusNote('');
  };

  const handleSaveFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followupTarget || !onUpdateQuotationFollowup || submitting) return;
    setSubmitting(true);
    try {
      await onUpdateQuotationFollowup(followupTarget.quotation_id, {
        status: fuStatus,
        followup_date: fuDate,
        followup_note: fuNote,
        followup_done: fuDone,
        share_url: fuShareUrl.trim(),
        status_note: fuStatusNote.trim(),
      });
      setFollowupTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenConvert = (q: QuotationRecord) => {
    if (q.converted_order_id) {
      onOpenOrder(q.converted_order_id);
      return;
    }
    const nowDate = getTodayDhakaIso();
    setConvertTarget(q);
    setConvertBookingDate(nowDate);
    setSchedDate(nowDate);
    setSchedTime('10:00');
    setSchedSupervisor('');
    setSchedInstructions(q.notes || '');
  };

  const handleConfirmConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convertTarget || submitting) return;
    setSubmitting(true);
    try {
      await onConvertQuotation(convertTarget.quotation_id, {
        booking_date: convertBookingDate,
        scheduled_date: schedDate,
        scheduled_time: schedTime,
        assigned_supervisor_id: schedSupervisor,
        instructions: schedInstructions,
      });
      setConvertTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const activeSupervisors = supervisors.filter((s) => s.is_active);

  const dueFollowupCount = useMemo(
    () => quotations.filter((q) => isQuotationFollowupDue(q, today)).length,
    [quotations, today]
  );

  const filteredQuotations = useMemo(() => {
    const qText = searchQuery.trim().toLowerCase();
    return quotations.filter((q) => {
      if (filterTab === 'due_followups' && !isQuotationFollowupDue(q, today)) return false;
      if (
        filterTab !== 'all' &&
        filterTab !== 'due_followups' &&
        q.status !== filterTab
      ) {
        return false;
      }
      if (!qText) return true;
      return (
        q.quotation_id.toLowerCase().includes(qText) ||
        q.customer_name.toLowerCase().includes(qText) ||
        q.phone_display.toLowerCase().includes(qText) ||
        q.address.toLowerCase().includes(qText) ||
        q.area.toLowerCase().includes(qText)
      );
    });
  }, [quotations, filterTab, searchQuery, today]);

  return (
    <div className="space-y-5">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            Create official WHO-standard water tank cleaning quotations with multiple services,
            optional Discount/VAT/Tax, follow-ups, PDF export, and one-click order conversion.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          New Quotation
        </button>
      </div>

      {/* Filter Bar + Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `All (${quotations.length})` },
              { id: 'due_followups', label: `Follow-Ups Due (${dueFollowupCount})` },
              ...QUOTATION_STATUSES.map((st) => ({
                id: st,
                label: `${st} (${quotations.filter((q) => q.status === st).length})`,
              })),
            ] as Array<{ id: 'all' | 'due_followups' | QuotationStatus; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterTab(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                filterTab === tab.id
                  ? 'bg-[#0B1F3A] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search ID, customer, phone, area..."
            className="h-9 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-xs text-[#0B1F3A]"
          />
        </div>
      </div>

      {/* Quotations List */}
      {filteredQuotations.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
          <h2 className="text-lg font-bold text-[#0B1F3A]">No Quotations Found</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Create a new quotation to automatically generate the official SUNVILOZ Clean Care A4
            document and track follow-ups until order confirmation.
          </p>
          <button
            type="button"
            onClick={openCreateForm}
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" />
            Create First Quotation
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredQuotations.map((q) => {
            const isDue = isQuotationFollowupDue(q, today);
            return (
              <div
                key={q.quotation_id}
                className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:flex-row lg:items-center"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#0B1F3A]">
                      {q.quotation_id}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-base font-bold text-[#0B1F3A]">{q.customer_name}</span>
                    <span
                      className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                        STATUS_BADGE_MAP[q.status] || 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {q.status}
                    </span>
                    {isDue && (
                      <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        Follow-Up Due: {formatDateEn(q.followup_date)}
                      </span>
                    )}
                    {!isDue && q.followup_date && !q.followup_done && q.status !== 'Accepted' && q.status !== 'Cancelled' && (
                      <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                        Follow-Up: {formatDateEn(q.followup_date)}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-slate-500">
                    <span className="font-mono">{q.phone_display}</span> ·{' '}
                    {q.area ? `${q.area}, ` : ''}
                    {q.address}
                    {q.lead_source && q.lead_source !== 'Not Specified' ? (
                      <>
                        {' '}
                        · <span className="font-medium text-slate-600">{q.lead_source}</span>
                      </>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
                    <span>Date: {formatDateEn(q.quotation_date)}</span>
                    <span>·</span>
                    <span>
                      {q.items.length} {q.items.length === 1 ? 'service' : 'services'}
                    </span>
                    <span>·</span>
                    <span>Subtotal: BDT {formatBdt2(q.subtotal_bdt)}</span>
                    {q.discount_enabled && (
                      <>
                        <span>·</span>
                        <span className="text-amber-800">
                          Discount: -BDT {formatBdt2(q.discount_bdt)}
                        </span>
                      </>
                    )}
                    {q.vat_enabled && (
                      <>
                        <span>·</span>
                        <span className="text-blue-800">VAT: +BDT {formatBdt2(q.vat_bdt)}</span>
                      </>
                    )}
                    {q.tax_enabled && (
                      <>
                        <span>·</span>
                        <span className="text-purple-800">Tax: +BDT {formatBdt2(q.tax_bdt)}</span>
                      </>
                    )}
                    <span>·</span>
                    <strong className="font-mono text-sm text-[#0B1F3A]">
                      Grand Total: BDT {formatBdt2(q.total_bdt)}
                    </strong>
                    {q.converted_order_id && (
                      <>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => onOpenOrder(q.converted_order_id)}
                          className="font-mono font-semibold text-teal-700 underline"
                        >
                          Order: {q.converted_order_id}
                        </button>
                      </>
                    )}
                  </div>

                  {q.followup_note && (
                    <div className="text-xs text-slate-500">
                      <strong className="text-slate-700">Follow-up note:</strong> {q.followup_note}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewQuotation(q)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview / PDF
                  </button>

                  {onOpenWhatsApp && (
                    <button
                      type="button"
                      onClick={() => onOpenWhatsApp(q)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                    </button>
                  )}

                  {onUpdateQuotationFollowup && (
                    <button
                      type="button"
                      onClick={() => openFollowupModal(q)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Follow-Up
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openEditForm(q)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </button>

                  {q.status !== 'Cancelled' && (
                    <button
                      type="button"
                      onClick={() => handleOpenConvert(q)}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold ${
                        q.converted_order_id
                          ? 'border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100'
                          : 'bg-[#0B1F3A] text-white hover:bg-[#163056]'
                      }`}
                    >
                      <ArrowRightCircle className="h-3.5 w-3.5" />
                      {q.converted_order_id ? 'Open Linked Order' : 'Convert to Order'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Quotation Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-bold text-[#0B1F3A]">
                {editingId ? `Edit Quotation (${editingId})` : 'New Water Tank Cleaning Quotation'}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex flex-1 flex-col overflow-hidden">
              <div className="space-y-4 overflow-y-auto px-6 py-5">
                {/* Auto-Inserted Fixed Quotation Content Notice */}
                <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-4 py-3 text-xs text-[#0B1F3A]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-teal-900">
                      <FileText className="h-4 w-4 shrink-0 text-teal-700" />
                      <span>
                        Official fixed Subject, WHO Introduction, and 8 Cleaning Steps are
                        automatically inserted into this quotation.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFixedPreview((p) => !p)}
                      className="inline-flex items-center gap-1 rounded border border-teal-300 bg-white px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-50"
                    >
                      {showFixedPreview ? (
                        <>
                          Hide <ChevronUp className="h-3 w-3" />
                        </>
                      ) : (
                        <>
                          View Text <ChevronDown className="h-3 w-3" />
                        </>
                      )}
                    </button>
                  </div>
                  {showFixedPreview && (
                    <div className="mt-3 space-y-1.5 border-t border-teal-200 pt-2.5 text-[11.5px] leading-relaxed text-slate-700">
                      <div>
                        <strong>Subject:</strong> {FIXED_QUOTATION_SUBJECT}
                      </div>
                      <p>{FIXED_QUOTATION_INTRO}</p>
                      <div className="font-bold text-[#0B1F3A]">{FIXED_QUOTATION_STEPS_HEADING}</div>
                      <ul className="space-y-0.5 pl-1">
                        {FIXED_QUOTATION_STEPS.map((st, idx) => (
                          <li key={idx}>
                            <strong>{st.label}</strong> {st.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Optional Customer & Building Auto-Fill */}
                {customers.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                        Select Existing Customer (Optional)
                      </label>
                      <select
                        value={selectedCustomerId}
                        onChange={(e) => handleSelectCustomer(e.target.value)}
                        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                      >
                        <option value="">-- Enter customer manually --</option>
                        {customers.map((c) => (
                          <option key={c.customer_id} value={c.customer_id}>
                            {c.name} ({c.phone_display})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                        Select Saved Building (Auto-fills Address &amp; Tanks)
                      </label>
                      <select
                        value={selectedBuildingId}
                        disabled={!selectedCustomerId || customerBuildings.length === 0}
                        onChange={(e) => handleSelectBuilding(e.target.value)}
                        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs disabled:bg-slate-100"
                      >
                        <option value="">
                          {selectedCustomerId
                            ? customerBuildings.length > 0
                              ? '-- Select building --'
                              : 'No saved buildings for this customer'
                            : '-- Choose customer first --'}
                        </option>
                        {customerBuildings.map((b) => (
                          <option key={b.building_id} value={b.building_id}>
                            {b.name} — {b.area || b.address}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Dates & Status */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Quotation Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={quotationDate}
                      onChange={(e) => setQuotationDate(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Valid Until (Optional)
                    </label>
                    <input
                      type="date"
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">Status</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as QuotationStatus)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      {QUOTATION_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Lead Source
                    </label>
                    <select
                      value={leadSource}
                      onChange={(e) => setLeadSource(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      {LEAD_SOURCES.map((src) => (
                        <option key={src} value={src}>
                          {src}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Customer Details */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Customer Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Full name or organization"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Phone Number *
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="017XXXXXXXX"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Address *
                    </label>
                    <input
                      type="text"
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="House, Road, Block, Dhaka"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">Area</label>
                    <input
                      type="text"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      placeholder="Uttara / Mirpur / Gulshan"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    />
                  </div>
                </div>

                {/* Financial Offer Multi-Service Table Editor */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-bold text-[#0B1F3A]">
                      Financial Offer — Services &amp; Pricing *
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={applyStandardServiceRows}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        Load Standard 3 Rows
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) => {
                            const used = new Set(prev.map((row) => row.service));
                            const nextService =
                              DEFAULT_SERVICES.find((srv) => !used.has(srv)) || DEFAULT_SERVICES[0];
                            return [...prev, makeEmptyRow(nextService)];
                          })
                        }
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Service
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {items.map((it, idx) => {
                      const isLegacyService =
                        Boolean(it.service.trim()) && !DEFAULT_SERVICES.includes(it.service);
                      const packageHint = SERVICE_PACKAGE_INCLUSIONS[it.service];
                      return (
                        <div
                          key={idx}
                          className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-12"
                        >
                          <div className="sm:col-span-4">
                            <label className="block text-[10px] font-medium text-slate-500">
                              Service *
                            </label>
                            <select
                              required
                              value={it.service}
                              onChange={(e) => updateItem(idx, { service: e.target.value })}
                              className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-[#0B1F3A]"
                            >
                              {DEFAULT_SERVICES.map((srv) => (
                                <option key={srv} value={srv}>
                                  {srv}
                                </option>
                              ))}
                              {isLegacyService && (
                                <option value={it.service}>{it.service} (Saved)</option>
                              )}
                            </select>
                            {packageHint && (
                              <p className="mt-1 text-[10px] text-slate-500">{packageHint}</p>
                            )}
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-medium text-slate-500">
                              Size
                            </label>
                            <input
                              type="text"
                              value={it.size || ''}
                              onChange={(e) => updateItem(idx, { size: e.target.value })}
                              placeholder="L x W x H"
                              className="h-9 w-full rounded border border-slate-300 bg-white px-2 font-mono text-xs"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 sm:col-span-2">
                            <div>
                              <label className="block text-[10px] font-medium text-slate-500">
                                Qty
                              </label>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={it.quantity}
                                onChange={(e) =>
                                  updateItem(idx, { quantity: Number(e.target.value) })
                                }
                                className="h-9 w-full rounded border border-slate-300 bg-white px-1.5 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-slate-500">
                                Unit
                              </label>
                              <input
                                type="text"
                                value={it.unit_label || ''}
                                onChange={(e) => updateItem(idx, { unit_label: e.target.value })}
                                placeholder="Flat / Tank"
                                className="h-9 w-full rounded border border-slate-300 bg-white px-1.5 text-xs"
                              />
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-medium text-slate-500">
                              Rate/Price (BDT)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={it.rate_bdt}
                              onChange={(e) => updateItem(idx, { rate_bdt: Number(e.target.value) })}
                              className="h-9 w-full rounded border border-slate-300 bg-white px-2 font-mono text-xs"
                            />
                          </div>
                          <div className="flex items-end justify-between sm:col-span-2 sm:justify-end sm:gap-1.5">
                            <div className="font-mono text-xs font-bold tabular-nums text-[#0B1F3A]">
                              BDT {formatBdt2(it.amount_bdt)}
                            </div>
                            {items.length > 1 && (
                              <button
                                type="button"
                                aria-label="Remove service row"
                                onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                                className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:text-red-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Optional Discount, VAT, and Tax Controls (ALL UNCHECKED BY DEFAULT) */}
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="text-xs font-bold text-[#0B1F3A]">
                    Optional Pricing Adjustments (Unchecked items are excluded from the quotation and PDF)
                  </div>

                  {/* 1. Apply Discount */}
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#0B1F3A]">
                      <input
                        type="checkbox"
                        checked={discountEnabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setDiscountEnabled(checked);
                          if (!checked) setDiscountValue('0');
                        }}
                        className="h-4 w-4 accent-teal-600"
                      />
                      Apply Discount
                    </label>
                    {discountEnabled && (
                      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <select
                          value={discountType}
                          onChange={(e) => setDiscountType(e.target.value as QuotationChargeMode)}
                          className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                        >
                          <option value="amount">Fixed Amount (BDT)</option>
                          <option value="percent">Percentage (%)</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          max={discountType === 'percent' ? 100 : undefined}
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          placeholder={discountType === 'percent' ? 'e.g. 10' : 'e.g. 1200'}
                          className="h-9 rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
                        />
                        <div className="flex items-center justify-end font-mono text-xs font-bold text-amber-800 tabular-nums">
                          -BDT {formatBdt2(totals.discount_bdt)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. Apply VAT */}
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#0B1F3A]">
                      <input
                        type="checkbox"
                        checked={vatEnabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setVatEnabled(checked);
                          if (!checked) setVatValue('0');
                        }}
                        className="h-4 w-4 accent-teal-600"
                      />
                      Apply VAT
                    </label>
                    {vatEnabled && (
                      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-4">
                        <select
                          value={vatType}
                          onChange={(e) => setVatType(e.target.value as QuotationChargeMode)}
                          className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                        >
                          <option value="percent">Percentage (%)</option>
                          <option value="amount">Fixed Amount (BDT)</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={vatValue}
                          onChange={(e) => setVatValue(e.target.value)}
                          placeholder={vatType === 'percent' ? 'e.g. 15' : 'e.g. 500'}
                          className="h-9 rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
                        />
                        <select
                          value={vatBase}
                          disabled={vatType === 'amount'}
                          onChange={(e) => setVatBase(e.target.value as VatCalculationBase)}
                          className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs disabled:bg-slate-100"
                        >
                          <option value="after_discount">Base: After Discount</option>
                          <option value="subtotal">Base: Subtotal</option>
                        </select>
                        <div className="flex items-center justify-end font-mono text-xs font-bold text-blue-800 tabular-nums">
                          +BDT {formatBdt2(totals.vat_bdt)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. Apply Tax */}
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#0B1F3A]">
                      <input
                        type="checkbox"
                        checked={taxEnabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setTaxEnabled(checked);
                          if (!checked) setTaxValue('0');
                        }}
                        className="h-4 w-4 accent-teal-600"
                      />
                      Apply Tax
                    </label>
                    {taxEnabled && (
                      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-4">
                        <select
                          value={taxType}
                          onChange={(e) => setTaxType(e.target.value as QuotationChargeMode)}
                          className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                        >
                          <option value="percent">Percentage (%)</option>
                          <option value="amount">Fixed Amount (BDT)</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={taxValue}
                          onChange={(e) => setTaxValue(e.target.value)}
                          placeholder={taxType === 'percent' ? 'e.g. 5' : 'e.g. 300'}
                          className="h-9 rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
                        />
                        <select
                          value={taxBase}
                          disabled={taxType === 'amount'}
                          onChange={(e) => setTaxBase(e.target.value as TaxCalculationBase)}
                          className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs disabled:bg-slate-100"
                        >
                          <option value="after_discount">Base: After Discount</option>
                          <option value="subtotal">Base: Subtotal</option>
                          <option value="after_discount_and_vat">Base: After Discount + VAT</option>
                        </select>
                        <div className="flex items-center justify-end font-mono text-xs font-bold text-purple-800 tabular-nums">
                          +BDT {formatBdt2(totals.tax_bdt)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Live Totals Summary (Only shows enabled rows!) */}
                  <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3.5 text-xs">
                    <div className="flex items-center justify-between py-0.5 text-slate-700">
                      <span>Subtotal</span>
                      <span className="font-mono font-semibold tabular-nums">
                        BDT {formatBdt2(totals.subtotal_bdt)}
                      </span>
                    </div>
                    {discountEnabled && (
                      <div className="flex items-center justify-between py-0.5 text-amber-900">
                        <span>
                          Discount{discountType === 'percent' ? ` (${parsedDiscountVal}%)` : ''}
                        </span>
                        <span className="font-mono font-semibold tabular-nums">
                          -BDT {formatBdt2(totals.discount_bdt)}
                        </span>
                      </div>
                    )}
                    {vatEnabled && (
                      <div className="flex items-center justify-between py-0.5 text-blue-900">
                        <span>VAT{vatType === 'percent' ? ` (${parsedVatVal}%)` : ''}</span>
                        <span className="font-mono font-semibold tabular-nums">
                          +BDT {formatBdt2(totals.vat_bdt)}
                        </span>
                      </div>
                    )}
                    {taxEnabled && (
                      <div className="flex items-center justify-between py-0.5 text-purple-900">
                        <span>Tax{taxType === 'percent' ? ` (${parsedTaxVal}%)` : ''}</span>
                        <span className="font-mono font-semibold tabular-nums">
                          +BDT {formatBdt2(totals.tax_bdt)}
                        </span>
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center justify-between border-t border-teal-200 pt-2 text-sm font-bold text-teal-900">
                      <span>Grand Total</span>
                      <span className="font-mono text-base tabular-nums">
                        BDT {formatBdt2(totals.total_bdt)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Follow-Up & Share Link */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Follow-Up Date
                    </label>
                    <input
                      type="date"
                      value={followupDate}
                      onChange={(e) => setFollowupDate(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Follow-Up Note
                    </label>
                    <input
                      type="text"
                      value={followupNote}
                      onChange={(e) => setFollowupNote(e.target.value)}
                      placeholder="e.g. Call committee chairman after board review"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Shareable Quotation URL (Optional)
                    </label>
                    <input
                      type="url"
                      value={shareUrl}
                      onChange={(e) => setShareUrl(e.target.value)}
                      placeholder="https://..."
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Internal Notes
                    </label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional internal remarks"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Terms &amp; Conditions (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    placeholder="Leave blank to match the official SUNVILOZ quotation sample (or add custom terms if needed)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-10 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {submitting ? 'Saving...' : 'Save Quotation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quotation Follow-Up & Status History Modal */}
      {followupTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-bold text-[#0B1F3A]">
                Quotation Follow-Up ({followupTarget.quotation_id})
              </h2>
              <button
                type="button"
                onClick={() => setFollowupTarget(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveFollowup} className="flex flex-1 flex-col overflow-hidden">
              <div className="space-y-4 overflow-y-auto p-5 text-sm">
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  <div className="font-bold text-[#0B1F3A]">{followupTarget.customer_name}</div>
                  <div>
                    {followupTarget.phone_display} · BDT {formatBdt2(followupTarget.total_bdt)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Quotation Status
                    </label>
                    <select
                      value={fuStatus}
                      onChange={(e) => setFuStatus(e.target.value as QuotationStatus)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      {QUOTATION_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Next Follow-Up Date
                    </label>
                    <input
                      type="date"
                      value={fuDate}
                      onChange={(e) => setFuDate(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Follow-Up Note
                  </label>
                  <textarea
                    rows={2}
                    value={fuNote}
                    onChange={(e) => setFuNote(e.target.value)}
                    placeholder="Record customer feedback or next step..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Shareable Link (Optional)
                  </label>
                  <input
                    type="url"
                    value={fuShareUrl}
                    onChange={(e) => setFuShareUrl(e.target.value)}
                    placeholder="https://..."
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Status Change Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={fuStatusNote}
                    onChange={(e) => setFuStatusNote(e.target.value)}
                    placeholder="Reason for status update"
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs"
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#0B1F3A]">
                  <input
                    type="checkbox"
                    checked={fuDone}
                    onChange={(e) => setFuDone(e.target.checked)}
                    className="h-4 w-4 accent-teal-600"
                  />
                  Mark current follow-up as completed
                </label>

                {/* Status History Timeline */}
                {followupTarget.status_history && followupTarget.status_history.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <div className="mb-2 text-xs font-bold text-[#0B1F3A]">Status History</div>
                    <div className="space-y-2 text-xs">
                      {followupTarget.status_history.map((entry, idx) => (
                        <div
                          key={idx}
                          className="flex items-start justify-between gap-2 border-b border-slate-200/70 pb-1.5 last:border-b-0 last:pb-0"
                        >
                          <div>
                            <span className="font-semibold text-[#0B1F3A]">{entry.status}</span>
                            {entry.note ? (
                              <span className="ml-1.5 text-slate-600">— {entry.note}</span>
                            ) : null}
                            <div className="text-[11px] text-slate-500">By {entry.changed_by}</div>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] text-slate-500">
                            {formatDateTimeEn(entry.changed_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => setFollowupTarget(null)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {submitting ? 'Saving...' : 'Save Follow-Up'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Convert Quotation -> Order Modal */}
      {convertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-bold text-[#0B1F3A]">
                Convert Quotation to Order ({convertTarget.quotation_id})
              </h2>
              <button
                type="button"
                onClick={() => setConvertTarget(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmConvert}>
              <div className="space-y-4 p-5 text-sm">
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  <div className="font-bold text-[#0B1F3A]">{convertTarget.customer_name}</div>
                  <div>
                    {convertTarget.phone_display} · {convertTarget.address}
                  </div>
                  <div className="mt-1 font-mono font-bold text-teal-800">
                    Quoted Total: BDT {formatBdt2(convertTarget.total_bdt)}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Order Booking Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={convertBookingDate}
                    onChange={(e) => setConvertBookingDate(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Scheduled Work Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={schedDate}
                      onChange={(e) => setSchedDate(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                      Scheduled Work Time *
                    </label>
                    <input
                      type="time"
                      required
                      value={schedTime}
                      onChange={(e) => setSchedTime(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Assigned Supervisor
                  </label>
                  <select
                    value={schedSupervisor}
                    onChange={(e) => setSchedSupervisor(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="">Not assigned yet</option>
                    {activeSupervisors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.username})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Work Instructions
                  </label>
                  <textarea
                    rows={2}
                    value={schedInstructions}
                    onChange={(e) => setSchedInstructions(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => setConvertTarget(null)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-10 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700"
                >
                  {submitting ? 'Creating...' : 'Create Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <DocumentPreviewModal
        open={Boolean(previewQuotation)}
        type="quotation"
        quotation={previewQuotation}
        fallbackPad={activePad}
        companyLogoDataUrl={companyLogoDataUrl}
        onArchivePdf={onArchivePdf}
        onClose={() => setPreviewQuotation(null)}
        onNotify={onNotify}
      />
    </div>
  );
}
