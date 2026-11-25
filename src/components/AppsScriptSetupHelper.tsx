import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  ShieldCheck,
  X,
} from 'lucide-react';

interface AppsScriptSourceFile {
  order: number;
  fileName: string;
  editorName: string;
  kind: 'manifest' | 'script';
  note: string;
  lineCount: number;
  content: string;
}

interface AppsScriptFilesPayload {
  primaryOwnerEmail: string;
  initialAdminUsername: string;
  excludedFiles: string[];
  files: AppsScriptSourceFile[];
}

interface AppsScriptSetupHelperProps {
  buttonLabel?: string;
  variant?: 'primary' | 'secondary';
  onNotify?: (msg: string, tone?: 'success' | 'error') => void;
}

async function copyTextReliably(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for restricted iframe clipboard permissions
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function AppsScriptSetupHelper({
  buttonLabel = 'Apps Script Setup (7 Files · 1-Click Copy)',
  variant = 'primary',
  onNotify,
}: AppsScriptSetupHelperProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AppsScriptFilesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedSet, setCopiedSet] = useState<Record<string, boolean>>({});
  const [justCopied, setJustCopied] = useState<string | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data) return;
    let active = true;
    setLoading(true);
    setError('');
    fetch('/api/android/apps-script-files', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Could not load Apps Script files.');
        }
        return (await res.json()) as AppsScriptFilesPayload;
      })
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((err: any) => {
        if (active) setError(err?.message || 'Failed to load Apps Script source files.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, data]);

  const handleCopy = async (file: AppsScriptSourceFile) => {
    const ok = await copyTextReliably(file.content);
    if (ok) {
      setCopiedSet((prev) => ({ ...prev, [file.fileName]: true }));
      setJustCopied(file.fileName);
      onNotify?.(`Copied ${file.fileName}`, 'success');
      window.setTimeout(() => {
        setJustCopied((curr) => (curr === file.fileName ? null : curr));
      }, 2200);
    } else {
      setExpandedFile(file.fileName);
      onNotify?.(`Auto-copy blocked. Opened ${file.fileName} so you can press Ctrl+A then Ctrl+C.`, 'error');
    }
  };

  const copiedCount = Object.values(copiedSet).filter(Boolean).length;
  const totalFiles = data?.files.length ?? 7;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === 'primary'
            ? 'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[#0B1F3A] px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-[#132f55] transition-colors'
            : 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50 transition-colors'
        }
      >
        <FileCode2 className="h-3.5 w-3.5 text-teal-400 shrink-0" />
        <span>{buttonLabel}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="apps-script-setup-title"
        >
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl text-slate-800">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B1F3A] px-5 py-4 text-white">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-teal-400 shrink-0" />
                  <h2 id="apps-script-setup-title" className="text-sm sm:text-base font-bold">
                    SUNVILOZ Clean Care — Primary Apps Script Setup (7 Files)
                  </h2>
                </div>
                <p className="text-xs text-slate-300">
                  Primary Account: <strong className="text-white">sunvilozltd@gmail.com</strong> ·
                  Copy each file in 1 click without opening any ZIP.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Close setup helper"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Action bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <CheckCircle2
                  className={`h-4 w-4 ${copiedCount === totalFiles ? 'text-emerald-600' : 'text-teal-600'}`}
                />
                <span>
                  Progress: {copiedCount} / {totalFiles} files copied
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="https://script.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0c6059]"
                >
                  <span>Open script.google.com</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Quick Step Guide */}
              <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3.5 text-xs text-slate-700 space-y-2">
                <div className="font-bold text-[#0B1F3A]">
                  Quick Deploy Checklist (Sign in with sunvilozltd@gmail.com)
                </div>
                <ol className="list-decimal space-y-1 pl-4 leading-relaxed">
                  <li>
                    Open <strong>script.google.com</strong> using <strong>sunvilozltd@gmail.com</strong>{' '}
                    → click <strong>+ New project</strong> → rename to{' '}
                    <code>SUNVILOZ Clean Care Primary Backend</code>.
                  </li>
                  <li>
                    Go to <strong>Project Settings (⚙️)</strong> → check{' '}
                    <strong>Show &quot;appsscript.json&quot; manifest file in editor</strong> → return to{' '}
                    <strong>Editor (&lt; &gt;)</strong>.
                  </li>
                  <li>
                    Copy and paste all <strong>7 files below</strong> in order (press{' '}
                    <strong>Ctrl+S</strong> to save). Do <strong>NOT</strong> add{' '}
                    <code>SecondaryBackupDrive.gs</code> here.
                  </li>
                  <li>
                    Open <code>Triggers.gs</code> → select{' '}
                    <code>provisionWorkspaceAndTriggers</code> → click <strong>Run</strong> →{' '}
                    <strong>Review permissions</strong> → <strong>Advanced</strong> →{' '}
                    <strong>Allow</strong>. Then open <code>Auth.gs</code> → run{' '}
                    <code>testRecoveryEmailDelivery</code>.
                  </li>
                  <li>
                    Click <strong>Deploy → New deployment → Web app</strong> → set{' '}
                    <strong>Execute as: Me (sunvilozltd@gmail.com)</strong> and{' '}
                    <strong>Who has access: Anyone</strong> → click <strong>Deploy</strong> → copy the{' '}
                    <code>/exec</code> Web app URL and paste it into your Android APK&apos;s{' '}
                    <strong>Configure Backend URL</strong>.
                  </li>
                </ol>
              </div>

              {loading && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                  Loading the 7 Primary Apps Script files...
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}

              {data && (
                <div className="space-y-2.5">
                  {data.files.map((file) => {
                    const isCopied = Boolean(copiedSet[file.fileName]);
                    const isJustCopied = justCopied === file.fileName;
                    const isExpanded = expandedFile === file.fileName;

                    return (
                      <div
                        key={file.fileName}
                        className={`rounded-xl border transition-colors ${
                          isCopied
                            ? 'border-emerald-200 bg-emerald-50/40'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2.5 p-3">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#0B1F3A] text-[11px] font-bold text-white">
                                {file.order}
                              </span>
                              <span className="font-mono text-xs sm:text-sm font-bold text-[#0B1F3A]">
                                {file.fileName}
                              </span>
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                {file.kind === 'manifest' ? 'Manifest' : `Script: ${file.editorName}`}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {file.lineCount} lines
                              </span>
                              {isCopied && (
                                <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                  <Check className="h-3 w-3" />
                                  Copied
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 pl-7">{file.note}</p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 pl-7 sm:pl-0">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedFile(isExpanded ? null : file.fileName)
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              <Code2 className="h-3.5 w-3.5" />
                              <span>{isExpanded ? 'Hide' : 'View'}</span>
                              {isExpanded ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleCopy(file)}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
                                isJustCopied
                                  ? 'bg-emerald-600 hover:bg-emerald-700'
                                  : 'bg-[#0F766E] hover:bg-[#0c6059]'
                              }`}
                            >
                              {isJustCopied ? (
                                <>
                                  <Check className="h-3.5 w-3.5" />
                                  <span>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5" />
                                  <span>Copy Code</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-slate-200 bg-slate-950 p-3 rounded-b-xl">
                            <textarea
                              readOnly
                              value={file.content}
                              onFocus={(e) => e.currentTarget.select()}
                              rows={12}
                              className="w-full resize-y rounded bg-slate-900 p-2.5 font-mono text-[11px] leading-relaxed text-slate-100 focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-[11px] text-slate-500">
              <span>
                Excluded on purpose: <code>SecondaryBackupDrive.gs</code> (separate backup project) &amp;{' '}
                <code>SETUP_GUIDE.md</code>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-[#0B1F3A] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#132f55]"
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
