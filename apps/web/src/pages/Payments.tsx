import { downloadReceiptPdf, loadReceipt, printReceipt80, receiptHtml80, whatsappReceipt, type PaymentReceiptData } from '../lib/thermal';
import { PrintPreview } from '../components/PrintPreview';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, FileDown, MessageCircle, Plus, Printer } from 'lucide-react';
import { supabase, rpc } from '../lib/supabase';
import { like, useBanks, usePaymodes, useSettings, useTable, type Row } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateFmt, isoDate, money, round2 } from '../lib/format';
import { Badge, Empty, ErrorBox, Field, Loading, PageHeader, Pager, SearchInput, useToast } from '../components/ui';
import { PartyPicker } from '../components/Pickers';
import { CompanyHeader } from './docs/DocView';

type Kind = 'receipt' | 'payment';
const CFG = {
  receipt: {
    title: 'Receipts', singular: 'Receipt', base: '/receipts', table: 'receipts', no: 'receipt_no', date: 'receipt_date',
    party: 'customer', partyTable: 'customers' as const, docTable: 'sales_docs', docType: 'INVOICE', docBase: '/sales',
    allocTable: 'receipt_allocations', fn: 'create_receipt', voidFn: 'void_receipt', area: 'receipts', printTitle: 'OFFICIAL RECEIPT',
  },
  payment: {
    title: 'Supplier Payments', singular: 'Payment', base: '/payments', table: 'supplier_payments', no: 'payment_no', date: 'payment_date',
    party: 'supplier', partyTable: 'suppliers' as const, docTable: 'purchase_docs', docType: 'GRN', docBase: '/purchase',
    allocTable: 'payment_allocations', fn: 'create_supplier_payment', voidFn: 'void_supplier_payment', area: 'payments', printTitle: 'PAYMENT VOUCHER',
  },
};

const PAGE = 50;

export function PaymentList({ kind }: { kind: Kind }) {
  const c = CFG[kind];
  const { can } = useAuth();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const list = useTable(c.table, {
    select: `*, party:${c.partyTable}(name), paymode:paymodes(name)`,
    key: [search, page],
    build: (q) => {
      if (search) q = q.ilike(c.no, like(search));
      return q.order('id', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
    },
  });
  return (
    <div>
      <PageHeader
        title={c.title}
        actions={can(c.area) && <button className="btn-primary" onClick={() => nav(`${c.base}/new`)}><Plus size={16} /> New {c.singular}</button>}
      />
      <div className="card overflow-hidden">
        <div className="border-b border-ink-100 p-3"><div className="w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={`${c.singular} no…`} /></div></div>
        {list.isLoading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} /></div> : !list.data?.items.length ? <Empty /> : (
          <table className="table">
            <thead><tr><th>No.</th><th>Date</th><th>{kind === 'receipt' ? 'Customer' : 'Supplier'}</th><th>Paymode</th><th>Reference</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <td><Link className="font-medium text-ink-900 hover:text-gold-600" to={`${c.base}/${r.id}`}>{r[c.no]}</Link></td>
                  <td>{dateFmt(r[c.date])}</td>
                  <td>{r.party?.name ?? <span className="text-ink-400">Walk-in</span>}</td>
                  <td>{r.paymode?.name}</td>
                  <td>{[r.reference, r.cheque_no && `Chq ${r.cheque_no}`].filter(Boolean).join(' · ')}</td>
                  <td className="num font-medium">{money(r.amount)}</td>
                  <td>{r.status === 'VOID' ? <Badge color="red">Void</Badge> : <Badge color="green">Active</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager page={page} pageSize={PAGE} count={list.data?.count ?? 0} onPage={setPage} />
      </div>
    </div>
  );
}

export function PaymentNew({ kind }: { kind: Kind }) {
  const c = CFG[kind];
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { locationId } = useAuth();
  const { data: paymodes } = usePaymodes();
  const { data: banks } = useBanks();
  const [party, setParty] = useState<Row | null>(null);
  const [paymodeId, setPaymodeId] = useState<number | ''>('');
  const [bankId, setBankId] = useState<number | ''>('');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(isoDate());
  const [reference, setReference] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [notes, setNotes] = useState('');
  const [alloc, setAlloc] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Preselect party from ?customer= / ?supplier=
  useEffect(() => {
    const pid = sp.get(c.party);
    if (pid) supabase.from(c.partyTable).select('*').eq('id', Number(pid)).single().then(({ data }) => data && setParty(data));
  }, [sp, c]);
  useEffect(() => {
    if (paymodes?.length && paymodeId === '') setPaymodeId(paymodes[0].id);
  }, [paymodes, paymodeId]);

  const { data: openDocs = [] } = useQuery({
    queryKey: ['open-docs', kind, party?.id],
    enabled: !!party,
    queryFn: async () => {
      const { data } = await supabase
        .from(c.docTable)
        .select('id, doc_no, doc_date, due_date, total, paid, credited, ref_no')
        .eq('type', c.docType)
        .eq(`${c.party}_id`, party!.id)
        .neq('status', 'VOID')
        .order('doc_date');
      return (data ?? []).map((d) => ({ ...d, outstanding: round2(d.total - d.paid - d.credited) })).filter((d) => d.outstanding > 0.004);
    },
  });

  // When a specific doc is passed (?doc=), allocate its full balance.
  useEffect(() => {
    const docId = Number(sp.get('doc'));
    const d = openDocs.find((x) => x.id === docId);
    if (d && !Object.keys(alloc).length) {
      setAlloc({ [d.id]: d.outstanding });
      setAmount(d.outstanding);
    }
  }, [openDocs, sp, alloc]);

  const allocated = round2(Object.values(alloc).reduce((s, v) => s + (v || 0), 0));
  const totalOutstanding = round2(openDocs.reduce((s, d) => s + d.outstanding, 0));

  function autoAllocate(amt: number) {
    let left = amt;
    const next: Record<number, number> = {};
    for (const d of openDocs) {
      if (left <= 0) break;
      const a = round2(Math.min(left, d.outstanding));
      next[d.id] = a;
      left = round2(left - a);
    }
    setAlloc(next);
  }

  const pm = paymodes?.find((p) => p.id === paymodeId);
  const isCheque = pm?.code === 'CHEQUE';

  async function save() {
    setError(null);
    if (!party) return setError(`Select a ${c.party}`);
    if (!paymodeId) return setError('Select a paymode');
    if (!(amount > 0)) return setError('Enter the amount');
    if (allocated - amount > 0.004) return setError('Allocated amount is more than the amount received');
    setSaving(true);
    try {
      const p: Row = {
        [`${c.party}_id`]: party.id,
        location_id: locationId,
        paymode_id: paymodeId,
        bank_id: bankId || null,
        amount,
        [c.date]: new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
        reference: reference || null,
        cheque_no: chequeNo || null,
        cheque_date: chequeDate || null,
        notes: notes || null,
        allocations: Object.entries(alloc).filter(([, v]) => v > 0).map(([doc_id, v]) => ({ doc_id: Number(doc_id), amount: v })),
      };
      const r = await rpc<Row>(c.fn, { p });
      qc.invalidateQueries();
      toast('ok', `${r[c.no]} saved`);
      nav(`${c.base}/${r.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`New ${c.singular}`}
        back={c.base}
        actions={<><button className="btn-secondary" onClick={() => nav(-1)}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>Save {c.singular}</button></>}
      />
      <div className="space-y-4">
        <ErrorBox error={error} />
        <div className="card grid gap-4 p-5 md:grid-cols-4">
          <Field label={`${kind === 'receipt' ? 'Customer' : 'Supplier'} *`} className="md:col-span-2">
            <PartyPicker table={c.partyTable} value={party} onChange={(p) => { setParty(p); setAlloc({}); }} />
          </Field>
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Paymode *">
            <select className="input" value={paymodeId} onChange={(e) => setPaymodeId(Number(e.target.value))}>
              {paymodes?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Amount *">
            <input type="number" step="any" min="0" className="input num text-lg font-semibold" value={amount || ''} onChange={(e) => { const v = Number(e.target.value); setAmount(v); autoAllocate(v); }} />
          </Field>
          <Field label="Bank">
            <select className="input" value={bankId} onChange={(e) => setBankId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">—</option>
              {banks?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          {isCheque && (
            <>
              <Field label="Cheque no."><input className="input" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></Field>
              <Field label="Cheque date"><input type="date" className="input" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} /></Field>
            </>
          )}
          <Field label="Reference"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label="Notes" className="md:col-span-4"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
            <h3 className="font-semibold text-ink-900">Outstanding {kind === 'receipt' ? 'invoices' : 'GRNs'}</h3>
            {party && <button className="btn-secondary btn-sm" onClick={() => { setAmount(totalOutstanding); autoAllocate(totalOutstanding); }}>Pay all {money(totalOutstanding)}</button>}
          </div>
          {!party ? <Empty>Select a {c.party} to see open documents</Empty> : !openDocs.length ? <Empty>No outstanding documents — the amount will be saved as an advance / on account.</Empty> : (
            <table className="table">
              <thead><tr><th>No.</th><th>Date</th><th>Due</th><th className="num">Total</th><th className="num">Outstanding</th><th className="w-40 num">Allocate</th></tr></thead>
              <tbody>
                {openDocs.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.doc_no}{d.ref_no && <span className="ml-1 text-xs text-ink-400">({d.ref_no})</span>}</td>
                    <td>{dateFmt(d.doc_date)}</td>
                    <td className={d.due_date && new Date(d.due_date) < new Date() ? 'font-medium text-rose-600' : ''}>{dateFmt(d.due_date)}</td>
                    <td className="num">{money(d.total)}</td>
                    <td className="num font-medium">{money(d.outstanding)}</td>
                    <td><input type="number" step="any" min="0" max={d.outstanding} className="input num py-1.5" value={alloc[d.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [d.id]: Number(e.target.value) })} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={4} className="px-3 py-2.5 text-right">Allocated / unallocated</td>
                  <td className="num px-3">{money(allocated)}</td>
                  <td className={`num px-3 ${amount - allocated < -0.004 ? 'text-rose-600' : 'text-ink-500'}`}>{money(amount - allocated)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export function PaymentView({ kind }: { kind: Kind }) {
  const c = CFG[kind];
  const { id } = useParams();
  const toast = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const [previewData, setPreviewData] = useState<PaymentReceiptData | null>(null);
  const { data: r, isLoading, refetch } = useQuery({
    queryKey: ['payment', kind, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(c.table)
        .select(`*, party:${c.partyTable}(*), paymode:paymodes(name), bank:banks(name), user:profiles(full_name), allocations:${c.allocTable}(amount, doc:${c.docTable}(id, doc_no, doc_date, total))`)
        .eq('id', Number(id))
        .single();
      if (error) throw new Error(error.message);
      return data as Row;
    },
  });
  if (isLoading || !r) return <Loading />;

  /** 80mm print / PDF / WhatsApp for customer receipts. */
  async function thermal(action: 'print' | 'pdf' | 'whatsapp') {
    try {
      const data = await loadReceipt(r!.id, settings ?? null);
      if (action === 'print') { setPreviewData(data); return; }
      else if (action === 'pdf') await downloadReceiptPdf(data);
      else if ((await whatsappReceipt(data)) === 'fallback') toast('ok', 'PDF downloaded and WhatsApp opened — attach the PDF to send');
    } catch (e) {
      toast('err', (e as Error).message);
    }
  }

  async function doVoid() {
    if (!confirm(`Void ${r![c.no]}? Allocated documents become unpaid again.`)) return;
    try {
      await rpc(c.voidFn, { p_id: r!.id });
      toast('ok', 'Voided');
      refetch();
    } catch (e) {
      toast('err', (e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-5 flex items-center justify-between">
        <Link to={c.base} className="text-xs font-medium text-ink-400 hover:text-ink-700">← {c.title}</Link>
        <div className="flex gap-2">
          {kind === 'receipt' ? (
            <>
              <button className="btn-primary" onClick={() => thermal('print')}><Printer size={15} /> Print 80mm</button>
              <button className="btn-secondary" onClick={() => window.print()}><Printer size={15} /> A4</button>
              <button className="btn-secondary" onClick={() => thermal('pdf')}><FileDown size={15} /> PDF</button>
              <button className="btn-secondary !text-emerald-700" onClick={() => thermal('whatsapp')}><MessageCircle size={15} /> WhatsApp</button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => window.print()}><Printer size={15} /> Print</button>
          )}
          {r.status !== 'VOID' && can('void_docs') && <button className="btn-ghost text-rose-600" onClick={doVoid}><Ban size={15} /> Void</button>}
        </div>
      </div>
      <PrintPreview html={previewData ? receiptHtml80(previewData) : null} title={`Receipt ${previewData?.receipt.receipt_no ?? ""}`} onClose={() => setPreviewData(null)} onPrint={() => printReceipt80(previewData!)} onPdf={() => downloadReceiptPdf(previewData!)} onWhatsapp={() => whatsappReceipt(previewData!)} />
      <div className="card print-area p-8">
        <CompanyHeader settings={settings} title={c.printTitle} />
        {r.status === 'VOID' && <div className="mt-4"><Badge color="red">VOID</Badge></div>}
        <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{kind === 'receipt' ? 'Received from' : 'Paid to'}</div>
            <div className="mt-1 font-semibold text-ink-900">{r.party?.name ?? 'Walk-in customer'}</div>
            {r.party?.address && <div className="whitespace-pre-line text-ink-600">{r.party.address}</div>}
          </div>
          <div className="justify-self-end text-right">
            <div><span className="text-ink-400">No. </span><b>{r[c.no]}</b></div>
            <div><span className="text-ink-400">Date </span>{dateFmt(r[c.date])}</div>
            <div><span className="text-ink-400">Paymode </span>{r.paymode?.name}</div>
            {r.bank && <div><span className="text-ink-400">Bank </span>{r.bank.name}</div>}
            {r.cheque_no && <div><span className="text-ink-400">Cheque </span>{r.cheque_no} {r.cheque_date && `(${dateFmt(r.cheque_date)})`}</div>}
            {r.reference && <div><span className="text-ink-400">Ref </span>{r.reference}</div>}
          </div>
        </div>
        <table className="mt-6 w-full text-sm">
          <thead><tr className="border-y border-ink-200 text-[11px] uppercase tracking-wider text-ink-500"><th className="py-2 text-left">Document</th><th className="py-2 text-left">Date</th><th className="py-2 text-right">Doc total</th><th className="py-2 text-right">Applied</th></tr></thead>
          <tbody>
            {r.allocations?.map((a: Row, i: number) => (
              <tr key={i} className="border-b border-ink-100">
                <td className="py-2"><Link to={`${c.docBase}/doc/${a.doc.id}`} className="hover:text-gold-600">{a.doc.doc_no}</Link></td>
                <td className="py-2">{dateFmt(a.doc.doc_date)}</td>
                <td className="py-2 text-right tabular-nums">{money(a.doc.total)}</td>
                <td className="py-2 text-right tabular-nums">{money(a.amount)}</td>
              </tr>
            ))}
            {!r.allocations?.length && <tr><td colSpan={4} className="py-3 text-ink-400">On account (not allocated)</td></tr>}
          </tbody>
        </table>
        <div className="mt-6 flex justify-end">
          <div className="rounded-xl bg-ink-900 px-6 py-3 text-right text-white">
            <div className="text-[11px] uppercase tracking-wider text-gold-300">Amount</div>
            <div className="text-2xl font-semibold tabular-nums">{settings?.currency} {money(r.amount)}</div>
          </div>
        </div>
        {r.notes && <p className="mt-4 text-sm text-ink-600">{r.notes}</p>}
        <div className="mt-16 grid grid-cols-2 gap-16 text-xs text-ink-500">
          <div className="border-t border-ink-300 pt-2">Prepared by {r.user?.full_name}</div>
          <div className="border-t border-ink-300 pt-2">{kind === 'receipt' ? 'Received by' : 'Authorised signature'}</div>
        </div>
      </div>
    </div>
  );
}
