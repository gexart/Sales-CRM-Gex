import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { ApiError } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { CONFIGS } from "./lib/entities";
import { AppShell } from "./components/layout";
import { Spinner, ToastProvider } from "./components/ui";
import { Dashboard } from "./pages/Dashboard";
import { EntityListPage } from "./pages/EntityListPage";
import { RecordDetailPage } from "./pages/RecordDetailPage";
import { AccountWorkspace } from "./pages/AccountWorkspace";
import { OpportunitiesPage, TasksPage } from "./pages/Pipeline";
import { AuthPage, ReportsPage, SettingsPage } from "./pages/Misc";
import { AssetDetailPage, PriceBookPage, ProductsNav, SalesAssetsPage } from "./pages/Library";
import { DiscoveryPage, ImportPage, ProspectsPage } from "./pages/Prospecting";
import { CallsPage } from "./pages/Calls";
import { AuditRedirect } from "./pages/Audits";
import { OutreachMessagePage, OutreachMessagesPage, SequenceDetailPage, SequencesPage, TemplatesPage } from "./pages/Outreach";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

function Gate() {
  const { user, needsSetup, loading } = useAuth();
  if (loading)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  if (!user) return <AuthPage mode={needsSetup ? "setup" : "login"} />;
  const C = CONFIGS;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="campaigns" element={<EntityListPage key="campaigns" cfg={C.campaigns} />} />
        <Route path="campaigns/:id" element={<RecordDetailPage key="campaigns" cfg={C.campaigns} crumb={{ label: "Campaigns", to: "/campaigns" }} />} />
        <Route path="sales-assets" element={<SalesAssetsPage />} />
        <Route path="sales-assets/:id" element={<AssetDetailPage />} />
        <Route path="products" element={<EntityListPage key="products" cfg={C.products} headerExtra={<ProductsNav />} />} />
        <Route path="products/price-book" element={<PriceBookPage />} />
        <Route path="products/:id" element={<RecordDetailPage key="products" cfg={C.products} crumb={{ label: "Products", to: "/products" }} />} />
        <Route path="accounts" element={<EntityListPage key="accounts" cfg={C.accounts} />} />
        <Route path="accounts/:id" element={<AccountWorkspace />} />
        <Route path="accounts/:id/audits/:runId" element={<AccountWorkspace />} />
        <Route path="contacts" element={<EntityListPage key="contacts" cfg={C.contacts} />} />
        <Route path="contacts/:id" element={<RecordDetailPage key="contacts" cfg={C.contacts} crumb={{ label: "Contacts", to: "/contacts" }} />} />
        <Route path="prospecting" element={<ProspectsPage />} />
        <Route path="prospecting/discover" element={<DiscoveryPage />} />
        <Route path="prospecting/import" element={<ImportPage />} />
        <Route path="prospecting/:id" element={<RecordDetailPage key="prospects" cfg={C.prospects} crumb={{ label: "Prospecting", to: "/prospecting" }} />} />
        <Route path="outreach" element={<OutreachMessagesPage />} />
        <Route path="outreach/calls" element={<CallsPage />} />
        <Route path="outreach/templates" element={<TemplatesPage />} />
        <Route path="outreach/templates/:id" element={<RecordDetailPage key="templates" cfg={C.templates} crumb={{ label: "Templates", to: "/outreach/templates" }} />} />
        <Route path="outreach/sequences" element={<SequencesPage />} />
        <Route path="outreach/sequences/:id" element={<SequenceDetailPage />} />
        <Route path="outreach/:id" element={<OutreachMessagePage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:id" element={<RecordDetailPage key="tasks" cfg={C.tasks} crumb={{ label: "Tasks", to: "/tasks" }} />} />
        <Route path="opportunities" element={<OpportunitiesPage />} />
        <Route path="opportunities/:id" element={<RecordDetailPage key="opportunities" cfg={C.opportunities} crumb={{ label: "Opportunities", to: "/opportunities" }} />} />
        <Route path="audits/:runId" element={<AuditRedirect />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
