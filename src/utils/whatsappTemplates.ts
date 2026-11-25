import {
  formatBdt,
  formatEnDateShort,
  formatEnDateTime,
  translateServiceToEnglish,
  validateSafeExternalUrl,
} from './dateAndPhone';

export type WhatsAppTemplateType =
  | 'booking_confirmed'
  | 'tomorrow_job'
  | 'send_quotation'
  | 'repeat_cleaning_due';

export interface WhatsAppDraftContext {
  template: WhatsAppTemplateType;
  customerName: string;
  phoneDisplay: string;
  phoneE164: string;
  service: string;
  dateIso?: string;
  time24?: string;
  orderId?: string;
  quotationId?: string;
  amountBdt?: number;
  quotationShareUrl?: string;
  address?: string;
}

export const WHATSAPP_TEMPLATE_LABELS: Record<WhatsAppTemplateType, string> = {
  booking_confirmed: 'Booking Confirmed',
  tomorrow_job: "Tomorrow's Job Reminder",
  send_quotation: 'Send Quotation',
  repeat_cleaning_due: 'Time to Clean Again',
};

export function generateWhatsAppDraft(ctx: WhatsAppDraftContext): string {
  const name = ctx.customerName?.trim() || 'Valued Customer';
  const service = translateServiceToEnglish(ctx.service || 'Water Tank Cleaning Service');
  const dateTimeLabel = ctx.dateIso
    ? formatEnDateTime(ctx.dateIso, ctx.time24)
    : 'your scheduled appointment';

  switch (ctx.template) {
    case 'booking_confirmed':
      return [
        `Hello ${name},`,
        `Your booking with SUNVILOZ Clean Care is confirmed!`,
        `Order Ref: ${ctx.orderId || 'Confirmed Booking'}`,
        `Service: ${service}`,
        `Scheduled Work Date & Time: ${dateTimeLabel}`,
        ctx.address ? `Address: ${ctx.address}` : '',
        ctx.amountBdt ? `Agreed Bill: BDT ${formatBdt(ctx.amountBdt)}` : '',
        `Our trained team will arrive on time. For any assistance, call 09649112288.`,
        `Thank you — SUNVILOZ Clean Care`,
      ]
        .filter(Boolean)
        .join('\n');

    case 'tomorrow_job':
      return [
        `Hello ${name},`,
        `Friendly reminder from SUNVILOZ Clean Care regarding your scheduled service tomorrow.`,
        `Order Ref: ${ctx.orderId || 'Scheduled Job'}`,
        `Service: ${service}`,
        `Date & Time: ${dateTimeLabel}`,
        ctx.address ? `Address: ${ctx.address}` : '',
        `Please ensure tank access and water/electricity availability. Call 09649112288 if you need to adjust the timing.`,
        `Thank you — SUNVILOZ Clean Care`,
      ]
        .filter(Boolean)
        .join('\n');

    case 'send_quotation': {
      const safeLink = validateSafeExternalUrl(ctx.quotationShareUrl || '');
      return [
        `Hello ${name},`,
        `Greetings from SUNVILOZ Clean Care!`,
        `Please find our quotation (${ctx.quotationId || 'Quotation'}) for ${service}.`,
        ctx.dateIso ? `Quotation Date: ${formatEnDateShort(ctx.dateIso)}` : '',
        ctx.amountBdt ? `Grand Total: BDT ${formatBdt(ctx.amountBdt)}/-` : '',
        safeLink ? `View Quotation: ${safeLink}` : '',
        `We follow WHO-suggested disinfection procedures with modern equipment. Please let us know when you would like to schedule the work.`,
        `Best regards,\nSUNVILOZ Clean Care | 09649112288`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    case 'repeat_cleaning_due':
      return [
        `Hello ${name},`,
        `Greetings from SUNVILOZ Clean Care!`,
        `It is time for your periodic ${service} to keep your building's water clean and hygienic.`,
        ctx.dateIso ? `Recommended Service Date: ${formatEnDateShort(ctx.dateIso)}` : '',
        ctx.address ? `Location: ${ctx.address}` : '',
        `Reply to this message or call 09649112288 to confirm a convenient date and time.`,
        `Thank you — SUNVILOZ Clean Care`,
      ]
        .filter(Boolean)
        .join('\n');
  }
}
