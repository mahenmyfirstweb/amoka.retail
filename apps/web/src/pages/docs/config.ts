export type DocKind = 'sales' | 'purchase';

export interface DocTypeDef {
  label: string;
  short: string;
  area: string;
  /** Can be edited after saving (quotes / orders). */
  editable: boolean;
  /** Has a payable / receivable balance. */
  hasBalance: boolean;
  /** Conversions offered from this type. */
  convertTo: string[];
  /** For returns: must/should come from this source type. */
  sourceType?: string;
  printTitle: string;
}

export interface KindDef {
  kind: DocKind;
  base: string;
  table: string;
  linesTable: string;
  party: 'customer' | 'supplier';
  partyTable: string;
  partyLabel: string;
  createFn: string;
  updateFn: string;
  convertFn: string;
  voidFn: string;
  types: Record<string, DocTypeDef>;
}

export const SALES: KindDef = {
  kind: 'sales',
  base: '/sales',
  table: 'sales_docs',
  linesTable: 'sales_lines',
  party: 'customer',
  partyTable: 'customers',
  partyLabel: 'Customer',
  createFn: 'create_sales_document',
  updateFn: 'update_sales_doc',
  convertFn: 'convert_sales_doc',
  voidFn: 'void_sales_doc',
  types: {
    QUOTE: { label: 'Sales Quote', short: 'Quote', area: 'sales_quote', editable: true, hasBalance: false, convertTo: ['ORDER', 'INVOICE'], printTitle: 'QUOTATION' },
    ORDER: { label: 'Sales Order', short: 'Order', area: 'sales_order', editable: true, hasBalance: false, convertTo: ['INVOICE', 'DELIVERY'], printTitle: 'SALES ORDER' },
    INVOICE: { label: 'Sales Invoice', short: 'Invoice', area: 'sales_invoice', editable: false, hasBalance: true, convertTo: ['DELIVERY', 'RETURN'], printTitle: 'TAX INVOICE' },
    DELIVERY: { label: 'Delivery Order', short: 'DO', area: 'sales_delivery', editable: false, hasBalance: false, convertTo: [], printTitle: 'DELIVERY ORDER' },
    RETURN: { label: 'Sales Return', short: 'Return', area: 'sales_return', editable: false, hasBalance: false, convertTo: [], sourceType: 'INVOICE', printTitle: 'CREDIT NOTE' },
  },
};

export const PURCHASE: KindDef = {
  kind: 'purchase',
  base: '/purchase',
  table: 'purchase_docs',
  linesTable: 'purchase_lines',
  party: 'supplier',
  partyTable: 'suppliers',
  partyLabel: 'Supplier',
  createFn: 'create_purchase_doc',
  updateFn: 'update_purchase_doc',
  convertFn: 'convert_purchase_doc',
  voidFn: 'void_purchase_doc',
  types: {
    QUOTE: { label: 'Purchase Quote', short: 'Quote', area: 'purchase', editable: true, hasBalance: false, convertTo: ['ORDER'], printTitle: 'REQUEST FOR QUOTATION' },
    ORDER: { label: 'Purchase Order', short: 'PO', area: 'purchase', editable: true, hasBalance: false, convertTo: ['GRN'], printTitle: 'PURCHASE ORDER' },
    GRN: { label: 'Goods Receive', short: 'GRN', area: 'purchase', editable: false, hasBalance: true, convertTo: ['RETURN'], printTitle: 'GOODS RECEIVED NOTE' },
    RETURN: { label: 'Purchase Return / Credit Note', short: 'Return', area: 'purchase', editable: false, hasBalance: false, convertTo: [], sourceType: 'GRN', printTitle: 'PURCHASE RETURN' },
  },
};

export const kindDef = (k: DocKind) => (k === 'sales' ? SALES : PURCHASE);
