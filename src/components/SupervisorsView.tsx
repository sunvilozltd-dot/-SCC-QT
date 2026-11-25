import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Phone,
  Plus,
  ShieldAlert,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { OrderRecord, SupervisorAccount } from '../types/order';
import { formatBdt } from '../utils/dateAndPhone';
import { getSettlementDirectionLabel } from '../utils/orderPredicates';

interface SupervisorsViewProps {
  supervisors: SupervisorAccount[];
  orders: OrderRecord[];
  onCreateSupervisor: (payload: {
    name: string;
    username: string;
    phone: string;
    password: string;
  }) => Promise<void>;
  onUpdateSupervisor: (
    id: string,
    payload: { name?: string; phone?: string; is_active?: boolean; password?: string }
  ) => Promise<void>;
  onSelectOrder: (orderId: string) => void;
}

export function SupervisorsView({
  supervisors,
  orders,
  onCreateSupervisor,
  onUpdateSupervisor,
  onSelectOrder,
}: SupervisorsViewProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showCreatePass, setShowCreatePass] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [createError, setCreateError] = useState('');
  const [recentlyCreated, setRecentlyCreated] = useState<{
    name: string;
    username: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState('');

  const [resetTarget, setResetTarget] = useState<SupervisorAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showResetPass, setShowResetPass] = useState(false);
  const [savingReset, setSavingReset] = useState(false);

  const [busyId, setBusyId] = useState('');

  const loginUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const supervisorMetrics = useMemo(() => {
    const map = new Map<
      string,
      {
        assignedActive: number;
        completedCount: number;
        pendingOrders: OrderRecord[];
        netPendingAmount: number;
      }
    >();
    for (const s of supervisors) {
      map.set(s.id, {
        assignedActive: 0,
        completedCount: 0,
        pendingOrders: [],
        netPendingAmount: 0,
      });
    }
    for (const o of orders) {
      if (!o.assigned_supervisor_id) continue;
      const entry = map.get(o.assigned_supervisor_id);
      if (!entry) continue;
      if (o.status === 'Completed') {
        entry.completedCount += 1;
        if (o.settlement_status === 'Pending' && o.settlement_remaining > 0) {
          entry.pendingOrders.push(o);
          entry.netPendingAmount +=
            o.supervisor_settlement >= 0 ? o.settlement_remaining : -o.settlement_remaining;
        }
      } else if (o.status !== 'Cancelled') {
        entry.assignedActive += 1;
      }
    }
    return map;
  }, [supervisors, orders]);

  const copyLoginInstructions = async (supName: string, supUsername: string, key: string) => {
    const text = [
      `SUNVILOZ Clean Care — Supervisor Login`,
      `Name: ${supName}`,
      `Login URL: ${loginUrl}`,
      `Username: ${supUsername}`,
      `(Use the password assigned by Admin; you can change it after signing in.)`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId(''), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (!name.trim() || !username.trim() || password.length < 6) {
      setCreateError('Name, unique username, and a password of at least 6 characters are required.');
      return;
    }
    setSavingCreate(true);
    try {
      const cleanName = name.trim();
      const cleanUsername = username.trim();
      await onCreateSupervisor({
        name: cleanName,
        username: cleanUsername,
        phone: phone.trim(),
        password,
      });
      setRecentlyCreated({ name: cleanName, username: cleanUsername });
      setCreateOpen(false);
      setName('');
      setUsername('');
      setPhone('');
      setPassword('');
      setShowCreatePass(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create supervisor.');
    } finally {
      setSavingCreate(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || newPassword.length < 6) return;
    setSavingReset(true);
    try {
      await onUpdateSupervisor(resetTarget.id, { password: newPassword });
      setResetTarget(null);
      setNewPassword('');
      setShowResetPass(false);
    } finally {
      setSavingReset(false);
    }
  };

  const handleToggleActive = async (s: SupervisorAccount) => {
    setBusyId(s.id);
    try {
      await onUpdateSupervisor(s.id, { is_active: !s.is_active });
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1F3A]">
            Supervisor Login Accounts
          </h1>
          <p className="text-sm text-slate-500">
            Create supervisor login accounts, reset passwords, control access, and track cash
            settlements.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateError('');
            setShowCreatePass(false);
            setCreateOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0F766E] px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-[#0c6059]"
        >
          <Plus className="h-4 w-4" />
          Create Supervisor Login Account
        </button>
      </div>

      {/* How Supervisors Sign In */}
      <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-xs text-teal-950">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#0F766E]" />
            <div>
              <div className="font-bold text-[#0B1F3A]">How Field Supervisors Sign In</div>
              <p className="mt-0.5 leading-relaxed text-slate-700">
                Supervisors open this same app link and sign in with the exact{' '}
                <strong>Username</strong> and <strong>Password</strong> you set below. They only
                see their assigned jobs for today through the next 6 days, can submit job
                completions, and can change their own password anytime.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recently Created Account Banner */}
      {recentlyCreated && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950">
          <div>
            <div className="font-bold text-emerald-900">
              Supervisor Login Created: {recentlyCreated.name}
            </div>
            <div className="mt-0.5">
              Username: <code className="rounded bg-white px-1.5 py-0.5 font-mono font-bold">{recentlyCreated.username}</code>{' '}
              — share the login URL, username, and password with them directly.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                copyLoginInstructions(recentlyCreated.name, recentlyCreated.username, 'recent')
              }
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              {copiedId === 'recent' ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy Login Info
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setRecentlyCreated(null)}
              className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {supervisors.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-3">
          <div className="text-sm font-semibold text-[#0B1F3A]">
            No supervisor login accounts created yet
          </div>
          <p className="mx-auto max-w-md text-xs text-slate-500">
            Create your first supervisor login account so field supervisors can sign in, view their
            assigned 7-day schedule, and submit completed job expenses.
          </p>
          <button
            type="button"
            onClick={() => {
              setCreateError('');
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059]"
          >
            <Plus className="h-4 w-4" />
            Create Supervisor Login Account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {supervisors.map((s) => {
            const metrics = supervisorMetrics.get(s.id) || {
              assignedActive: 0,
              completedCount: 0,
              pendingOrders: [],
              netPendingAmount: 0,
            };
            const dir = getSettlementDirectionLabel(metrics.netPendingAmount);

            return (
              <div
                key={s.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-[#0B1F3A]">{s.name}</h3>
                      {s.is_active ? (
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          <ShieldAlert className="h-3 w-3" />
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span>
                        Username:{' '}
                        <strong className="font-mono text-[#0B1F3A]">{s.username}</strong>
                      </span>
                      {s.phone_display && (
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Phone className="h-3 w-3" />
                          {s.phone_display}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => copyLoginInstructions(s.name, s.username, s.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      title="Copy login URL and username"
                    >
                      {copiedId === s.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedId === s.id ? 'Copied' : 'Copy Login'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResetTarget(s);
                        setNewPassword('');
                        setShowResetPass(false);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Reset Password
                    </button>
                    <button
                      type="button"
                      disabled={busyId === s.id}
                      onClick={() => handleToggleActive(s)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                        s.is_active
                          ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      {s.is_active ? (
                        <>
                          <UserX className="h-3.5 w-3.5" />
                          Deactivate
                        </>
                      ) : (
                        <>
                          <UserCheck className="h-3.5 w-3.5" />
                          Activate
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Summary Counters */}
                <div className="mt-4 grid grid-cols-3 gap-2.5 text-center">
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[11px] text-slate-500">Active Jobs</div>
                    <div className="mt-0.5 text-base font-bold tabular-nums text-[#0B1F3A]">
                      {metrics.assignedActive}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[11px] text-slate-500">Completed</div>
                    <div className="mt-0.5 text-base font-bold tabular-nums text-[#0B1F3A]">
                      {metrics.completedCount}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[11px] text-slate-500">Pending Settlement</div>
                    <div
                      className={`mt-0.5 text-sm font-bold tabular-nums ${
                        dir.tone === 'positive'
                          ? 'text-amber-700'
                          : dir.tone === 'negative'
                          ? 'text-blue-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      BDT {formatBdt(dir.amount)}
                    </div>
                  </div>
                </div>

                {metrics.pendingOrders.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="text-[11px] font-bold uppercase text-slate-400">
                      Pending Settlement Orders ({metrics.pendingOrders.length})
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {metrics.pendingOrders.map((po) => (
                        <button
                          key={po.order_id}
                          type="button"
                          onClick={() => onSelectOrder(po.order_id)}
                          className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        >
                          {po.order_id} · Rem: BDT {formatBdt(po.settlement_remaining)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: New Supervisor Account */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0B1F3A]">
                  Create Supervisor Login Account
                </h3>
                <p className="text-xs text-slate-500">
                  Supervisor will sign in with this exact username and password.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {createError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreate} className="mt-4 space-y-3 text-sm">
              <div>
                <label className="text-xs font-semibold text-slate-700">Full Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Md. Rahim Uddin"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Login Username (Unique, no spaces) *
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g., rahim_sup"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Mobile Number (Optional)
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Login Password (min 6 characters) *
                </label>
                <div className="relative mt-1">
                  <input
                    type={showCreatePass ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter initial password"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-10 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePass((v) => !v)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    aria-label={showCreatePass ? 'Hide password' : 'Show password'}
                  >
                    {showCreatePass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCreate}
                  className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {savingCreate ? 'Creating...' : 'Create Login Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0B1F3A]">Reset Supervisor Password</h3>
                <p className="text-xs text-slate-500">
                  {resetTarget.name} ({resetTarget.username}) — existing sessions will be revoked.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="mt-4 space-y-3 text-sm">
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  New Password (min 6 characters) *
                </label>
                <div className="relative mt-1">
                  <input
                    type={showResetPass ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-10 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPass((v) => !v)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    aria-label={showResetPass ? 'Hide password' : 'Show password'}
                  >
                    {showResetPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingReset}
                  className="rounded-lg bg-[#0B1F3A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132f55] disabled:opacity-50"
                >
                  {savingReset ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
