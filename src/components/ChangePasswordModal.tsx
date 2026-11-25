import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, X } from 'lucide-react';
import { api, setAuthToken } from '../services/apiClient';
import { AuthUser } from '../types/order';

interface ChangePasswordModalProps {
  open: boolean;
  user: AuthUser;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function ChangePasswordModal({
  open,
  user,
  onClose,
  onSuccess,
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const resetAndClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    setSaving(true);
    try {
      const res = await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setAuthToken(res.token);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onSuccess(res.message || 'Password changed successfully.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-[#0F766E]">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0B1F3A]">Change Password</h3>
              <p className="text-xs text-slate-500">
                {user.name} ({user.username})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-sm">
          <div>
            <label className="text-xs font-semibold text-slate-700">Current Password *</label>
            <div className="relative mt-1">
              <input
                name="modal_current_password_verify"
                type={showCurrent ? 'text' : 'password'}
                required
                autoComplete="off"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your current password"
                className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-10 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">
              New Password (min 6 characters) *
            </label>
            <div className="relative mt-1">
              <input
                type={showNew ? 'text' : 'password'}
                required
                minLength={6}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-10 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                aria-label={showNew ? 'Hide password' : 'Show password'}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Confirm New Password *</label>
            <input
              type={showNew ? 'text' : 'password'}
              required
              minLength={6}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-600">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-[#0F766E]" />
            Changing your password immediately signs out all other active sessions on other devices.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetAndClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
            >
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
