import React, { useEffect, useState } from 'react';
import { Download, FolderArchive, ShieldCheck, Smartphone, Terminal, X } from 'lucide-react';
import { AppsScriptSetupHelper } from './AppsScriptSetupHelper';

interface AndroidArtifactsInfo {
  applicationId: string;
  versionName: string;
  minSdk: number;
  targetSdk: number;
  apk: {
    available: boolean;
    fileName: string;
    signingType: string;
    sizeBytes: number;
    sha256: string | null;
    downloadUrl: string | null;
  };
  projectZip: {
    available: boolean;
    fileName: string;
    sizeBytes: number;
    downloadUrl: string | null;
  };
}

interface PWAInstallButtonProps {
  variant?: 'sidebar' | 'header' | 'card';
  onNotify?: (msg: string, tone?: 'success' | 'error') => void;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Native Android APK & Android Studio Project download UI.
 * Replaces earlier browser "Add to Home Screen" PWA instructions with genuine
 * native Kotlin + Jetpack Compose Android deliverables.
 */
export function PWAInstallButton({ variant = 'header', onNotify }: PWAInstallButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<AndroidArtifactsInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchArtifacts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/android/artifacts', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as AndroidArtifactsInfo;
        setArtifacts(data);
      }
    } catch {
      // Keep graceful fallback UI
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (variant === 'card' || modalOpen) {
      void fetchArtifacts();
    }
  }, [variant, modalOpen]);

  const handleDownload = (url: string | null, label: string) => {
    if (!url) {
      onNotify?.(`${label} is not available on this server yet.`, 'error');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    onNotify?.(`Downloading ${label}...`, 'success');
  };

  const apkAvailable = Boolean(artifacts?.apk?.available && artifacts.apk.downloadUrl);
  const zipAvailable = Boolean(artifacts?.projectZip?.available && artifacts.projectZip.downloadUrl);

  const renderDownloadContent = () => (
    <div className="space-y-4 text-xs leading-relaxed text-slate-600">
      <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3.5 text-slate-800 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-[#0B1F3A]">
            <ShieldCheck className="h-4 w-4 text-[#0F766E]" />
            Native Android APK (Kotlin + Jetpack Compose)
          </div>
          {artifacts && (
            <span className="rounded bg-white px-2 py-0.5 text-[11px] font-semibold text-[#0B1F3A] border border-teal-200">
              v{artifacts.versionName} · API {artifacts.minSdk}–{artifacts.targetSdk}
            </span>
          )}
        </div>

        {loading && !artifacts ? (
          <p className="text-slate-600">Checking generated Android build artifacts...</p>
        ) : apkAvailable ? (
          <>
            <p>
              <strong>Test Build (Debug-Signed APK):</strong> Native Kotlin + Jetpack Compose APK (
              <code>{artifacts?.applicationId}</code>, no WebView or browser shortcut) with your
              SUNVILOZ app icon and official quotation pad. Connects directly to your Google Apps
              Script backend.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownload(artifacts!.apk.downloadUrl, artifacts!.apk.fileName)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0c6059]"
              >
                <Download className="h-4 w-4" />
                Download SUNVILOZ-Clean-Care.apk ({formatSize(artifacts!.apk.sizeBytes)})
              </button>
              <AppsScriptSetupHelper variant="secondary" onNotify={onNotify} />
              {zipAvailable && (
                <button
                  type="button"
                  onClick={() =>
                    handleDownload(artifacts!.projectZip.downloadUrl, artifacts!.projectZip.fileName)
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                >
                  <FolderArchive className="h-4 w-4 text-[#0F766E]" />
                  Download Android Studio ZIP ({formatSize(artifacts!.projectZip.sizeBytes)})
                </button>
              )}
            </div>
            {artifacts?.apk.sha256 && (
              <p className="text-[11px] font-mono text-slate-500 break-all">
                APK SHA-256: {artifacts.apk.sha256}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-amber-800 font-medium">
              No pre-built APK file is currently present on this server. Download the complete
              Android Studio project ZIP below and build the signed APK in Android Studio.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <AppsScriptSetupHelper variant="primary" onNotify={onNotify} />
              {zipAvailable && (
                <button
                  type="button"
                  onClick={() =>
                    handleDownload(artifacts!.projectZip.downloadUrl, artifacts!.projectZip.fileName)
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                >
                  <FolderArchive className="h-4 w-4 text-[#0F766E]" />
                  Download Android Studio Project ZIP ({formatSize(artifacts!.projectZip.sizeBytes)})
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
          <div className="font-bold text-[#0B1F3A]">Install Test APK on Android Phone</div>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Download <strong>SUNVILOZ-Clean-Care.apk</strong> (Test Build) on your Android phone (Android 8.0+).</li>
            <li>Tap the downloaded APK and allow <strong>Install unknown apps</strong> for your browser/Files app.</li>
            <li>If an older build of <code>com.sunviloz.cleancare</code> is already installed, an in-place update requires the same signing certificate and a higher <code>versionCode</code>.</li>
            <li>Open <strong>SUNVILOZ Clean Care</strong>, tap <strong>Configure Backend URL</strong>, and paste your deployed Apps Script <code>/exec</code> URL.</li>
          </ol>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-[#0B1F3A]">
            <Terminal className="h-3.5 w-3.5 text-[#0F766E]" />
            Build in Android Studio (Source ZIP)
          </div>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Extract the ZIP and open the <code>android/</code> folder in <strong>Android Studio (JDK 17, SDK 35)</strong>.</li>
            <li>Copy <code>local.properties.example</code> to <code>local.properties</code> and verify <code>sdk.dir</code>.</li>
            <li>Run <code>./gradlew assembleDebug</code> (debug-signed APK) or <strong>Build → Generate Signed APK</strong> (release).</li>
            <li>Deploy files in <code>apps-script-backend/</code> under your Primary Google Account.</li>
          </ol>
        </div>
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
                Native Android App (APK & Android Studio Project)
              </h2>
              <p className="text-xs text-slate-500">
                Kotlin + Jetpack Compose native Android app connected directly to Google Sheets,
                Drive, and Apps Script.
              </p>
            </div>
          </div>
        </div>
        {renderDownloadContent()}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={
          variant === 'sidebar'
            ? 'flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-500/20 border border-teal-400/30 px-2.5 py-2 text-xs font-semibold text-teal-100 hover:bg-teal-500/30'
            : 'inline-flex h-10 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-[#0F766E] hover:bg-teal-100'
        }
      >
        <Smartphone className="h-3.5 w-3.5" />
        <span>Android App (APK)</span>
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="android-apk-dialog-title"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl text-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-[#0F766E]" />
                <h2 id="android-apk-dialog-title" className="text-base font-bold text-[#0B1F3A]">
                  SUNVILOZ Clean Care — Native Android App
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close Android app download dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">{renderDownloadContent()}</div>

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
