import React, { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Fingerprint, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { api, setAuthToken } from '../services/apiClient';
import { AuthUser } from '../types/order';
import { BrandLogo } from './BrandLogo';

interface DeviceUnlockScreenProps {
  userPreview: {
    id: string;
    name: string;
    username: string;
    role: 'admin' | 'supervisor';
  };
  companyLogoDataUrl?: string;
  onUnlocked: (user: AuthUser) => void;
  onUsePasswordFallback: () => void;
  onSignOut: () => void;
}

export function DeviceUnlockScreen({
  userPreview,
  companyLogoDataUrl = '',
  onUnlocked,
  onUsePasswordFallback,
  onSignOut,
}: DeviceUnlockScreenProps) {
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState('');

  const handleDeviceUnlock = async () => {
    setError('');
    setUnlocking(true);
    try {
      const opts = await api.webAuthnAuthOptions();
      const assertion = await startAuthentication({
        optionsJSON: opts.options as PublicKeyCredentialRequestOptionsJSON,
      });
      const verified = await api.webAuthnAuthVerify({
        challengeId: opts.challengeId,
        response: assertion,
      });
      setAuthToken(verified.token);
      onUnlocked(verified.user);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Device unlock was cancelled or failed.';
      if (rawMsg.toLowerCase().includes('notallowederror') || rawMsg.toLowerCase().includes('abort')) {
        setError('Device verification was cancelled. Try again or use your app password.');
      } else {
        setError(rawMsg);
      }
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <BrandLogo
          logoDataUrl={companyLogoDataUrl}
          variant="light"
          subtitle="Operations, Orders & Accounts"
        />

        <div className="mt-6 border-t border-slate-100 pt-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-[#0F766E]">
            <Fingerprint className="h-8 w-8" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-[#0B1F3A]">Unlock SUNVILOZ Clean Care</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Signed in on this device as{' '}
            <strong className="text-[#0B1F3A]">{userPreview.name}</strong>
          </p>
          <div className="mt-1 font-mono text-xs text-slate-500">
            {userPreview.username} · {userPreview.role === 'admin' ? 'Admin' : 'Field Supervisor'}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 space-y-3">
          <button
            type="button"
            disabled={unlocking}
            onClick={handleDeviceUnlock}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0F766E] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0c6059] disabled:opacity-60"
          >
            <Fingerprint className="h-5 w-5" />
            {unlocking ? 'Verifying on This Device...' : 'Unlock with Fingerprint / Face / PIN'}
          </button>

          <button
            type="button"
            disabled={unlocking}
            onClick={onUsePasswordFallback}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0B1F3A] hover:bg-slate-50 disabled:opacity-60"
          >
            <KeyRound className="h-4 w-4 text-slate-500" />
            Use App Password Instead
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-teal-700" />
            Verified locally via WebAuthn
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-red-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
