import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Pencil, Plus } from 'lucide-react';
import { like, useLookup, useSave, useTable, type Row } from '../lib/data';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pager, SearchInput, useToast } from '../components/ui';
import { supabase } from '../lib/supabase';
import { useQuery } from '@tanstack/react-query';

type FieldType = 'text' | 'number' | 'int' | 'bool' | 'textarea' | 'lookup' | 'currency' | 'salesman' | 'enum';
interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;
  table?: string; // for lookup
  required?: boolean;
  options?: string[];
  upper?: boolean;
  span?: 2;
}
interface ColDef {
  key: string;
  label: string;
  render?: (r: Row) => React.ReactNode;
  num?: boolean;
}
interface MasterDef {
  title: string;
  singular: string;
  area: string;
  select?: string;
  search: string[];
  columns: ColDef[];
  fields: FieldDef[];
  idKey?: string; // currencies use code as key
  order?: string;
}

const code: FieldDef = { key: 'code', label: 'Code', required: true, upper: true };
const name: FieldDef = { key: 'name', label: 'Name', required: true };
const active: FieldDef = { key: 'is_active', label: 'Active', type: 'bool' };
const simpleCols: ColDef[] = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Name' },
];
const simple = (title: string, singular: string, area = 'masters', extra: FieldDef[] = [], extraCols: ColDef[] = []): MasterDef => ({
  title,
  singular,
  area,
  search: ['code', 'name'],
  columns: [...simpleCols, ...extraCols],
  fields: [code, name, ...extra, active],
});

export const MASTERS: Record<string, MasterDef> = {
  locations: simple('Locations', 'Location', 'masters', [
    { key: 'address', label: 'Address', type: 'textarea', span: 2 },
    { key: 'phone', label: 'Phone' },
  ]),
  customer_groups: simple('Customer Groups', 'Customer Group', 'masters', [{ key: 'discount_pct', label: 'Discount %', type: 'number' }], [
    { key: 'discount_pct', label: 'Discount %', num: true },
  ]),
  terms: simple('Terms', 'Term', 'masters', [{ key: 'days', label: 'Days', type: 'int' }], [{ key: 'days', label: 'Days', num: true }]),
  currencies: {
    title: 'Currencies',
    singular: 'Currency',
    area: 'masters',
    idKey: 'code',
    search: ['code', 'name'],
    columns: [...simpleCols, { key: 'rate', label: 'Rate', num: true }],
    fields: [code, name, { key: 'rate', label: 'Exchange rate (to base)', type: 'number' }, active],
  },
  banks: simple('Banks', 'Bank', 'masters', [
    { key: 'account_no', label: 'Account no.' },
    { key: 'branch', label: 'Branch' },
  ], [{ key: 'account_no', label: 'Account no.' }]),
  paymodes: {
    ...simple('Paymodes', 'Paymode', 'masters', [
      { key: 'is_cash', label: 'Is cash (goes into cash drawer)', type: 'bool' },
      { key: 'sort_order', label: 'Sort order', type: 'int' },
    ], [{ key: 'is_cash', label: 'Cash', render: (r) => (r.is_cash ? <Badge color="gold">Cash</Badge> : '') }]),
    order: 'sort_order',
  },
  taxes: simple('Taxes', 'Tax', 'masters', [{ key: 'rate', label: 'Rate %', type: 'number' }], [{ key: 'rate', label: 'Rate %', num: true }]),
  areas: simple('Areas', 'Area'),
  bins: {
    title: 'Bins',
    singular: 'Bin',
    area: 'stock',
    select: '*, location:locations(name)',
    search: ['code', 'name'],
    order: 'code',
    columns: [...simpleCols, { key: 'location', label: 'Location', render: (r) => r.location?.name }],
    fields: [{ key: 'location_id', label: 'Location', type: 'lookup', table: 'locations', required: true }, code, { key: 'name', label: 'Name' }, active],
  },
  categories: {
    ...simple('Categories & Sub Categories', 'Category', 'products', [
      { key: 'parent_id', label: 'Parent category (leave empty for main category)', type: 'lookup', table: 'categories', span: 2 },
    ]),
    select: '*, parent:categories!parent_id(name)',
    columns: [...simpleCols, { key: 'parent', label: 'Parent', render: (r) => r.parent?.name ?? <span className="text-ink-300">Main</span> }],
  },
  brands: simple('Brands', 'Brand', 'products'),
  uoms: simple('Units of Measure', 'UOM', 'products'),
  accounts: {
    ...simple('Chart of Accounts', 'Account', 'vouchers', [
      { key: 'type', label: 'Type', type: 'enum', options: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'], required: true },
      { key: 'parent_id', label: 'Parent account', type: 'lookup', table: 'accounts' },
    ], [{ key: 'type', label: 'Type', render: (r) => <Badge>{r.type}</Badge> }]),
    order: 'code',
  },
  customers: {
    title: 'Customers',
    singular: 'Customer',
    area: 'customers',
    select: '*, group:customer_groups(name), area:areas(name), salesman:profiles(full_name)',
    search: ['code', 'name', 'phone', 'email'],
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'group', label: 'Group', render: (r) => r.group?.name },
      { key: 'area', label: 'Area', render: (r) => r.area?.name },
      { key: 'salesman', label: 'Salesman', render: (r) => r.salesman?.full_name },
      { key: 'terms_days', label: 'Terms', num: true, render: (r) => (r.terms_days ? `${r.terms_days} d` : 'COD') },
      { key: 'credit_limit', label: 'Credit limit', num: true, render: (r) => money(r.credit_limit) },
    ],
    fields: [
      code,
      name,
      { key: 'contact_person', label: 'Contact person' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'tax_reg_no', label: 'GST / UEN no.' },
      { key: 'address', label: 'Billing address', type: 'textarea', span: 2 },
      { key: 'delivery_address', label: 'Delivery address', type: 'textarea', span: 2 },
      { key: 'group_id', label: 'Customer group', type: 'lookup', table: 'customer_groups' },
      { key: 'area_id', label: 'Area', type: 'lookup', table: 'areas' },
      { key: 'salesman_id', label: 'Salesman', type: 'salesman' },
      { key: 'currency_code', label: 'Currency', type: 'currency' },
      { key: 'terms_days', label: 'Credit terms (days)', type: 'int' },
      { key: 'credit_limit', label: 'Credit limit', type: 'number' },
      active,
    ],
  },
  suppliers: {
    title: 'Suppliers',
    singular: 'Supplier',
    area: 'suppliers',
    search: ['code', 'name', 'phone', 'email'],
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'contact_person', label: 'Contact' },
      { key: 'phone', label: 'Phone' },
      { key: 'terms_days', label: 'Terms', num: true, render: (r) => (r.terms_days ? `${r.terms_days} d` : 'COD') },
    ],
    fields: [
      code,
      name,
      { key: 'contact_person', label: 'Contact person' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'tax_reg_no', label: 'GST / UEN no.' },
      { key: 'address', label: 'Address', type: 'textarea', span: 2 },
      { key: 'currency_code', label: 'Currency', type: 'currency' },
      { key: 'terms_days', label: 'Credit terms (days)', type: 'int' },
      active,
    ],
  },
};

function LookupSelect({ table, value, onChange, exclude }: { table: string; value: unknown; onChange: (v: number | null) => void; exclude?: number }) {
  const { data } = useLookup(table);
  return (
    <select className="input" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">—</option>
      {data?.filter((o) => o.id !== exclude).map((o) => (
        <option key={o.id} value={o.id}>
          {o.code ? `${o.code} · ` : ''}
          {o.name}
        </option>
      ))}
    </select>
  );
}

function SalesmanSelect({ value, onChange }: { value: unknown; onChange: (v: string | null) => void }) {
  const { data } = useQuery({
    queryKey: ['salesmen'],
    queryFn: async () => (await supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name')).data ?? [],
  });
  return (
    <select className="input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {data?.map((o) => (
        <option key={o.id} value={o.id}>
          {o.full_name}
        </option>
      ))}
    </select>
  );
}

function CurrencySelect({ value, onChange }: { value: unknown; onChange: (v: string | null) => void }) {
  const { data } = useQuery({
    queryKey: ['currencies'],
    queryFn: async () => (await supabase.from('currencies').select('code, name').eq('is_active', true).order('code')).data ?? [],
  });
  return (
    <select className="input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {data?.map((o) => (
        <option key={o.code} value={o.code}>
          {o.code} · {o.name}
        </option>
      ))}
    </select>
  );
}

export function RecordForm({ fields, value, onChange, selfId }: { fields: FieldDef[]; value: Row; onChange: (v: Row) => void; selfId?: number }) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const v = value[f.key];
        const cls = f.span === 2 || f.type === 'textarea' ? 'sm:col-span-2' : '';
        if (f.type === 'bool')
          return (
            <label key={f.key} className={`flex items-center gap-2 text-sm ${cls}`}>
              <input type="checkbox" className="h-4 w-4 accent-ink-900" checked={!!v} onChange={(e) => set(f.key, e.target.checked)} />
              {f.label}
            </label>
          );
        let input: React.ReactNode;
        switch (f.type) {
          case 'textarea':
            input = <textarea className="input" rows={2} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} />;
            break;
          case 'number':
          case 'int':
            input = (
              <input
                className="input"
                type="number"
                step={f.type === 'int' ? 1 : 'any'}
                value={v ?? ''}
                onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))}
              />
            );
            break;
          case 'lookup':
            input = <LookupSelect table={f.table!} value={v} onChange={(x) => set(f.key, x)} exclude={selfId} />;
            break;
          case 'salesman':
            input = <SalesmanSelect value={v} onChange={(x) => set(f.key, x)} />;
            break;
          case 'currency':
            input = <CurrencySelect value={v} onChange={(x) => set(f.key, x)} />;
            break;
          case 'enum':
            input = (
              <select className="input" value={v ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">—</option>
                {f.options!.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            );
            break;
          default:
            input = (
              <input
                className="input"
                value={v ?? ''}
                required={f.required}
                onChange={(e) => set(f.key, f.upper ? e.target.value.toUpperCase() : e.target.value)}
              />
            );
        }
        return (
          <Field key={f.key} label={f.label + (f.required ? ' *' : '')} className={cls}>
            {input}
          </Field>
        );
      })}
    </div>
  );
}

const PAGE = 50;

export default function MasterPage() {
  const { entity = '' } = useParams();
  const def = MASTERS[entity];
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Row | null>(null);
  const save = useSave(entity);
  const idKey = def?.idKey ?? 'id';

  useEffect(() => {
    setPage(1);
    setSearch('');
  }, [entity]);

  const list = useTable(def ? entity : null, {
    select: def?.select,
    key: [search, page],
    build: (q) => {
      if (search) q = q.or(def.search.map((s) => `${s}.ilike.${like(search)}`).join(','));
      return q.order(def.order ?? 'name').range((page - 1) * PAGE, page * PAGE - 1);
    },
  });

  if (!def) return <ErrorBox error={`Unknown master: ${entity}`} />;
  const editable = can(def.area);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const row: Row = {};
    for (const f of def.fields) {
      let v = editing[f.key];
      if (typeof v === 'string') v = v.trim() || null;
      if ((f.type === 'number' || f.type === 'int') && v === null) v = 0;
      if (f.type === 'bool') v = !!v;
      row[f.key] = v;
    }
    if (idKey === 'id' && editing.id) row.id = editing.id;
    try {
      if (idKey !== 'id' && editing.__existing) {
        const { error } = await supabase.from(entity).update(row).eq(idKey, editing[idKey]);
        if (error) throw error;
        list.refetch();
      } else {
        await save.mutateAsync(row);
      }
      toast('ok', `${def.singular} saved`);
      setEditing(null);
    } catch (err) {
      toast('err', (err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title={def.title}
        subtitle={`${list.data?.count ?? 0} records`}
        actions={
          editable && (
            <button className="btn-primary" onClick={() => setEditing({ is_active: true })}>
              <Plus size={16} /> New {def.singular}
            </button>
          )
        }
      />
      <div className="card overflow-hidden">
        <div className="border-b border-ink-100 p-3">
          <div className="max-w-sm">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} />
          </div>
        </div>
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4"><ErrorBox error={list.error} /></div>
        ) : !list.data?.items.length ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {def.columns.map((c) => (
                    <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>
                  ))}
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r[idKey]} className="cursor-pointer" onClick={() => editable && setEditing({ ...r, __existing: true })}>
                    {def.columns.map((c) => (
                      <td key={c.key} className={c.num ? 'num' : c.key === 'code' ? 'font-medium text-ink-900' : ''}>
                        {c.render ? c.render(r) : r[c.key]}
                      </td>
                    ))}
                    <td>{r.is_active ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    <td className="w-10 text-ink-300">{editable && <Pencil size={14} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE} count={list.data?.count ?? 0} onPage={setPage} />
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.__existing ? `Edit ${def.singular}` : `New ${def.singular}`}
        size={def.fields.length > 8 ? 'lg' : 'md'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" form="master-form" disabled={save.isPending}>Save</button>
          </>
        }
      >
        {editing && (
          <form id="master-form" onSubmit={submit}>
            <RecordForm
              fields={idKey !== 'id' && editing.__existing ? def.fields.map((f) => (f.key === idKey ? { ...f, type: 'text' } : f)) : def.fields}
              value={editing}
              onChange={setEditing}
              selfId={editing.id}
            />
          </form>
        )}
      </Modal>
    </div>
  );
}
