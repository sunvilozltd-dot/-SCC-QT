import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, MessageCircle, X, Check } from 'lucide-react';
import { buildWhatsAppUrl, normalizeBangladeshPhone } from '../utils/dateAndPhone';
import { WhatsAppTemplateType } from '../utils/whatsappTemplates';

export interface WhatsAppPreviewRequest {
  templateType: WhatsAppTemplateType;
  recipientName: string;
  phone: string;
  initialMessage: string;
  contextLabel?: string;
}

interface WhatsAppPreviewModalProps {
  request: WhatsAppPreviewRequest | null;
  onClose: () => void;
}

const TEMPLATE_TITLES: Record<WhatsAppTemplateType, string> = {
  booking_confirmed: 'Booking Confirmed Message',
  tomorrow_job: "Tomorrow's Job Reminder",
  send_quotation: 'Send Quotation Message',
  repeat_cleaning_due: 'Time to Clean Again Reminder',
};

export const WhatsAppPreviewModal: React.FC<WhatsAppPreviewModalProps> = ({
  request,
  onClose,
}) => {
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (request) {
      setMessage(request.initialMessage);
      setCopied(false);
    }
  }, [request]);

  if (!request) return null;

  const normalized = normalizeBangladeshPhone(request.phone);
  const waUrl = normalized ? buildWhatsAppUrl(normalized.e164, message) : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0b1f3a]">
                {TEMPLATE_TITLES[request.templateType]}
              </h3>
              <p className="text-xs text-slate-500">
                {request.recipientName}
                {request.contextLabel ? ` · ${request.contextLabel}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {!normalized ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
              No valid Bangladesh mobile number is saved for this customer ({request.phone || 'empty'}).
              Add a valid number (e.g., 017XXXXXXXX) to open WhatsApp directly, or copy the text below.
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
              <span className="text-slate-500">WhatsApp Recipient</span>
              <span className="font-mono font-semibold text-[#0b1f3a]">
                {normalized.display} ({normalized.e164})
              </span>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Message Preview (Editable before sending)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={9}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3.5 rounded-b-2xl">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy Message'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            {waUrl ? (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" />
                Open in WhatsApp
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-slate-200 px-4 py-2 text-xs font-semibold text-slate-500"
              >
                Valid Phone Required
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
