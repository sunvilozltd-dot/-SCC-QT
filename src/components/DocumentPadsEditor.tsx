import React, { useEffect, useRef, useState } from 'react';
import { Move, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { DocumentPadConfig, PadFieldConfig, PadType } from '../types/order';
import { COMPANY_ADDRESS, COMPANY_WEBSITE } from '../utils/companyConstants';
import { getDefaultPadFields } from '../utils/padDefaults';
import { convertUploadedPadFileToImage } from '../utils/pdfExport';

interface DocumentPadsEditorProps {
  pads: Record<PadType, DocumentPadConfig | null>;
  companyLogoDataUrl?: string;
  onUploadPad: (
    padType: PadType,
    payload: {
      file_name: string;
      mime_type: string;
      image_data_url: string;
      fields: PadFieldConfig[];
    }
  ) => Promise<void>;
  onSaveFields: (padType: PadType, fields: PadFieldConfig[]) => Promise<void>;
  onDeletePad: (padType: PadType) => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function DocumentPadsEditor({
  pads,
  companyLogoDataUrl,
  onUploadPad,
  onSaveFields,
  onDeletePad,
  onNotify,
}: DocumentPadsEditorProps) {
  const [padType, setPadType] = useState<PadType>('quotation');
  const activePad = pads[padType];
  const [fields, setFields] = useState<PadFieldConfig[]>(() =>
    activePad ? activePad.fields : getDefaultPadFields(padType)
  );
  const [selectedKey, setSelectedKey] = useState<string>(fields[0]?.key || '');
  const [uploading, setUploading] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = pads[padType];
    const defaults = getDefaultPadFields(padType);
    const nextFields = current
      ? [
          ...current.fields.map((f) => ({ ...f })),
          ...defaults.filter((d) => !current.fields.some((f) => f.key === d.key)),
        ]
      : defaults;
    setFields(nextFields);
    setSelectedKey(nextFields[0]?.key || '');
  }, [padType, pads]);

  const selectedField = fields.find((f) => f.key === selectedKey) || fields[0];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const converted = await convertUploadedPadFileToImage(file);
      await onUploadPad(padType, {
        file_name: converted.fileName,
        mime_type: converted.mimeType,
        image_data_url: converted.imageDataUrl,
        fields,
      });
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to upload pad.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const updateSelectedField = (patch: Partial<PadFieldConfig>) => {
    if (!selectedField) return;
    setFields((prev) =>
      prev.map((f) => (f.key === selectedField.key ? { ...f, ...patch } : f))
    );
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || !selectedField) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(92, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(94, ((e.clientY - rect.top) / rect.height) * 100));
    updateSelectedField({
      xPct: Number(xPct.toFixed(1)),
      yPct: Number(yPct.toFixed(1)),
    });
  };

  const handleSaveFieldPositions = async () => {
    setSavingFields(true);
    try {
      await onSaveFields(padType, fields);
    } finally {
      setSavingFields(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Separate Pad Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setPadType('quotation')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              padType === 'quotation'
                ? 'bg-white text-[#0B1F3A] shadow-sm'
                : 'text-slate-600 hover:text-[#0B1F3A]'
            }`}
          >
            Quotation Pad {pads.quotation ? `(v${pads.quotation.version})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setPadType('receipt')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              padType === 'receipt'
                ? 'bg-white text-[#0B1F3A] shadow-sm'
                : 'text-slate-600 hover:text-[#0B1F3A]'
            }`}
          >
            Money Receipt Pad {pads.receipt ? `(v${pads.receipt.version})` : ''}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700">
            <Upload className="h-4 w-4" />
            {uploading
              ? 'Uploading...'
              : activePad
              ? 'Replace Custom Pad (PDF/PNG/JPG)'
              : 'Upload Custom Pad (PDF/PNG/JPG)'}
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg"
              className="hidden"
              disabled={uploading}
              onChange={handleFileChange}
            />
          </label>
          {activePad && (
            <button
              type="button"
              onClick={() => onDeletePad(padType)}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Reset to Official Default
            </button>
          )}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        Upload a custom pad once and save field positions in the visual editor below. New{' '}
        {padType === 'quotation' ? 'quotations' : 'money receipts'} will automatically use it while
        previously issued PDFs preserve their original pad snapshot. Enable{' '}
        <strong className="text-[#0B1F3A]">Updated Company Contact Header</strong> if an uploaded pad
        contains outdated contact details so it cleanly overlays{' '}
        <span className="font-mono">{COMPANY_ADDRESS}</span> and{' '}
        <span className="font-mono">{COMPANY_WEBSITE}</span>.
      </p>

      {!activePad ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-[#0B1F3A]">
            {padType === 'quotation'
              ? 'No custom quotation pad uploaded (Official verified English quotation template is active)'
              : 'No custom money receipt pad uploaded (Standard English money receipt template is active)'}
          </p>
          <p className="mx-auto mt-1.5 max-w-xl text-xs leading-relaxed text-slate-500">
            {padType === 'quotation'
              ? `By default, new quotations use the official SUNVILOZ Clean Care A4 sample layout with ${COMPANY_ADDRESS} and ${COMPANY_WEBSITE}. You can upload a replacement blank pad (PDF/PNG/JPG) anytime.`
              : `By default, new money receipts use the clean English A4 layout with ${COMPANY_ADDRESS} and ${COMPANY_WEBSITE} (custom visual sample pending). You can upload a blank money receipt pad (PDF/PNG/JPG) anytime.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Interactive Visual A4 Canvas */}
          <div className="lg:col-span-7">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1 font-medium text-[#0B1F3A]">
                <Move className="h-3.5 w-3.5 text-teal-700" />
                Click canvas to reposition selected field: <strong>{selectedField?.label}</strong>
              </span>
              <span className="font-mono">
                {activePad.file_name} · v{activePad.version}
              </span>
            </div>

            <div
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="relative w-full cursor-crosshair overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm"
              style={{ aspectRatio: '210 / 297' }}
            >
              <img
                src={activePad.image_data_url}
                alt={activePad.file_name}
                className="pointer-events-none absolute inset-0 h-full w-full object-fill"
              />
              {fields.map((f) => {
                if (!f.visible) return null;
                const isSel = f.key === selectedField?.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedKey(f.key);
                    }}
                    style={{
                      position: 'absolute',
                      left: `${f.xPct}%`,
                      top: `${f.yPct}%`,
                      width: `${f.widthPct}%`,
                      fontSize: `${Math.max(9, f.fontSize * 0.72)}px`,
                      textAlign: f.align,
                    }}
                    className={`rounded border px-1.5 py-0.5 leading-tight transition-colors ${
                      isSel
                        ? 'z-10 border-teal-600 bg-teal-50/90 font-bold text-teal-900 ring-2 ring-teal-500/40'
                        : 'border-slate-400/70 bg-white/85 text-[#0B1F3A] hover:border-teal-500'
                    }`}
                  >
                    {f.key === 'company_logo' && companyLogoDataUrl ? (
                      <img
                        src={companyLogoDataUrl}
                        alt="Company Logo"
                        className="h-10 w-full object-contain"
                      />
                    ) : (
                      f.label
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Field Controls */}
          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 text-xs font-bold text-[#0B1F3A]">Dynamic Fields</div>
              <div className="grid grid-cols-2 gap-1.5">
                {fields.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setSelectedKey(f.key)}
                    className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                      f.key === selectedField?.key
                        ? 'border-teal-600 bg-teal-50 font-bold text-teal-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {f.label} {!f.visible ? '(Hidden)' : ''}
                  </button>
                ))}
              </div>
            </div>

            {selectedField && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#0B1F3A]">{selectedField.label}</span>
                  <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedField.visible}
                      onChange={(e) => updateSelectedField({ visible: e.target.checked })}
                      className="h-4 w-4 accent-teal-600"
                    />
                    Visible
                  </label>
                </div>

                {selectedField.key === 'contact_header_override' && (
                  <p className="rounded-lg border border-teal-100 bg-teal-50/70 px-2.5 py-2 text-[11px] leading-relaxed text-teal-900">
                    Cleanly masks any outdated address or website baked into the uploaded pad and
                    renders {COMPANY_ADDRESS} and {COMPANY_WEBSITE}.
                  </p>
                )}

                {selectedField.key === 'company_logo' && (
                  <p className="rounded-lg border border-teal-100 bg-teal-50/70 px-2.5 py-2 text-[11px] leading-relaxed text-teal-900">
                    Hidden by default to preserve the uploaded pad&apos;s own header. Enable to overlay
                    your saved logo from Settings → Company Branding.
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-slate-500">From Left (X%)</label>
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      max={95}
                      value={selectedField.xPct}
                      onChange={(e) => updateSelectedField({ xPct: Number(e.target.value) })}
                      className="mt-1 h-9 w-full rounded border border-slate-300 px-2 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500">From Top (Y%)</label>
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      max={95}
                      value={selectedField.yPct}
                      onChange={(e) => updateSelectedField({ yPct: Number(e.target.value) })}
                      className="mt-1 h-9 w-full rounded border border-slate-300 px-2 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500">Width (%)</label>
                    <input
                      type="number"
                      min={10}
                      max={95}
                      value={selectedField.widthPct}
                      onChange={(e) => updateSelectedField({ widthPct: Number(e.target.value) })}
                      className="mt-1 h-9 w-full rounded border border-slate-300 px-2 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500">Font Size (px)</label>
                    <input
                      type="number"
                      min={8}
                      max={24}
                      value={selectedField.fontSize}
                      onChange={(e) => updateSelectedField({ fontSize: Number(e.target.value) })}
                      className="mt-1 h-9 w-full rounded border border-slate-300 px-2 font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <select
                    value={selectedField.align}
                    onChange={(e) =>
                      updateSelectedField({ align: e.target.value as 'left' | 'center' | 'right' })
                    }
                    className="h-9 rounded border border-slate-300 bg-white px-2.5 text-xs"
                  >
                    <option value="left">Align Left</option>
                    <option value="center">Align Center</option>
                    <option value="right">Align Right</option>
                  </select>
                  <label className="flex cursor-pointer items-center gap-1.5 font-semibold">
                    <input
                      type="checkbox"
                      checked={selectedField.bold}
                      onChange={(e) => updateSelectedField({ bold: e.target.checked })}
                      className="h-4 w-4 accent-teal-600"
                    />
                    Bold Text
                  </label>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={savingFields}
                onClick={handleSaveFieldPositions}
                className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {savingFields ? 'Saving...' : 'Save Field Positions'}
              </button>
              <button
                type="button"
                onClick={() => setFields(getDefaultPadFields(padType))}
                className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
