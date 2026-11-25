import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Edit3,
  FileText,
  MessageCircle,
  MessageSquarePlus,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../services/apiClient';
import {
  DEFAULT_SERVICES,
  LEAD_CHANNELS,
  LEAD_SOURCES,
  LEAD_STAGES,
  LeadChannel,
  LeadNoteRecord,
  LeadRecord,
  LeadStage,
  ReferralContactType,
  SERVICE_PACKAGE_INCLUSIONS,
} from '../types/order';
import {
  buildContactWhatsAppLink,
  buildLeadWhatsAppLink,
  buildTelLink,
  formatDateEn,
  formatDateTimeEn,
  getTodayDhakaIso,
  normalizeSearchText,
  translateServiceToEnglish,
} from '../utils/dateAndPhone';
import { OrderLeadPrefill } from './OrderFormModal';
import { QuotationLeadPrefill } from './QuotationsView';

interface LeadsViewProps {
  leads: LeadRecord[];
  leadNotes: LeadNoteRecord[];
  todayDhaka: string;
  onCreateLead: (payload: {
    name: string;
    phone: string;
    area?: string;
    building_org?: string;
    address?: string;
    contact_role?: string;
    interested_services?: string[];
    lead_source?: string;
    referral_contact_type?: ReferralContactType;
    stage?: LeadStage;
    next_followup_date?: string;
    initial_note?: string;
    initial_channel?: LeadChannel;
    agent_name?: string;
    agent_phone?: string;
    agent_note?: string;
    caretaker_name?: string;
    caretaker_phone?: string;
    caretaker_note?: string;
  }) => Promise<void>;
  onUpdateLead: (
    leadId: string,
    payload: {
      name: string;
      phone: string;
      area?: string;
      building_org?: string;
      address?: string;
      contact_role?: string;
      interested_services?: string[];
      lead_source?: string;
      referral_contact_type?: ReferralContactType;
      stage?: LeadStage;
      next_followup_date?: string;
      agent_name?: string;
      agent_phone?: string;
      agent_note?: string;
      caretaker_name?: string;
      caretaker_phone?: string;
      caretaker_note?: string;
    }
  ) => Promise<void>;
  onAddLeadNote: (
    leadId: string,
    payload: {
      channel?: LeadChannel;
      note_text: string;
      stage?: LeadStage;
      next_followup_date?: string;
    }
  ) => Promise<void>;
  onRescheduleFollowup: (
    leadId: string,
    payload: { next_followup_date: string; note?: string }
  ) => Promise<void>;
  onToggleFollowupDone: (
    leadId: string,
    payload: { is_done?: boolean; next_followup_date?: string; note_text?: string }
  ) => Promise<void>;
  onCreateQuotationFromLead: (prefill: QuotationLeadPrefill) => void;
  onCreateOrderFromLead: (prefill: OrderLeadPrefill) => void;
  onOpenOrder: (orderId: string) => void;
}

const STAGE_STYLES: Record<LeadStage, string> = {
  New: 'border-blue-200 bg-blue-50 text-blue-800',
  Contacted: 'border-amber-200 bg-amber-50 text-amber-800',
  'Quotation Sent': 'border-purple-200 bg-purple-50 text-purple-800',
  Confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'Not Interested': 'border-slate-200 bg-slate-100 text-slate-600',
};

export function LeadsView({
  leads,
  leadNotes,
  todayDhaka,
  onCreateLead,
  onUpdateLead,
  onAddLeadNote,
  onRescheduleFollowup,
  onToggleFollowupDone,
  onCreateQuotationFromLead,
  onCreateOrderFromLead,
  onOpenOrder,
}: LeadsViewProps) {
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<LeadStage | ''>('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [followupTab, setFollowupTab] = useState<'all' | 'due_today' | 'overdue'>('all');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // Create / Edit Lead Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadRecord | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [area, setArea] = useState('');
  const [buildingOrg, setBuildingOrg] = useState('');
  const [address, setAddress] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [services, setServices] = useState<string[]>([DEFAULT_SERVICES[0]]);
  const [leadSource, setLeadSource] = useState('Facebook');
  const [referralType, setReferralType] = useState<ReferralContactType>('');
  const [stage, setStage] = useState<LeadStage>('New');
  const [nextFollowupDate, setNextFollowupDate] = useState(todayDhaka || getTodayDhakaIso());
  const [initialNote, setInitialNote] = useState('');
  const [initialChannel, setInitialChannel] = useState<LeadChannel>('Call');
  const [agentName, setAgentName] = useState('');
  const [agentPhone, setAgentPhone] = useState('');
  const [agentNote, setAgentNote] = useState('');
  const [caretakerName, setCaretakerName] = useState('');
  const [caretakerPhone, setCaretakerPhone] = useState('');
  const [caretakerNote, setCaretakerNote] = useState('');
  const [dupInfo, setDupInfo] = useState<{
    leads: Array<{ lead_id: string; name: string; phone_display: string; stage: LeadStage }>;
    orders: Array<{ order_id: string; customer_name: string; scheduled_date: string }>;
  } | null>(null);
  const [savingForm, setSavingForm] = useState(false);
  const [formError, setFormError] = useState('');

  // Add Note Modal
  const [noteLead, setNoteLead] = useState<LeadRecord | null>(null);
  const [noteChannel, setNoteChannel] = useState<LeadChannel>('Call');
  const [noteText, setNoteText] = useState('');
  const [noteStage, setNoteStage] = useState<LeadStage>('Contacted');
  const [noteNextDate, setNoteNextDate] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Reschedule Modal
  const [reschedLead, setReschedLead] = useState<LeadRecord | null>(null);
  const [reschedDate, setReschedDate] = useState('');
  const [reschedNote, setReschedNote] = useState('');
  const [savingResched, setSavingResched] = useState(false);

  const selectedLead = useMemo(
    () => leads.find((l) => l.lead_id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  const selectedLeadNotes = useMemo(
    () =>
      selectedLead
        ? leadNotes.filter((n) => n.lead_id === selectedLead.lead_id)
        : [],
    [leadNotes, selectedLead]
  );

  const filteredLeads = useMemo(() => {
    const q = normalizeSearchText(search);
    const digitsOnly = q.replace(/\D/g, '');
    return leads.filter((l) => {
      if (stageFilter && l.stage !== stageFilter) return false;
      if (sourceFilter && (l.lead_source || 'Not Specified') !== sourceFilter) return false;
      if (followupTab === 'due_today') {
        if (
          l.followup_done ||
          l.stage === 'Confirmed' ||
          l.stage === 'Not Interested' ||
          l.next_followup_date !== todayDhaka
        ) {
          return false;
        }
      }
      if (followupTab === 'overdue') {
        if (
          l.followup_done ||
          l.stage === 'Confirmed' ||
          l.stage === 'Not Interested' ||
          !l.next_followup_date ||
          l.next_followup_date >= todayDhaka
        ) {
          return false;
        }
      }
      if (!q) return true;
      const hay = normalizeSearchText(
        [
          l.lead_id,
          l.name,
          l.phone_display,
          l.phone_e164,
          l.area,
          l.building_org,
          l.address,
          l.lead_source,
          l.agent_name,
          l.agent_phone_display,
          l.agent_note,
          l.caretaker_name,
          l.caretaker_phone_display,
          l.caretaker_note,
        ].join(' ')
      );
      if (hay.includes(q)) return true;
      if (digitsOnly) {
        const allPhones = [
          l.phone_display,
          l.phone_e164,
          l.agent_phone_display,
          l.agent_phone_e164,
          l.caretaker_phone_display,
          l.caretaker_phone_e164,
        ]
          .join('')
          .replace(/\D/g, '');
        if (allPhones.includes(digitsOnly)) return true;
      }
      return false;
    });
  }, [leads, search, stageFilter, sourceFilter, followupTab, todayDhaka]);

  const openNewForm = () => {
    setEditingLead(null);
    setName('');
    setPhone('');
    setArea('');
    setBuildingOrg('');
    setAddress('');
    setContactRole('');
    setServices([DEFAULT_SERVICES[0]]);
    setLeadSource('Facebook');
    setReferralType('');
    setStage('New');
    setNextFollowupDate(todayDhaka || getTodayDhakaIso());
    setInitialNote('');
    setInitialChannel('Call');
    setAgentName('');
    setAgentPhone('');
    setAgentNote('');
    setCaretakerName('');
    setCaretakerPhone('');
    setCaretakerNote('');
    setDupInfo(null);
    setFormError('');
    setFormOpen(true);
  };

  const openEditForm = (l: LeadRecord) => {
    setEditingLead(l);
    setName(l.name);
    setPhone(l.phone_display);
    setArea(l.area || '');
    setBuildingOrg(l.building_org || '');
    setAddress(l.address || '');
    setContactRole(l.contact_role || '');
    setServices(
      l.interested_services && l.interested_services.length > 0
        ? l.interested_services.map(translateServiceToEnglish)
        : [DEFAULT_SERVICES[0]]
    );
    setLeadSource(l.lead_source || 'Not Specified');
    setReferralType(l.referral_contact_type || '');
    setStage(l.stage);
    setNextFollowupDate(l.next_followup_date || '');
    setInitialNote('');
    setAgentName(l.agent_name || '');
    setAgentPhone(l.agent_phone_display || '');
    setAgentNote(l.agent_note || '');
    setCaretakerName(l.caretaker_name || '');
    setCaretakerPhone(l.caretaker_phone_display || '');
    setCaretakerNote(l.caretaker_note || '');
    setDupInfo(null);
    setFormError('');
    setFormOpen(true);
  };

  const checkDuplicatePhone = async (val: string) => {
    const cleaned = val.replace(/\D/g, '');
    if (cleaned.length < 10) {
      setDupInfo(null);
      return;
    }
    try {
      const res = await api.checkDuplicatePhone(val, editingLead?.lead_id || '');
      if (res.matchingLeads.length > 0 || res.matchingOrders.length > 0) {
        setDupInfo({
          leads: res.matchingLeads,
          orders: res.matchingOrders,
        });
      } else {
        setDupInfo(null);
      }
    } catch {
      setDupInfo(null);
    }
  };

  const toggleService = (svc: string) => {
    setServices((prev) =>
      prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc]
    );
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setFormError('Prospect name and mobile number are required.');
      return;
    }
    setSavingForm(true);
    setFormError('');
    try {
      const resolvedReferral: ReferralContactType =
        leadSource === 'Agent Referral'
          ? 'agent'
          : leadSource === 'Caretaker Referral'
          ? 'caretaker'
          : referralType;

      const commonPayload = {
        name: name.trim(),
        phone: phone.trim(),
        area: area.trim(),
        building_org: buildingOrg.trim(),
        address: address.trim(),
        contact_role: contactRole.trim(),
        interested_services: services,
        lead_source: leadSource,
        referral_contact_type: resolvedReferral,
        stage,
        next_followup_date: nextFollowupDate,
        agent_name: agentName.trim(),
        agent_phone: agentPhone.trim(),
        agent_note: agentNote.trim(),
        caretaker_name: caretakerName.trim(),
        caretaker_phone: caretakerPhone.trim(),
        caretaker_note: caretakerNote.trim(),
      };
      if (editingLead) {
        await onUpdateLead(editingLead.lead_id, commonPayload);
      } else {
        await onCreateLead({
          ...commonPayload,
          initial_note: initialNote.trim(),
          initial_channel: initialChannel,
        });
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save prospect.');
    } finally {
      setSavingForm(false);
    }
  };

  const openNoteModal = (l: LeadRecord) => {
    setNoteLead(l);
    setNoteChannel('Call');
    setNoteText('');
    setNoteStage(l.stage === 'New' ? 'Contacted' : l.stage);
    setNoteNextDate(l.next_followup_date || todayDhaka);
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteLead || !noteText.trim()) return;
    setSavingNote(true);
    try {
      await onAddLeadNote(noteLead.lead_id, {
        channel: noteChannel,
        note_text: noteText.trim(),
        stage: noteStage,
        next_followup_date: noteNextDate,
      });
      setNoteLead(null);
    } finally {
      setSavingNote(false);
    }
  };

  const openReschedModal = (l: LeadRecord) => {
    setReschedLead(l);
    setReschedDate(l.next_followup_date || todayDhaka);
    setReschedNote('');
  };

  const handleSaveResched = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reschedLead || !reschedDate) return;
    setSavingResched(true);
    try {
      await onRescheduleFollowup(reschedLead.lead_id, {
        next_followup_date: reschedDate,
        note: reschedNote.trim() || undefined,
      });
      setReschedLead(null);
    } finally {
      setSavingResched(false);
    }
  };

  const triggerQuotation = (l: LeadRecord) => {
    onCreateQuotationFromLead({
      lead_id: l.lead_id,
      customer_name: l.name,
      phone: l.phone_display,
      address: [l.building_org, l.address].filter(Boolean).join(', '),
      area: l.area || '',
      interested_services: translateServiceToEnglish(l.interested_services_text || ''),
      lead_source: l.lead_source || 'Not Specified',
    });
  };

  const triggerOrder = (l: LeadRecord) => {
    const refType: ReferralContactType =
      l.lead_source === 'Agent Referral'
        ? 'agent'
        : l.lead_source === 'Caretaker Referral'
        ? 'caretaker'
        : l.referral_contact_type || '';
    const refName =
      refType === 'agent'
        ? l.agent_name
        : refType === 'caretaker'
        ? l.caretaker_name
        : '';
    const refPhone =
      refType === 'agent'
        ? l.agent_phone_display
        : refType === 'caretaker'
        ? l.caretaker_phone_display
        : '';

    onCreateOrderFromLead({
      lead_id: l.lead_id,
      customer_name: l.name,
      phone: l.phone_display,
      address: [l.building_org, l.address].filter(Boolean).join(', '),
      area: l.area || '',
      services:
        l.interested_services.length > 0
          ? l.interested_services.map(translateServiceToEnglish)
          : [DEFAULT_SERVICES[0]],
      lead_source: l.lead_source || 'Not Specified',
      referral_contact_type: refType,
      referral_contact_name: refName,
      referral_contact_phone: refPhone,
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1F3A]">Prospects</h1>
          <p className="text-sm text-slate-500">
            Track inquiries, agent & caretaker contacts, follow-ups, and conversions (Admin only).
          </p>
        </div>
        <button
          type="button"
          onClick={openNewForm}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0F766E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0c6059]"
        >
          <UserPlus className="h-4 w-4" />
          New Prospect
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'due_today', 'overdue'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFollowupTab(tab)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                followupTab === tab
                  ? 'bg-[#0B1F3A] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tab === 'all' ? 'All Prospects' : tab === 'due_today' ? 'Due Today' : 'Overdue'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prospect, agent, caretaker, phone, area..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as LeadStage | '')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All Stages</option>
            {LEAD_STAGES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All Lead Sources</option>
            {LEAD_SOURCES.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Prospect Cards */}
      {filteredLeads.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No prospects match your current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredLeads.map((l) => {
            const notesCount = leadNotes.filter((n) => n.lead_id === l.lead_id).length;
            const hasAgent = Boolean(l.agent_name || l.agent_phone_display || l.agent_note);
            const hasCaretaker = Boolean(
              l.caretaker_name || l.caretaker_phone_display || l.caretaker_note
            );
            return (
              <div
                key={l.lead_id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs transition-colors hover:border-slate-300"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-500">{l.lead_id}</span>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          STAGE_STYLES[l.stage] || 'border-slate-200 bg-slate-100 text-slate-700'
                        }`}
                      >
                        {l.stage}
                      </span>
                      {l.lead_source && (
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {l.lead_source}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedLeadId(l.lead_id)}
                      className="mt-1 text-left text-base font-bold text-[#0B1F3A] hover:text-[#0F766E]"
                    >
                      {l.name}
                    </button>
                    <div className="text-xs text-slate-600">
                      <span className="font-mono font-semibold">{l.phone_display}</span>
                      {l.area ? ` · ${l.area}` : ''}
                      {l.building_org ? ` · ${l.building_org}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditForm(l)}
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                      title="Edit Prospect"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedLeadId(l.lead_id)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Details ({notesCount})
                    </button>
                  </div>
                </div>

                {/* Main Prospect Call/WhatsApp */}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <a
                    href={buildTelLink(l.phone_e164, l.phone_display)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Call Prospect ({l.phone_display})
                  </a>
                  <a
                    href={buildLeadWhatsAppLink(l)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    WhatsApp Prospect
                  </a>
                </div>

                {/* Agent & Caretaker Separate Contacts */}
                {(hasAgent || hasCaretaker) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {hasAgent && (
                      <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-2.5 text-xs">
                        <div className="font-bold text-blue-900">
                          Agent: {l.agent_name || 'Unnamed'}
                        </div>
                        {l.agent_phone_display && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <a
                              href={buildTelLink(l.agent_phone_e164, l.agent_phone_display)}
                              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-800 hover:bg-blue-50"
                            >
                              <Phone className="h-3 w-3" />
                              Call Agent: {l.agent_phone_display}
                            </a>
                            <a
                              href={buildContactWhatsAppLink({
                                phone_e164: l.agent_phone_e164,
                                phone_display: l.agent_phone_display,
                                contactName: l.agent_name,
                                roleLabel: 'Agent',
                                prospectName: l.name,
                                buildingOrg: l.building_org,
                              })}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                            >
                              <MessageCircle className="h-3 w-3" />
                              WA Agent
                            </a>
                          </div>
                        )}
                        {l.agent_note && (
                          <div className="mt-1 text-[11px] text-slate-600">{l.agent_note}</div>
                        )}
                      </div>
                    )}

                    {hasCaretaker && (
                      <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-2.5 text-xs">
                        <div className="font-bold text-amber-900">
                          Caretaker: {l.caretaker_name || 'Unnamed'}
                        </div>
                        {l.caretaker_phone_display && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <a
                              href={buildTelLink(
                                l.caretaker_phone_e164,
                                l.caretaker_phone_display
                              )}
                              className="inline-flex items-center gap-1 rounded border border-amber-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900 hover:bg-amber-50"
                            >
                              <Phone className="h-3 w-3" />
                              Call Caretaker: {l.caretaker_phone_display}
                            </a>
                            <a
                              href={buildContactWhatsAppLink({
                                phone_e164: l.caretaker_phone_e164,
                                phone_display: l.caretaker_phone_display,
                                contactName: l.caretaker_name,
                                roleLabel: 'Caretaker',
                                prospectName: l.name,
                                buildingOrg: l.building_org,
                              })}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                            >
                              <MessageCircle className="h-3 w-3" />
                              WA Caretaker
                            </a>
                          </div>
                        )}
                        {l.caretaker_note && (
                          <div className="mt-1 text-[11px] text-slate-600">{l.caretaker_note}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Footer Actions */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
                  <div className="text-slate-500">
                    Follow-Up:{' '}
                    <strong className="text-[#0B1F3A]">
                      {l.next_followup_date ? formatDateEn(l.next_followup_date) : 'Not set'}
                    </strong>
                    {l.followup_done && (
                      <span className="ml-1.5 text-emerald-700 font-semibold">(Done)</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openNoteModal(l)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      Add Note
                    </button>
                    <button
                      type="button"
                      onClick={() => openReschedModal(l)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Reschedule
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerQuotation(l)}
                      className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 font-semibold text-purple-800 hover:bg-purple-100"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Quotation
                    </button>
                    {l.linked_order_id ? (
                      <button
                        type="button"
                        onClick={() => onOpenOrder(l.linked_order_id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-800"
                      >
                        Order {l.linked_order_id}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => triggerOrder(l)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#0F766E] px-2.5 py-1 font-semibold text-white hover:bg-[#0c6059]"
                      >
                        <ShoppingBag className="h-3.5 w-3.5" />
                        Book Order
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Prospect Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-[#0B1F3A]">
                {editingLead ? `Edit Prospect (${editingLead.lead_id})` : 'New Prospect'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmitForm} className="mt-4 space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Prospect Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Main Mobile Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onBlur={(e) => checkDuplicatePhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              {dupInfo && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="h-4 w-4" />
                    Existing records found for this phone number:
                  </div>
                  {dupInfo.leads.map((m) => (
                    <div key={m.lead_id} className="mt-1">
                      Prospect {m.lead_id}: {m.name} ({m.stage})
                    </div>
                  ))}
                  {dupInfo.orders.map((o) => (
                    <div key={o.order_id} className="mt-1">
                      Order {o.order_id}: {o.customer_name} ({formatDateEn(o.scheduled_date)})
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Area</label>
                  <input
                    type="text"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    placeholder="e.g., Uttara, Mirpur"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Building / Organization
                  </label>
                  <input
                    type="text"
                    value={buildingOrg}
                    onChange={(e) => setBuildingOrg(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Contact Role</label>
                  <input
                    type="text"
                    value={contactRole}
                    onChange={(e) => setContactRole(e.target.value)}
                    placeholder="Owner / Manager / Committee"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Interested Services</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {Array.from(
                    new Set([
                      ...DEFAULT_SERVICES,
                      ...services.filter((s) => !DEFAULT_SERVICES.includes(s)),
                    ])
                  ).map((svc) => {
                    const checked = services.includes(svc);
                    const isLegacySaved = !DEFAULT_SERVICES.includes(svc);
                    return (
                      <button
                        key={svc}
                        type="button"
                        onClick={() => toggleService(svc)}
                        title={SERVICE_PACKAGE_INCLUSIONS[svc] || svc}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                          checked
                            ? 'border-[#0F766E] bg-teal-50 text-[#0F766E]'
                            : 'border-slate-300 bg-white text-slate-600'
                        }`}
                      >
                        {svc}
                        {isLegacySaved ? ' (Saved)' : ''}
                      </button>
                    );
                  })}
                </div>
                {services.some((s) => Boolean(SERVICE_PACKAGE_INCLUSIONS[s])) && (
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                    {services
                      .filter((s) => Boolean(SERVICE_PACKAGE_INCLUSIONS[s]))
                      .map((s) => (
                        <div key={s}>
                          <strong>{s}:</strong> {SERVICE_PACKAGE_INCLUSIONS[s]}
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Lead Source</label>
                  <select
                    value={leadSource}
                    onChange={(e) => setLeadSource(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                  >
                    {LEAD_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Stage</label>
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value as LeadStage)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                  >
                    {LEAD_STAGES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Next Follow-Up Date</label>
                  <input
                    type="date"
                    value={nextFollowupDate}
                    onChange={(e) => setNextFollowupDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              {/* Separate Optional Agent Section */}
              <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3.5 space-y-2.5">
                <div className="text-xs font-bold text-blue-900">Agent Contact (Optional)</div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Agent Name"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                  <input
                    type="text"
                    value={agentPhone}
                    onChange={(e) => setAgentPhone(e.target.value)}
                    placeholder="Agent Mobile (e.g., 01XXXXXXXXX)"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <input
                  type="text"
                  value={agentNote}
                  onChange={(e) => setAgentNote(e.target.value)}
                  placeholder="Agent Note (separate from prospect notes)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                />
              </div>

              {/* Separate Optional Caretaker Section */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 space-y-2.5">
                <div className="text-xs font-bold text-amber-900">Caretaker Contact (Optional)</div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <input
                    type="text"
                    value={caretakerName}
                    onChange={(e) => setCaretakerName(e.target.value)}
                    placeholder="Caretaker Name"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                  <input
                    type="text"
                    value={caretakerPhone}
                    onChange={(e) => setCaretakerPhone(e.target.value)}
                    placeholder="Caretaker Mobile (e.g., 01XXXXXXXXX)"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <input
                  type="text"
                  value={caretakerNote}
                  onChange={(e) => setCaretakerNote(e.target.value)}
                  placeholder="Caretaker Note (separate from prospect notes)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                />
              </div>

              {!editingLead && (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700">Initial Channel</label>
                    <select
                      value={initialChannel}
                      onChange={(e) => setInitialChannel(e.target.value as LeadChannel)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                    >
                      {LEAD_CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-700">
                      Initial Conversation Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={initialNote}
                      onChange={(e) => setInitialNote(e.target.value)}
                      placeholder="Summary of initial inquiry..."
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingForm}
                  className="rounded-lg bg-[#0F766E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {savingForm ? 'Saving...' : editingLead ? 'Save Changes' : 'Create Prospect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Drawer Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/50">
          <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-[#0B1F3A]">{selectedLead.name}</h3>
                <p className="text-xs text-slate-500">
                  {selectedLead.lead_id} · {selectedLead.phone_display}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLeadId(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
                    STAGE_STYLES[selectedLead.stage]
                  }`}
                >
                  {selectedLead.stage}
                </span>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                  Source: {selectedLead.lead_source || 'Not Specified'}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onToggleFollowupDone(selectedLead.lead_id, {
                      is_done: !selectedLead.followup_done,
                    })
                  }
                  className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
                    selectedLead.followup_done
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {selectedLead.followup_done ? 'Follow-Up Done' : 'Mark Follow-Up Done'}
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
                {selectedLead.building_org && (
                  <div>
                    <span className="font-semibold">Building/Org:</span> {selectedLead.building_org}
                  </div>
                )}
                {selectedLead.address && (
                  <div>
                    <span className="font-semibold">Address:</span> {selectedLead.address}
                  </div>
                )}
                {selectedLead.area && (
                  <div>
                    <span className="font-semibold">Area:</span> {selectedLead.area}
                  </div>
                )}
                <div>
                  <span className="font-semibold">Interested Services:</span>{' '}
                  {translateServiceToEnglish(selectedLead.interested_services_text || 'Not specified')}
                </div>
                <div>
                  <span className="font-semibold">Next Follow-Up:</span>{' '}
                  {selectedLead.next_followup_date
                    ? formatDateEn(selectedLead.next_followup_date)
                    : 'Not scheduled'}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Conversation History ({selectedLeadNotes.length})
                </h4>
                <button
                  type="button"
                  onClick={() => openNoteModal(selectedLead)}
                  className="text-xs font-semibold text-[#0F766E] hover:underline"
                >
                  + Add Note
                </button>
              </div>

              {selectedLeadNotes.length === 0 ? (
                <p className="text-xs text-slate-500">No conversation notes recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {selectedLeadNotes.map((n) => (
                    <div
                      key={n.note_id}
                      className="rounded-lg border border-slate-200 bg-white p-3 text-xs"
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span className="font-semibold text-[#0B1F3A]">{n.channel}</span>
                        <span>
                          {n.created_by} · {formatDateTimeEn(n.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-700">{n.note_text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Note Modal */}
      {noteLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-[#0B1F3A]">Add Note — {noteLead.name}</h3>
              <button
                type="button"
                onClick={() => setNoteLead(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveNote} className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Channel</label>
                  <select
                    value={noteChannel}
                    onChange={(e) => setNoteChannel(e.target.value as LeadChannel)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                  >
                    {LEAD_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Update Stage</label>
                  <select
                    value={noteStage}
                    onChange={(e) => setNoteStage(e.target.value as LeadStage)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                  >
                    {LEAD_STAGES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Next Follow-Up Date</label>
                <input
                  type="date"
                  value={noteNextDate}
                  onChange={(e) => setNoteNextDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Note *</label>
                <textarea
                  rows={3}
                  required
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Write discussion summary..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNoteLead(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNote}
                  className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {savingNote ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reschedule Follow-Up Modal */}
      {reschedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-[#0B1F3A]">
                Reschedule Follow-Up — {reschedLead.name}
              </h3>
              <button
                type="button"
                onClick={() => setReschedLead(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveResched} className="mt-4 space-y-3 text-sm">
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  New Follow-Up Date *
                </label>
                <input
                  type="date"
                  required
                  value={reschedDate}
                  onChange={(e) => setReschedDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Note (Optional)</label>
                <input
                  type="text"
                  value={reschedNote}
                  onChange={(e) => setReschedNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReschedLead(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingResched}
                  className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {savingResched ? 'Saving...' : 'Save Date'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
