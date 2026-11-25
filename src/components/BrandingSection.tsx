import React, { useState } from 'react';
import { CheckCircle2, Image as ImageIcon, Save, Trash2, Upload } from 'lucide-react';
import { AppSettings } from '../types/order';
import { BrandLogo } from './BrandLogo';

interface BrandingSectionProps {
  settings: AppSettings;
  onSaveLogo: (payload: {
    file_name: string;
    mime_type: string;
    data_url: string;
  }) => Promise<void>;
  onDeleteLogo: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function BrandingSection({
  settings,
  onSaveLogo,
  onDeleteLogo,
  onNotify,
}: BrandingSectionProps) {
  const [pendingLogo, setPendingLogo] = useState<{
    file_name: string;
    mime_type: string;
    data_url: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const previewUrl = pendingLogo?.data_url ?? settings.company_logo_data_url ?? '';
  const hasSavedLogo = Boolean(settings.company_logo_data_url);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const mime = file.type.toLowerCase();
    if (!ALLOWED_MIMES.has(mime)) {
      onNotify('Only PNG, JPG, or WebP logo files can be uploaded.', 'error');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      onNotify('Logo file must be 2 MB or smaller.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl.startsWith('data:image/')) {
        onNotify('Could not read the selected image file.', 'error');
        return;
      }
      setPendingLogo({
        file_name: file.name,
        mime_type: mime === 'image/jpg' ? 'image/jpeg' : mime,
        data_url: dataUrl,
      });
      setConfirmRemove(false);
    };
    reader.onerror = () => onNotify('Failed to read the selected logo file.', 'error');
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!pendingLogo || saving) return;
    setSaving(true);
    try {
      await onSaveLogo(pendingLogo);
      setPendingLogo(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await onDeleteLogo();
      setPendingLogo(null);
      setConfirmRemove(false);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#0B1F3A]">Company Logo & Branding</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Your saved logo appears across all devices on the sign-in screen, admin navigation,
              and supervisor "My Jobs" header. If no logo is uploaded, the default SUNVILOZ Clean
              Care mark is shown.
            </p>
          </div>
          {hasSavedLogo && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Logo Saved
            </span>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 text-[11px] font-semibold text-slate-500">
              Light Background Preview (Admin Sidebar & Sign In)
            </div>
            <div className="flex min-h-[76px] items-center rounded-lg border border-slate-100 bg-slate-50/70 px-4 py-3">
              <BrandLogo logoDataUrl={previewUrl} variant="light" />
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0B1F3A] p-5">
            <div className="mb-3 text-[11px] font-semibold text-slate-300">
              Dark Header Preview (Supervisor "My Jobs" Header)
            </div>
            <div className="flex min-h-[76px] items-center rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <BrandLogo
                logoDataUrl={previewUrl}
                variant="dark"
                subtitle="My Jobs — Supervisor"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4">
          <div className="flex items-center gap-2.5 text-xs text-slate-600">
            <ImageIcon className="h-4 w-4 text-teal-700" />
            {pendingLogo ? (
              <span>
                Selected new logo:{' '}
                <strong className="text-[#0B1F3A]">{pendingLogo.file_name}</strong> (click "Save
                Logo" to apply)
              </span>
            ) : hasSavedLogo ? (
              <span>
                Current logo:{' '}
                <strong className="text-[#0B1F3A]">
                  {settings.company_logo_file_name || 'company-logo'}
                </strong>
                {settings.company_logo_updated_at
                  ? ` · Updated: ${settings.company_logo_updated_at}`
                  : ''}
              </span>
            ) : (
              <span>Upload a PNG, JPG, or WebP logo with transparent background (max 2 MB).</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50">
              <Upload className="h-4 w-4 text-teal-600" />
              {hasSavedLogo ? 'Choose New Logo' : 'Upload Logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleFileSelect}
              />
            </label>

            {pendingLogo && (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Logo'}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingLogo(null)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </>
            )}

            {hasSavedLogo && !pendingLogo && (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove Logo
              </button>
            )}
          </div>
        </div>

        {confirmRemove && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
            <span>
              Are you sure you want to remove the company logo? The default "SUNVILOZ Clean Care"
              branding will be restored on all screens.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="h-8 rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removing}
                onClick={handleDelete}
                className="h-8 rounded-lg bg-red-700 px-3.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {removing ? 'Removing...' : 'Yes, Remove'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 rounded-xl border border-teal-100 bg-teal-50/60 p-4 text-xs leading-relaxed text-teal-950">
          <strong className="font-bold">Quotation & Money Receipt Pad Rule:</strong> Uploading a
          logo here does not modify your uploaded Quotation or Money Receipt pad artwork and never
          changes previously issued PDFs. You can optionally enable the "Company Logo (Optional)"
          field under Settings → Document Pads. The logo is also included in full backups and
          restores.
        </div>
      </div>
    </div>
  );
}
