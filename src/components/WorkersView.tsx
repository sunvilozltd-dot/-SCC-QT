import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  HardHat,
  Phone,
  Plus,
  Search,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { OrderRecord, WorkerRecord } from '../types/order';
import { formatBdt } from '../utils/dateAndPhone';

interface WorkersViewProps {
  workers: WorkerRecord[];
  orders: OrderRecord[];
  onCreateWorker: (payload: {
    name: string;
    phone?: string;
    is_active?: boolean;
    notes?: string;
  }) => Promise<void>;
  onUpdateWorker: (
    workerId: string,
    payload: { name?: string; phone?: string; is_active?: boolean; notes?: string }
  ) => Promise<void>;
}

export const WorkersView: React.FC<WorkersViewProps> = ({
  workers,
  orders,
  onCreateWorker,
  onUpdateWorker,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkerRecord | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const workerStats = useMemo(() => {
    const map = new Map<
      string,
      { completedJobs: number; totalEarned: number; totalPaid: number; totalUnpaid: number }
    >();
    for (const o of orders) {
      if (o.status !== 'Completed') continue;
      for (const w of o.assigned_workers || []) {
        if (!w.confirmed_worked) continue;
        const cur = map.get(w.worker_id) || {
          completedJobs: 0,
          totalEarned: 0,
          totalPaid: 0,
          totalUnpaid: 0,
        };
        cur.completedJobs += 1;
        cur.totalEarned += w.agreed_pay_bdt;
        if (w.payment_status === 'Paid') {
          cur.totalPaid += w.agreed_pay_bdt;
        } else {
          cur.totalUnpaid += w.agreed_pay_bdt;
        }
        map.set(w.worker_id, cur);
      }
    }
    return map;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workers.filter((w) => {
      if (statusFilter === 'active' && !w.is_active) return false;
      if (statusFilter === 'inactive' && w.is_active) return false;
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.phone_display.toLowerCase().includes(q) ||
        w.notes.toLowerCase().includes(q)
      );
    });
  }, [workers, search, statusFilter]);

  const openNew = () => {
    setEditing(null);
    setName('');
    setPhone('');
    setNotes('');
    setIsActive(true);
    setError('');
    setModalOpen(true);
  };

  const openEdit = (w: WorkerRecord) => {
    setEditing(w);
    setName(w.name);
    setPhone(w.phone_display);
    setNotes(w.notes);
    setIsActive(w.is_active);
    setError('');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await onUpdateWorker(editing.worker_id, { name, phone, is_active: isActive, notes });
      } else {
        await onCreateWorker({ name, phone, is_active: isActive, notes });
      }
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save worker.');
    } finally {
      setSaving(false);
    }
  };

  const activeCount = workers.filter((w) => w.is_active).length;
  const totalUnpaidAll = Array.from(workerStats.values()).reduce(
    (sum, s) => sum + s.totalUnpaid,
    0
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0b1f3a]">Workers</h1>
          <p className="text-sm text-slate-500">
            Manage cleaning staff for order team assignments, participation tracking, and per-job pay.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" />
          Add Worker
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Active Workers
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-[#0b1f3a]">
            {activeCount}{' '}
            <span className="text-sm font-normal text-slate-400">/ {workers.length}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Confirmed Earnings (All Time)
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-teal-700">
            {formatBdt(
              Array.from(workerStats.values()).reduce((sum, s) => sum + s.totalEarned, 0)
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Currently Unpaid Worker Pay
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-amber-700">
            {formatBdt(totalUnpaidAll)}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search worker by name, phone, or notes..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-teal-600 focus:bg-white focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'active', 'inactive'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors ${
                statusFilter === tab
                  ? 'bg-[#0b1f3a] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Worker List */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            <HardHat className="mx-auto mb-2 h-9 w-9 text-slate-300" />
            No workers found. Add your field team members to assign them to orders.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Worker Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Completed Jobs</th>
                  <th className="px-4 py-3 text-right">Earned</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Unpaid</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((w) => {
                  const st = workerStats.get(w.worker_id) || {
                    completedJobs: 0,
                    totalEarned: 0,
                    totalPaid: 0,
                    totalUnpaid: 0,
                  };
                  return (
                    <tr key={w.worker_id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#0b1f3a]">{w.name}</div>
                        {w.notes && <div className="text-xs text-slate-500">{w.notes}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {w.phone_display ? (
                          <a
                            href={`tel:${w.phone_e164 || w.phone_display}`}
                            className="inline-flex items-center gap-1 text-teal-700 hover:underline"
                          >
                            <Phone className="h-3 w-3" />
                            {w.phone_display}
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {w.is_active ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {st.completedJobs}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {formatBdt(st.totalEarned)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-medium">
                        {formatBdt(st.totalPaid)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-amber-700">
                        {formatBdt(st.totalUnpaid)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(w)}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <Edit3 className="inline h-3.5 w-3.5 mr-1" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateWorker(w.worker_id, { is_active: !w.is_active })
                            }
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                              w.is_active
                                ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                                : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                            }`}
                          >
                            {w.is_active ? (
                              <>
                                <UserX className="inline h-3.5 w-3.5 mr-1" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <UserCheck className="inline h-3.5 w-3.5 mr-1" />
                                Activate
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Worker Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-bold text-[#0b1f3a]">
                {editing ? 'Edit Worker' : 'Add New Worker'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4 p-5">
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Worker Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Karim Mia"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Mobile Number (Optional)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="017XXXXXXXX"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Skills, experience, preferred area..."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600"
                />
                Active (available for new job assignments)
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Worker'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
