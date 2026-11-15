import { StrictMode, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { ApiError } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { CONFIGS } from "./lib/entities";
import { AppShell } from "./components/layout";
import { Spinner, ToastProvider } from "./components/ui";

// Pages load on demand so the first screen is small and fast on a phone connection.
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const EntityListPage = lazy(() => import("./pages/EntityListPage").then((m) => ({ default: m.EntityListPage })));
const RecordDetailPage = lazy(() => import("./pages/RecordDetailPage").then((m) => ({ default: m.RecordDetailPage })));
const AccountWorkspace = lazy(() => import("./pages/AccountWorkspace").then((m) => ({ default: m.AccountWorkspace })));
const OpportunitiesPage = lazy(() => import("./pages/Pipeline").then((m) => ({ default: m.OpportunitiesPage })));
const TasksPage = lazy(() => import("./pages/Pipeline").then((m) => ({ default: m.TasksPage })));
const ReportsPage = lazy(() => import("./pages/Misc").then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import("./pages/Misc").then((m) => ({ default: m.SettingsPage })));
const AuthPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.AuthPage })));
const ForgotPasswordPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.ResetPasswordPage })));
const AutopilotPage = lazy(() => import("./pages/Autopilot").then((m) => ({ default: m.AutopilotPage })));
const AssetDetailPage = lazy(() => import("./pages/Library").then((m) => ({ default: m.AssetDetailPage })));
const PriceBookPage = lazy(() => import("./pages/Library").then((m) => ({ default: m.PriceBookPage })));
const ProductsNav = lazy(() => import("./pages/Library").then((m) => ({ default: m.ProductsNav })));
const SalesAssetsPage = lazy(() => import("./pages/Library").then((m) => ({ default: m.SalesAssetsPage })));
const DiscoveryPage = lazy(() => import("./pages/Prospecting").then((m) => ({ default: m.DiscoveryPage })));
const ImportPage = lazy(() => import("./pages/Prospecting").then((m) => ({ default: m.ImportPage })));
const ProspectsPage = lazy(() => import("./pages/Prospecting").then((m) => ({ default: m.ProspectsPage })));
const CallsPage = lazy(() => import("./pages/Calls").then((m) => ({ default: m.CallsPage })));
const AuditRedirect = lazy(() => import("./pages/Audits").then((m) => ({ default: m.AuditRedirect })));
const OutreachMessagePage = lazy(() => import("./pages/Outreach").then((m) => ({ default: m.OutreachMessagePage })));
const OutreachMessagesPage = lazy(() => import("./pages/Outreach").then((m) => ({ default: m.OutreachMessagesPage })));
const SequenceDetailPage = lazy(() => import("./pages/Outreach").then((m) => ({ default: m.SequenceDetailPage })));
const SequencesPage = lazy(() => import("./pages/Outreach").then((m) => ({ default: m.SequencesPage })));
const TemplatesPage = lazy(() => import("./pages/Outreach").then((m) => ({ default: m.TemplatesPage })));

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
  const { pathname } = useLocation();
  // The emailed link works whether or not someone is signed in on this browser.
  if (pathname === "/reset-password") return <ResetPasswordPage />;
  if (loading)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  if (!user) {
    if (!needsSetup && pathname === "/forgot-password") return <ForgotPasswordPage />;
    return <AuthPage mode={needsSetup ? "setup" : "login"} />;
  }
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
        <Route path="autopilot" element={<AutopilotPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// After a new release the old hashed files no longer exist, so a tab opened before the release fails with
// "Failed to fetch dynamically imported module". Reload once to pick up the new version (guarded against loops).
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  try {
    const last = Number(sessionStorage.getItem("gx-chunk-reload") ?? 0);
    if (Date.now() - last < 15_000) return;
    sessionStorage.setItem("gx-chunk-reload", String(Date.now()));
  } catch {
    /* storage unavailable: reload anyway */
  }
  window.location.reload();
});

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
