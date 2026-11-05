import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import { like, useTable } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { dateFmt, money } from '../../lib/format';
import { Empty, ErrorBox, Loading, PageHeader, Pager, SearchInput, StatusBadge } from '../../components/ui';
import { kindDef, type DocKind } from './config';

const PAGE = 50;

export default function DocList({ kind, voidOnly }: { kind: DocKind; voidOnly?: boolean }) {
  const def = kindDef(kind);
  const params = useParams();
  const type = voidOnly ? 'INVOICE' : (params.type ?? '').toUpperCase();
  const t = def.types[type];
  const { can } = useAuth();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const list = useTable(t ? def.table : null, {
    select: `*, party:${def.partyTable}(code, name), location:locations(name)`,
    key: [type, search, status, from, to, page, voidOnly],
    build: (q) => {
      q = q.eq('type', type);
      if (voidOnly) q = q.eq('status', 'VOID');
      else if (status === 'UNPAID') q = q.neq('status', 'VOID');
      else if (status) q = q.eq('status', status);
      if (search) q = q.or(`doc_no.ilike.${like(search)},ref_no.ilike.${like(search)}`);
      if (from) q = q.gte('doc_date', `${from}T00:00:00`);
      if (to) q = q.lte('doc_date', `${to}T23:59:59`);
      return q.order('id', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
    },
  });

  if (!t) return <ErrorBox error={`Unknown document type ${type}`} />;
  let items = list.data?.items ?? [];
  if (status === 'UNPAID') items = items.filter((d) => d.total - d.paid - d.credited > 0.004);

  return (
    <div>
      <PageHeader
        title={voidOnly ? 'Deleted (Void) Invoices' : t.label}
        subtitle={voidOnly ? 'Invoices that were voided, with the reason' : undefined}
        actions={
          !voidOnly &&
          can(t.area) && (
            <button className="btn-primary" onClick={() => nav(`${def.base}/new/${type}`)}>
              <Plus size={16} /> New {t.short}
            </button>
          )
        }
      />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
          <div className="w-64"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Doc no. or reference…" /></div>
          {!voidOnly && (
            <select className="input w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All status</option>
              <option value="OPEN">Open</option>
              {t.convertTo.length > 0 && <option value="CONVERTED">Converted</option>}
              {t.hasBalance && <option value="UNPAID">Unpaid / partial</option>}
              <option value="VOID">Void</option>
            </select>
          )}
          <input type="date" className="input w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <span className="text-ink-300">–</span>
          <input type="date" className="input w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
        {list.isLoading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} /></div> : !items.length ? <Empty>No documents found</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Date</th>
                  <th>{def.partyLabel}</th>
                  <th>Location</th>
                  <th>Ref</th>
                  <th className="num">Total</th>
                  {t.hasBalance && <th className="num">Balance</th>}
                  <th>{voidOnly ? 'Reason' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => {
                  const bal = d.total - d.paid - d.credited;
                  return (
                    <tr key={d.id}>
                      <td><Link className="font-medium text-ink-900 hover:text-gold-600" to={`${def.base}/doc/${d.id}`}>{d.doc_no}</Link>{d.is_pos && <span className="ml-1.5 text-[10px] font-semibold text-gold-600">POS</span>}</td>
                      <td className="whitespace-nowrap">{dateFmt(d.doc_date)}</td>
                      <td>{d.party?.name ?? <span className="text-ink-400">Walk-in</span>}</td>
                      <td>{d.location?.name}</td>
                      <td>{d.ref_no}</td>
                      <td className="num font-medium">{money(d.total)}</td>
                      {t.hasBalance && <td className="num">{d.status === 'VOID' ? '—' : money(bal)}</td>}
                      <td>{voidOnly ? <span className="text-xs text-ink-500">{d.void_reason || '—'}</span> : <StatusBadge status={d.status} outstanding={t.hasBalance ? bal : undefined} total={t.hasBalance ? d.total : undefined} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE} count={list.data?.count ?? 0} onPage={setPage} />
      </div>
    </div>
  );
}
