import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Globe,
  Languages,
  Mail,
  MapPin,
  Phone,
  Printer,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  DocumentPadConfig,
  MoneyReceiptRecord,
  PadFieldConfig,
  QuotationItem,
  QuotationRecord,
  SERVICE_PACKAGE_INCLUSIONS,
} from '../types/order';
import {
  COMPANY_ADDRESS,
  COMPANY_EMAIL,
  COMPANY_NAME,
  COMPANY_PHONE,
  COMPANY_WEBSITE,
  FIXED_QUOTATION_FINANCIAL_HEADING,
  FIXED_QUOTATION_INTRO,
  FIXED_QUOTATION_STEPS,
  FIXED_QUOTATION_STEPS_HEADING,
  FIXED_QUOTATION_SUBJECT,
  computeQuotationTotals,
} from '../utils/companyConstants';
import {
  bnToEnDigits,
  containsBanglaScript,
  formatBdt2,
  formatEnDateShort,
  numberToEnglishWordsTk,
  roundMoney2,
  translatePaymentMethodToEnglish,
  translateServiceToEnglish,
} from '../utils/dateAndPhone';
import { exportA4ElementsToPdf, shareDocumentPdf } from '../utils/pdfExport';

interface DocumentPreviewModalProps {
  open: boolean;
  type: 'quotation' | 'receipt';
  quotation?: QuotationRecord | null;
  receipt?: MoneyReceiptRecord | null;
  fallbackPad: DocumentPadConfig | null;
  companyLogoDataUrl?: string;
  onArchivePdf?: (payload: {
    doc_type: 'quotation' | 'receipt';
    doc_id: string;
    file_name: string;
    pdf_base64: string;
  }) => Promise<void>;
  onClose: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

const ROWS_PER_EXTRA_PAGE = 14;

/**
 * Crisp SVG circular company stamp matching the official SUNVILOZ Clean Care seal
 * with the exact updated company address along the bottom arc (zero outdated pixels).
 */
function OfficialStampSvg({ size = 114 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 220 220"
      role="img"
      aria-label="SUNVILOZ Clean Care Official Stamp"
      className="shrink-0 select-none"
    >
      <defs>
        <path id="sunviloz-stamp-top" d="M 32,110 A 78,78 0 1,1 188,110" />
        <path id="sunviloz-stamp-bottom" d="M 24,114 A 86,86 0 0,0 196,114" />
      </defs>
      <circle cx="110" cy="110" r="102" fill="none" stroke="#1E3A6D" strokeWidth="3.2" />
      <circle cx="110" cy="110" r="95" fill="none" stroke="#1E3A6D" strokeWidth="1.2" />
      <circle cx="110" cy="110" r="66" fill="none" stroke="#1E3A6D" strokeWidth="1.6" />

      <text
        fill="#1E3A6D"
        fontSize="14.5"
        fontWeight="700"
        letterSpacing="1.6"
        fontFamily="Arial, sans-serif"
      >
        <textPath href="#sunviloz-stamp-top" startOffset="50%" textAnchor="middle">
          SUNVILOZ CLEAN CARE
        </textPath>
      </text>

      <text
        fill="#1E3A6D"
        fontSize="6.7"
        fontWeight="700"
        letterSpacing="0.45"
        fontFamily="Arial, sans-serif"
      >
        <textPath href="#sunviloz-stamp-bottom" startOffset="50%" textAnchor="middle">
          HOUSE:30, ROAD: 1/D, NIKUNJA-02, KHILKHET,DHAKA-1229
        </textPath>
      </text>

      {/* Side Stars */}
      <text x="27" y="114" fill="#1E3A6D" fontSize="11" textAnchor="middle">
        ★
      </text>
      <text x="193" y="114" fill="#1E3A6D" fontSize="11" textAnchor="middle">
        ★
      </text>

      {/* Center Mark */}
      <g transform="translate(86, 56)">
        <polygon points="22,4 2,34 28,34 22,26 12,26 24,10" fill="#1E3A6D" />
        <polygon points="34,4 24,20 29,26 42,6" fill="#EA7A0E" />
      </g>

      <line x1="56" y1="98" x2="164" y2="98" stroke="#1E3A6D" strokeWidth="1" />
      <text
        x="110"
        y="108"
        fill="#1E3A6D"
        fontSize="7.8"
        fontWeight="700"
        letterSpacing="0.8"
        textAnchor="middle"
        fontFamily="Arial, sans-serif"
      >
        AUTHORIZED SIGNATURE
      </text>
      <line x1="56" y1="113" x2="164" y2="113" stroke="#1E3A6D" strokeWidth="1" />

      {/* Stylized Authorized Signature Flourish */}
      <path
        d="M 73,144 C 82,126 92,124 94,138 C 96,149 106,120 114,132 C 120,141 128,125 136,134 C 141,139 147,131 151,136"
        fill="none"
        stroke="#1E3A6D"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 76,151 C 98,147 126,145 148,149"
        fill="none"
        stroke="#1E3A6D"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <text
        x="110"
        y="164"
        fill="#1E3A6D"
        fontSize="8"
        fontWeight="700"
        textAnchor="middle"
        fontFamily="Arial, sans-serif"
      >
        Managing Director
      </text>
    </svg>
  );
}

/**
 * Reusable exact company contact block with orange circular icon badges.
 * Masks out any outdated contact lines on letterheads/uploaded pads cleanly.
 */
function UpdatedContactHeaderBlock({ compact = false }: { compact?: boolean }) {
  const rowGap = compact ? 'gap-1.5' : 'gap-2';
  const textSize = compact ? '10.5px' : '11.4px';
  const iconWrap = compact ? 'h-[19px] w-[19px]' : 'h-[22px] w-[22px]';
  const iconSize = compact ? 'h-2.5 w-2.5' : 'h-3 w-3';

  return (
    <div
      className="flex h-full w-full flex-col justify-center bg-white px-2.5 py-1.5 text-[#18181B]"
      style={{
        fontFamily: '"Arial", "Plus Jakarta Sans", sans-serif',
        fontSize: textSize,
        lineHeight: 1.32,
      }}
    >
      <div className={`flex items-start ${rowGap} mb-1.5`}>
        <span
          className={`mt-0.5 inline-flex ${iconWrap} shrink-0 items-center justify-center rounded-full bg-[#EA7A0E] text-white`}
        >
          <MapPin className={iconSize} />
        </span>
        <span className="font-semibold tracking-[0.01em] text-[#18181B]">{COMPANY_ADDRESS}</span>
      </div>
      <div className={`flex items-center ${rowGap} mb-1.5`}>
        <span
          className={`inline-flex ${iconWrap} shrink-0 items-center justify-center rounded-full bg-[#EA7A0E] text-white`}
        >
          <Phone className={iconSize} />
        </span>
        <span className="font-semibold text-[#18181B]">{COMPANY_PHONE}</span>
      </div>
      <div className={`flex items-center ${rowGap} mb-1.5`}>
        <span
          className={`inline-flex ${iconWrap} shrink-0 items-center justify-center rounded-full bg-[#EA7A0E] text-white`}
        >
          <Mail className={iconSize} />
        </span>
        <span className="font-semibold text-[#18181B]">{COMPANY_EMAIL}</span>
      </div>
      <div className={`flex items-center ${rowGap}`}>
        <span
          className={`inline-flex ${iconWrap} shrink-0 items-center justify-center rounded-full bg-[#EA7A0E] text-white`}
        >
          <Globe className={iconSize} />
        </span>
        <span className="font-semibold text-[#18181B]">{COMPANY_WEBSITE}</span>
      </div>
    </div>
  );
}

export function DocumentPreviewModal({
  open,
  type,
  quotation,
  receipt,
  fallbackPad,
  companyLogoDataUrl,
  onArchivePdf,
  onClose,
  onNotify,
}: DocumentPreviewModalProps) {
  const pagesContainerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'pdf' | 'share' | null>(null);

  // Admin English Spelling Review / Confirmation overrides (non-destructive, per preview/export)
  const [englishPanelOpen, setEnglishPanelOpen] = useState(false);
  const [enCustomerName, setEnCustomerName] = useState('');
  const [enAddress, setEnAddress] = useState('');
  const [enArea, setEnArea] = useState('');
  const [enServicesText, setEnServicesText] = useState('');
  const [enItemServices, setEnItemServices] = useState<string[]>([]);
  const [enNotes, setEnNotes] = useState('');
  const [enReceivedBy, setEnReceivedBy] = useState('');

  useEffect(() => {
    if (!open) return;

    if (type === 'quotation' && quotation) {
      const initName = bnToEnDigits(quotation.customer_name || '');
      const initAddr = bnToEnDigits(quotation.address || '');
      const initArea = bnToEnDigits(quotation.area || '');
      const initNotes = bnToEnDigits(quotation.notes || '');
      const initItems = (quotation.items || []).map((it) =>
        translateServiceToEnglish(it.service || '')
      );

      setEnCustomerName(initName);
      setEnAddress(initAddr);
      setEnArea(initArea);
      setEnNotes(initNotes);
      setEnItemServices(initItems);
      setEnServicesText('');
      setEnReceivedBy('');

      const needsReview =
        containsBanglaScript(initName) ||
        containsBanglaScript(initAddr) ||
        containsBanglaScript(initArea) ||
        initItems.some((s) => containsBanglaScript(s));
      setEnglishPanelOpen(needsReview);
    } else if (type === 'receipt' && receipt) {
      const initName = bnToEnDigits(receipt.customer_name || '');
      const initAddr = bnToEnDigits(receipt.address || '');
      const initServices = translateServiceToEnglish(receipt.services_text || '');
      const initNotes = bnToEnDigits(receipt.notes || '');
      const rawRecBy = bnToEnDigits(receipt.received_by || COMPANY_NAME);
      const initRecBy = containsBanglaScript(rawRecBy) ? COMPANY_NAME : rawRecBy;

      setEnCustomerName(initName);
      setEnAddress(initAddr);
      setEnArea('');
      setEnServicesText(initServices);
      setEnNotes(initNotes);
      setEnReceivedBy(initRecBy);
      setEnItemServices([]);

      const needsReview =
        containsBanglaScript(initName) ||
        containsBanglaScript(initAddr) ||
        containsBanglaScript(initServices) ||
        containsBanglaScript(initNotes);
      setEnglishPanelOpen(needsReview);
    }
  }, [open, type, quotation?.quotation_id, receipt?.receipt_id, quotation, receipt]);

  const effectiveQuotation = useMemo<QuotationRecord | null>(() => {
    if (type !== 'quotation' || !quotation) return null;
    const normalizedItems: QuotationItem[] = (quotation.items || []).map((it, idx) => {
      const qty = Math.max(0, Number(it.quantity) || 0);
      const rate = Math.max(0, Number(it.rate_bdt) || 0);
      const amount =
        rate > 0 ? roundMoney2(qty * rate) : roundMoney2(Math.max(0, Number(it.amount_bdt) || 0));
      return {
        ...it,
        service: enItemServices[idx] ?? translateServiceToEnglish(it.service),
        size: bnToEnDigits(it.size || ''),
        unit_label: bnToEnDigits(it.unit_label || ''),
        description: bnToEnDigits(it.description || ''),
        quantity: qty,
        rate_bdt: rate,
        amount_bdt: amount,
      };
    });

    const discountEnabled = Boolean(quotation.discount_enabled);
    const vatEnabled = Boolean(quotation.vat_enabled);
    const taxEnabled = Boolean(quotation.tax_enabled);
    const computed = computeQuotationTotals({
      items: normalizedItems,
      discount_enabled: discountEnabled,
      discount_type: quotation.discount_type || 'amount',
      discount_value: discountEnabled ? Number(quotation.discount_value || quotation.discount_bdt || 0) : 0,
      vat_enabled: vatEnabled,
      vat_type: quotation.vat_type || 'percent',
      vat_value: vatEnabled ? Number(quotation.vat_value || 0) : 0,
      vat_base: quotation.vat_base || 'after_discount',
      tax_enabled: taxEnabled,
      tax_type: quotation.tax_type || 'percent',
      tax_value: taxEnabled ? Number(quotation.tax_value || 0) : 0,
      tax_base: quotation.tax_base || 'after_discount',
    });

    return {
      ...quotation,
      customer_name: enCustomerName || quotation.customer_name,
      address: enAddress || quotation.address,
      area: enArea,
      notes: enNotes,
      items: normalizedItems,
      subtotal_bdt: computed.subtotal_bdt,
      discount_enabled: discountEnabled,
      discount_bdt: computed.discount_bdt,
      vat_enabled: vatEnabled,
      vat_bdt: computed.vat_bdt,
      tax_enabled: taxEnabled,
      tax_bdt: computed.tax_bdt,
      total_bdt: computed.total_bdt,
    };
  }, [type, quotation, enCustomerName, enAddress, enArea, enNotes, enItemServices]);

  const effectiveReceipt = useMemo<MoneyReceiptRecord | null>(() => {
    if (type !== 'receipt' || !receipt) return null;
    return {
      ...receipt,
      customer_name: enCustomerName || receipt.customer_name,
      address: enAddress || receipt.address,
      services_text: enServicesText || translateServiceToEnglish(receipt.services_text),
      notes: enNotes,
      received_by: enReceivedBy || COMPANY_NAME,
      payment_method: translatePaymentMethodToEnglish(
        receipt.payment_method
      ) as MoneyReceiptRecord['payment_method'],
      transaction_ref: bnToEnDigits(receipt.transaction_ref || ''),
    };
  }, [type, receipt, enCustomerName, enAddress, enServicesText, enNotes, enReceivedBy]);

  const hasRemainingBangla = useMemo(() => {
    if (type === 'quotation' && effectiveQuotation) {
      return (
        containsBanglaScript(effectiveQuotation.customer_name) ||
        containsBanglaScript(effectiveQuotation.address) ||
        containsBanglaScript(effectiveQuotation.area) ||
        effectiveQuotation.items.some(
          (it) =>
            containsBanglaScript(it.service) ||
            containsBanglaScript(it.description) ||
            containsBanglaScript(it.unit_label || '')
        )
      );
    }
    if (type === 'receipt' && effectiveReceipt) {
      return (
        containsBanglaScript(effectiveReceipt.customer_name) ||
        containsBanglaScript(effectiveReceipt.address) ||
        containsBanglaScript(effectiveReceipt.services_text) ||
        containsBanglaScript(effectiveReceipt.notes) ||
        containsBanglaScript(effectiveReceipt.received_by)
      );
    }
    return false;
  }, [type, effectiveQuotation, effectiveReceipt]);

  // Smart pagination so extra service rows, optional Discount/VAT/Tax rows, and Terms never overlap footer
  const quotationPages = useMemo<QuotationItem[][]>(() => {
    if (type !== 'quotation' || !effectiveQuotation) return [];
    const items = effectiveQuotation.items || [];
    const optionalSummaryCount =
      (effectiveQuotation.discount_enabled ? 1 : 0) +
      (effectiveQuotation.vat_enabled ? 1 : 0) +
      (effectiveQuotation.tax_enabled ? 1 : 0);
    const termsLines =
      effectiveQuotation.terms && !containsBanglaScript(effectiveQuotation.terms)
        ? effectiveQuotation.terms.trim().split('\n').filter(Boolean).length
        : 0;

    // Single-page capacity (with totals + terms + signature block cleanly above footer)
    const singlePageMax = Math.max(
      2,
      5 - Math.max(0, optionalSummaryCount - 1) - (termsLines >= 3 ? 1 : 0)
    );
    if (items.length <= singlePageMax) {
      return [items];
    }

    // Multi-page: Page 1 holds up to 7 service rows (no totals/signature on Page 1),
    // remaining rows + totals + terms + signature flow onto Page 2+ cleanly.
    const firstPageSplit = Math.min(items.length, 7);
    const chunks: QuotationItem[][] = [items.slice(0, firstPageSplit)];
    let idx = firstPageSplit;
    while (idx < items.length) {
      chunks.push(items.slice(idx, idx + ROWS_PER_EXTRA_PAGE));
      idx += ROWS_PER_EXTRA_PAGE;
    }

    // If the final page has too many rows to also fit totals + terms + signature cleanly,
    // push an empty continuation page for the summary/terms/signature block.
    const lastChunk = chunks[chunks.length - 1];
    const maxLastPageRows = Math.max(6, 10 - optionalSummaryCount - (termsLines >= 3 ? 2 : 0));
    if (chunks.length === 1 || lastChunk.length > maxLastPageRows) {
      chunks.push([]);
    }
    return chunks;
  }, [type, effectiveQuotation]);

  if (!open) return null;
  if (type === 'quotation' && !effectiveQuotation) return null;
  if (type === 'receipt' && !effectiveReceipt) return null;

  const activePad =
    type === 'quotation'
      ? quotation?.pad_snapshot || fallbackPad
      : receipt?.pad_snapshot || fallbackPad;

  const docId = type === 'quotation' ? effectiveQuotation!.quotation_id : effectiveReceipt!.receipt_id;
  const filename = `${docId}.pdf`;

  const getPageNodes = (): HTMLElement[] => {
    if (!pagesContainerRef.current) return [];
    return Array.from(
      pagesContainerRef.current.querySelectorAll<HTMLElement>('[data-a4-page="true"]')
    );
  };

  const handleDownloadPdf = async () => {
    setBusy('pdf');
    try {
      const nodes = getPageNodes();
      const { base64 } = await exportA4ElementsToPdf(nodes, filename);
      if (onArchivePdf && base64) {
        onArchivePdf({
          doc_type: type,
          doc_id: docId,
          file_name: filename,
          pdf_base64: base64,
        }).catch(() => {
          // Non-blocking archive failure should not break user's PDF download
        });
      }
      onNotify(`PDF downloaded and archived (${filename}).`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to generate PDF.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    setBusy('share');
    try {
      const nodes = getPageNodes();
      const summary =
        type === 'quotation'
          ? `${COMPANY_NAME} Quotation (${effectiveQuotation!.quotation_id})\nCustomer: ${effectiveQuotation!.customer_name}\nGrand Total: BDT ${formatBdt2(effectiveQuotation!.total_bdt)}/-\nDate: ${formatEnDateShort(effectiveQuotation!.quotation_date)}`
          : `${COMPANY_NAME} Money Receipt (${effectiveReceipt!.receipt_id})\nOrder: ${effectiveReceipt!.order_id}\nCustomer: ${effectiveReceipt!.customer_name}\nAmount Received: BDT ${formatBdt2(effectiveReceipt!.amount_received)}/- (${effectiveReceipt!.payment_method})`;

      const res = await shareDocumentPdf(
        nodes,
        filename,
        `${COMPANY_NAME} — ${docId}`,
        summary
      );
      if (res === 'copied') {
        onNotify('Document summary copied to clipboard.', 'success');
      } else {
        onNotify('Document share dialog opened.', 'success');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to share document.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  /**
   * Financial Offer Table matched to uploaded SUNVILOZ sample:
   * - Sage green header (#A9D08E) repeated on continuation pages
   * - 6 columns: SL | Description | Size | Quantity | Rate/CFT | Price
   * - Peach-orange totals block (#F4B084): Subtotal, optional Discount/VAT/Tax (ONLY when checked), Grand Total
   * - White bordered "In words: ..." footer row
   * - Consistent 2-decimal BDT precision
   */
  const renderOfficialFinancialTable = (
    q: QuotationRecord,
    pageItems: QuotationItem[],
    pageIdx: number,
    totalPages: number,
    isLastPage: boolean
  ) => {
    let startSerial = 1;
    for (let i = 0; i < pageIdx; i++) {
      startSerial += quotationPages[i]?.length || 0;
    }

    // Pad single-page quotations up to 4 rows minimum to match uploaded sample aesthetic
    const displayRows: Array<QuotationItem | null> = [...pageItems];
    if (pageIdx === 0 && totalPages === 1 && displayRows.length < 4) {
      while (displayRows.length < 4) {
        displayRows.push(null);
      }
    }

    const discountLabel =
      q.discount_type === 'percent' ? `Discount (${q.discount_value}%)` : 'Discount';
    const vatBaseText = q.vat_base === 'subtotal' ? 'Subtotal' : 'After Discount';
    const vatLabel =
      q.vat_type === 'percent' ? `VAT (${q.vat_value}% on ${vatBaseText})` : 'VAT';
    const taxBaseText =
      q.tax_base === 'subtotal'
        ? 'Subtotal'
        : q.tax_base === 'after_discount_and_vat'
        ? 'After Discount + VAT'
        : 'After Discount';
    const taxLabel =
      q.tax_type === 'percent' ? `Tax (${q.tax_value}% on ${taxBaseText})` : 'Tax';

    const formatQuoteAmount = (n: number): string => {
      const safe = roundMoney2(Math.max(0, Number(n) || 0));
      if (Math.abs(safe - Math.round(safe)) < 0.005) {
        return Math.round(safe).toLocaleString('en-US');
      }
      return formatBdt2(safe);
    };

    const hasOptionalAdjustments = Boolean(q.discount_enabled || q.vat_enabled || q.tax_enabled);

    return (
      <table
        className="w-full border-collapse text-[#111111]"
        style={{
          fontFamily: '"Calibri", "Arial", "Plus Jakarta Sans", sans-serif',
          fontSize: '12.2px',
          lineHeight: 1.3,
        }}
      >
        <thead>
          <tr style={{ backgroundColor: '#A9D08E' }}>
            <th className="w-[7%] border border-[#333333] px-1.5 py-1 text-center font-semibold">
              SL
            </th>
            <th className="w-[33%] border border-[#333333] px-2 py-1 text-center font-semibold">
              Description
            </th>
            <th className="w-[19%] border border-[#333333] px-2 py-1 text-center font-semibold">
              Size
            </th>
            <th className="w-[13%] border border-[#333333] px-1.5 py-1 text-center font-semibold">
              Quantity
            </th>
            <th className="w-[13%] border border-[#333333] px-1.5 py-1 text-center font-semibold">
              Rate/CFT
            </th>
            <th className="w-[15%] border border-[#333333] px-2 py-1 text-center font-semibold">
              Price
            </th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((item, idx) => {
            const serial = String(startSerial + idx).padStart(2, '0');
            if (!item) {
              return (
                <tr key={`empty-${serial}`} className="bg-white/80">
                  <td className="border border-[#333333] px-1.5 py-1 text-center">{serial}</td>
                  <td className="border border-[#333333] px-2 py-1">&nbsp;</td>
                  <td className="border border-[#333333] px-2 py-1">&nbsp;</td>
                  <td className="border border-[#333333] px-1.5 py-1">&nbsp;</td>
                  <td className="border border-[#333333] px-1.5 py-1">&nbsp;</td>
                  <td className="border border-[#333333] px-2 py-1">&nbsp;</td>
                </tr>
              );
            }

            const qtyText = item.unit_label
              ? `${item.quantity} ${item.unit_label}`
              : String(item.quantity);
            const sizeText =
              item.size && item.size.trim() ? item.size.trim() : '----------------------';

            return (
              <tr key={`row-${serial}`} className="bg-white/90">
                <td className="border border-[#333333] px-1.5 py-1 text-center">{serial}</td>
                <td className="border border-[#333333] px-2 py-1 text-left">
                  <div className="font-medium">{item.service}</div>
                  {SERVICE_PACKAGE_INCLUSIONS[item.service] ? (
                    <div className="text-[10px] leading-tight text-neutral-600">
                      ({SERVICE_PACKAGE_INCLUSIONS[item.service]})
                    </div>
                  ) : null}
                  {item.description ? (
                    <div className="text-[10.5px] leading-tight text-neutral-600">
                      {item.description}
                    </div>
                  ) : null}
                </td>
                <td className="border border-[#333333] px-2 py-1 text-center">{sizeText}</td>
                <td className="border border-[#333333] px-1.5 py-1 text-center">{qtyText}</td>
                <td className="border border-[#333333] px-1.5 py-1 text-center tabular-nums">
                  {formatQuoteAmount(item.rate_bdt)}
                </td>
                <td className="border border-[#333333] px-2 py-1 text-center tabular-nums">
                  {formatQuoteAmount(item.amount_bdt)}/-
                </td>
              </tr>
            );
          })}

          {isLastPage && (
            <>
              <tr style={{ backgroundColor: '#F8CBAD' }}>
                <td
                  colSpan={5}
                  className="border border-[#333333] px-2.5 py-1 text-right font-bold"
                >
                  Total
                </td>
                <td className="border border-[#333333] px-2 py-1 text-center font-bold tabular-nums">
                  {formatQuoteAmount(q.subtotal_bdt)}/-
                </td>
              </tr>

              {q.discount_enabled && (
                <tr style={{ backgroundColor: '#F8CBAD' }}>
                  <td
                    colSpan={5}
                    className="border-x border-[#333333] px-2.5 py-1 text-right font-bold"
                  >
                    {discountLabel}
                  </td>
                  <td className="border-x border-[#333333] px-2 py-1 text-center font-bold tabular-nums">
                    {formatQuoteAmount(q.discount_bdt)}/-
                  </td>
                </tr>
              )}

              {q.vat_enabled && (
                <tr style={{ backgroundColor: '#F8CBAD' }}>
                  <td
                    colSpan={5}
                    className="border-x border-[#333333] px-2.5 py-1 text-right font-bold"
                  >
                    {vatLabel}
                  </td>
                  <td className="border-x border-[#333333] px-2 py-1 text-center font-bold tabular-nums">
                    {formatQuoteAmount(q.vat_bdt)}/-
                  </td>
                </tr>
              )}

              {q.tax_enabled && (
                <tr style={{ backgroundColor: '#F8CBAD' }}>
                  <td
                    colSpan={5}
                    className="border-x border-[#333333] px-2.5 py-1 text-right font-bold"
                  >
                    {taxLabel}
                  </td>
                  <td className="border-x border-[#333333] px-2 py-1 text-center font-bold tabular-nums">
                    {formatQuoteAmount(q.tax_bdt)}/-
                  </td>
                </tr>
              )}

              <tr style={{ backgroundColor: '#F8CBAD' }}>
                <td
                  colSpan={5}
                  className={`border-x border-b border-[#333333] ${
                    hasOptionalAdjustments ? '' : 'border-t'
                  } px-2.5 py-1 text-right font-bold`}
                >
                  Grant Total
                </td>
                <td
                  className={`border-x border-b border-[#333333] ${
                    hasOptionalAdjustments ? '' : 'border-t'
                  } px-2 py-1 text-center font-bold tabular-nums`}
                >
                  {formatQuoteAmount(q.total_bdt)}/-
                </td>
              </tr>

              <tr className="bg-white/95">
                <td colSpan={6} className="border border-[#333333] px-2.5 py-1.5 text-left">
                  <span>In words: </span>
                  <strong className="font-bold">{numberToEnglishWordsTk(q.total_bdt)}</strong>
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    );
  };

  // Custom uploaded pad overlay renderer
  const renderFieldOverlay = (field: PadFieldConfig, pageIdx: number, totalPages: number) => {
    if (!field.visible) return null;

    if (field.key === 'contact_header_override') {
      return (
        <div
          key={field.key}
          style={{
            position: 'absolute',
            left: `${field.xPct}%`,
            top: `${field.yPct}%`,
            width: `${field.widthPct}%`,
            minHeight: '13.2%',
            zIndex: 15,
          }}
        >
          <UpdatedContactHeaderBlock compact />
        </div>
      );
    }

    const style: React.CSSProperties = {
      position: 'absolute',
      left: `${field.xPct}%`,
      top: `${field.yPct}%`,
      width: `${field.widthPct}%`,
      fontSize: `${field.fontSize}px`,
      textAlign: field.align,
      fontWeight: field.bold ? 700 : 400,
      color: field.color || '#0b1f3a',
      lineHeight: 1.45,
      wordBreak: 'break-word',
      fontFamily: '"Arial", "Plus Jakarta Sans", sans-serif',
    };

    if (field.key === 'company_logo') {
      if (!companyLogoDataUrl || pageIdx > 0) return null;
      return (
        <div
          key={field.key}
          style={{
            position: 'absolute',
            left: `${field.xPct}%`,
            top: `${field.yPct}%`,
            width: `${field.widthPct}%`,
            display: 'flex',
            justifyContent:
              field.align === 'center'
                ? 'center'
                : field.align === 'right'
                ? 'flex-end'
                : 'flex-start',
          }}
        >
          <img
            src={companyLogoDataUrl}
            alt={COMPANY_NAME}
            className="max-h-20 w-auto max-w-full object-contain"
          />
        </div>
      );
    }

    if (type === 'quotation' && effectiveQuotation) {
      const pageItems = quotationPages[pageIdx] || [];
      const isLastPage = pageIdx === totalPages - 1;
      switch (field.key) {
        case 'quotation_id':
          return <div key={field.key} style={style}>{effectiveQuotation.quotation_id}</div>;
        case 'quotation_date':
          return (
            <div key={field.key} style={style}>
              {formatEnDateShort(effectiveQuotation.quotation_date)}
            </div>
          );
        case 'valid_until':
          return effectiveQuotation.valid_until ? (
            <div key={field.key} style={style}>
              Valid until: {formatEnDateShort(effectiveQuotation.valid_until)}
            </div>
          ) : null;
        case 'customer_name':
          return pageIdx === 0 ? (
            <div key={field.key} style={style}>
              {effectiveQuotation.customer_name}
            </div>
          ) : null;
        case 'phone_display':
          return pageIdx === 0 ? (
            <div key={field.key} style={style}>
              {effectiveQuotation.phone_display}
            </div>
          ) : null;
        case 'address':
          return pageIdx === 0 ? (
            <div key={field.key} style={style}>
              {effectiveQuotation.address}
              {effectiveQuotation.area ? `, ${effectiveQuotation.area}` : ''}
            </div>
          ) : null;
        case 'items_table':
          return (
            <div key={field.key} style={style}>
              {renderOfficialFinancialTable(
                effectiveQuotation,
                pageItems,
                pageIdx,
                totalPages,
                isLastPage
              )}
            </div>
          );
        case 'terms':
          return isLastPage &&
            effectiveQuotation.terms &&
            !containsBanglaScript(effectiveQuotation.terms) ? (
            <div key={field.key} style={style} className="whitespace-pre-line">
              {effectiveQuotation.terms}
            </div>
          ) : null;
        default:
          return null;
      }
    }

    if (type === 'receipt' && effectiveReceipt) {
      switch (field.key) {
        case 'receipt_id':
          return (
            <div key={field.key} style={style}>
              Receipt No: {effectiveReceipt.receipt_id}
            </div>
          );
        case 'receipt_date':
          return (
            <div key={field.key} style={style}>
              Date: {formatEnDateShort(effectiveReceipt.receipt_date)}
            </div>
          );
        case 'order_id':
          return (
            <div key={field.key} style={style}>
              Order Ref: {effectiveReceipt.order_id}
            </div>
          );
        case 'customer_name':
          return (
            <div key={field.key} style={style}>
              Received From: {effectiveReceipt.customer_name}
            </div>
          );
        case 'phone_display':
          return (
            <div key={field.key} style={style}>
              Phone: {effectiveReceipt.phone_display}
            </div>
          );
        case 'address':
          return (
            <div key={field.key} style={style}>
              Address: {effectiveReceipt.address}
            </div>
          );
        case 'services_text':
          return (
            <div key={field.key} style={style}>
              Services: {effectiveReceipt.services_text}
            </div>
          );
        case 'amount_received':
          return (
            <div
              key={field.key}
              style={style}
              className="rounded border border-emerald-300 bg-emerald-50/90 px-3 py-2"
            >
              Total Paid: BDT {formatBdt2(effectiveReceipt.amount_received)}/- (
              {numberToEnglishWordsTk(effectiveReceipt.amount_received)})
            </div>
          );
        case 'payment_method':
          return (
            <div key={field.key} style={style}>
              Payment Method: {effectiveReceipt.payment_method}
              {effectiveReceipt.transaction_ref ? ` · Ref: ${effectiveReceipt.transaction_ref}` : ''}
            </div>
          );
        case 'received_by':
          return (
            <div key={field.key} style={style}>
              Received By: {effectiveReceipt.received_by}
            </div>
          );
        default:
          return null;
      }
    }

    return null;
  };

  /**
   * VERIFIED OFFICIAL SUNVILOZ CLEAN CARE QUOTATION A4 PAGE
   * Preserves sample letterhead, section order, page size, typography, table layout, footer, and terms,
   * while masking out the outdated right-hand contact block and replacing it with the exact updated
   * address and website.
   */
  const renderOfficialQuotationPage = (
    q: QuotationRecord,
    pageItems: QuotationItem[],
    pageIdx: number,
    totalPages: number
  ) => {
    const isLastPage = pageIdx === totalPages - 1;
    const recipientAddress = [q.address, q.area].filter(Boolean).join(', ');
    const cleanTerms =
      q.terms && !containsBanglaScript(q.terms) ? q.terms.trim() : '';

    return (
      <div
        key={`official-q-${pageIdx}`}
        data-a4-page="true"
        className="relative mx-auto overflow-hidden bg-white shadow-lg"
        style={{
          width: '794px',
          height: '1123px',
          fontFamily: '"Arial", "Plus Jakarta Sans", sans-serif',
          color: '#111111',
        }}
      >
        {/* Official or Saved Quotation Letterhead Pad Background */}
        <img
          src={
            activePad && activePad.image_data_url
              ? activePad.image_data_url
              : '/assets/sunviloz/official-quotation-pad.jpg'
          }
          alt="SUNVILOZ Clean Care Official Letterhead"
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
        />

        {/* Ref. No. & Date bar positioned cleanly below the official SUNVILOZ CLEAN CARE letterhead header */}
        <div
          className="absolute z-10 flex items-center justify-between text-[#111111]"
          style={{
            top: '202px',
            left: '44px',
            right: '52px',
            fontSize: '12.5px',
          }}
        >
          <div>
            <span className="font-semibold">Ref. No.: </span>
            <span className="font-medium">{q.quotation_id}</span>
          </div>
          <div>
            <span className="font-semibold">Date: </span>
            <span>{formatEnDateShort(q.quotation_date)}</span>
          </div>
        </div>

        {/* Main Content Container positioned cleanly above Bottom Footer (height capped at 1036px) */}
        <div
          className="relative z-10 flex flex-col overflow-hidden"
          style={{
            paddingTop: '242px',
            paddingLeft: '44px',
            paddingRight: '52px',
            height: '1036px',
          }}
        >
          {pageIdx === 0 ? (
            <>
              {/* Recipient Block */}
              <div style={{ fontSize: '13.2px', lineHeight: 1.38 }}>
                <div>To,</div>
                <div className="uppercase">{q.customer_name},</div>
                <div>
                  {recipientAddress}
                  {recipientAddress && !recipientAddress.endsWith('.') ? '.' : ''}
                </div>
              </div>

              {/* Subject (Exact Verbatim Fixed Wording) */}
              <div className="mt-4" style={{ fontSize: '13.2px', lineHeight: 1.38 }}>
                <span className="font-bold">Subject: </span>
                <span className="font-bold underline">{FIXED_QUOTATION_SUBJECT}</span>
              </div>

              {/* Intro Paragraph (Exact Verbatim Fixed Wording) */}
              <p className="mt-2 text-justify" style={{ fontSize: '12.3px', lineHeight: 1.38 }}>
                {FIXED_QUOTATION_INTRO}
              </p>

              {/* Our Basic Steps (Exact Verbatim Steps 1–8) */}
              <div className="mt-2.5 text-center">
                <h3
                  className="inline-block font-bold underline"
                  style={{ fontSize: '13.5px', color: '#111111' }}
                >
                  {FIXED_QUOTATION_STEPS_HEADING}
                </h3>
              </div>

              <div className="mt-1.5 space-y-0.5" style={{ fontSize: '12.1px', lineHeight: 1.34 }}>
                {FIXED_QUOTATION_STEPS.map((step, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <span className="w-[45px] shrink-0">{step.label}</span>
                    <span className="flex-1">{step.text}</span>
                  </div>
                ))}
              </div>

              {/* Financial Offer Heading */}
              <div className="mt-3 mb-2 text-center">
                <h3
                  className="inline-block font-bold underline"
                  style={{ fontSize: '16px', color: '#111111' }}
                >
                  {FIXED_QUOTATION_FINANCIAL_HEADING}
                </h3>
              </div>
            </>
          ) : (
            <div className="mb-3 flex items-center justify-between border-b border-slate-300 pb-2 text-xs font-semibold text-slate-600">
              <span>
                {FIXED_QUOTATION_FINANCIAL_HEADING} (Continued) — {q.customer_name}
              </span>
              <span>
                Page {pageIdx + 1} of {totalPages}
              </span>
            </div>
          )}

          {/* Financial Offer Table */}
          <div>{renderOfficialFinancialTable(q, pageItems, pageIdx, totalPages, isLastPage)}</div>

          {/* Terms & Conditions + Signature & Official Stamp (Last Page Only) */}
          {isLastPage && (
            <div className="mt-3.5">
              {cleanTerms && (
                <div
                  className="mb-3 rounded border border-slate-200/80 bg-white/85 px-2.5 py-1.5 text-[#1E293B]"
                  style={{ fontSize: '10.6px', lineHeight: 1.35 }}
                >
                  <div className="mb-0.5 font-bold text-[#111111]">Terms &amp; Conditions:</div>
                  <div className="whitespace-pre-line">{cleanTerms}</div>
                </div>
              )}

              <div className="flex items-end gap-4">
                <div
                  style={{
                    fontFamily: '"Georgia", "Times New Roman", serif',
                    fontSize: '13px',
                    lineHeight: 1.34,
                    color: '#111111',
                  }}
                >
                  <div className="mb-3">Sincerely,</div>
                  <div>MD ABUL HASAN SHIPON</div>
                  <div>Managing Director</div>
                  <div className="font-bold">Sunviloz Clean Care</div>
                  <div>Mobile: 01609999612</div>
                  <div>
                    Email: <span className="underline">{COMPANY_EMAIL}</span>
                  </div>
                </div>

                <OfficialStampSvg size={110} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  /**
   * 100% ENGLISH MONEY RECEIPT A4 PAGE
   * Uses exact updated Company Address and Website (`https://sunvilozcleancare.com/`).
   */
  const renderModernMoneyReceiptPage = (r: MoneyReceiptRecord) => {
    const amountWords = numberToEnglishWordsTk(r.amount_received);
    const paymentMethodEn = translatePaymentMethodToEnglish(r.payment_method);

    return (
      <div
        data-a4-page="true"
        className="relative mx-auto flex flex-col justify-between overflow-hidden bg-white shadow-lg"
        style={{
          width: '794px',
          height: '1123px',
          fontFamily: '"Plus Jakarta Sans", "Arial", sans-serif',
          color: '#1E293B',
        }}
      >
        {/* Top Dual-Tone SUNVILOZ Brand Bar */}
        <div>
          <div className="flex h-3 w-full">
            <div className="h-full w-[64%] bg-[#18181B]" />
            <div className="h-full w-[36%] bg-[#EA7A0E]" />
          </div>

          <div className="px-11 pt-9">
            {/* Header Row: Official Logo + Exact Updated Company Info | Money Receipt Title Block */}
            <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
              <div className="max-w-[430px]">
                <img
                  src="/assets/sunviloz/official-logo.png"
                  alt={COMPANY_NAME}
                  className="h-[64px] w-auto object-contain"
                />
                <div className="mt-3 space-y-1.5 text-[11.2px] text-slate-700">
                  <div className="flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EA7A0E]" />
                    <span className="font-medium">{COMPANY_ADDRESS}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 font-mono font-medium">
                      <Phone className="h-3.5 w-3.5 text-[#EA7A0E]" />
                      {COMPANY_PHONE}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Mail className="h-3.5 w-3.5 text-[#EA7A0E]" />
                      {COMPANY_EMAIL}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 font-medium">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-[#EA7A0E]" />
                    <span>{COMPANY_WEBSITE}</span>
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="inline-block rounded-lg bg-[#0B1F3A] px-4 py-1.5 text-xs font-bold tracking-[0.16em] text-white uppercase">
                  MONEY RECEIPT
                </div>
                <div className="mt-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Official Payment Confirmation
                </div>

                <div className="mt-3 space-y-1 text-xs">
                  <div className="text-slate-500">
                    Receipt No:{' '}
                    <span className="font-mono font-bold text-[#0B1F3A]">{r.receipt_id}</span>
                  </div>
                  <div className="text-slate-500">
                    Date:{' '}
                    <span className="font-mono font-semibold text-[#0B1F3A]">
                      {formatEnDateShort(r.receipt_date)}
                    </span>
                  </div>
                  <div className="text-slate-500">
                    Order Ref:{' '}
                    <span className="font-mono font-semibold text-[#0B1F3A]">{r.order_id}</span>
                  </div>
                </div>

                <div className="mt-3 inline-flex items-center gap-1.5 rounded border border-emerald-600 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold tracking-wide text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                  PAID IN FULL
                </div>
              </div>
            </div>

            {/* Two-Column Customer & Payment Information Grid */}
            <div className="mt-7 grid grid-cols-2 gap-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4.5">
                <div className="text-[10.5px] font-bold tracking-wider text-[#EA7A0E] uppercase">
                  Received With Thanks From
                </div>
                <div className="mt-2 text-base font-bold text-[#0B1F3A]">{r.customer_name}</div>
                <div className="mt-1 font-mono text-xs font-medium text-slate-600">
                  Phone: {r.phone_display}
                </div>
                <div className="mt-1 text-xs leading-relaxed text-slate-600">{r.address}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4.5">
                <div className="text-[10.5px] font-bold tracking-wider text-[#EA7A0E] uppercase">
                  Payment Information
                </div>
                <dl className="mt-2 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Payment Method:</dt>
                    <dd className="font-semibold text-[#0B1F3A]">{paymentMethodEn}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Transaction Ref:</dt>
                    <dd className="font-mono font-semibold text-[#0B1F3A]">
                      {r.transaction_ref || 'N/A'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Payment Status:</dt>
                    <dd className="font-bold text-emerald-700">Full Payment Received</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Received By:</dt>
                    <dd className="font-semibold text-[#0B1F3A]">
                      {r.received_by || COMPANY_NAME}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Service & Settlement Breakdown Table */}
            <div className="mt-7 overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-[#0B1F3A] text-xs font-semibold text-white">
                    <th className="w-12 px-4 py-3 text-center">SL</th>
                    <th className="px-4 py-3">Service Description</th>
                    <th className="w-36 px-4 py-3 text-center">Order Ref</th>
                    <th className="w-40 px-4 py-3 text-right">Amount (BDT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white text-sm">
                  <tr>
                    <td className="px-4 py-4 text-center font-mono text-xs font-semibold text-slate-500">
                      01
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-bold text-[#0B1F3A]">{r.services_text}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Professional Water Tank &amp; Pipeline Cleaning Service (WHO Standard)
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center font-mono text-xs text-slate-600">
                      {r.order_id}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-base font-bold tabular-nums text-[#0B1F3A]">
                      BDT {formatBdt2(r.amount_received)}/-
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Total Received Banner + Amount In Words */}
            <div className="mt-6 overflow-hidden rounded-xl border border-[#0B1F3A]/15">
              <div className="flex items-center justify-between bg-[#0B1F3A] px-6 py-4 text-white">
                <div>
                  <div className="text-[11px] font-semibold tracking-wider text-amber-300 uppercase">
                    Total Amount Received
                  </div>
                  <div className="mt-0.5 text-xs text-slate-300">
                    Full Bill Settled — Zero Balance Due
                  </div>
                </div>
                <div className="font-mono text-2xl font-bold tracking-tight tabular-nums text-white">
                  BDT {formatBdt2(r.amount_received)}/-
                </div>
              </div>
              <div className="flex items-center justify-between bg-amber-50/70 px-6 py-3 text-xs text-[#0B1F3A]">
                <div>
                  <span className="font-semibold text-slate-600">In words: </span>
                  <strong className="font-bold">{amountWords}</strong>
                </div>
                <span className="font-mono text-[11px] font-semibold text-amber-900">
                  Currency: BDT
                </span>
              </div>
            </div>

            {r.notes && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
                <strong className="text-[#0B1F3A]">Remarks: </strong>
                {r.notes}
              </div>
            )}

            {/* Official Assurance Strip */}
            <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-600">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <div>
                Thank you for choosing <strong className="text-[#0B1F3A]">{COMPANY_NAME}</strong>.
                This official money receipt confirms full payment received for the completed cleaning
                service listed above. Please retain this receipt for your service and follow-up
                records.
              </div>
            </div>

            {/* Dual Signature & Official Circular Stamp Section */}
            <div className="mt-9 flex items-end justify-between gap-8 px-2">
              <div className="w-56 text-center">
                <div className="h-[92px]" />
                <div className="border-t border-slate-400 pt-2 text-xs font-semibold text-[#0B1F3A]">
                  Customer Signature
                </div>
                <div className="text-[11px] text-slate-500">Client Acknowledgement</div>
              </div>

              <div className="flex items-end gap-4">
                <OfficialStampSvg size={110} />
                <div className="w-56 text-center">
                  <div className="border-t border-slate-400 pt-2 text-xs font-bold text-[#0B1F3A]">
                    Authorized Signature
                  </div>
                  <div className="text-[11px] font-semibold text-slate-700">
                    MD ABUL HASAN SHIPON
                  </div>
                  <div className="text-[10.5px] text-slate-500">
                    Managing Director, Sunviloz Clean Care
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Corporate Brand Footer */}
        <div>
          <div className="mb-3 flex items-center justify-center gap-4 px-11">
            <div className="h-[1.5px] flex-1 bg-[#EA7A0E]/60" />
            <div className="text-[11px] font-semibold tracking-[0.28em] text-[#18181B]">
              CLEANLINESS <span className="text-[#EA7A0E]">•</span> RELIABILITY{' '}
              <span className="text-[#EA7A0E]">•</span> TRUST
            </div>
            <div className="h-[1.5px] flex-1 bg-[#EA7A0E]/60" />
          </div>
          <div className="relative h-6 w-full overflow-hidden bg-[#18181B]">
            <div
              className="absolute inset-y-0 right-0 w-[42%] bg-[#EA7A0E]"
              style={{ clipPath: 'polygon(12% 0, 100% 0, 100% 100%, 0% 100%)' }}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/75"
      role="dialog"
      aria-modal="true"
    >
      {/* Top Action Toolbar (Hidden in Print) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#0B1F3A] px-4 py-3 text-white sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">
              {type === 'quotation'
                ? `Quotation Preview — ${effectiveQuotation!.quotation_id}`
                : `Money Receipt Preview — ${effectiveReceipt!.receipt_id}`}
            </span>
            {!activePad && type === 'quotation' && (
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                Sample Layout Verified · English A4
              </span>
            )}
            {!activePad && type === 'receipt' && (
              <span className="rounded bg-amber-500/25 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                Standard English Template (Sample Pending)
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-slate-300">
            {activePad
              ? `Custom Uploaded Pad: ${activePad.file_name} (v${activePad.version})`
              : type === 'quotation'
              ? `${COMPANY_NAME} Official Quotation Pad (A4)`
              : `${COMPANY_NAME} Official Money Receipt (A4)`}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEnglishPanelOpen((prev) => !prev)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              hasRemainingBangla
                ? 'border-amber-400 bg-amber-500/25 text-amber-100 hover:bg-amber-500/35'
                : 'border-white/20 bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <Languages className="h-3.5 w-3.5" />
            {englishPanelOpen ? 'Hide Text Review' : 'Review English Text'}
            {hasRemainingBangla && <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />}
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20"
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </button>

          <button
            type="button"
            disabled={busy !== null}
            onClick={handleDownloadPdf}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {busy === 'pdf' ? 'Generating PDF...' : 'Download PDF'}
          </button>

          <button
            type="button"
            disabled={busy !== null}
            onClick={handleShare}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-60"
          >
            <Share2 className="h-3.5 w-3.5" />
            {busy === 'share' ? 'Sharing...' : 'Share'}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Non-Printable English Spelling Review Panel */}
      {englishPanelOpen && (
        <div className="no-print border-b border-slate-200 bg-amber-50 px-4 py-3.5 text-[#0B1F3A] sm:px-6">
          <div className="mx-auto max-w-5xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold">
                {hasRemainingBangla ? (
                  <>
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                    <span className="text-amber-950">
                      Non-English text was found in this record. Review and confirm English spelling below before printing or exporting to PDF.
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                    <span className="text-emerald-900">
                      All fields are ready in English. You can adjust any display wording below without altering saved database records.
                    </span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setEnglishPanelOpen(false)}
                className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B1F3A] hover:bg-amber-100"
              >
                Done
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Customer Name (English)
                </label>
                <input
                  type="text"
                  value={enCustomerName}
                  onChange={(e) => setEnCustomerName(e.target.value)}
                  placeholder="Enter English customer name"
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A]"
                />
              </div>

              <div className={type === 'quotation' ? 'sm:col-span-1' : 'sm:col-span-2'}>
                <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                  Address (English)
                </label>
                <input
                  type="text"
                  value={enAddress}
                  onChange={(e) => setEnAddress(e.target.value)}
                  placeholder="Enter English street/house address"
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A]"
                />
              </div>

              {type === 'quotation' && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                    Area (English)
                  </label>
                  <input
                    type="text"
                    value={enArea}
                    onChange={(e) => setEnArea(e.target.value)}
                    placeholder="e.g. Uttara, Dhaka"
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A]"
                  />
                </div>
              )}
            </div>

            {type === 'quotation' && enItemServices.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {enItemServices.map((svc, idx) => (
                  <div key={idx}>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                      Item {String(idx + 1).padStart(2, '0')} Description (English)
                    </label>
                    <input
                      type="text"
                      value={svc}
                      onChange={(e) =>
                        setEnItemServices((prev) =>
                          prev.map((val, i) => (i === idx ? e.target.value : val))
                        )
                      }
                      className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A]"
                    />
                  </div>
                ))}
              </div>
            )}

            {type === 'receipt' && (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                    Service Description (English)
                  </label>
                  <input
                    type="text"
                    value={enServicesText}
                    onChange={(e) => setEnServicesText(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                    Received By (English)
                  </label>
                  <input
                    type="text"
                    value={enReceivedBy}
                    onChange={(e) => setEnReceivedBy(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                    Remarks (English, Optional)
                  </label>
                  <input
                    type="text"
                    value={enNotes}
                    onChange={(e) => setEnNotes(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scrollable A4 Document Stage */}
      <div className="flex-1 overflow-auto bg-slate-800/90 p-4 sm:p-8">
        <div ref={pagesContainerRef} className="mx-auto flex flex-col items-center gap-6">
          {/* Quotation always preserves verbatim master layout + mandatory Steps 1–8 + uses saved quotation pad when present */}
          {type === 'quotation' && effectiveQuotation ? (
            quotationPages.map((pageItems, pageIdx) =>
              renderOfficialQuotationPage(
                effectiveQuotation,
                pageItems,
                pageIdx,
                quotationPages.length
              )
            )
          ) : activePad && activePad.image_data_url ? (
            <div
              data-a4-page="true"
              className="relative overflow-hidden bg-white shadow-lg"
              style={{ width: '794px', height: '1123px' }}
            >
              <img
                src={activePad.image_data_url}
                alt={activePad.file_name}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              />
              {activePad.fields.map((field) => renderFieldOverlay(field, 0, 1))}
            </div>
          ) : effectiveReceipt ? (
            renderModernMoneyReceiptPage(effectiveReceipt)
          ) : null}
        </div>
      </div>
    </div>
  );
}
