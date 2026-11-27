import React, { useState } from 'react';
import { CheckCircle2, Download, Globe, Laptop, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { isAppsScriptRuntime } from '../services/apiClient';
import { AppsScriptSetupHelper } from './AppsScriptSetupHelper';

interface PWAInstallButtonProps {
  variant?: 'sidebar' | 'header' | 'card';
  onNotify?: (msg: string, tone?: 'success' | 'error') => void;
}

/**
 * Browser-based Add to Home Screen & Web App Installation helper.
 * Works across mobile Chrome/Edge, iOS Safari, and desktop browsers with zero native APK required.
 */
export function PWAInstallButton({ variant = 'header', onNotify }: PWAInstallButtonProps) {
  const { canNativeInstall, isInstalled, isIos, isAndroid, triggerInstall } = usePWAInstall();
  const [modalOpen, setModalOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const inGasRuntime = isAppsScriptRuntime();

  const handlePrimaryClick = async () => {
    if (canNativeInstall) {
      setInstalling(true);
      try {
        const outcome = await triggerInstall();
        if (outcome === 'accepted') {
          onNotify?.('SUNVILOZ Clean Care added to your device home screen.', 'success');
          return;
        }
      } catch {
        // Fall through to manual browser steps
      } finally {
        setInstalling(false);
      }
    }
    setModalOpen(true);
  };

  const renderInstallInstructions = () => (
    <div className="space-y-4 text-xs leading-relaxed text-slate-600">
      <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3.5 text-slate-800 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-[#0B1F3A]">
            <Globe className="h-4 w-4 text-[#0F766E]" />
            Browser Web App — One URL for Phone &amp; Desktop
          </div>
          {isInstalled && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Installed on Home Screen
            </span>
          )}
        </div>
        <p>
          SUNVILOZ Clean Care runs directly in your browser from one web app URL — no APK file,
          Play Store install, or backend URL entry needed. Add a Home Screen shortcut on any phone
          or desktop for 1-tap full-screen access.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canNativeInstall && (
            <button
              type="button"
              disabled={installing}
              onClick={() => void handlePrimaryClick()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {installing ? 'Opening Install Prompt...' : 'Install Web App Now'}
            </button>
          )}
          {!inGasRuntime && <AppsScriptSetupHelper variant="secondary" onNotify={onNotify} />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div
          className={`rounded-lg border p-3 space-y-1.5 ${
            isAndroid ? 'border-teal-300 bg-teal-50/40' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold text-[#0B1F3A]">
            <Smartphone className="h-3.5 w-3.5 text-[#0F766E]" />
            Android Phone (Chrome / Edge)
          </div>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Open your SUNVILOZ Clean Care web app URL in <strong>Chrome</strong>.</li>
            <li>Tap the <strong>⋮ Menu</strong> button in the top-right corner.</li>
            <li>
              Tap <strong>Install app</strong> or <strong>Add to Home screen</strong> → confirm{' '}
              <strong>Add</strong>.
            </li>
            <li>Launch SUNVILOZ directly from your phone home screen icon.</li>
          </ol>
        </div>

        <div
          className={`rounded-lg border p-3 space-y-1.5 ${
            isIos ? 'border-teal-300 bg-teal-50/40' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold text-[#0B1F3A]">
            <Smartphone className="h-3.5 w-3.5 text-[#0F766E]" />
            iPhone / iPad (Safari)
          </div>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Open the web app URL in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> icon (square with upward arrow) at the bottom.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong> in the top-right corner.</li>
          </ol>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
        <div className="flex items-center gap-1.5 font-bold text-[#0B1F3A]">
          <Laptop className="h-3.5 w-3.5 text-[#0F766E]" />
          Desktop Browser (Chrome / Edge)
        </div>
        <p>
          Bookmark the web app URL or click the <strong>Install / Create Shortcut</strong> icon in
          the browser address bar (or menu → <strong>Cast, save, and share → Install page as app</strong>)
          to pin SUNVILOZ Clean Care to your desktop or taskbar.
        </p>
      </div>
    </div>
  );

  if (variant === 'card') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-[#0F766E]">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0B1F3A]">
                Install Web App (Add to Home Screen)
              </h2>
              <p className="text-xs text-slate-500">
                Add SUNVILOZ Clean Care to your phone or desktop home screen directly from your
                browser.
              </p>
            </div>
          </div>
        </div>
        {renderInstallInstructions()}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={installing}
        onClick={() => void handlePrimaryClick()}
        className={
          variant === 'sidebar'
            ? 'flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-500/20 border border-teal-400/30 px-2.5 py-2 text-xs font-semibold text-teal-100 hover:bg-teal-500/30'
            : 'inline-flex h-10 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-[#0F766E] hover:bg-teal-100'
        }
      >
        <Smartphone className="h-3.5 w-3.5" />
        <span>
          {isInstalled
            ? 'Web App Installed'
            : canNativeInstall
            ? 'Install Web App'
            : 'Add to Home Screen'}
        </span>
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="web-install-dialog-title"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl text-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-[#0F766E]" />
                <h2 id="web-install-dialog-title" className="text-base font-bold text-[#0B1F3A]">
                  Install SUNVILOZ Clean Care Web App
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close installation guide"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">{renderInstallInstructions()}</div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg bg-[#0B1F3A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#132f55]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
