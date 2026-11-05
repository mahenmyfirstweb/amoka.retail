/**
 * Excel / PDF export for any report.
 * Reads the visible <table> inside the element marked data-report (header, body and footer rows),
 * so every report gets exports without duplicating its data logic.
 * The export libraries are loaded only when a button is clicked.
 */
import { useState } from 'react';
import { FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import { useSettings } from '../lib/data';
import { useToast } from './ui';

interface Extracted {
  head: string[];
  body: (string | number)[][];
  foot: (string | number)[][];
  numeric: boolean[];
}

/** Cells in "num" columns (or that look like money) become numbers. */
function toValue(text: string, isNum: boolean): string | number {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!isNum) return t;
  const cleaned = t.replace(/[^0-9.\-−]/g, '').replace('−', '-');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return t;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : t;
}

function extract(table: HTMLTableElement): Extracted {
  const visible = (el: Element) => !el.classList.contains('no-print') && (el as HTMLElement).offsetParent !== null;
  const headCells = [...(table.tHead?.rows[0]?.cells ?? [])];
  const keep = headCells.map((c) => visible(c));
  const numeric = headCells.map((c) => c.classList.contains('num') || c.classList.contains('text-right'));
  const head = headCells.filter((_, i) => keep[i]).map((c) => c.textContent?.trim() ?? '');
  const rowsOf = (section: HTMLTableSectionElement | null | undefined) =>
    [...(section?.rows ?? [])].map((r) => {
      const out: (string | number)[] = [];
      let col = 0;
      for (const cell of [...r.cells]) {
        const span = cell.colSpan || 1;
        if (keep[col] !== false && !cell.classList.contains('no-print')) {
          const isNum = cell.classList.contains('num') || cell.classList.contains('text-right') || numeric[col];
          out.push(toValue(cell.textContent ?? '', isNum && span === 1));
          for (let k = 1; k < span; k++) if (keep[col + k] !== false) out.push('');
        }
        col += span;
      }
      return out;
    });
  return {
    head,
    body: rowsOf(table.tBodies[0]),
    foot: rowsOf(table.tFoot),
    numeric: numeric.filter((_, i) => keep[i]),
  };
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_');

export function ExportButtons({ title, subtitle, landscape }: { title: string; subtitle?: string; landscape?: boolean }) {
  const toast = useToast();
  const { data: settings } = useSettings();
  const [busy, setBusy] = useState<'' | 'xlsx' | 'pdf'>('');

  function getTable() {
    const table = document.querySelector<HTMLTableElement>('[data-report] table');
    if (!table || !table.tBodies[0]?.rows.length) {
      toast('err', 'Nothing to export — the report is empty');
      return null;
    }
    return extract(table);
  }
  const fileBase = `${safeName(title)}_${new Date().toISOString().slice(0, 10)}`;

  async function excel() {
    const t = getTable();
    if (!t) return;
    setBusy('xlsx');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = settings?.company_name ?? 'amoka.retail';
      const ws = wb.addWorksheet(title.slice(0, 31));
      ws.addRow([settings?.company_name ?? '']).font = { bold: true, size: 14 };
      ws.addRow([title]).font = { bold: true, size: 12 };
      if (subtitle) ws.addRow([subtitle]).font = { italic: true, color: { argb: 'FF666666' } };
      ws.addRow([]);
      const header = ws.addRow(t.head);
      header.eachCell((c) => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E1527' } };
        c.alignment = { vertical: 'middle' };
      });
      const firstData = ws.rowCount + 1;
      t.body.forEach((r) => ws.addRow(r));
      t.foot.forEach((r) => {
        const row = ws.addRow(r);
        row.font = { bold: true };
        row.eachCell((c) => (c.border = { top: { style: 'thin' } }));
      });
      // Number format + widths
      t.head.forEach((h, i) => {
        const col = ws.getColumn(i + 1);
        const values = [h, ...t.body.map((r) => r[i])];
        col.width = Math.min(Math.max(...values.map((v) => String(v ?? '').length)) + 2, 50);
        if (t.numeric[i]) col.numFmt = '#,##0.00';
      });
      ws.views = [{ state: 'frozen', ySplit: firstData - 1 }];
      const buf = await wb.xlsx.writeBuffer();
      download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileBase}.xlsx`);
    } catch (e) {
      toast('err', `Excel export failed: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function pdf() {
    const t = getTable();
    if (!t) return;
    setBusy('pdf');
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const wide = landscape ?? t.head.length > 6;
      const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold').setFontSize(14).text(settings?.company_name ?? '', 14, 15);
      doc.setFontSize(11).text(title, 14, 22);
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110);
      doc.text([subtitle, `Printed ${new Date().toLocaleString()}`].filter(Boolean).join('   ·   '), 14, 27);
      doc.setTextColor(0);
      const fmt = (v: string | number, i: number) =>
        typeof v === 'number' && t.numeric[i] ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
      autoTable(doc, {
        startY: 31,
        head: [t.head],
        body: t.body.map((r) => r.map(fmt)),
        foot: t.foot.length ? t.foot.map((r) => r.map(fmt)) : undefined,
        showFoot: 'lastPage',
        styles: { fontSize: 8, cellPadding: 1.6 },
        headStyles: { fillColor: [14, 21, 39], textColor: 255 },
        footStyles: { fillColor: [245, 247, 251], textColor: 20, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [250, 250, 252] },
        columnStyles: Object.fromEntries(t.numeric.map((n, i) => [i, n ? { halign: 'right' } : {}]).filter(([, s]) => Object.keys(s as object).length)),
        didDrawPage: () => {
          const n = doc.getNumberOfPages();
          doc.setFontSize(7).setTextColor(140).text(`Page ${n}`, pageW - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
          doc.setTextColor(0);
        },
      });
      doc.save(`${fileBase}.pdf`);
    } catch (e) {
      toast('err', `PDF export failed: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="flex gap-2">
      <button className="btn-secondary" onClick={excel} disabled={!!busy}>
        {busy === 'xlsx' ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} className="text-emerald-600" />} Excel
      </button>
      <button className="btn-secondary" onClick={pdf} disabled={!!busy}>
        {busy === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} className="text-rose-600" />} PDF
      </button>
      <button className="btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>
    </div>
  );
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
