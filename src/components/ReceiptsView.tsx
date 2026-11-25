import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Plus, Receipt, Search, X } from 'lucide-react';
import {
  DocumentPadConfig,
  MoneyReceiptRecord,
  OrderRecord,
  PAYMENT_METHODS,
  PaymentMethod,
} from '../types/order';
import {
  formatBdt2,
  formatDateEn,
  getTodayDhakaIso,
  translateServiceToEnglish,
} from '../utils/dateAndPhone';
import { DocumentPreviewModal } from './DocumentPreviewModal';

interface ReceiptsViewProps {
  receipts: MoneyReceiptRecord[];
  orders: OrderRecord[];
  activePad: DocumentPadConfig | null;
  companyLogoDataUrl?: string;
  preselectOrderId?: string;
  onConsumePreselectOrder?: () => void;
  onIssueReceipt: (payload: {
    order_id: string;
    receipt_date: string;
    payment_method: PaymentMethod;
    transaction_ref?: string;
    notes?: string;
  }) => Promise<MoneyReceiptRecord>;
  onArchivePdf?: (payload: {
    doc_type: 'quotation' | 'receipt';
    doc_id: string;
    file_name: string;
    pdf_base64: string;
  }) => Promise<void>;
  onOpenOrder: (orderId: string) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function ReceiptsView({
  receipts,
  orders,
  activePad,
  companyLogoDataUrl = '',
  preselectOrderId = '',
  onConsumePreselectOrder,
  onIssueReceipt,
  onArchivePdf,
  onOpenOrder,
  onNotify,
}: ReceiptsViewProps) {
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [receiptDate, setReceiptDate] = useState(getTodayDhakaIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [transactionRef, setTransactionRef] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState<MoneyReceiptRecord | null>(null);

  // Eligible orders: Completed, no existing receipt, and NOT a no-charge return visit
  const eligibleOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.status === 'Completed' &&
          !o.receipt_id &&
          !o.is_no_charge_visit &&
          o.price_bdt > 0
      ),
    [orders]
  );

  useEffect(() => {
    if (preselectOrderId) {
      const target = orders.find((o) => o.order_id === preselectOrderId);
      if (target && target.status === 'Completed' && !target.receipt_id && !target.is_no_charge_visit) {
        setSelectedOrderId(target.order_id);
        setReceiptDate(getTodayDhakaIso());
        setPaymentMethod('Cash');
        setTransactionRef('');
        setNotes('');
        setModalOpen(true);
      }
      onConsumePreselectOrder?.();
    }
  }, [preselectOrderId, orders, onConsumePreselectOrder]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return receipts;
    return receipts.filter((r) =>
      [
        r.receipt_id,
        r.order_id,
        r.customer_name,
        r.phone_display,
        r.payment_method,
        r.transaction_ref,
        r.services_text,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [receipts, search]);

  const selectedOrder = useMemo(
    () => eligibleOrders.find((o) => o.order_id === selectedOrderId) || null,
    [eligibleOrders, selectedOrderId]
  );

  const openNewModal = () => {
    setSelectedOrderId(eligibleOrders[0]?.order_id || '');
    setReceiptDate(getTodayDhakaIso());
    setPaymentMethod('Cash');
    setTransactionRef('');
    setNotes('');
    setModalOpen(true);
  };

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId) return;
    setSubmitting(true);
    try {
      const issued = await onIssueReceipt({
        order_id: selectedOrderId,
        receipt_date: receiptDate,
        payment_method: paymentMethod,
        transaction_ref: transactionRef.trim(),
        notes: notes.trim(),
      });
      setModalOpen(false);
      setPreviewReceipt(issued);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to issue money receipt.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1F3A]">Money Receipts</h1>
          <p className="text-sm text-slate-500">
            Issue official English money receipts for completed paid orders (one receipt per order;
            no-charge return visits excluded).
          </p>
        </div>
        <button
          type="button"
          onClick={openNewModal}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0F766E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0c6059]"
        >
          <Plus className="h-4 w-4" />
          Issue Money Receipt
        </button>
      </div>

      {/* Search Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by receipt ID, order ID, customer, phone..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      {/* Receipts Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No money receipts found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                  <th className="px-4 py-3">Receipt No.</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer & Order</th>
                  <th className="px-4 py-3">Payment Method</th>
                  <th className="px-4 py-3 text-right">Amount Received</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.receipt_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-[#0B1F3A]">
                      {r.receipt_id}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatDateEn(r.receipt_date)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#0B1F3A]">{r.customer_name}</div>
                      <div className="text-xs text-slate-500">
                        {r.phone_display} ·{' '}
                        <button
                          type="button"
                          onClick={() => onOpenOrder(r.order_id)}
                          className="font-mono font-semibold text-[#0F766E] hover:underline"
                        >
                          {r.order_id}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="font-semibold">{r.payment_method}</div>
                      {r.transaction_ref && (
                        <div className="font-mono text-[11px] text-slate-500">
                          Ref: {r.transaction_ref}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-emerald-700">
                      BDT {formatBdt2(r.amount_received)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setPreviewReceipt(r)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Preview / PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Issue Receipt Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-[#0F766E]" />
                <h3 className="text-base font-bold text-[#0B1F3A]">Issue Money Receipt</h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {eligibleOrders.length === 0 ? (
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <p>
                  There are no eligible completed orders awaiting a money receipt right now.
                  Completed orders that already have a receipt or are marked as no-charge return
                  visits are excluded.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleIssue} className="mt-4 space-y-3 text-sm">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Completed Order *</label>
                  <select
                    required
                    value={selectedOrderId}
                    onChange={(e) => setSelectedOrderId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  >
                    {eligibleOrders.map((o) => (
                      <option key={o.order_id} value={o.order_id}>
                        {o.order_id} — {o.customer_name} (BDT {formatBdt2(o.price_bdt)})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedOrder && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                    <div className="font-bold text-[#0B1F3A]">{selectedOrder.customer_name}</div>
                    <div className="text-slate-600">
                      {translateServiceToEnglish(selectedOrder.services_text)}
                    </div>
                    <div className="font-mono font-bold text-emerald-700">
                      Amount: BDT {formatBdt2(selectedOrder.price_bdt)}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700">Receipt Date</label>
                    <input
                      type="date"
                      required
                      value={receiptDate}
                      onChange={(e) => setReceiptDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700">Payment Method</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Transaction Ref / Cheque No. (Optional)
                  </label>
                  <input
                    type="text"
                    value={transactionRef}
                    onChange={(e) => setTransactionRef(e.target.value)}
                    placeholder="bKash TrxID / Bank Ref"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700">Notes (Optional)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                  >
                    {submitting ? 'Issuing...' : 'Issue Receipt'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Document Preview Modal */}
      <DocumentPreviewModal
        open={Boolean(previewReceipt)}
        type="receipt"
        receipt={previewReceipt}
        fallbackPad={activePad}
        companyLogoDataUrl={companyLogoDataUrl}
        onArchivePdf={onArchivePdf}
        onClose={() => setPreviewReceipt(null)}
        onNotify={onNotify}
      />
    </div>
  );
}
