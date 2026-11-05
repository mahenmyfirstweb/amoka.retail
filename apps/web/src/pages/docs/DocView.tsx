import { BrandLogo } from '../../components/Brand';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Ban, HandCoins, Pencil, Printer } from 'lucide-react';
import { supabase, rpc } from '../../lib/supabase';
import { useSettings, type Row } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { dateFmt, money, qtyFmt } from '../../lib/format';
import { Badge, ErrorBox, Field, Loading, Modal, StatusBadge, useToast } from '../../components/ui';
import { kindDef, type DocKind } from './config';

export function CompanyHeader({ settings, title, compact }: { settings?: Row; title: string; compact?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b-2 border-gold-500 pb-5">
      <div className="flex items-start gap-4">
        <BrandLogo className={compact ? "h-12" : "h-20"} />
        <div>
        <div className="font-display text-xl font-bold tracking-wide text-ink-900">{settings?.company_name}</div>
        {!compact && (
          <div className="mt-1 space-y-0.5 text-xs text-ink-500">
            {settings?.address && <div className="whitespace-pre-line">{settings.address}</div>}
            <div>{[settings?.phone, settings?.email, settings?.website].filter(Boolean).join(' · ')}</div>
            {settings?.show_tax && settings?.tax_reg_no && <div>{settings?.tax_name} Reg. No: {settings.tax_reg_no}</div>}
          </div>
        )}
        </div>
      </div>
      <div className="text-right">
        <div className="font-display text-2xl font-semibold tracking-[0.15em] text-gold-600">{title}</div>
      </div>
    </div>
  );
}

export default function DocView({ kind }: { kind: DocKind }) {
  const def = kindDef(kind);
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const allocTable = kind === 'sales' ? 'receipt_allocations' : 'payment_allocations';
  const payRel = kind === 'sales' ? 'receipt:receipts(id, receipt_no, receipt_date, status, paymode:paymodes(name))' : 'payment:supplier_payments(id, payment_no, payment_date, status, paymode:paymodes(name))';

  const { data: doc, isLoading, error, refetch } = useQuery({
    queryKey: ['doc', kind, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(def.table)
        .select(
          `*, party:${def.partyTable}(*), location:locations(name, address, phone), user:profiles(full_name),
           lines:${def.linesTable}(*, product:products(code, uom:uoms(code))),
           source:${def.table}!source_id(id, doc_no, type),
           allocations:${allocTable}(amount, ${payRel})`,
        )
        .eq('id', Number(id))
        .single();
      if (error) throw new Error(error.message);
      const { data: children } = await supabase.from(def.table).select('id, doc_no, type, status').eq('source_id', Number(id));
      return { ...(data as Row), children: children ?? [] } as Row;
    },
  });

  // Customer's total outstanding (all invoices - returns - receipts), shown on invoice / return printouts.
  const showBalance = kind === 'sales' && !!doc?.customer_id && ['INVOICE', 'RETURN'].includes(doc?.type);
  const { data: customerBalance } = useQuery({
    queryKey: ['customer-outstanding', doc?.customer_id, doc?.updated_at],
    enabled: showBalance,
    queryFn: () => rpc<number>('customer_outstanding', { p_customer: doc!.customer_id }),
  });

  if (isLoading) return <Loading />;
  if (error || !doc) return <ErrorBox error={error ?? 'Not found'} />;
  const t = def.types[doc.type];
  const outstanding = doc.total - doc.paid - doc.credited;
  const isOpen = doc.status === 'OPEN';
  const lines = [...doc.lines].sort((a: Row, b: Row) => a.line_no - b.line_no);
  const party = doc.party;

  async function doVoid() {
    setBusy(true);
    try {
      await rpc(def.voidFn, { p_id: doc!.id, p_reason: reason || null });
      toast('ok', `${doc!.doc_no} voided`);
      setVoidOpen(false);
      refetch();
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`${def.base}/${doc.type}`} className="text-xs font-medium text-ink-400 hover:text-ink-700">← {t.label}</Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold text-ink-900">{doc.doc_no}</h1>
            <StatusBadge status={doc.status} outstanding={t.hasBalance ? outstanding : undefined} total={t.hasBalance ? doc.total : undefined} />
            {doc.is_pos && <Badge color="gold">POS</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {t.editable && isOpen && can(t.area) && (
            <button className="btn-secondary" onClick={() => nav(`${def.base}/edit/${doc.id}`)}><Pencil size={15} /> Edit</button>
          )}
          {isOpen && t.convertTo.filter((c) => can(def.types[c].area)).map((c) => (
            <button key={c} className="btn-secondary" onClick={() => nav(`${def.base}/new/${c}?from=${doc.id}`)}>
              <ArrowRightLeft size={15} /> {def.types[c].short}
            </button>
          ))}
          {t.hasBalance && doc.status !== 'VOID' && outstanding > 0.004 && party && (
            kind === 'sales'
              ? can('receipts') && <button className="btn-gold" onClick={() => nav(`/receipts/new?customer=${party.id}&doc=${doc.id}`)}><HandCoins size={15} /> Receive payment</button>
              : can('payments') && <button className="btn-gold" onClick={() => nav(`/payments/new?supplier=${party.id}&doc=${doc.id}`)}><HandCoins size={15} /> Make payment</button>
          )}
          <button className="btn-primary" onClick={() => window.print()}><Printer size={15} /> Print</button>
          {doc.status !== 'VOID' && can('void_docs') && (
            <button className="btn-ghost text-rose-600" onClick={() => setVoidOpen(true)}><Ban size={15} /> Void</button>
          )}
        </div>
      </div>

      {doc.status === 'VOID' && (
        <div className="no-print mb-4"><ErrorBox error={`This document is VOID.${doc.void_reason ? ` Reason: ${doc.void_reason}` : ''}`} /></div>
      )}

      <div className="card print-area relative p-8 sm:p-10">
        {doc.status === 'VOID' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-20deg] font-display text-8xl font-bold text-rose-500/15">VOID</span>
          </div>
        )}
        <CompanyHeader settings={settings} title={t.printTitle === 'TAX INVOICE' && !settings?.show_tax ? 'INVOICE' : t.printTitle} />

        <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{kind === 'sales' ? 'Bill to' : 'Supplier'}</div>
            {party ? (
              <div className="mt-1.5">
                <div className="font-semibold text-ink-900">{party.name}</div>
                {party.address && <div className="whitespace-pre-line text-ink-600">{party.address}</div>}
                <div className="text-ink-600">{[party.phone, party.email].filter(Boolean).join(' · ')}</div>
                {party.tax_reg_no && <div className="text-ink-600">GST/UEN: {party.tax_reg_no}</div>}
                {kind === 'sales' && doc.type === 'DELIVERY' && party.delivery_address && (
                  <div className="mt-2"><span className="text-[11px] font-semibold uppercase text-ink-400">Deliver to</span><div className="whitespace-pre-line">{party.delivery_address}</div></div>
                )}
              </div>
            ) : (
              <div className="mt-1.5 text-ink-600">Walk-in customer</div>
            )}
          </div>
          <div className="justify-self-end">
            <table className="text-sm">
              <tbody>
                {[
                  ['No.', doc.doc_no],
                  ['Date', dateFmt(doc.doc_date)],
                  doc.due_date && ['Due date', dateFmt(doc.due_date)],
                  doc.ref_no && [kind === 'purchase' ? 'Supplier ref' : 'Your ref', doc.ref_no],
                  doc.source && ['From', doc.source.doc_no],
                  party?.terms_days ? ['Terms', `${party.terms_days} days`] : null,
                  ['Location', doc.location?.name],
                  [kind === 'sales' ? 'Salesperson' : 'Prepared by', doc.user?.full_name],
                ]
                  .filter(Boolean)
                  .map((r) => (
                    <tr key={(r as string[])[0]}>
                      <td className="pr-4 text-ink-400">{(r as string[])[0]}</td>
                      <td className="text-right font-medium text-ink-900">{(r as string[])[1]}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-y border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <th className="py-2 text-left font-semibold">#</th>
              <th className="py-2 text-left font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Qty</th>
              {doc.type !== 'DELIVERY' && (
                <>
                  <th className="py-2 text-right font-semibold">Price</th>
                  <th className="py-2 text-right font-semibold">Disc.</th>
                  <th className="py-2 text-right font-semibold">Amount</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((l: Row, i: number) => (
              <tr key={l.id} className="border-b border-ink-100">
                <td className="py-2 align-top text-ink-400">{i + 1}</td>
                <td className="py-2">
                  <div className="font-medium text-ink-900">{l.description}</div>
                  <div className="text-xs text-ink-400">{l.product?.code}</div>
                </td>
                <td className="py-2 text-right tabular-nums">{qtyFmt(l.qty)} {l.product?.uom?.code}</td>
                {doc.type !== 'DELIVERY' && (
                  <>
                    <td className="py-2 text-right tabular-nums">{money(l.price)}</td>
                    <td className="py-2 text-right tabular-nums">{Number(l.discount) ? money(l.discount) : ''}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{money(l.line_total)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {doc.type !== 'DELIVERY' ? (
          <div className="mt-6 flex justify-end">
            <div className="w-72 space-y-1.5 text-sm">
              {Number(doc.discount) > 0 && <div className="flex justify-between"><span className="text-ink-500">Discount</span><span className="tabular-nums">-{money(doc.discount)}</span></div>}
              {settings?.show_tax && (
                <>
                  <div className="flex justify-between"><span className="text-ink-500">Subtotal</span><span className="tabular-nums">{money(doc.subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-500">{settings?.tax_name} {Number(settings?.tax_rate)}%</span><span className="tabular-nums">{money(doc.tax)}</span></div>
                </>
              )}
              <div className="flex justify-between border-t-2 border-ink-900 pt-2 text-base font-bold text-ink-900">
                <span>Total {settings?.currency}</span><span className="tabular-nums">{money(doc.total)}</span>
              </div>
              {t.hasBalance && (
                <>
                  {Number(doc.paid) > 0 && <div className="flex justify-between text-ink-500"><span>Paid</span><span className="tabular-nums">-{money(doc.paid)}</span></div>}
                  {Number(doc.credited) > 0 && <div className="flex justify-between text-ink-500"><span>Credited (returns)</span><span className="tabular-nums">-{money(doc.credited)}</span></div>}
                  <div className="flex justify-between font-semibold text-ink-900"><span>Balance due</span><span className="tabular-nums">{money(outstanding)}</span></div>
                </>
              )}
              {showBalance && customerBalance !== undefined && (
                <div className="mt-3 flex justify-between rounded-lg bg-ink-900 px-3 py-2 font-semibold text-white">
                  <span>Total outstanding (all invoices)</span>
                  <span className="tabular-nums">{settings?.currency} {money(Number(customerBalance))}</span>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {doc.type === 'RETURN' && kind === 'sales' && (
          <div className="mt-6 text-sm text-ink-600">
            <b>Return reason:</b> {String(doc.return_reason ?? '—').replace('_', ' ').toLowerCase()}
            {' · '}{doc.restock ? 'Goods returned to stock' : 'Goods written off (not resaleable)'}
          </div>
        )}
        {doc.notes && <div className="mt-6 whitespace-pre-line text-sm text-ink-600"><b>Notes:</b> {doc.notes}</div>}
        {kind === 'sales' && settings?.invoice_terms && doc.type === 'INVOICE' && (
          <div className="mt-6 whitespace-pre-line text-xs text-ink-400">{settings.invoice_terms}</div>
        )}
        {doc.signature_url && (
          <div className="mt-6"><div className="text-xs text-ink-400">Customer signature</div><img src={doc.signature_url} alt="signature" className="h-20" /></div>
        )}
        <div className="mt-16 grid grid-cols-2 gap-16 text-xs text-ink-500">
          <div className="border-t border-ink-300 pt-2">Authorised signature</div>
          <div className="border-t border-ink-300 pt-2">{kind === 'sales' ? 'Received in good order & condition' : 'Received by'}</div>
        </div>
      </div>

      {(doc.allocations?.length > 0 || doc.children?.length > 0) && (
        <div className="no-print mt-5 grid gap-5 md:grid-cols-2">
          {doc.allocations?.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-3 font-semibold text-ink-900">Payments</h3>
              <table className="table">
                <tbody>
                  {doc.allocations.map((a: Row, i: number) => {
                    const r = a.receipt ?? a.payment;
                    return (
                      <tr key={i}>
                        <td><Link className="font-medium hover:text-gold-600" to={kind === 'sales' ? `/receipts/${r.id}` : `/payments/${r.id}`}>{r.receipt_no ?? r.payment_no}</Link></td>
                        <td>{dateFmt(r.receipt_date ?? r.payment_date)}</td>
                        <td>{r.paymode?.name}</td>
                        <td className="num">{money(a.amount)}</td>
                        <td>{r.status === 'VOID' && <Badge color="red">Void</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {doc.children?.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-3 font-semibold text-ink-900">Linked documents</h3>
              {doc.children.map((c: Row) => (
                <Link key={c.id} to={`${def.base}/doc/${c.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50">
                  <span className="font-medium">{c.doc_no} <span className="text-ink-400">· {def.types[c.type]?.label}</span></span>
                  <StatusBadge status={c.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={`Void ${doc.doc_no}?`}
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setVoidOpen(false)}>Cancel</button>
            <button className="btn-danger" onClick={doVoid} disabled={busy}>Void document</button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-500">Stock effects are reversed. This cannot be undone.</p>
        <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Modal>
    </div>
  );
}
