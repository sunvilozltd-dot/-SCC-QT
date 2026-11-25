import React, { useMemo, useState } from 'react';
import {
  Building2,
  CalendarPlus,
  Droplets,
  Edit3,
  ExternalLink,
  MapPin,
  Phone,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  BuildingProfile,
  CustomerProfile,
  LEAD_SOURCES,
  OrderRecord,
  TANK_MATERIALS,
} from '../types/order';
import {
  formatBdt,
  formatDateEn,
  validateSafeExternalUrl,
} from '../utils/dateAndPhone';
import { StatusBadge } from './StatusBadge';

interface CustomersViewProps {
  customers: CustomerProfile[];
  buildings: BuildingProfile[];
  orders: OrderRecord[];
  onCreateCustomer: (payload: {
    name: string;
    phone: string;
    lead_source?: string;
    notes?: string;
  }) => Promise<void>;
  onUpdateCustomer: (
    customerId: string,
    payload: { name: string; phone: string; lead_source?: string; notes?: string }
  ) => Promise<void>;
  onCreateBuilding: (payload: {
    customer_id: string;
    name: string;
    address: string;
    area?: string;
    maps_url?: string;
    access_instructions?: string;
    overhead_tank_qty?: number | string;
    overhead_tank_capacity_litres?: number | string | null;
    overhead_tank_material?: string;
    reserve_tank_qty?: number | string;
    reserve_tank_capacity_litres?: number | string | null;
    reserve_tank_material?: string;
    tank_notes?: string;
  }) => Promise<void>;
  onUpdateBuilding: (
    buildingId: string,
    payload: {
      name: string;
      address: string;
      area?: string;
      maps_url?: string;
      access_instructions?: string;
      overhead_tank_qty?: number | string;
      overhead_tank_capacity_litres?: number | string | null;
      overhead_tank_material?: string;
      reserve_tank_qty?: number | string;
      reserve_tank_capacity_litres?: number | string | null;
      reserve_tank_material?: string;
      tank_notes?: string;
    }
  ) => Promise<void>;
  onDeleteBuilding: (buildingId: string) => Promise<void>;
  onOpenOrder: (orderId: string) => void;
  onBookAgainForBuilding: (customer: CustomerProfile, building: BuildingProfile, lastOrder?: OrderRecord) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  buildings,
  orders,
  onCreateCustomer,
  onUpdateCustomer,
  onCreateBuilding,
  onUpdateBuilding,
  onDeleteBuilding,
  onOpenOrder,
  onBookAgainForBuilding,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    customers[0]?.customer_id || ''
  );

  // Customer modal
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerProfile | null>(null);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custSource, setCustSource] = useState('Not Specified');
  const [custNotes, setCustNotes] = useState('');

  // Building modal
  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState<BuildingProfile | null>(null);
  const [bName, setBName] = useState('');
  const [bAddress, setBAddress] = useState('');
  const [bArea, setBArea] = useState('');
  const [bMapsUrl, setBMapsUrl] = useState('');
  const [bAccess, setBAccess] = useState('');
  const [bOhQty, setBOhQty] = useState('1');
  const [bOhCap, setBOhCap] = useState('');
  const [bOhMat, setBOhMat] = useState('Concrete');
  const [bResQty, setBResQty] = useState('1');
  const [bResCap, setBResCap] = useState('');
  const [bResMat, setBResMat] = useState('Concrete');
  const [bNotes, setBNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const custBuildings = buildings.filter((b) => b.customer_id === c.customer_id);
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone_display.toLowerCase().includes(q) ||
        custBuildings.some(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            b.address.toLowerCase().includes(q) ||
            b.area.toLowerCase().includes(q)
        )
      );
    });
  }, [customers, buildings, search]);

  const activeCustomer = useMemo(() => {
    return (
      customers.find((c) => c.customer_id === selectedCustomerId) ||
      filteredCustomers[0] ||
      null
    );
  }, [customers, filteredCustomers, selectedCustomerId]);

  const customerBuildings = useMemo(() => {
    if (!activeCustomer) return [];
    return buildings.filter((b) => b.customer_id === activeCustomer.customer_id);
  }, [buildings, activeCustomer]);

  const customerOrders = useMemo(() => {
    if (!activeCustomer) return [];
    return orders.filter(
      (o) =>
        o.customer_id === activeCustomer.customer_id ||
        (activeCustomer.phone_e164 && o.phone_e164 === activeCustomer.phone_e164)
    );
  }, [orders, activeCustomer]);

  const openNewCustomer = () => {
    setEditingCustomer(null);
    setCustName('');
    setCustPhone('');
    setCustSource('Not Specified');
    setCustNotes('');
    setError('');
    setCustomerModalOpen(true);
  };

  const openEditCustomer = (c: CustomerProfile) => {
    setEditingCustomer(c);
    setCustName(c.name);
    setCustPhone(c.phone_display);
    setCustSource(c.lead_source || 'Not Specified');
    setCustNotes(c.notes || '');
    setError('');
    setCustomerModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingCustomer) {
        await onUpdateCustomer(editingCustomer.customer_id, {
          name: custName,
          phone: custPhone,
          lead_source: custSource,
          notes: custNotes,
        });
      } else {
        await onCreateCustomer({
          name: custName,
          phone: custPhone,
          lead_source: custSource,
          notes: custNotes,
        });
      }
      setCustomerModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customer.');
    } finally {
      setSaving(false);
    }
  };

  const openNewBuilding = () => {
    if (!activeCustomer) return;
    setEditingBuilding(null);
    setBName('');
    setBAddress('');
    setBArea('');
    setBMapsUrl('');
    setBAccess('');
    setBOhQty('1');
    setBOhCap('');
    setBOhMat('Concrete');
    setBResQty('1');
    setBResCap('');
    setBResMat('Concrete');
    setBNotes('');
    setError('');
    setBuildingModalOpen(true);
  };

  const openEditBuilding = (b: BuildingProfile) => {
    setEditingBuilding(b);
    setBName(b.name);
    setBAddress(b.address);
    setBArea(b.area);
    setBMapsUrl(b.maps_url);
    setBAccess(b.access_instructions);
    setBOhQty(String(b.overhead_tank_qty ?? 0));
    setBOhCap(b.overhead_tank_capacity_litres != null ? String(b.overhead_tank_capacity_litres) : '');
    setBOhMat(b.overhead_tank_material || 'Concrete');
    setBResQty(String(b.reserve_tank_qty ?? 0));
    setBResCap(b.reserve_tank_capacity_litres != null ? String(b.reserve_tank_capacity_litres) : '');
    setBResMat(b.reserve_tank_material || 'Concrete');
    setBNotes(b.tank_notes || '');
    setError('');
    setBuildingModalOpen(true);
  };

  const handleSaveBuilding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCustomer) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: bName,
        address: bAddress,
        area: bArea,
        maps_url: bMapsUrl,
        access_instructions: bAccess,
        overhead_tank_qty: bOhQty,
        overhead_tank_capacity_litres: bOhCap.trim() === '' ? null : bOhCap,
        overhead_tank_material: bOhMat,
        reserve_tank_qty: bResQty,
        reserve_tank_capacity_litres: bResCap.trim() === '' ? null : bResCap,
        reserve_tank_material: bResMat,
        tank_notes: bNotes,
      };
      if (editingBuilding) {
        await onUpdateBuilding(editingBuilding.building_id, payload);
      } else {
        await onCreateBuilding({ ...payload, customer_id: activeCustomer.customer_id });
      }
      setBuildingModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save building profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0b1f3a]">Customers & Building Profiles</h1>
          <p className="text-sm text-slate-500">
            Save multiple buildings, service addresses, access notes, and tank details under each customer.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewCustomer}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-teal-700"
        >
          <UserPlus className="h-4 w-4" />
          New Customer
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left: Customer Directory */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 p-3.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer, phone, building, area..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-teal-600 focus:bg-white focus:outline-none"
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Showing {filteredCustomers.length} of {customers.length} customers
            </p>
          </div>

          <div className="max-h-[600px] divide-y divide-slate-100 overflow-y-auto">
            {filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                No customers found.
              </div>
            ) : (
              filteredCustomers.map((c) => {
                const bCount = buildings.filter((b) => b.customer_id === c.customer_id).length;
                const isSelected = activeCustomer?.customer_id === c.customer_id;
                return (
                  <button
                    key={c.customer_id}
                    type="button"
                    onClick={() => setSelectedCustomerId(c.customer_id)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? 'bg-teal-50/80 border-l-4 border-teal-600'
                        : 'hover:bg-slate-50 border-l-4 border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-[#0b1f3a]">{c.name}</span>
                      <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {bCount} {bCount === 1 ? 'building' : 'buildings'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono">{c.phone_display}</span>
                      <span>{c.lead_source || 'Not Specified'}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Customer Detail & Building/Tank Profiles */}
        <div className="lg:col-span-8 space-y-5">
          {!activeCustomer ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              Select a customer from the list or add a new customer to manage buildings and tank details.
            </div>
          ) : (
            <>
              {/* Customer Header Card */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-[#0b1f3a]">{activeCustomer.name}</h2>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                        {activeCustomer.customer_id}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                      <a
                        href={`tel:${activeCustomer.phone_e164 || activeCustomer.phone_display}`}
                        className="inline-flex items-center gap-1.5 font-mono text-teal-700 hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {activeCustomer.phone_display}
                      </a>
                      <span className="text-slate-400">|</span>
                      <span>Source: {activeCustomer.lead_source || 'Not Specified'}</span>
                      <span className="text-slate-400">|</span>
                      <span>Total Orders: {customerOrders.length}</span>
                    </div>
                    {activeCustomer.notes && (
                      <p className="mt-2 text-xs text-slate-600">{activeCustomer.notes}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditCustomer(activeCustomer)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit Customer
                    </button>
                    <button
                      type="button"
                      onClick={openNewBuilding}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0b1f3a] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#163056]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Building / Site
                    </button>
                  </div>
                </div>
              </div>

              {/* Building & Water Tank Profiles */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
                    <Building2 className="h-4 w-4 text-teal-600" />
                    Building & Water Tank Details ({customerBuildings.length})
                  </h3>
                </div>

                {customerBuildings.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                    <Building2 className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                    <p className="text-sm font-medium text-slate-600">
                      No buildings saved under this customer yet.
                    </p>
                    <button
                      type="button"
                      onClick={openNewBuilding}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add First Building
                    </button>
                  </div>
                ) : (
                  customerBuildings.map((b) => {
                    const safeMapsUrl = validateSafeExternalUrl(b.maps_url);
                    const bOrders = orders
                      .filter(
                        (o) =>
                          o.building_id === b.building_id ||
                          (!o.building_id &&
                            o.customer_id === activeCustomer.customer_id &&
                            o.address.trim().toLowerCase() === b.address.trim().toLowerCase())
                      )
                      .sort((x, y) => y.scheduled_date.localeCompare(x.scheduled_date));
                    const latestOrder = bOrders[0];

                    return (
                      <div
                        key={b.building_id}
                        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-base font-bold text-[#0b1f3a]">{b.name}</h4>
                              {b.area && (
                                <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                                  {b.area}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
                              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                              <span>{b.address}</span>
                            </p>
                            {safeMapsUrl && (
                              <a
                                href={safeMapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"
                              >
                                Open Google Maps Location
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onBookAgainForBuilding(activeCustomer, b, latestOrder)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
                            >
                              <CalendarPlus className="h-3.5 w-3.5" />
                              Book Again
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditBuilding(b)}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                              title="Edit Building"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteBuilding(b.building_id)}
                              className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50"
                              title="Delete Building"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {/* Tank Specifications Grid */}
                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                              <Droplets className="h-3.5 w-3.5 text-teal-600" />
                              Overhead Tanks
                            </div>
                            <p className="mt-1 text-sm font-semibold text-[#0b1f3a]">
                              Qty: {b.overhead_tank_qty}
                              {b.overhead_tank_capacity_litres
                                ? ` · ${b.overhead_tank_capacity_litres.toLocaleString()} L`
                                : ''}
                              {b.overhead_tank_material ? ` · ${b.overhead_tank_material}` : ''}
                            </p>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                              <Droplets className="h-3.5 w-3.5 text-blue-600" />
                              Reserve / Underground Tanks
                            </div>
                            <p className="mt-1 text-sm font-semibold text-[#0b1f3a]">
                              Qty: {b.reserve_tank_qty}
                              {b.reserve_tank_capacity_litres
                                ? ` · ${b.reserve_tank_capacity_litres.toLocaleString()} L`
                                : ''}
                              {b.reserve_tank_material ? ` · ${b.reserve_tank_material}` : ''}
                            </p>
                          </div>
                        </div>

                        {(b.access_instructions || b.tank_notes) && (
                          <div className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/50 px-3.5 py-2.5 text-xs text-slate-700 space-y-1">
                            {b.access_instructions && (
                              <p>
                                <span className="font-semibold text-[#0b1f3a]">Access Instructions:</span>{' '}
                                {b.access_instructions}
                              </p>
                            )}
                            {b.tank_notes && (
                              <p>
                                <span className="font-semibold text-[#0b1f3a]">Tank Notes:</span>{' '}
                                {b.tank_notes}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Previous Jobs for This Building */}
                        <div className="mt-4 border-t border-slate-100 pt-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                              Previous Jobs at This Building ({bOrders.length})
                            </span>
                          </div>
                          {bOrders.length === 0 ? (
                            <p className="text-xs text-slate-400">No jobs recorded for this building yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {bOrders.slice(0, 6).map((o) => (
                                <div
                                  key={o.order_id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => onOpenOrder(o.order_id)}
                                      className="font-mono font-bold text-teal-700 hover:underline"
                                    >
                                      {o.order_id}
                                    </button>
                                    <StatusBadge status={o.status} />
                                    <span className="text-slate-600">
                                      Work Date: {formatDateEn(o.completion_date || o.scheduled_date)}
                                    </span>
                                    <span className="text-slate-500 truncate max-w-[200px]">
                                      {o.services_text}
                                    </span>
                                  </div>
                                  <span className="font-semibold tabular-nums text-[#0b1f3a]">
                                    {o.is_no_charge_visit ? 'No-Charge' : formatBdt(o.price_bdt)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Customer Create/Edit Modal */}
      {customerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-bold text-[#0b1f3a]">
                {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
              </h3>
              <button
                type="button"
                onClick={() => setCustomerModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveCustomer} className="space-y-4 p-5">
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Customer Name *
                </label>
                <input
                  type="text"
                  required
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Mobile Number *
                </label>
                <input
                  type="tel"
                  required
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="017XXXXXXXX"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Lead Source
                </label>
                <select
                  value={custSource}
                  onChange={(e) => setCustSource(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                >
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={custNotes}
                  onChange={(e) => setCustNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCustomerModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Building Create/Edit Modal */}
      {buildingModalOpen && activeCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-[#0b1f3a]">
                  {editingBuilding ? 'Edit Building & Tank Profile' : 'Add Building & Tank Profile'}
                </h3>
                <p className="text-xs text-slate-500">Customer: {activeCustomer.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setBuildingModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBuilding} className="space-y-4 p-5">
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Building / Site Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={bName}
                    onChange={(e) => setBName(e.target.value)}
                    placeholder="e.g., Green View Tower"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Area
                  </label>
                  <input
                    type="text"
                    value={bArea}
                    onChange={(e) => setBArea(e.target.value)}
                    placeholder="e.g., Uttara, Mirpur, Dhanmondi"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Full Service Address *
                </label>
                <input
                  type="text"
                  required
                  value={bAddress}
                  onChange={(e) => setBAddress(e.target.value)}
                  placeholder="House, Road, Block/Sector, Dhaka"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Google Maps Link (Optional)
                  </label>
                  <input
                    type="url"
                    value={bMapsUrl}
                    onChange={(e) => setBMapsUrl(e.target.value)}
                    placeholder="https://maps.google.com/..."
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Access Instructions
                  </label>
                  <input
                    type="text"
                    value={bAccess}
                    onChange={(e) => setBAccess(e.target.value)}
                    placeholder="Rooftop key with caretaker, lift access, etc."
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* Overhead Tank Section */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wide text-[#0b1f3a]">
                  Overhead Tank Details
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Quantity</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={bOhQty}
                      onChange={(e) => setBOhQty(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Capacity (Litres, optional)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={bOhCap}
                      onChange={(e) => setBOhCap(e.target.value)}
                      placeholder="e.g., 5000"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Material</label>
                    <select
                      value={bOhMat}
                      onChange={(e) => setBOhMat(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    >
                      {TANK_MATERIALS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Reserve Tank Section */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wide text-[#0b1f3a]">
                  Reserve / Underground Tank Details
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Quantity</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={bResQty}
                      onChange={(e) => setBResQty(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Capacity (Litres, optional)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={bResCap}
                      onChange={(e) => setBResCap(e.target.value)}
                      placeholder="e.g., 15000"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Material</label>
                    <select
                      value={bResMat}
                      onChange={(e) => setBResMat(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    >
                      {TANK_MATERIALS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Additional Tank / Site Notes
                </label>
                <textarea
                  rows={2}
                  value={bNotes}
                  onChange={(e) => setBNotes(e.target.value)}
                  placeholder="Dimensions, water pump shutoff location, ladder requirements..."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBuildingModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-teal-600 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Building Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
