import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { Loading, ToastProvider } from './components/ui';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MasterPage from './pages/MasterPage';
import Products, { PriceChanges, ProductStock, StockMovements } from './pages/Products';
import DocList from './pages/docs/DocList';
import DocEditor from './pages/docs/DocEditor';
import DocView from './pages/docs/DocView';
import { PaymentList, PaymentNew, PaymentView } from './pages/Payments';
import { StockList, StockNew, StockView } from './pages/Stock';
import Pos from './pages/Pos';
import { AgingReport, CustomerStatement, SalesReport } from './pages/Reports';
import { CustomerOutstandingReport, ReceiptReport } from './pages/Reports2';
import {
  Account, DataImport, OpeningBalances, PosSessions, PriceList, Roles, Settings, Users, VoucherList, VoucherNew, VoucherView,
} from './pages/Admin';

/** Shows the error instead of a blank page if any screen crashes. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-2xl text-ink-900">Something went wrong on this screen</h1>
        <pre className="max-w-2xl whitespace-pre-wrap rounded-lg bg-rose-50 p-4 text-left text-xs text-rose-700">{this.state.error.message}</pre>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => history.back()}>Go back</button>
          <button className="btn-primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 10_000 } },
});

function RequireAuth() {
  const { loading, session, profile, can, signOut } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center"><Loading /></div>;
  if (!session || !profile?.is_active) return <Navigate to="/login" replace />;
  if (!can('web_portal')) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="font-display text-2xl">Please use the amoka.retail mobile app</h1>
        <p className="max-w-md text-sm text-ink-500">Your role ({profile.role}) does not have access to the web portal.</p>
        <button className="btn-secondary" onClick={signOut}>Sign out</button>
      </div>
    );
  }
  return <Outlet />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route path="/pos" element={<Pos />} />
                <Route element={<Layout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="m/:entity" element={<MasterPage />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="account" element={<Account />} />
                  <Route path="users" element={<Users />} />
                  <Route path="roles" element={<Roles />} />

                  <Route path="products" element={<Products />} />
                  <Route path="products/stock" element={<ProductStock />} />
                  <Route path="products/price-changes" element={<PriceChanges />} />
                  <Route path="prices/customer" element={<PriceList kind="customer" />} />
                  <Route path="prices/supplier" element={<PriceList kind="supplier" />} />

                  <Route path="sales/new/:type" element={<DocEditor kind="sales" />} />
                  <Route path="sales/edit/:id" element={<DocEditor kind="sales" />} />
                  <Route path="sales/doc/:id" element={<DocView kind="sales" />} />
                  <Route path="sales/:type" element={<DocList kind="sales" />} />
                  <Route path="deleted" element={<DocList kind="sales" voidOnly />} />
                  <Route path="receipts" element={<PaymentList kind="receipt" />} />
                  <Route path="receipts/new" element={<PaymentNew kind="receipt" />} />
                  <Route path="receipts/:id" element={<PaymentView kind="receipt" />} />
                  <Route path="statement" element={<CustomerStatement />} />

                  <Route path="purchase/new/:type" element={<DocEditor kind="purchase" />} />
                  <Route path="purchase/edit/:id" element={<DocEditor kind="purchase" />} />
                  <Route path="purchase/doc/:id" element={<DocView kind="purchase" />} />
                  <Route path="purchase/:type" element={<DocList kind="purchase" />} />
                  <Route path="payments" element={<PaymentList kind="payment" />} />
                  <Route path="payments/new" element={<PaymentNew kind="payment" />} />
                  <Route path="payments/:id" element={<PaymentView kind="payment" />} />

                  <Route path="stock/movements" element={<StockMovements />} />
                  <Route path="stock/ADJUST" element={<StockList kind="ADJUST" />} />
                  <Route path="stock/ADJUST/new" element={<StockNew kind="ADJUST" />} />
                  <Route path="stock/ADJUST/:id" element={<StockView kind="ADJUST" />} />
                  <Route path="stock/STOCKTAKE" element={<StockList kind="STOCKTAKE" />} />
                  <Route path="stock/STOCKTAKE/new" element={<StockNew kind="STOCKTAKE" />} />
                  <Route path="stock/STOCKTAKE/:id" element={<StockView kind="STOCKTAKE" />} />
                  <Route path="stock/transfers" element={<StockList kind="TRANSFER" />} />
                  <Route path="stock/transfers/new" element={<StockNew kind="TRANSFER" />} />
                  <Route path="stock/transfers/:id" element={<StockView kind="TRANSFER" />} />
                  <Route path="stock/requests" element={<StockList kind="REQUEST" />} />
                  <Route path="stock/requests/new" element={<StockNew kind="REQUEST" />} />
                  <Route path="stock/requests/:id" element={<StockView kind="REQUEST" />} />

                  <Route path="vouchers/:type" element={<VoucherList />} />
                  <Route path="vouchers/new/:type" element={<VoucherNew />} />
                  <Route path="vouchers/view/:id" element={<VoucherView />} />

                  <Route path="import" element={<DataImport />} />
                  <Route path="opening-balances" element={<OpeningBalances />} />
                  <Route path="pos/sessions" element={<PosSessions />} />

                  <Route path="reports/customer-outstanding" element={<CustomerOutstandingReport />} />
                  <Route path="reports/receipts" element={<ReceiptReport />} />
                  <Route path="reports/sales" element={<SalesReport />} />
                  <Route path="reports/profit" element={<SalesReport profit />} />
                  <Route path="reports/receivable" element={<AgingReport kind="CUSTOMER" />} />
                  <Route path="reports/payable" element={<AgingReport kind="SUPPLIER" />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
