import type { AdminBootstrapPayload } from '../types/order';
import { formatEnDateShort, normalizeLeadSource } from './dateAndPhone';
import { computeMonthlyFinancialReport, type MonthlyFinancialFilter } from './financialReport';

type CellValue = string | number | boolean | null | undefined;

interface SheetSpec {
  name: string;
  rows: CellValue[][];
  headerRowIndices?: number[];
  totalRowIndices?: number[];
}

function escapeXml(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/*?:[\]]/g, ' ').trim();
  return (cleaned || 'Sheet').slice(0, 31);
}

function colIndexToLetter(index: number): string {
  let col = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function buildWorksheetXml(sheet: SheetSpec): string {
  const headerSet = new Set(sheet.headerRowIndices || []);
  const totalSet = new Set(sheet.totalRowIndices || []);

  // Compute approximate column widths
  const maxCols = sheet.rows.reduce((m, r) => Math.max(m, r.length), 1);
  const colWidths = new Array<number>(maxCols).fill(14);
  for (const row of sheet.rows) {
    row.forEach((cell, idx) => {
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      if (len + 3 > colWidths[idx]) colWidths[idx] = Math.min(44, len + 3);
    });
  }

  const colsXml = `<cols>${colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')}</cols>`;

  const rowsXml = sheet.rows
    .map((row, rIdx) => {
      const rowNum = rIdx + 1;
      const styleId = headerSet.has(rIdx) ? 1 : totalSet.has(rIdx) ? 2 : rIdx === 0 ? 3 : 0;
      const cellsXml = row
        .map((val, cIdx) => {
          const ref = `${colIndexToLetter(cIdx)}${rowNum}`;
          const sAttr = styleId > 0 ? ` s="${styleId}"` : '';
          if (val === null || val === undefined || val === '') {
            return `<c r="${ref}"${sAttr}/>`;
          }
          if (typeof val === 'number' && Number.isFinite(val)) {
            return `<c r="${ref}"${sAttr}><v>${val}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"${sAttr}><is><t xml:space="preserve">${escapeXml(
            String(val)
          )}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNum}">${cellsXml}</row>`;
    })
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    colsXml +
    `<sheetData>${rowsXml}</sheetData>` +
    `</worksheet>`
  );
}

// CRC-32 table for ZIP (Store method, zero dependencies)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipStore(entries: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = encoder.encode(entry.content);
    const checksum = crc32(dataBytes);

    // Local file header (30 bytes + name)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // compression method: store
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x5421, true); // mod date
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central directory header (46 bytes + name)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const p of centralParts) {
    out.set(p, pos);
    pos += p.length;
  }
  out.set(eocd, pos);
  return out;
}

function buildXlsxBytes(sheets: SheetSpec[]): Uint8Array {
  const safeSheets = sheets.map((s) => ({ ...s, name: sanitizeSheetName(s.name) }));

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    safeSheets
      .map(
        (_s, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('') +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    safeSheets
      .map(
        (s, i) =>
          `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join('') +
    `</sheets></workbook>`;

  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    safeSheets
      .map(
        (_s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join('') +
    `<Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  // Styles: 0=default, 1=navy header (white bold), 2=slate total (bold), 3=title (navy bold)
  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="4">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="13"/><color rgb="FF0B1F3A"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="4">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF0B1F3A"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `</styleSheet>`;

  const entries: Array<{ name: string; content: string }> = [
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: stylesXml },
  ];

  safeSheets.forEach((sheet, i) => {
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      content: buildWorksheetXml(sheet),
    });
  });

  return buildZipStore(entries);
}

export function buildClientReportXlsx(
  bootstrap: AdminBootstrapPayload,
  reportType: 'monthly_financial' | 'monthly_team' | 'monthly_worker_payments' | 'lead_source',
  filters: Record<string, string>
): { bytes: Uint8Array; fileName: string } {
  if (reportType === 'monthly_financial') {
    const filter: MonthlyFinancialFilter = {
      dateFrom: filters.dateFrom || '',
      dateTo: filters.dateTo || '',
      area: filters.area || '',
      service: filters.service || '',
      supervisorId: filters.supervisorId || '',
    };
    const report = computeMonthlyFinancialReport(
      {
        orders: bootstrap.orders,
        overhead: bootstrap.overhead,
        settlementEntries: bootstrap.settlementEntries,
      },
      filter
    );
    const supervisorName = filter.supervisorId
      ? bootstrap.supervisors.find((s) => s.id === filter.supervisorId)?.name || filter.supervisorId
      : 'All';

    const summaryRows: CellValue[][] = [
      ['SUNVILOZ Clean Care — Monthly Jobs & Income Report'],
      [`Period: ${formatEnDateShort(filter.dateFrom)} to ${formatEnDateShort(filter.dateTo)} (Asia/Dhaka)`],
      [`Filters: Area=${filter.area || 'All'} | Service=${filter.service || 'All'} | Supervisor=${supervisorName}`],
      [],
      ['Metric', 'Date Basis / Scope', 'Amount / Count'],
      ['Completed Jobs', 'Job Completion Date', report.totals.completedJobsCount],
      ['No-Charge Return Visits', 'Job Completion Date', report.totals.noChargeReturnVisitsCount],
      ['Income Collected (BDT)', 'Collection Date (Recorded once at completion; receipts add 0)', report.totals.totalIncomeCollected],
      ['Completed Job Bills (BDT)', 'Job Completion Date', report.totals.totalCompletedJobBills],
      ['Actual Job Costs (BDT)', 'Job Completion Date (Transport, meals, other, confirmed worker pay once)', report.totals.totalActualJobCosts],
      ['Job Profit / Loss (BDT)', 'Completed Job Bills - Actual Job Costs', report.totals.totalJobProfit],
      [],
    ];
    const summaryTotals = [10];
    if (report.hasJobFilter) {
      summaryRows.push(
        ['General Business Expenses (Company-Wide — Unfiltered) (BDT)', 'Expense Date', report.totals.totalGeneralBusinessExpenses],
        ['Net Business Profit (BDT)', 'Company-wide only (Clear filters to view)', 'Unfiltered view only']
      );
    } else {
      summaryRows.push(
        ['General Business Expenses (BDT)', 'Expense Date (Company-Wide)', report.totals.totalGeneralBusinessExpenses],
        ['Net Business Profit (BDT)', 'Job Profit / Loss - General Business Expenses', report.totals.netBusinessProfit ?? 0]
      );
      summaryTotals.push(summaryRows.length - 1);
    }
    const settHeaderIdx = summaryRows.length + 1;
    summaryRows.push(
      [],
      ['Supervisor Settlements (Excluded from Income & Job Costs)', 'Date Basis', 'Amount / Count'],
      ['Supervisor Deposits Received (BDT)', 'Actual Settlement Date', report.totals.totalDepositsReceived],
      ['Supervisor Reimbursements Paid (BDT)', 'Actual Settlement Date', report.totals.totalReimbursementsPaid],
      ['Pending Settlements (Orders Count)', 'Period Completed Jobs with Unsettled Balance', report.totals.pendingSettlementsCount],
      ['Pending Settlements Remaining (BDT)', 'Period Completed Jobs with Unsettled Balance', report.totals.pendingSettlementsRemaining]
    );

    const jobRows: CellValue[][] = [
      [
        'Order ID', 'Type', 'Customer', 'Area', 'Completion Date', 'Service', 'Supervisor',
        'Bill (BDT)', 'Transport (BDT)', 'Meals (BDT)', 'Other Expenses (BDT)',
        'Confirmed Worker Pay (BDT)', 'Cost (BDT)', 'Profit / Loss (BDT)',
        'Collection Date', 'Income Collected (BDT)', 'Expected Settlement (BDT)',
        'Actual Settled (BDT)', 'Remaining Settlement (BDT)', 'Settlement Status',
      ],
      ...report.orderRows.map((row) => {
        const o = row.order;
        return [
          o.order_id,
          o.is_no_charge_visit ? `No-Charge Return Visit (${o.parent_order_id})` : 'Completed Job',
          o.customer_name,
          o.area,
          o.completion_date,
          row.service_label,
          o.assigned_supervisor_name || 'Unassigned',
          row.period_revenue_bdt,
          o.transport_cost,
          o.meals_cost,
          o.other_expenses_total,
          o.worker_pay_total,
          row.period_cost_bdt,
          row.period_profit_or_loss_bdt,
          row.collection_date || '—',
          row.collected_amount_bdt,
          o.supervisor_settlement,
          o.settlement_actual_total,
          o.settlement_remaining,
          o.settlement_status,
        ];
      }),
      [
        'TOTAL', `${report.orderRows.length} Records`, '', '', '', '', '',
        report.totals.totalCompletedJobBills,
        report.matchingCompletedOrders.reduce((s, o) => s + o.transport_cost, 0),
        report.matchingCompletedOrders.reduce((s, o) => s + o.meals_cost, 0),
        report.matchingCompletedOrders.reduce((s, o) => s + o.other_expenses_total, 0),
        report.matchingCompletedOrders.reduce((s, o) => s + o.worker_pay_total, 0),
        report.totals.totalActualJobCosts,
        report.totals.totalJobProfit,
        '',
        report.orderRows.reduce((s, r) => s + r.collected_amount_bdt, 0),
        report.totals.expectedSettlementForPeriodJobs,
        report.totals.actualSettledForPeriodJobs,
        report.totals.remainingSettlementForPeriodJobs,
        '',
      ],
    ];

    const colRows: CellValue[][] = [
      ['Order ID', 'Collection Date', 'Completion Date', 'Customer', 'Area', 'Service', 'Supervisor', 'Collected By', 'Receipt ID', 'Income Collected (BDT)'],
      ...report.matchingCollections.map((c) => [
        c.order.order_id, c.collection_date, c.order.completion_date, c.order.customer_name,
        c.order.area, c.service_label, c.order.assigned_supervisor_name || 'Unassigned',
        c.collected_by_name, c.receipt_id || '—', c.collected_amount_bdt,
      ]),
      ['TOTAL', `${report.matchingCollections.length} Confirmed Collections`, '', '', '', '', '', '', '', report.totals.totalIncomeCollected],
    ];

    const settRows: CellValue[][] = [
      ['Entry ID', 'Actual Settlement Date', 'Order ID', 'Supervisor', 'Type', 'Amount (BDT)', 'Payment Method', 'Reference', 'Note', 'Recorded By'],
      ...report.matchingSettlementEntries.map((e) => [
        e.entry_id, e.entry_datetime, e.order_id, e.supervisor_name,
        e.entry_type === 'deposit_received' ? 'Deposit Received' : 'Reimbursement Paid',
        e.amount_bdt, e.payment_method, e.reference, e.note, e.recorded_by,
      ]),
    ];

    const pendRows: CellValue[][] = [
      ['Order ID', 'Completion Date', 'Customer', 'Supervisor', 'Expected Settlement (BDT)', 'Amount Settled (BDT)', 'Remaining Amount (BDT)', 'Direction'],
      ...report.pendingSettlementOrders.map((o) => [
        o.order_id, o.completion_date, o.customer_name, o.assigned_supervisor_name || 'Unassigned',
        o.supervisor_settlement, o.settlement_actual_total, o.settlement_remaining,
        o.supervisor_settlement > 0 ? 'Admin to Receive Deposit' : 'Admin to Pay Reimbursement',
      ]),
      [
        'TOTAL', `${report.pendingSettlementOrders.length} Pending`, '', '',
        report.pendingSettlementOrders.reduce((s, o) => s + o.supervisor_settlement, 0),
        report.pendingSettlementOrders.reduce((s, o) => s + o.settlement_actual_total, 0),
        report.totals.pendingSettlementsRemaining, '',
      ],
    ];

    const expRows: CellValue[][] = [
      ['Date', 'Category', 'Notes / Description', 'Amount (BDT)', 'Recorded By'],
      ...report.matchingGeneralExpenses.map((ex) => [
        ex.expense_date, ex.category, ex.description, ex.amount_bdt, ex.created_by,
      ]),
      ['TOTAL', '', '', report.totals.totalGeneralBusinessExpenses, ''],
    ];

    return {
      bytes: buildXlsxBytes([
        { name: 'Summary', rows: summaryRows, headerRowIndices: [4, settHeaderIdx], totalRowIndices: summaryTotals },
        { name: 'Completed Jobs', rows: jobRows, headerRowIndices: [0], totalRowIndices: [jobRows.length - 1] },
        { name: 'Income Collected', rows: colRows, headerRowIndices: [0], totalRowIndices: [colRows.length - 1] },
        { name: 'Supervisor Settlements', rows: settRows, headerRowIndices: [0] },
        { name: 'Pending Settlements', rows: pendRows, headerRowIndices: [0], totalRowIndices: [pendRows.length - 1] },
        { name: 'General Business Expenses', rows: expRows, headerRowIndices: [0], totalRowIndices: [expRows.length - 1] },
      ]),
      fileName: `SUNVILOZ_Monthly_Financial_${filter.dateFrom}_to_${filter.dateTo}.xlsx`,
    };
  }

  if (reportType === 'monthly_team') {
    const month = filters.month || '';
    const supervisorId = filters.supervisorId || '';
    const workerId = filters.workerId || '';
    const completedInMonth = bootstrap.orders.filter(
      (o) => o.status === 'Completed' && o.completion_date.startsWith(month)
    );
    const supMap = new Map<string, { id: string; name: string; completedJobs: number; noChargeVisits: number; orderIds: Set<string> }>();
    for (const s of bootstrap.supervisors) {
      supMap.set(s.id, { id: s.id, name: s.name, completedJobs: 0, noChargeVisits: 0, orderIds: new Set() });
    }
    const workerMap = new Map<string, { id: string; name: string; participations: number; noChargeVisits: number; orderIds: Set<string> }>();
    for (const w of bootstrap.workers) {
      workerMap.set(w.worker_id, { id: w.worker_id, name: w.name, participations: 0, noChargeVisits: 0, orderIds: new Set() });
    }
    const distinctOrderIds = new Set<string>();
    const distinctNoChargeIds = new Set<string>();

    for (const o of completedInMonth) {
      const matchesSup = !supervisorId || o.assigned_supervisor_id === supervisorId || o.completed_by_user_id === supervisorId;
      const matchesWorker = !workerId || o.assigned_workers.some((w) => w.worker_id === workerId && w.confirmed_worked);
      if (!matchesSup || !matchesWorker) continue;
      if (o.is_no_charge_visit) distinctNoChargeIds.add(o.order_id);
      else distinctOrderIds.add(o.order_id);

      const effSupId = o.assigned_supervisor_id || o.completed_by_user_id || 'unassigned';
      const effSupName = o.assigned_supervisor_name || o.completed_by_name || 'Admin / Unassigned';
      if (!supMap.has(effSupId)) {
        supMap.set(effSupId, { id: effSupId, name: effSupName, completedJobs: 0, noChargeVisits: 0, orderIds: new Set() });
      }
      const supEntry = supMap.get(effSupId)!;
      if (!supEntry.orderIds.has(o.order_id)) {
        supEntry.orderIds.add(o.order_id);
        if (o.is_no_charge_visit) supEntry.noChargeVisits += 1;
        else supEntry.completedJobs += 1;
      }

      for (const ow of o.assigned_workers) {
        if (!ow.confirmed_worked) continue;
        if (!workerMap.has(ow.worker_id)) {
          workerMap.set(ow.worker_id, { id: ow.worker_id, name: ow.worker_name, participations: 0, noChargeVisits: 0, orderIds: new Set() });
        }
        const wEntry = workerMap.get(ow.worker_id)!;
        if (!wEntry.orderIds.has(o.order_id)) {
          wEntry.orderIds.add(o.order_id);
          if (o.is_no_charge_visit) wEntry.noChargeVisits += 1;
          else wEntry.participations += 1;
        }
      }
    }

    const s1Rows: CellValue[][] = [
      [`SUNVILOZ Clean Care — Monthly Team Report (${month})`],
      [`Distinct Completed Jobs: ${distinctOrderIds.size} | Distinct No-Charge Return Visits: ${distinctNoChargeIds.size}`],
      [],
      ['Supervisor', 'Completed Jobs', 'No-Charge Return Visits', 'Order IDs'],
    ];
    for (const s of supMap.values()) {
      if (supervisorId && s.id !== supervisorId) continue;
      if (s.completedJobs === 0 && s.noChargeVisits === 0) continue;
      s1Rows.push([s.name, s.completedJobs, s.noChargeVisits, Array.from(s.orderIds).join(', ')]);
    }
    s1Rows.push(['OVERALL DISTINCT TOTAL', distinctOrderIds.size, distinctNoChargeIds.size, '']);

    const s2Rows: CellValue[][] = [
      ['Worker', 'Confirmed Completed Jobs', 'No-Charge Return Visits', 'Order IDs'],
    ];
    for (const w of workerMap.values()) {
      if (workerId && w.id !== workerId) continue;
      if (w.participations === 0 && w.noChargeVisits === 0) continue;
      s2Rows.push([w.name, w.participations, w.noChargeVisits, Array.from(w.orderIds).join(', ')]);
    }
    s2Rows.push(['OVERALL DISTINCT JOBS', distinctOrderIds.size, distinctNoChargeIds.size, '']);

    return {
      bytes: buildXlsxBytes([
        { name: 'Supervisor Performance', rows: s1Rows, headerRowIndices: [3], totalRowIndices: [s1Rows.length - 1] },
        { name: 'Worker Participation', rows: s2Rows, headerRowIndices: [0], totalRowIndices: [s2Rows.length - 1] },
      ]),
      fileName: `SUNVILOZ_Monthly_Team_${month}.xlsx`,
    };
  }

  if (reportType === 'monthly_worker_payments') {
    const month = filters.month || '';
    const workerId = filters.workerId || '';
    const monthEndDate = `${month}-31`;
    const workerSummary = new Map<
      string,
      { worker_id: string; name: string; completedJobs: number; earnedThisMonth: number; paidThisMonth: number; unpaidAtMonthEnd: number }
    >();
    for (const w of bootstrap.workers) {
      if (workerId && w.worker_id !== workerId) continue;
      workerSummary.set(w.worker_id, {
        worker_id: w.worker_id, name: w.name, completedJobs: 0, earnedThisMonth: 0, paidThisMonth: 0, unpaidAtMonthEnd: 0,
      });
    }
    const detailRows: CellValue[][] = [
      ['Worker', 'Order ID', 'Completion Date', 'Customer', 'Pay for This Job (BDT)', 'Status', 'Paid Amount (BDT)', 'Payment Date', 'Method', 'Paid By', 'Reference'],
    ];

    for (const o of bootstrap.orders) {
      if (o.status !== 'Completed' || !o.completion_date) continue;
      for (const ow of o.assigned_workers) {
        if (!ow.confirmed_worked) continue;
        if (workerId && ow.worker_id !== workerId) continue;
        if (!workerSummary.has(ow.worker_id)) {
          workerSummary.set(ow.worker_id, {
            worker_id: ow.worker_id, name: ow.worker_name, completedJobs: 0, earnedThisMonth: 0, paidThisMonth: 0, unpaidAtMonthEnd: 0,
          });
        }
        const entry = workerSummary.get(ow.worker_id)!;
        const completedThisMonth = o.completion_date.startsWith(month);
        const completedUpToMonthEnd = o.completion_date <= monthEndDate;
        const paidThisMonth = ow.payment_status === 'Paid' && ow.payment_date.startsWith(month);
        const paidUpToMonthEnd = ow.payment_status === 'Paid' && Boolean(ow.payment_date) && ow.payment_date <= monthEndDate;

        if (completedThisMonth) {
          entry.completedJobs += 1;
          entry.earnedThisMonth += ow.agreed_pay_bdt;
        }
        if (paidThisMonth) entry.paidThisMonth += ow.paid_amount_bdt || ow.agreed_pay_bdt;
        if (completedUpToMonthEnd && !paidUpToMonthEnd) entry.unpaidAtMonthEnd += ow.agreed_pay_bdt;

        if (completedThisMonth || paidThisMonth || (completedUpToMonthEnd && !paidUpToMonthEnd)) {
          detailRows.push([
            ow.worker_name, o.order_id, o.completion_date, o.customer_name, ow.agreed_pay_bdt,
            ow.payment_status, ow.payment_status === 'Paid' ? ow.paid_amount_bdt : 0,
            ow.payment_date || '—', ow.payment_method || '—',
            ow.paid_by_role === 'supervisor' ? 'Supervisor (Job Cash)' : ow.paid_by_role === 'admin' ? 'Admin (Direct)' : '—',
            ow.payment_reference || '',
          ]);
        }
      }
    }

    const s1Rows: CellValue[][] = [
      [`SUNVILOZ Clean Care — Monthly Worker Payments (${month})`],
      ['Earnings basis: Job Completion Date | Paid This Month basis: Actual Payment Date'],
      [],
      ['Worker', 'Completed Jobs', 'Earned This Month (BDT)', 'Paid This Month (BDT)', 'Unpaid at Month End (BDT)'],
    ];
    let totJobs = 0;
    let totEarned = 0;
    let totPaid = 0;
    let totUnpaid = 0;
    for (const r of workerSummary.values()) {
      totJobs += r.completedJobs;
      totEarned += r.earnedThisMonth;
      totPaid += r.paidThisMonth;
      totUnpaid += r.unpaidAtMonthEnd;
      s1Rows.push([r.name, r.completedJobs, r.earnedThisMonth, r.paidThisMonth, r.unpaidAtMonthEnd]);
    }
    s1Rows.push(['TOTAL', totJobs, totEarned, totPaid, totUnpaid]);

    return {
      bytes: buildXlsxBytes([
        { name: 'Monthly Worker Payments', rows: s1Rows, headerRowIndices: [3], totalRowIndices: [s1Rows.length - 1] },
        { name: 'Supporting Ledger', rows: detailRows, headerRowIndices: [0] },
      ]),
      fileName: `SUNVILOZ_Worker_Payments_${month}.xlsx`,
    };
  }

  // lead_source
  const dateFrom = filters.dateFrom || '';
  const dateTo = filters.dateTo || '';
  const sources = [
    'Facebook', 'Google', 'Existing Customer', 'Agent Referral', 'Caretaker Referral', 'Other', 'Not Specified',
  ];
  const orderById = new Map(bootstrap.orders.map((o) => [o.order_id, o]));
  const rows: CellValue[][] = [
    [`SUNVILOZ Clean Care — Lead Source & Conversion Report (${dateFrom} to ${dateTo})`],
    ['Conversion counts unique prospects added in period who booked by period end; Confirmed Orders counted by booking date.'],
    [],
    ['Lead Source', 'New Prospects', 'Prospects Converted to Confirmed Bookings', 'Conversion Rate (%)', 'Confirmed Orders (by Booking Date)'],
  ];
  let totalProspects = 0;
  let totalConverted = 0;
  let totalOrders = 0;

  for (const src of sources) {
    const newLeads = bootstrap.leads.filter((l) => {
      const createdDate = (l.created_at || '').slice(0, 10);
      return normalizeLeadSource(l.lead_source) === src && createdDate >= dateFrom && createdDate <= dateTo;
    });
    const convertedLeads = newLeads.filter((l) => {
      const linkedOrders = bootstrap.orders.filter(
        (o) =>
          (o.lead_id === l.lead_id || (l.linked_order_id && o.order_id === l.linked_order_id)) &&
          o.status !== 'Cancelled' &&
          !o.is_no_charge_visit &&
          (o.booking_date || o.created_at.slice(0, 10)) <= dateTo
      );
      if (linkedOrders.length > 0) return true;
      if (l.linked_order_id) {
        const lo = orderById.get(l.linked_order_id);
        if (lo && lo.status !== 'Cancelled' && (lo.booking_date || lo.created_at.slice(0, 10)) <= dateTo) {
          return true;
        }
      }
      return false;
    });
    const confirmedOrders = bootstrap.orders.filter((o) => {
      const bDate = o.booking_date || o.created_at.slice(0, 10);
      return (
        !o.is_no_charge_visit &&
        o.status !== 'Cancelled' &&
        normalizeLeadSource(o.lead_source) === src &&
        bDate >= dateFrom &&
        bDate <= dateTo
      );
    });
    const rate = newLeads.length > 0 ? Number(((convertedLeads.length / newLeads.length) * 100).toFixed(1)) : 0;
    totalProspects += newLeads.length;
    totalConverted += convertedLeads.length;
    totalOrders += confirmedOrders.length;
    rows.push([src, newLeads.length, convertedLeads.length, `${rate}%`, confirmedOrders.length]);
  }
  const totalRate = totalProspects > 0 ? Number(((totalConverted / totalProspects) * 100).toFixed(1)) : 0;
  rows.push(['TOTAL', totalProspects, totalConverted, `${totalRate}%`, totalOrders]);

  return {
    bytes: buildXlsxBytes([
      { name: 'Lead Source & Conversion', rows, headerRowIndices: [3], totalRowIndices: [rows.length - 1] },
    ]),
    fileName: `SUNVILOZ_Lead_Sources_${dateFrom}_to_${dateTo}.xlsx`,
  };
}
