import React, { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import {
  CheckCircle2,
  Fingerprint,
  Laptop,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { api, isAppsScriptRuntime } from '../services/apiClient';
import {
  getFriendlyDeviceLabel,
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
} from '../services/deviceIdentity';
import { ActiveSessionInfo, EnrolledDeviceInfo } from '../types/order';
import { formatDateTimeEn } from '../utils/dateAndPhone';

interface EnrolledDevicesPanelProps {
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
  onEnrollmentChanged?: (currentDeviceEnrolled: boolean) => void;
  onCurrentSessionRevoked?: () => void;
}

export function EnrolledDevicesPanel({
  onNotify,
  onEnrollmentChanged,
  onCurrentSessionRevoked,
}: EnrolledDevicesPanelProps) {
  const inGasRuntime = isAppsScriptRuntime();
  const [devices, setDevices] = useState<EnrolledDeviceInfo[]>([]);
  const [sessions, setSessions] = useState<ActiveSessionInfo[]>([]);
  const [currentDeviceEnrolled, setCurrentDeviceEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [webAuthnReady, setWebAuthnReady] = useState(false);
  const [platformReady, setPlatformReady] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listDevices();
      setDevices(res.devices);
      setSessions(res.sessions);
      setCurrentDeviceEnrolled(res.currentDeviceEnrolled);
      onEnrollmentChanged?.(res.currentDeviceEnrolled);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load active sessions.', 'error');
    } finally {
      setLoading(false);
    }
  }, [onNotify, onEnrollmentChanged]);

  useEffect(() => {
    setWebAuthnReady(!inGasRuntime && isWebAuthnSupported());
    if (!inGasRuntime) {
      isPlatformAuthenticatorAvailable().then(setPlatformReady).catch(() => setPlatformReady(false));
    }
    loadDevices();
  }, [loadDevices, inGasRuntime]);

  const handleEnrollThisDevice = async () => {
    setEnrolling(true);
    try {
      const regOpts = await api.webAuthnRegisterOptions(platformReady);
      const attestation = await startRegistration({
        optionsJSON: regOpts.options as PublicKeyCredentialCreationOptionsJSON,
      });
      const verified = await api.webAuthnRegisterVerify({
        challengeId: regOpts.challengeId,
        response: attestation,
      });
      setDevices(verified.devices);
      setCurrentDeviceEnrolled(true);
      onEnrollmentChanged?.(true);
      onNotify(verified.message || 'Device Unlock enabled on this device.', 'success');
      await loadDevices();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to enable Device Unlock.';
      if (msg.toLowerCase().includes('notallowederror') || msg.toLowerCase().includes('abort')) {
        onNotify('Device Unlock setup was cancelled on this device.', 'error');
      } else {
        onNotify(msg, 'error');
      }
    } finally {
      setEnrolling(false);
    }
  };

  const handleRemoveDevice = async (cred: EnrolledDeviceInfo) => {
    setBusyId(cred.credential_id);
    try {
      const res = await api.removeDevice(cred.credential_id);
      setDevices(res.devices);
      setSessions(res.sessions);
      onNotify(res.message, 'success');
      if (res.revokedCurrentSession) {
        onCurrentSessionRevoked?.();
      } else {
        const stillEnrolled = res.devices.some((d) => d.is_current_device);
        setCurrentDeviceEnrolled(stillEnrolled);
        onEnrollmentChanged?.(stillEnrolled);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not remove device.', 'error');
    } finally {
      setBusyId('');
    }
  };

  const handleRevokeSession = async (session: ActiveSessionInfo) => {
    setBusyId(session.session_id);
    try {
      const res = await api.revokeSession(session.session_id);
      setSessions(res.sessions);
      onNotify(res.message, 'success');
      if (session.is_current_session) {
        onCurrentSessionRevoked?.();
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not revoke session.', 'error');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-[#0F766E]">
            <Fingerprint className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0B1F3A]">
              Device Unlock &amp; Active Sessions
            </h2>
            <p className="text-xs text-slate-500">
              Use this phone&apos;s fingerprint, face unlock, or screen lock via WebAuthn. Biometric
              data and device PINs are never sent to or stored by this app.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={loadDevices}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {webAuthnReady && !currentDeviceEnrolled && (
            <button
              type="button"
              disabled={enrolling}
              onClick={handleEnrollThisDevice}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
            >
              <Fingerprint className="h-4 w-4" />
              {enrolling ? 'Verifying Device...' : 'Enable Device Unlock'}
            </button>
          )}
        </div>
      </div>

      {/* Current device summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-[#0F766E]" />
          <span>
            This device: <strong className="text-[#0B1F3A]">{getFriendlyDeviceLabel()}</strong>
          </span>
        </div>
        {currentDeviceEnrolled ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Device Unlock Enabled
          </span>
        ) : webAuthnReady ? (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
            Not Enrolled Yet (App Password Active)
          </span>
        ) : (
          <span className="rounded-md bg-slate-200 px-2 py-0.5 font-semibold text-slate-700">
            WebAuthn Unavailable on This Browser
          </span>
        )}
      </div>

      {/* Enrolled Devices List */}
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Enrolled Devices ({devices.length})
        </div>
        {devices.length === 0 ? (
          <p className="text-xs text-slate-500">
            No devices enrolled for biometric/screen-lock unlock yet. Enabling Device Unlock on this
            phone only authorizes this phone — never other phones.
          </p>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <div
                key={d.credential_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[#0F766E]" />
                  <div>
                    <div className="font-semibold text-[#0B1F3A]">
                      {d.device_label}
                      {d.is_current_device && (
                        <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0F766E]">
                          This Device
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Added {formatDateTimeEn(d.created_at)}
                      {d.last_used_at ? ` · Last unlock ${formatDateTimeEn(d.last_used_at)}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyId === d.credential_id}
                  onClick={() => handleRemoveDevice(d)}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {busyId === d.credential_id ? 'Removing...' : 'Remove Device'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Persistent Sessions */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Active Signed-In Sessions ({sessions.length})
        </div>
        {sessions.length === 0 ? (
          <p className="text-xs text-slate-500">No active persistent sessions.</p>
        ) : (
          <div className="space-y-1.5">
            {sessions.map((s) => (
              <div
                key={s.session_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Laptop className="h-3.5 w-3.5 text-slate-500" />
                  <div>
                    <span className="font-semibold text-[#0B1F3A]">{s.device_label}</span>
                    {s.is_current_session && (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                        Current Session
                      </span>
                    )}
                    <div className="text-[11px] text-slate-500">
                      Signed in {formatDateTimeEn(s.created_at)} · Last active{' '}
                      {formatDateTimeEn(s.last_active_at)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyId === s.session_id}
                  onClick={() => handleRevokeSession(s)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                >
                  {busyId === s.session_id ? 'Revoking...' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
