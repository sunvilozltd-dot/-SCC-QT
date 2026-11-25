import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CalendarClock,
  ExternalLink,
  Lock,
  Plus,
  Repeat,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api } from '../services/apiClient';
import {
  BuildingProfile,
  CustomerProfile,
  DEFAULT_SERVICES,
  LEAD_SOURCES,
  OrderRecord,
  OrderStatus,
  ReferralContactType,
  SERVICE_PACKAGE_INCLUSIONS,
  ScheduleConflictItem,
  SupervisorAccount,
  WorkerRecord,
  isOrderStatusLocked,
} from '../types/order';
import {
  bnToEnDigits,
  computeEndTime24,
  formatBdt,
  formatEnDateShort,
  formatTime12h,
  getTodayDhakaIso,
  normalizeBangladeshPhone,
  normalizeLeadSource,
  normalizeOrderStatus,
  translateServiceToEnglish,
} from '../utils/dateAndPhone';

export interface OrderLeadPrefill {
  lead_id: string;
  customer_name: string;
  phone: string;
  address: string;
  area: string;
  services: string[];
  lead_source?: string;
  referral_contact_type?: ReferralContactType;
  referral_contact_name?: string;
  referral_contact_phone?: string;
  notes?: string;
}

export interface OrderBuildingPrefill {
  customer: CustomerProfile;
  building: BuildingProfile;
  previousOrder?: OrderRecord | null;
}

interface OrderFormModalProps {
  open: boolean;
  mode: 'create' | 'edit' | 'rebook';
  sourceOrder: OrderRecord | null;
  leadPrefill?: OrderLeadPrefill | null;
  buildingPrefill?: OrderBuildingPrefill | null;
  customers: CustomerProfile[];
  buildings: BuildingProfile[];
  supervisors: SupervisorAccount[];
  workers: WorkerRecord[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>, isEdit: boolean) => Promise<void>;
  onCreateSupervisor?: (payload: {
    name: string;
    username: string;
    phone: string;
    password: string;
  }) => Promise<SupervisorAccount>;
  onOpenConflictingOrder?: (orderId: string) => void;
}

export function OrderFormModal({
  open,
  mode,
  sourceOrder,
  leadPrefill = null,
  buildingPrefill = null,
  customers,
  buildings,
  supervisors,
  workers,
  onClose,
  onSubmit,
  onCreateSupervisor,
  onOpenConflictingOrder,
}: OrderFormModalProps) {
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedBuildingId, setSelectedBuildingId] = useState('');
  const [buildingName, setBuildingName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [extraServices, setExtraServices] = useState<string[]>([]);
  const [bookingDate, setBookingDate] = useState(getTodayDhakaIso());
  const [scheduledDate, setScheduledDate] = useState(getTodayDhakaIso());
  const [scheduledTime, setScheduledTime] = useState('10:00');
  const [estimatedDurationMins, setEstimatedDurationMins] = useState('120');
  const [priceBdt, setPriceBdt] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [advanceGiven, setAdvanceGiven] = useState('0');
  const [status, setStatus] = useState<OrderStatus>('New');
  const [instructions, setInstructions] = useState('');
  const [notes, setNotes] = useState('');
  const [leadId, setLeadId] = useState('');
  const [leadSource, setLeadSource] = useState('Not Specified');
  const [referralType, setReferralType] = useState<ReferralContactType>('');
  const [referralName, setReferralName] = useState('');
  const [referralPhone, setReferralPhone] = useState('');

  // Assigned workers & per-job pay ("Pay for This Job")
  const [workerRows, setWorkerRows] = useState<
    Array<{ worker_id: string; agreed_pay_bdt: string }>
  >([]);

  // Schedule conflict detection
  const [conflicts, setConflicts] = useState<ScheduleConflictItem[]>([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [overrideConflict, setOverrideConflict] = useState(false);

  // Submission guard
  const [submissionKey, setSubmissionKey] = useState('');
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Inline "+ New Supervisor" drawer state
  const [showNewSupBox, setShowNewSupBox] = useState(false);
  const [newSupName, setNewSupName] = useState('');
  const [newSupUsername, setNewSupUsername] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupPassword, setNewSupPassword] = useState('');
  const [creatingSup, setCreatingSup] = useState(false);
  const [newSupError, setNewSupError] = useState('');

  const buildTankAccessSummary = (b: BuildingProfile): string => {
    const parts: string[] = [];
    if (b.overhead_tank_qty > 0) {
      parts.push(
        `Overhead Tank: ${b.overhead_tank_qty}x${
          b.overhead_tank_capacity_litres ? ` ${b.overhead_tank_capacity_litres}L` : ''
        } (${b.overhead_tank_material})`
      );
    }
    if (b.reserve_tank_qty > 0) {
      parts.push(
        `Reserve Tank: ${b.reserve_tank_qty}x${
          b.reserve_tank_capacity_litres ? ` ${b.reserve_tank_capacity_litres}L` : ''
        } (${b.reserve_tank_material})`
      );
    }
    if (b.access_instructions) parts.push(`Access: ${b.access_instructions}`);
    if (b.tank_notes) parts.push(`Notes: ${b.tank_notes}`);
    return parts.join(' | ');
  };

  useEffect(() => {
    if (!open) return;
    setLocalError('');
    setSubmitting(false);
    setShowNewSupBox(false);
    setNewSupError('');
    setNewSupName('');
    setNewSupUsername('');
    setNewSupPhone('');
    setNewSupPassword('');
    setConflicts([]);
    setOverrideConflict(false);
    setSubmissionKey(`ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    if (mode === 'edit' && sourceOrder) {
      const normServices = sourceOrder.services.map((s) => translateServiceToEnglish(s));
      setSelectedCustomerId(sourceOrder.customer_id || '');
      setSelectedBuildingId(sourceOrder.building_id || '');
      setBuildingName(sourceOrder.building_name || '');
      setCustomerName(sourceOrder.customer_name);
      setPhone(sourceOrder.phone_display);
      setAddress(sourceOrder.address);
      setArea(sourceOrder.area || '');
      setSelectedServices(normServices);
      setExtraServices(normServices.filter((s) => !DEFAULT_SERVICES.includes(s)));
      setBookingDate(sourceOrder.booking_date || '');
      setScheduledDate(sourceOrder.scheduled_date);
      setScheduledTime(sourceOrder.scheduled_time || '10:00');
      setEstimatedDurationMins(String(sourceOrder.estimated_duration_mins || 120));
      setPriceBdt(String(sourceOrder.price_bdt));
      setSupervisorId(sourceOrder.assigned_supervisor_id || '');
      setAdvanceGiven(String(sourceOrder.advance_given || 0));
      setStatus(normalizeOrderStatus(sourceOrder.status));
      setInstructions(sourceOrder.instructions || '');
      setNotes(sourceOrder.notes || '');
      setLeadId(sourceOrder.lead_id || '');
      setLeadSource(normalizeLeadSource(sourceOrder.lead_source));
      setReferralType(sourceOrder.referral_contact_type || '');
      setReferralName(sourceOrder.referral_contact_name || '');
      setReferralPhone(sourceOrder.referral_contact_phone || '');
      setWorkerRows(
        (sourceOrder.assigned_workers || []).map((w) => ({
          worker_id: w.worker_id,
          agreed_pay_bdt: String(w.agreed_pay_bdt ?? 0),
        }))
      );
    } else if (mode === 'rebook' && (sourceOrder || buildingPrefill)) {
      const prev = sourceOrder || buildingPrefill?.previousOrder || null;
      const cust = buildingPrefill?.customer || null;
      const bld = buildingPrefill?.building || null;
      const copiedServices = prev
        ? prev.services.map((s) => translateServiceToEnglish(s))
        : bld
        ? bld.overhead_tank_qty > 0 && bld.reserve_tank_qty > 0
          ? ['Overhead & Reserve Tank Cleaning']
          : [
              ...(bld.overhead_tank_qty > 0 ? ['Overhead Tank Cleaning'] : []),
              ...(bld.reserve_tank_qty > 0 ? ['Reserve Tank Cleaning'] : []),
            ]
        : [];
      setSelectedCustomerId(cust?.customer_id || prev?.customer_id || '');
      setSelectedBuildingId(bld?.building_id || prev?.building_id || '');
      setBuildingName(bld?.name || prev?.building_name || '');
      setCustomerName(cust?.name || prev?.customer_name || '');
      setPhone(cust?.phone_display || prev?.phone_display || '');
      setAddress(bld?.address || prev?.address || '');
      setArea(bld?.area || prev?.area || '');
      setSelectedServices(copiedServices);
      setExtraServices(copiedServices.filter((s) => !DEFAULT_SERVICES.includes(s)));
      setBookingDate(getTodayDhakaIso());
      setScheduledDate(getTodayDhakaIso());
      setScheduledTime(prev?.scheduled_time || '10:00');
      setEstimatedDurationMins(String(prev?.estimated_duration_mins || 120));
      setPriceBdt(prev ? String(prev.price_bdt) : '');
      setSupervisorId('');
      setAdvanceGiven('0');
      setStatus('Confirmed');
      setInstructions(bld ? buildTankAccessSummary(bld) : prev?.instructions || '');
      setNotes('');
      setLeadId('');
      setLeadSource('Existing Customer');
      setReferralType('');
      setReferralName('');
      setReferralPhone('');
      setWorkerRows([]);
    } else if (buildingPrefill) {
      const { customer, building } = buildingPrefill;
      const autoServices: string[] =
        building.overhead_tank_qty > 0 && building.reserve_tank_qty > 0
          ? ['Overhead & Reserve Tank Cleaning']
          : [
              ...(building.overhead_tank_qty > 0 ? ['Overhead Tank Cleaning'] : []),
              ...(building.reserve_tank_qty > 0 ? ['Reserve Tank Cleaning'] : []),
            ];
      setSelectedCustomerId(customer.customer_id);
      setSelectedBuildingId(building.building_id);
      setBuildingName(building.name);
      setCustomerName(customer.name);
      setPhone(customer.phone_display);
      setAddress(building.address);
      setArea(building.area || '');
      setSelectedServices(autoServices);
      setExtraServices([]);
      setBookingDate(getTodayDhakaIso());
      setScheduledDate(getTodayDhakaIso());
      setScheduledTime('10:00');
      setEstimatedDurationMins('120');
      setPriceBdt('');
      setSupervisorId('');
      setAdvanceGiven('0');
      setStatus('Confirmed');
      setInstructions(buildTankAccessSummary(building));
      setNotes('');
      setLeadId('');
      setLeadSource(normalizeLeadSource(customer.lead_source || 'Existing Customer'));
      setReferralType('');
      setReferralName('');
      setReferralPhone('');
      setWorkerRows([]);
    } else if (leadPrefill) {
      const normServices = leadPrefill.services.map((s) => translateServiceToEnglish(s));
      setSelectedCustomerId('');
      setSelectedBuildingId('');
      setBuildingName('');
      setCustomerName(leadPrefill.customer_name);
      setPhone(leadPrefill.phone);
      setAddress(leadPrefill.address);
      setArea(leadPrefill.area);
      setSelectedServices(normServices);
      setExtraServices(normServices.filter((s) => !DEFAULT_SERVICES.includes(s)));
      setBookingDate(getTodayDhakaIso());
      setScheduledDate(getTodayDhakaIso());
      setScheduledTime('10:00');
      setEstimatedDurationMins('120');
      setPriceBdt('');
      setSupervisorId('');
      setAdvanceGiven('0');
      setStatus('Confirmed');
      setInstructions('');
      setNotes(leadPrefill.notes || '');
      setLeadId(leadPrefill.lead_id);
      setLeadSource(normalizeLeadSource(leadPrefill.lead_source || 'Not Specified'));
      setReferralType(leadPrefill.referral_contact_type || '');
      setReferralName(leadPrefill.referral_contact_name || '');
      setReferralPhone(leadPrefill.referral_contact_phone || '');
      setWorkerRows([]);
    } else {
      setSelectedCustomerId('');
      setSelectedBuildingId('');
      setBuildingName('');
      setCustomerName('');
      setPhone('');
      setAddress('');
      setArea('');
      setSelectedServices([]);
      setExtraServices([]);
      setBookingDate(getTodayDhakaIso());
      setScheduledDate(getTodayDhakaIso());
      setScheduledTime('10:00');
      setEstimatedDurationMins('120');
      setPriceBdt('');
      setSupervisorId('');
      setAdvanceGiven('0');
      setStatus('New');
      setInstructions('');
      setNotes('');
      setLeadId('');
      setLeadSource('Not Specified');
      setReferralType('');
      setReferralName('');
      setReferralPhone('');
      setWorkerRows([]);
    }
  }, [open, mode, sourceOrder, leadPrefill, buildingPrefill]);

  // Live schedule conflict check whenever supervisor + date + time + duration change
  const durationNum = useMemo(() => {
    const n = Number(bnToEnDigits(estimatedDurationMins || '120'));
    return Number.isFinite(n) && n >= 15 ? Math.min(720, Math.round(n)) : 120;
  }, [estimatedDurationMins]);

  const computedEndTime = useMemo(
    () => computeEndTime24(scheduledTime, durationNum),
    [scheduledTime, durationNum]
  );

  useEffect(() => {
    if (!open || !supervisorId || !scheduledDate || !scheduledTime) {
      setConflicts([]);
      setOverrideConflict(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCheckingConflicts(true);
      try {
        const res = await api.checkScheduleConflicts({
          supervisor_id: supervisorId,
          scheduled_date: scheduledDate,
          scheduled_time: scheduledTime,
          estimated_duration_mins: durationNum,
          scheduled_end_time: computedEndTime,
          exclude_order_id: mode === 'edit' && sourceOrder ? sourceOrder.order_id : undefined,
        });
        if (!cancelled) {
          setConflicts(res.conflicts || []);
          if ((res.conflicts || []).length === 0) {
            setOverrideConflict(false);
          }
        }
      } catch {
        if (!cancelled) setConflicts([]);
      } finally {
        if (!cancelled) setCheckingConflicts(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, supervisorId, scheduledDate, scheduledTime, durationNum, computedEndTime, mode, sourceOrder]);

  const customerBuildings = useMemo(
    () =>
      selectedCustomerId
        ? buildings.filter((b) => b.customer_id === selectedCustomerId)
        : [],
    [buildings, selectedCustomerId]
  );

  if (!open) return null;

  const normalizedPhone = phone.trim() ? normalizeBangladeshPhone(phone) : null;
  const allServices = [...DEFAULT_SERVICES, ...extraServices];
  const activeSupervisors = supervisors.filter((s) => s.is_active || s.id === supervisorId);
  const selectableWorkers = workers.filter(
    (w) => w.is_active || workerRows.some((r) => r.worker_id === w.worker_id)
  );

  const totalWorkerPay = workerRows.reduce((sum, r) => {
    const n = Number(bnToEnDigits(r.agreed_pay_bdt || '0'));
    return sum + (Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
  }, 0);

  const handleSelectCustomer = (custId: string) => {
    setSelectedCustomerId(custId);
    setSelectedBuildingId('');
    setBuildingName('');
    const found = customers.find((c) => c.customer_id === custId);
    if (!found) return;
    setCustomerName(found.name);
    setPhone(found.phone_display);
    if (found.lead_source) {
      setLeadSource(normalizeLeadSource(found.lead_source));
    }
    const custBlds = buildings.filter((b) => b.customer_id === custId);
    if (custBlds.length === 1) {
      handleSelectBuilding(custBlds[0].building_id, custBlds[0]);
    }
  };

  const handleSelectBuilding = (bldId: string, directBld?: BuildingProfile) => {
    setSelectedBuildingId(bldId);
    const b = directBld || buildings.find((x) => x.building_id === bldId);
    if (!b) {
      setBuildingName('');
      return;
    }
    setBuildingName(b.name);
    setAddress(b.address);
    if (b.area) setArea(b.area);
    const summary = buildTankAccessSummary(b);
    if (summary) {
      setInstructions(summary);
    }
    if (selectedServices.length === 0) {
      const autoSrv: string[] =
        b.overhead_tank_qty > 0 && b.reserve_tank_qty > 0
          ? ['Overhead & Reserve Tank Cleaning']
          : [
              ...(b.overhead_tank_qty > 0 ? ['Overhead Tank Cleaning'] : []),
              ...(b.reserve_tank_qty > 0 ? ['Reserve Tank Cleaning'] : []),
            ];
      if (autoSrv.length > 0) setSelectedServices(autoSrv);
    }
  };

  const toggleService = (service: string) => {
    setSelectedServices((prev) =>
      prev.includes(service) ? prev.filter((s) => s !== service) : [...prev, service]
    );
  };

  const toggleWorker = (workerId: string) => {
    setWorkerRows((prev) => {
      const exists = prev.find((r) => r.worker_id === workerId);
      if (exists) return prev.filter((r) => r.worker_id !== workerId);
      return [...prev, { worker_id: workerId, agreed_pay_bdt: '0' }];
    });
  };

  const updateWorkerPay = (workerId: string, val: string) => {
    setWorkerRows((prev) =>
      prev.map((r) => (r.worker_id === workerId ? { ...r, agreed_pay_bdt: val } : r))
    );
  };

  const handleInlineCreateSupervisor = async () => {
    if (!onCreateSupervisor || creatingSup) return;
    setNewSupError('');
    if (!newSupName.trim() || !newSupUsername.trim() || newSupPassword.length < 6) {
      setNewSupError('Enter a name, username, and password (at least 6 characters).');
      return;
    }
    setCreatingSup(true);
    try {
      const created = await onCreateSupervisor({
        name: newSupName.trim(),
        username: newSupUsername.trim(),
        phone: newSupPhone.trim(),
        password: newSupPassword,
      });
      if (created && created.id && created.is_active) {
        setSupervisorId(created.id);
      }
      setShowNewSupBox(false);
      setNewSupName('');
      setNewSupUsername('');
      setNewSupPhone('');
      setNewSupPassword('');
    } catch (err) {
      setNewSupError(err instanceof Error ? err.message : 'Failed to create supervisor.');
    } finally {
      setCreatingSup(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setLocalError('');
    if (selectedServices.length === 0) {
      setLocalError('Please select at least one service.');
      return;
    }
    if (conflicts.length > 0 && !overrideConflict) {
      setLocalError(
        'Please resolve the supervisor schedule conflict or check the override confirmation box.'
      );
      return;
    }

    const assignedWorkersPayload = workerRows.map((r) => {
      const pay = Number(bnToEnDigits(r.agreed_pay_bdt || '0'));
      return {
        worker_id: r.worker_id,
        agreed_pay_bdt: Number.isFinite(pay) && pay >= 0 ? Math.round(pay) : 0,
      };
    });

    const prevRefOrder =
      mode === 'rebook' ? sourceOrder || buildingPrefill?.previousOrder || null : null;

    setSubmitting(true);
    try {
      await onSubmit(
        {
          order_id: mode === 'edit' && sourceOrder ? sourceOrder.order_id : undefined,
          previous_order_id: prevRefOrder ? prevRefOrder.order_id : '',
          previous_work_date: prevRefOrder
            ? prevRefOrder.completion_date || prevRefOrder.scheduled_date
            : '',
          lead_id: leadId || undefined,
          customer_id: selectedCustomerId || undefined,
          building_id: selectedBuildingId || undefined,
          building_name: buildingName || undefined,
          customer_name: customerName,
          phone,
          address,
          area,
          services: selectedServices,
          booking_date: bookingDate,
          scheduled_date: scheduledDate,
          scheduled_time: scheduledTime,
          estimated_duration_mins: durationNum,
          scheduled_end_time: computedEndTime,
          price_bdt: priceBdt,
          assigned_supervisor_id: supervisorId,
          assigned_workers: assignedWorkersPayload,
          advance_given: advanceGiven,
          status: mode === 'edit' && sourceOrder ? sourceOrder.status : status,
          instructions,
          notes,
          lead_source: leadSource,
          referral_contact_type:
            leadSource === 'Agent Referral'
              ? 'agent'
              : leadSource === 'Caretaker Referral'
              ? 'caretaker'
              : referralType,
          referral_contact_name:
            leadSource === 'Agent Referral' || leadSource === 'Caretaker Referral'
              ? referralName
              : '',
          referral_contact_phone:
            leadSource === 'Agent Referral' || leadSource === 'Caretaker Referral'
              ? referralPhone
              : '',
          submission_key: submissionKey,
        },
        mode === 'edit'
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save order.');
    } finally {
      setSubmitting(false);
    }
  };

  const showAdvancePreservationNotice =
    mode === 'edit' &&
    sourceOrder &&
    sourceOrder.advance_given > 0 &&
    Boolean(sourceOrder.advance_supervisor_id) &&
    sourceOrder.advance_supervisor_id !== supervisorId;

  const prevRebookOrder =
    mode === 'rebook' ? sourceOrder || buildingPrefill?.previousOrder || null : null;

  const title =
    mode === 'edit' && sourceOrder
      ? `Edit Order (${sourceOrder.order_id})`
      : mode === 'rebook'
      ? 'Book Again — Repeat Order'
      : leadPrefill
      ? `New Order from Prospect (${leadPrefill.lead_id})`
      : 'Create New Order';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-modal-heading"
    >
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id="order-modal-heading" className="text-lg font-bold text-[#0B1F3A]">
            {title}
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

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="space-y-4 overflow-y-auto px-6 py-5">
            {mode === 'edit' && sourceOrder && isOrderStatusLocked(sourceOrder) && (
              <div className="flex items-start gap-2.5 rounded-xl border border-slate-300 bg-slate-100/90 px-4 py-3 text-xs text-slate-700">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                <div>
                  <span className="font-bold text-[#0B1F3A]">Status Locked:</span> This order is
                  Completed and full customer payment is confirmed. Order status cannot be changed,
                  but non-status details can still be updated.
                </div>
              </div>
            )}

            {/* Repeat Booking Banner with Previous vs New Work Dates */}
            {mode === 'rebook' && prevRebookOrder && (
              <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-sm text-[#0B1F3A]">
                <div className="flex items-center gap-2 font-bold text-teal-900">
                  <Repeat className="h-4 w-4 text-teal-700" />
                  Repeat Booking from {prevRebookOrder.order_id}
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Customer, building, and service details have been copied. Please confirm the new
                  price, booking date, and scheduled work date/time below. Previous orders and
                  issued PDFs remain untouched.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-teal-200 bg-white px-3 py-2">
                    <div className="text-[11px] font-semibold text-slate-500">
                      Previous Work Date
                    </div>
                    <div className="mt-0.5 font-mono text-xs font-bold text-[#0B1F3A]">
                      {formatEnDateShort(
                        prevRebookOrder.completion_date || prevRebookOrder.scheduled_date
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-teal-200 bg-white px-3 py-2">
                    <div className="text-[11px] font-semibold text-slate-500">
                      Order Booking Date
                    </div>
                    <div className="mt-0.5 font-mono text-xs font-bold text-[#0B1F3A]">
                      {formatEnDateShort(bookingDate)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-teal-200 bg-white px-3 py-2">
                    <div className="text-[11px] font-semibold text-slate-500">
                      New Scheduled Work Date & Time
                    </div>
                    <div className="mt-0.5 font-mono text-xs font-bold text-teal-800">
                      {formatEnDateShort(scheduledDate)}, {formatTime12h(scheduledTime)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {leadPrefill && mode === 'create' && (
              <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-[#0B1F3A]">
                <span className="font-semibold text-teal-800">Prospect Conversion:</span> Details
                from {leadPrefill.customer_name} ({leadPrefill.lead_id}) are pre-filled. Please
                verify the schedule, services, and agreed bill before saving.
              </div>
            )}

            {localError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {localError}
              </div>
            )}

            {/* Existing Customer & Building Quick Auto-Fill */}
            {customers.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[#0B1F3A]">
                  <Building2 className="h-3.5 w-3.5 text-teal-700" />
                  Existing Customer & Building Profile (Optional Auto-Fill)
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => handleSelectCustomer(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A]"
                  >
                    <option value="">-- Select Saved Customer (or type manually below) --</option>
                    {customers.map((c) => (
                      <option key={c.customer_id} value={c.customer_id}>
                        {c.name} ({c.phone_display})
                      </option>
                    ))}
                  </select>

                  <select
                    value={selectedBuildingId}
                    disabled={!selectedCustomerId || customerBuildings.length === 0}
                    onChange={(e) => handleSelectBuilding(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">
                      {!selectedCustomerId
                        ? '-- Select customer first --'
                        : customerBuildings.length === 0
                        ? 'No saved buildings for this customer'
                        : '-- Select Building / Address --'}
                    </option>
                    {customerBuildings.map((b) => (
                      <option key={b.building_id} value={b.building_id}>
                        {b.name} {b.area ? `(${b.area})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Customer Name & Phone */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                  Customer Name *
                </label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Md. Kamrul Islam"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                  Mobile Number *
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="017XXXXXXXX"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 font-mono text-sm tabular-nums text-[#0B1F3A] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                />
                {phone.trim() ? (
                  normalizedPhone ? (
                    <p className="mt-1 font-mono text-xs font-medium tabular-nums text-emerald-700">
                      Saved as: {normalizedPhone.display} ({normalizedPhone.e164})
                    </p>
                  ) : (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      Enter a valid 11-digit Bangladesh mobile number (01XXXXXXXXX)
                    </p>
                  )
                ) : (
                  <p className="mt-1 text-xs text-slate-500">Leading zero is preserved.</p>
                )}
              </div>
            </div>

            {/* Address, Area & Building Label */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                  Service Address *
                </label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="House, Road, Sector / Block"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">Area</label>
                <input
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. Uttara / Dhanmondi"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-teal-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Services */}
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                Services * (Select one or more)
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {allServices.map((srv) => {
                  const checked = selectedServices.includes(srv);
                  const inclusionNote = SERVICE_PACKAGE_INCLUSIONS[srv];
                  const isLegacySaved = !DEFAULT_SERVICES.includes(srv);
                  return (
                    <label
                      key={srv}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                        checked
                          ? 'border-teal-600 bg-teal-50/70 font-semibold text-[#0B1F3A]'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleService(srv)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded accent-teal-600"
                      />
                      <span className="min-w-0">
                        <span className="block">
                          {srv}
                          {isLegacySaved && (
                            <span className="ml-1.5 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                              Saved
                            </span>
                          )}
                        </span>
                        {inclusionNote && (
                          <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                            {inclusionNote}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Booking Date vs Scheduled Work Date, Time & Estimated Duration */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#0B1F3A]">
                <CalendarClock className="h-3.5 w-3.5 text-teal-700" />
                Booking & Work Schedule (Asia/Dhaka)
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Order Booking Date {mode !== 'edit' ? '*' : ''}
                  </label>
                  <input
                    type="date"
                    required={mode !== 'edit'}
                    value={bookingDate}
                    onChange={(e) => setBookingDate(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs tabular-nums text-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Scheduled Work Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs tabular-nums text-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Start Time *
                  </label>
                  <input
                    type="time"
                    required
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs tabular-nums text-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    Est. Duration (mins)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={720}
                    step={15}
                    value={estimatedDurationMins}
                    onChange={(e) => setEstimatedDurationMins(e.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs tabular-nums text-[#0B1F3A]"
                  />
                  {computedEndTime && (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      Ends ~{formatTime12h(computedEndTime)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Price & Advance */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                  Agreed Full Bill (BDT) *
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={priceBdt}
                  onChange={(e) => setPriceBdt(e.target.value)}
                  placeholder="e.g. 5000"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm tabular-nums text-[#0B1F3A]"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                  Advance Given Before Work (BDT)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={advanceGiven}
                  onChange={(e) => setAdvanceGiven(e.target.value)}
                  placeholder="0"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm tabular-nums text-[#0B1F3A]"
                />
              </div>
            </div>

            {/* Assigned Supervisor + Schedule Conflict Warning */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-semibold text-[#0B1F3A]">
                  Assigned Supervisor
                </label>
                {onCreateSupervisor && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewSupBox((prev) => !prev);
                      setNewSupError('');
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                  >
                    <UserPlus className="h-3.5 w-3.5" />+ New Supervisor
                  </button>
                )}
              </div>

              <select
                value={supervisorId}
                onChange={(e) => setSupervisorId(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A]"
              >
                <option value="">Unassigned</option>
                {activeSupervisors.map((sup) => (
                  <option key={sup.id} value={sup.id}>
                    {sup.name} ({sup.username}){!sup.is_active ? ' — Inactive' : ''}
                  </option>
                ))}
              </select>

              {checkingConflicts && (
                <p className="mt-2 text-xs text-slate-500">Checking supervisor schedule...</p>
              )}

              {/* Booking Schedule Conflict Warning */}
              {conflicts.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
                  <div className="flex items-center gap-2 font-bold text-amber-900">
                    <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                    Booking Schedule Conflict Detected ({conflicts.length})
                  </div>
                  <p className="mt-1 text-amber-900/90">
                    The selected supervisor already has overlapping or nearby scheduled work on{' '}
                    {formatEnDateShort(scheduledDate)}:
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {conflicts.map((c) => (
                      <div
                        key={c.order_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
                      >
                        <div>
                          <span className="font-mono font-bold text-[#0B1F3A]">{c.order_id}</span>
                          <span className="mx-1.5">·</span>
                          <span className="font-semibold text-[#0B1F3A]">{c.customer_name}</span>
                          {c.area ? ` (${c.area})` : ''}
                          <div className="text-[11px] text-slate-600">
                            {formatTime12h(c.scheduled_time)}
                            {c.scheduled_end_time ? ` – ${formatTime12h(c.scheduled_end_time)}` : ''}{' '}
                            · {c.reason}
                          </div>
                        </div>
                        {onOpenConflictingOrder && (
                          <button
                            type="button"
                            onClick={() => onOpenConflictingOrder(c.order_id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B1F3A] hover:bg-slate-50"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open Order
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-amber-200 bg-amber-100/60 px-3 py-2 font-semibold text-amber-950">
                    <input
                      type="checkbox"
                      checked={overrideConflict}
                      onChange={(e) => setOverrideConflict(e.target.checked)}
                      className="h-4 w-4 rounded accent-amber-700"
                    />
                    <span>I understand there is a schedule conflict and want to save anyway</span>
                  </label>
                </div>
              )}

              {showAdvancePreservationNotice && sourceOrder && (
                <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <span>
                    The ৳{formatBdt(sourceOrder.advance_given)} advance on this order is linked to{' '}
                    <strong>{sourceOrder.advance_supervisor_name || 'previous supervisor'}</strong>.
                    Reassigning the job will not transfer that advance automatically.
                  </span>
                </div>
              )}

              {showNewSupBox && onCreateSupervisor && (
                <div className="mt-3 space-y-3 rounded-lg border border-teal-200 bg-teal-50/50 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#0B1F3A]">
                      Create New Supervisor Account (unsaved order details are preserved)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewSupBox(false)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                    >
                      Close
                    </button>
                  </div>

                  {newSupError && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                      {newSupError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <input
                      type="text"
                      value={newSupName}
                      onChange={(e) => setNewSupName(e.target.value)}
                      placeholder="Supervisor Name *"
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A]"
                    />
                    <input
                      type="text"
                      value={newSupUsername}
                      onChange={(e) => setNewSupUsername(e.target.value)}
                      placeholder="Username (e.g. rahim1) *"
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-[#0B1F3A]"
                    />
                    <input
                      type="tel"
                      value={newSupPhone}
                      onChange={(e) => setNewSupPhone(e.target.value)}
                      placeholder="Mobile Number (optional)"
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-[#0B1F3A]"
                    />
                    <input
                      type="password"
                      value={newSupPassword}
                      onChange={(e) => setNewSupPassword(e.target.value)}
                      placeholder="Password (min 6 chars) *"
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A]"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={creatingSup}
                      onClick={handleInlineCreateSupervisor}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-3.5 text-xs font-semibold text-white hover:bg-[#163056] disabled:opacity-60"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      {creatingSup ? 'Creating...' : 'Create & Select Supervisor'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Assigned Workers & Pay for This Job */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-[#0B1F3A]">
                  <Users className="h-4 w-4 text-teal-700" />
                  Assigned Workers & Pay for This Job
                </div>
                {workerRows.length > 0 && (
                  <span className="font-mono text-xs font-bold text-teal-800">
                    Planned Pay: ৳{formatBdt(totalWorkerPay)}
                  </span>
                )}
              </div>

              {selectableWorkers.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No active workers yet. Add field workers under the Workers menu to assign them to
                  jobs.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {selectableWorkers.map((w) => {
                      const isSelected = workerRows.some((r) => r.worker_id === w.worker_id);
                      return (
                        <button
                          key={w.worker_id}
                          type="button"
                          onClick={() => toggleWorker(w.worker_id)}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                            isSelected
                              ? 'border-teal-600 bg-teal-50 text-teal-900'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {isSelected ? '✓ ' : '+ '}
                          {w.name}
                          {!w.is_active ? ' (Inactive)' : ''}
                        </button>
                      );
                    })}
                  </div>

                  {workerRows.length > 0 && (
                    <div className="mt-2.5 space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                      {workerRows.map((row) => {
                        const w = workers.find((x) => x.worker_id === row.worker_id);
                        return (
                          <div
                            key={row.worker_id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 border border-slate-200"
                          >
                            <span className="text-xs font-semibold text-[#0B1F3A]">
                              {w?.name || row.worker_id}
                            </span>
                            <div className="flex items-center gap-2">
                              <label className="text-[11px] font-medium text-slate-500">
                                Pay for This Job (BDT):
                              </label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={row.agreed_pay_bdt}
                                onChange={(e) => updateWorkerPay(row.worker_id, e.target.value)}
                                className="h-8 w-24 rounded-md border border-slate-300 px-2 font-mono text-xs font-semibold tabular-nums text-[#0B1F3A]"
                              />
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-slate-500">
                        Per-job pay applies only to workers confirmed as working at job completion.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Lead Source & Initial Status */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                  Lead Source
                </label>
                <select
                  value={leadSource}
                  onChange={(e) => setLeadSource(e.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A]"
                >
                  {LEAD_SOURCES.map((src) => (
                    <option key={src} value={src}>
                      {src}
                    </option>
                  ))}
                </select>
              </div>

              {mode !== 'edit' && (
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                    Initial Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as OrderStatus)}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A]"
                  >
                    <option value="New">New</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="In Progress">In Progress</option>
                  </select>
                </div>
              )}
            </div>

            {(leadSource === 'Agent Referral' || leadSource === 'Caretaker Referral') && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-teal-200 bg-teal-50/40 p-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    {leadSource === 'Agent Referral' ? 'Agent Name' : 'Caretaker Name'}
                  </label>
                  <input
                    type="text"
                    value={referralName}
                    onChange={(e) => setReferralName(e.target.value)}
                    placeholder="Referral contact name"
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#0B1F3A]">
                    {leadSource === 'Agent Referral' ? 'Agent Phone' : 'Caretaker Phone'}
                  </label>
                  <input
                    type="tel"
                    value={referralPhone}
                    onChange={(e) => setReferralPhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-[#0B1F3A]"
                  />
                </div>
              </div>
            )}

            {/* Instructions & Admin Notes */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                  Work Instructions (Visible to Supervisor)
                </label>
                <textarea
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Roof key, water pump, parking, or tank access instructions..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1F3A]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0B1F3A]">
                  Admin Internal Notes (Private)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Visible to admin only..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0B1F3A]"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (conflicts.length > 0 && !overrideConflict)}
              className="h-10 rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
