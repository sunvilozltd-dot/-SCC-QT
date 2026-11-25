import {
  ComplaintStatus,
  LeadChannel,
  LeadStage,
  OrderRecord,
  OrderStatus,
  PaymentMethod,
  QuotationStatus,
  SettlementStatus,
} from '../types/order';

const BN_TO_EN_MAP: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

const EN_SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function bnToEnDigits(input: string | number): string {
  return String(input ?? '').replace(/[০-৯]/g, (d) => BN_TO_EN_MAP[d] ?? d);
}

/**
 * English-only digit formatter (kept as alias so legacy call sites also render English digits).
 */
export function toBnDigits(input: string | number): string {
  return bnToEnDigits(input);
}

export function roundMoney2(amount: number): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatBdt(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return safe.toLocaleString('en-US');
}

export function formatBdt2(amount: number): string {
  const safe = roundMoney2(amount);
  return safe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function getTodayDhakaIso(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

export function getNowDhakaTimestamp(): string {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function getCurrentDhakaMonth(): string {
  return getTodayDhakaIso().slice(0, 7);
}

export function isValidIsoDate(dateStr: string): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addCalendarDays(isoDateStr: string, days: number): string {
  if (!isValidIsoDate(isoDateStr)) return '';
  const [y, m, d] = isoDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function addCalendarMonths(isoDateStr: string, months: number): string {
  if (!isValidIsoDate(isoDateStr)) return '';
  const [y, m, d] = isoDateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(d, lastDay);
  const yy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Formats ISO date (YYYY-MM-DD) as "24 Nov 2026".
 */
export function formatEnDateShort(isoDateStr: string): string {
  if (!isoDateStr) return '—';
  const clean = isoDateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return isoDateStr;
  const [y, m, d] = clean.split('-').map(Number);
  if (m < 1 || m > 12) return isoDateStr;
  return `${String(d).padStart(2, '0')} ${EN_SHORT_MONTHS[m - 1]} ${y}`;
}

/**
 * Kept as alias to formatEnDateShort so every date across the entire app renders in English.
 */
export function formatBnDate(isoDateStr: string): string {
  return formatEnDateShort(isoDateStr);
}

/**
 * Formats 24-hour time ("10:00" or "14:30") into "10:00 AM" / "2:30 PM".
 */
export function formatTime12h(time24: string): string {
  if (!time24 || !/^\d{1,2}:\d{2}/.test(time24)) return time24 || '';
  const [hStr, mStr] = time24.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time24;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Compatibility alias to formatTime12h so legacy call sites render English 12-hour time.
 */
export function formatTime12hBn(time24: string): string {
  return formatTime12h(time24);
}

export function formatDateEn(isoDateStr: string): string {
  return formatEnDateShort(isoDateStr);
}

/**
 * Formats date and time into "24 Nov 2026, 10:00 AM".
 */
export function formatEnDateTime(isoDateStr: string, time24?: string): string {
  if (!isoDateStr) return '—';
  if (isoDateStr.includes(' ') && !time24) {
    const [dPart, tPart] = isoDateStr.split(' ');
    const formattedDate = formatEnDateShort(dPart);
    const formattedTime = tPart ? formatTime12h(tPart) : '';
    return formattedTime ? `${formattedDate}, ${formattedTime}` : formattedDate;
  }
  const formattedDate = formatEnDateShort(isoDateStr);
  if (!time24) return formattedDate;
  return `${formattedDate}, ${formatTime12h(time24)}`;
}

export function formatDateTimeEn(isoDateStr: string, time24?: string): string {
  return formatEnDateTime(isoDateStr, time24);
}

export function timeToMinutes(time24: string): number | null {
  if (!time24 || !/^\d{1,2}:\d{2}$/.test(time24.trim())) return null;
  const [h, m] = time24.trim().split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function minutesToTime24(totalMins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMins)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function computeEndTime24(startTime24: string, durationMins: number): string {
  const start = timeToMinutes(startTime24);
  if (start === null) return '';
  const dur = Math.max(15, Math.min(720, Math.round(Number(durationMins) || 120)));
  return minutesToTime24(start + dur);
}

/**
 * Converts a non-negative BDT amount (supporting 2 decimal places) into clean English words.
 */
export function numberToEnglishWordsTk(amount: number): string {
  const rounded = roundMoney2(Math.max(0, Number(amount) || 0));
  const whole = Math.floor(rounded);
  const paisa = Math.round((rounded - whole) * 100);
  if (whole === 0 && paisa === 0) return 'Zero Tk Only';

  const ones = [
    '',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  const tens = [
    '',
    '',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety',
  ];

  const under1000 = (num: number): string => {
    const parts: string[] = [];
    if (num >= 100) {
      parts.push(`${ones[Math.floor(num / 100)]} hundred`);
      num %= 100;
    }
    if (num >= 20) {
      const t = tens[Math.floor(num / 10)];
      const o = ones[num % 10];
      parts.push(o ? `${t} ${o}` : t);
    } else if (num > 0) {
      parts.push(ones[num]);
    }
    return parts.join(' ');
  };

  const parts: string[] = [];
  let rem = whole;
  const crore = Math.floor(rem / 10000000);
  if (crore > 0) {
    parts.push(`${under1000(crore)} crore`);
    rem %= 10000000;
  }
  const lakh = Math.floor(rem / 100000);
  if (lakh > 0) {
    parts.push(`${under1000(lakh)} lakh`);
    rem %= 100000;
  }
  const thousand = Math.floor(rem / 1000);
  if (thousand > 0) {
    parts.push(`${under1000(thousand)} thousand`);
    rem %= 1000;
  }
  if (rem > 0) {
    parts.push(under1000(rem));
  }

  const wholeSentence = parts.join(' ').trim() || 'zero';
  const capitalizedWhole = wholeSentence.charAt(0).toUpperCase() + wholeSentence.slice(1);
  if (paisa > 0) {
    const paisaWords = under1000(paisa);
    return `${capitalizedWhole} Tk and ${paisaWords} paisa Only`;
  }
  return `${capitalizedWhole} Tk Only`;
}

export interface NormalizedPhone {
  display: string;
  e164: string;
  whatsapp: string;
}

export function normalizeBangladeshPhone(raw: string): NormalizedPhone | null {
  const cleaned = bnToEnDigits(raw).replace(/[\s\-().]/g, '');
  let local = '';
  if (/^\+8801[3-9]\d{8}$/.test(cleaned)) {
    local = cleaned.slice(3);
  } else if (/^8801[3-9]\d{8}$/.test(cleaned)) {
    local = cleaned.slice(2);
  } else if (/^01[3-9]\d{8}$/.test(cleaned)) {
    local = cleaned;
  } else {
    return null;
  }

  return {
    display: local,
    e164: `+88${local}`,
    whatsapp: `88${local}`,
  };
}

export function normalizeOptionalContactPhone(raw: string): { display: string; e164: string } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { display: '', e164: '' };
  const bd = normalizeBangladeshPhone(trimmed);
  if (bd) {
    return { display: bd.display, e164: bd.e164 };
  }
  const cleaned = bnToEnDigits(trimmed).replace(/[\s\-().]/g, '');
  if (!/^\+?\d{6,15}$/.test(cleaned)) {
    throw new Error('Please enter a valid mobile number (e.g., 017XXXXXXXX, keeping leading zero).');
  }
  return {
    display: cleaned,
    e164: cleaned.startsWith('+') ? cleaned : cleaned.startsWith('01') ? `+88${cleaned}` : cleaned,
  };
}

export function extractWhatsAppDigits(phoneE164: string, phoneDisplay: string): string {
  let digits = bnToEnDigits(String(phoneE164 || phoneDisplay || '')).replace(/\D/g, '');
  if (digits.startsWith('01') && digits.length === 11) {
    digits = `88${digits}`;
  }
  return digits.length >= 10 ? digits : '';
}

export function buildTelLink(phoneE164: string, phoneDisplay: string): string {
  const num =
    phoneE164 ||
    (phoneDisplay ? (phoneDisplay.startsWith('01') ? `+88${phoneDisplay}` : phoneDisplay) : '');
  return `tel:${encodeURIComponent(num)}`;
}

export function buildDirectWhatsAppUrl(
  phoneE164: string,
  phoneDisplay: string,
  message: string
): string | null {
  const digits = extractWhatsAppDigits(phoneE164, phoneDisplay);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  return buildDirectWhatsAppUrl(phone, phone, message) || '';
}

export function buildWhatsAppLink(
  order: Pick<OrderRecord, 'phone_e164' | 'phone_display' | 'customer_name' | 'order_id' | 'services_text'>
): string {
  const digits = extractWhatsAppDigits(order.phone_e164, order.phone_display);
  const msg = `Hello ${order.customer_name}, this is SUNVILOZ Clean Care regarding your order ${order.order_id} (${translateServiceToEnglish(order.services_text)}).`;
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(msg)}` : '#';
}

export function buildLeadWhatsAppLink(lead: {
  phone_e164: string;
  phone_display: string;
  name: string;
  interested_services?: string | string[];
  interested_services_text?: string;
}): string {
  const digits = extractWhatsAppDigits(lead.phone_e164, lead.phone_display);
  const servicesLabel =
    lead.interested_services_text ||
    (Array.isArray(lead.interested_services)
      ? lead.interested_services.join(', ')
      : lead.interested_services || '');
  const svcText = servicesLabel ? ` (${translateServiceToEnglish(servicesLabel)})` : '';
  const msg = `Hello ${lead.name}, greetings from SUNVILOZ Clean Care. We are following up regarding your water tank & pipeline cleaning inquiry${svcText}.`;
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(msg)}` : '#';
}

export function buildContactWhatsAppLink(params: {
  phone_e164: string;
  phone_display: string;
  contactName: string;
  roleLabel: string;
  prospectName: string;
  buildingOrg?: string;
}): string {
  const digits = extractWhatsAppDigits(params.phone_e164, params.phone_display);
  const greetingName = params.contactName.trim() || params.roleLabel;
  const refTarget = [params.prospectName, params.buildingOrg].filter(Boolean).join(' - ');
  const msg = `Hello ${greetingName}, this is SUNVILOZ Clean Care contacting you regarding water tank & pipeline cleaning service for ${refTarget}.`;
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(msg)}` : '#';
}

export function containsBanglaScript(text: string): boolean {
  return /[\u0980-\u09FF]/.test(String(text || ''));
}

export function validateSafeExternalUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

// ============================================================================
// LEGACY BENGALI -> CANONICAL ENGLISH NORMALIZERS (100% Data Preservation)
// ============================================================================

export function normalizeOrderStatus(raw: string): OrderStatus {
  const v = String(raw || '').trim();
  const map: Record<string, OrderStatus> = {
    'নতুন': 'New',
    'নিশ্চিত': 'Confirmed',
    'কাজ চলছে': 'In Progress',
    'সম্পন্ন': 'Completed',
    'বাতিল': 'Cancelled',
    New: 'New',
    Confirmed: 'Confirmed',
    'In Progress': 'In Progress',
    Completed: 'Completed',
    Cancelled: 'Cancelled',
  };
  return map[v] || 'New';
}

export function normalizeQuotationStatus(raw: string): QuotationStatus {
  const v = String(raw || '').trim();
  const map: Record<string, QuotationStatus> = {
    'খসড়া': 'Draft',
    'পাঠানো': 'Sent',
    'পাঠানো হয়েছে': 'Sent',
    'গৃহীত': 'Accepted',
    'বাতিল': 'Cancelled',
    Draft: 'Draft',
    Sent: 'Sent',
    Accepted: 'Accepted',
    Cancelled: 'Cancelled',
  };
  return map[v] || 'Draft';
}

export function normalizeSettlementStatus(raw: string): SettlementStatus {
  const v = String(raw || '').trim();
  const map: Record<string, SettlementStatus> = {
    'প্রযোজ্য নয়': 'Not Applicable',
    'হিসাব বাকি': 'Pending',
    'হিসাব মিটেছে': 'Settled',
    'হিসাব সমান': 'Balanced',
    'Not Applicable': 'Not Applicable',
    Pending: 'Pending',
    Settled: 'Settled',
    Balanced: 'Balanced',
  };
  return map[v] || 'Not Applicable';
}

export function normalizeLeadStage(raw: string): LeadStage {
  const v = String(raw || '').trim();
  const map: Record<string, LeadStage> = {
    'নতুন': 'New',
    'যোগাযোগ হয়েছে': 'Contacted',
    'কোটেশন পাঠানো হয়েছে': 'Quotation Sent',
    'কাজ নিশ্চিত': 'Confirmed',
    'আগ্রহী নন': 'Not Interested',
    New: 'New',
    Contacted: 'Contacted',
    'Quotation Sent': 'Quotation Sent',
    Confirmed: 'Confirmed',
    'Not Interested': 'Not Interested',
  };
  return map[v] || 'New';
}

export function normalizeLeadChannel(raw: string): LeadChannel {
  const v = String(raw || '').trim();
  const map: Record<string, LeadChannel> = {
    'কল': 'Call',
    WhatsApp: 'WhatsApp',
    'সরাসরি ভিজিট': 'Site Visit',
    'অন্যান্য': 'Other',
    Call: 'Call',
    'Site Visit': 'Site Visit',
    Other: 'Other',
  };
  return map[v] || 'Call';
}

export function normalizeLeadSource(raw: string): string {
  const v = String(raw || '').trim();
  if (!v) return 'Not Specified';
  const map: Record<string, string> = {
    'ফেসবুক / অনলাইন': 'Facebook',
    'ফেসবুক': 'Facebook',
    Facebook: 'Facebook',
    Google: 'Google',
    'পূর্বের গ্রাহক': 'Existing Customer',
    'Existing Customer': 'Existing Customer',
    'রেফারেল (পরিচিতজন)': 'Agent Referral',
    'এজেন্ট রেফারেল': 'Agent Referral',
    'Agent Referral': 'Agent Referral',
    'ভবন ম্যানেজার / কেয়ারটেকার': 'Caretaker Referral',
    'দারোয়ান রেফারেল': 'Caretaker Referral',
    'Caretaker Referral': 'Caretaker Referral',
    'সরাসরি ফোন কল': 'Other',
    'ফোন কল': 'Other',
    'অন্যান্য': 'Other',
    Other: 'Other',
    'উৎস উল্লেখ নেই': 'Not Specified',
    'Not Specified': 'Not Specified',
  };
  return map[v] || v;
}

export function normalizeComplaintStatus(raw: string): ComplaintStatus {
  const v = String(raw || '').trim();
  const map: Record<string, ComplaintStatus> = {
    Open: 'Open',
    'Return Visit Scheduled': 'Return Visit Scheduled',
    Resolved: 'Resolved',
  };
  return map[v] || 'Open';
}

export function normalizeExpenseCategory(raw: string): string {
  const v = String(raw || '').trim();
  const map: Record<string, string> = {
    'বিজ্ঞাপন': 'Advertising',
    'মার্কেটিং / বিজ্ঞাপন': 'Advertising',
    Advertising: 'Advertising',
    'যন্ত্রপাতি মেরামত': 'Equipment Repair',
    'মেশিন / যন্ত্রপাতি': 'Equipment Repair',
    'Equipment Repair': 'Equipment Repair',
    'ফোন বিল': 'Phone Bills',
    'Phone Bills': 'Phone Bills',
    'অফিস খরচ': 'Office Expenses',
    'অফিস ভাড়া': 'Office Expenses',
    'অফিস / স্টাফ': 'Office Expenses',
    'Office Expenses': 'Office Expenses',
    'অন্যান্য': 'Other',
    Other: 'Other',
  };
  return map[v] || (containsBanglaScript(v) ? 'Other' : v || 'Other');
}

export function translateServiceToEnglish(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const directMap: Record<string, string> = {
    'ওভারহেড ট্যাংক পরিষ্কার': 'Overhead Tank Cleaning',
    'ওভারহেড ট্যাংক': 'Overhead Tank Cleaning',
    'রিজার্ভ ট্যাংক পরিষ্কার': 'Reserve Tank Cleaning',
    'রিজার্ভ ট্যাংক': 'Reserve Tank Cleaning',
    'আন্ডারগ্রাউন্ড রিজার্ভ ট্যাংক': 'Reserve Tank Cleaning',
    'পানির পাইপলাইন পরিষ্কার': 'Pipeline Cleaning',
    'পাইপলাইন পরিষ্কার': 'Pipeline Cleaning',
    'পাইপলাইন': 'Pipeline Cleaning',
    'পানির ট্যাংক পরিষ্কার': 'Overhead & Reserve Tank Cleaning',
  };
  if (directMap[trimmed]) return directMap[trimmed];

  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((part) => {
        const p = part.trim();
        return directMap[p] || bnToEnDigits(p);
      })
      .filter(Boolean)
      .join(', ');
  }

  return bnToEnDigits(trimmed);
}

export function translatePaymentMethodToEnglish(method: string): PaymentMethod {
  const m = String(method || '').trim();
  const map: Record<string, PaymentMethod> = {
    'নগদ (Cash)': 'Cash',
    Cash: 'Cash',
    'বিকাশ (bKash)': 'bKash',
    bKash: 'bKash',
    'নগদ (Nagad)': 'Nagad',
    Nagad: 'Nagad',
    'ব্যাংক ট্রান্সফার': 'Bank Transfer',
    'Bank Transfer': 'Bank Transfer',
    'চেক': 'Cheque',
    Cheque: 'Cheque',
  };
  if (map[m]) return map[m];
  const parenMatch = m.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1]) {
    const inner = parenMatch[1].trim();
    if (map[inner]) return map[inner];
  }
  return 'Cash';
}

export function normalizeSearchText(str: string): string {
  return bnToEnDigits(str).toLowerCase().trim();
}
