import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { StoreProvider, useStore } from './lib/store';
import { AppShell, ToastProvider } from './ui';
import Catalog from './screens/Catalog';
import Customers from './screens/Customers';
import Cart from './screens/Cart';
import Orders, { OrderView } from './screens/Orders';
import { PickShop, Receipt, ReceiptsList, SalesReturn, Statement } from './screens/Money';
import { Home, Login, More } from './screens/Misc';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="font-display text-xl">Something went wrong</div>
        <pre className="max-w-full whitespace-pre-wrap rounded-xl bg-rose-50 p-3 text-left text-xs text-rose-700">{this.state.error.message}</pre>
        <button className="btn-primary" onClick={() => location.replace('/')}>Restart app</button>
      </div>
    );
  }
}

function RequireAuth() {
  const { ready, session, profile, permissions } = useStore();
  if (!ready) return <div className="flex h-full items-center justify-center bg-ink-950 font-display text-2xl text-gold-300">amoka</div>;
  // Offline start: allow if a profile was cached from a previous login.
  if (!session && navigator.onLine) return <Navigate to="/login" replace />;
  if (!profile?.is_active || !permissions.has('mobile_app')) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <StoreProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<RequireAuth />}>
                  <Route element={<AppShell />}>
                    <Route index element={<Home />} />
                    <Route path="catalog" element={<Catalog />} />
                    <Route path="customers" element={<Customers />} />
                    <Route path="cart" element={<Cart />} />
                    <Route path="orders" element={<Orders />} />
                    <Route path="orders/:id" element={<OrderView />} />
                    <Route path="collect/:customerId" element={<Receipt />} />
                    <Route path="return/:customerId" element={<SalesReturn />} />
                    <Route path="statement/:customerId" element={<Statement />} />
                    <Route path="pick/:action" element={<PickShop />} />
                    <Route path="receipts" element={<ReceiptsList />} />
                    <Route path="more" element={<More />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Route>
              </Routes>
            </BrowserRouter>
          </StoreProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
