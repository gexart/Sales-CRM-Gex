import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Bell, Briefcase, Building2, CheckSquare, ChevronRight, FolderOpen, LayoutDashboard, LogOut, Megaphone, Menu as MenuIcon,
  Package, Plus, Search, Send, Settings, Users, X, Telescope, type LucideIcon,
} from "lucide-react";
import { api, qs, type Page, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CONFIGS, type EntityConfig } from "../lib/entities";
import { dateTime, isOverdue, relative } from "../lib/format";
import { ROLES, labelOf } from "../../shared/enums";
import { Avatar, Button, Menu, MenuItem, cn } from "./ui";
import { EntityForm, useDebounced } from "./forms";

type NavItem = { to: string; label: string; icon: LucideIcon };
const NAV: { group?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    group: "Database",
    items: [
      { to: "/campaigns", label: "Campaigns", icon: Megaphone },
      { to: "/sales-assets", label: "Sales Assets", icon: FolderOpen },
      { to: "/products", label: "Products", icon: Package },
      { to: "/accounts", label: "Accounts", icon: Building2 },
      { to: "/contacts", label: "Contacts", icon: Users },
      { to: "/prospecting", label: "Prospecting", icon: Telescope },
      { to: "/outreach", label: "Outreach", icon: Send },
      { to: "/tasks", label: "Tasks", icon: CheckSquare },
      { to: "/opportunities", label: "Opportunities", icon: Briefcase },
    ],
  },
  { group: "Insights", items: [{ to: "/reports", label: "Reports", icon: BarChart3 }] },
  { group: "System", items: [{ to: "/settings", label: "Settings", icon: Settings }] },
];

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#4338ca" />
        <path d="M21.5 11.2A7 7 0 1 0 23 16h-6.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-ink">
        gexart<span className="text-brand-600">.</span>
      </span>
    </span>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link to="/" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        {NAV.map((g, i) => (
          <div key={i} className={g.group ? "mt-4" : "mt-1"}>
            {g.group && <div className="mb-1 px-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{g.group}</div>}
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                    isActive ? "bg-slate-100 font-medium text-ink" : "text-slate-600 hover:bg-slate-50 hover:text-ink",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <it.icon className={cn("size-4", isActive ? "text-brand-600" : "text-slate-400 group-hover:text-slate-500")} />
                    {it.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

const KIND_ROUTE: Record<string, (id: string) => string> = {
  account: (id) => `/accounts/${id}`,
  contact: (id) => `/contacts/${id}`,
  prospect: (id) => `/prospecting/${id}`,
  opportunity: (id) => `/opportunities/${id}`,
  campaign: (id) => `/campaigns/${id}`,
  product: (id) => `/products/${id}`,
  task: (id) => `/tasks/${id}`,
};

function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const term = useDebounced(q, 150);
  const nav = useNavigate();
  const res = useQuery({
    queryKey: ["search", term],
    queryFn: () => api.get<{ data: Row[] }>(`/search${qs({ q: term })}`).then((r) => r.data),
    enabled: open && term.trim().length >= 2,
    placeholderData: (p) => p,
  });
  const rows = term.trim().length >= 2 ? (res.data ?? []) : [];
  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [term]);
  if (!open) return null;
  const go = (r: Row) => {
    nav(KIND_ROUTE[r.kind](r.id));
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-center p-4 pt-[10vh]">
      <div className="fixed inset-0 animate-fade-in bg-slate-900/25" onClick={onClose} />
      <div role="dialog" aria-label="Search" className="relative h-fit w-full max-w-xl animate-pop-in overflow-hidden rounded-xl bg-white shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, rows.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
              if (e.key === "Enter" && rows[active]) go(rows[active]);
            }}
            placeholder="Search accounts, contacts, prospects, deals, campaigns…"
            className="h-12 flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="rounded border border-line px-1.5 text-[10px] text-slate-500">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {rows.map((r, i) => (
            <li key={`${r.kind}-${r.id}`}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left", i === active && "bg-slate-100")}
              >
                <span className="w-20 shrink-0 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{r.kind}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                <span className="truncate text-xs text-muted">{r.subtitle}</span>
              </button>
            </li>
          ))}
          {term.trim().length >= 2 && !rows.length && <li className="px-3 py-6 text-center text-xs text-muted">{res.isFetching ? "Searching…" : "No results"}</li>}
          {term.trim().length < 2 && <li className="px-3 py-6 text-center text-xs text-muted">Type at least two characters</li>}
        </ul>
      </div>
    </div>
  );
}

const NOTIFY_PATH: Record<string, (id: string) => string> = {
  task: (id) => `/tasks/${id}`,
  audit_run: (id) => `/audits/${id}`,
  call: () => "/outreach/calls",
  outreach: (id) => `/outreach/${id}`,
  account: (id) => `/accounts/${id}`,
};

function Reminders() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const endOfDay = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, []);
  const tasks = useQuery({
    queryKey: ["tasks", "reminders", user?.id],
    queryFn: () => api.get<Page<Row>>(`/tasks${qs({ open: 1, mine: 1, due_before: endOfDay, sort: "due_at", dir: "asc", pageSize: 6 })}`),
    refetchInterval: 5 * 60_000,
  });
  const notes = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ data: Row[]; meta: { unread: number } }>("/notifications"),
    refetchInterval: 60_000,
  });
  const readAll = useMutation({ mutationFn: () => api.post("/notifications/read-all"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const unread = notes.data?.meta.unread ?? 0;
  const due = tasks.data?.meta.total ?? 0;
  const badge = unread + due;
  const items = (notes.data?.data ?? []).filter((n) => !n.type?.startsWith("task_")).slice(0, 8);
  return (
    <Menu
      width="w-96"
      trigger={(p) => (
        <button {...p} aria-label={`Notifications${badge ? ` (${badge})` : ""}`} className="relative inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-ink">
          <Bell className="size-4" />
          {badge > 0 && <span className="absolute top-1 right-1 flex min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] leading-3.5 font-bold text-white">{badge > 9 ? "9+" : badge}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold text-slate-500">Notifications</span>
            {unread > 0 && <button className="text-xs font-medium text-brand-700" onClick={() => readAll.mutate()}>Mark all read</button>}
          </div>
          {items.map((n) => (
            <Link
              key={n.id}
              to={NOTIFY_PATH[n.entity_type]?.(n.entity_id) ?? "/"}
              onClick={() => (close(), !n.read_at && read.mutate(n.id))}
              className="flex gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100"
            >
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand-500")} />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate", !n.read_at && "font-medium")}>{n.title}</span>
                {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                <span className="text-[11px] text-muted">{relative(n.created_at)}</span>
              </span>
            </Link>
          ))}
          {!items.length && <div className="px-2 py-3 text-center text-xs text-muted">No new notifications</div>}
          <div className="mt-1 border-t border-line px-2 pt-2 pb-1 text-xs font-semibold text-slate-500">Due today & overdue</div>
          {(tasks.data?.data ?? []).map((t) => (
            <Link key={t.id} to={`/tasks/${t.id}`} onClick={close} className="block rounded-md px-2 py-1.5 hover:bg-slate-100">
              <div className="truncate font-medium">{t.title}</div>
              <div className={cn("text-xs", isOverdue(t.due_at) ? "text-red-600" : "text-muted")}>{dateTime(t.due_at)}</div>
            </Link>
          ))}
          {!due && <div className="px-2 py-3 text-center text-xs text-muted">Nothing due. Nice.</div>}
          <Link to="/tasks" onClick={close} className="mt-1 block border-t border-line px-2 pt-2 pb-1 text-xs font-medium text-brand-700">
            Open tasks →
          </Link>
        </div>
      )}
    </Menu>
  );
}

function QuickCreate() {
  const { user } = useAuth();
  const [cfg, setCfg] = useState<EntityConfig | null>(null);
  const nav = useNavigate();
  const items = [CONFIGS.accounts, CONFIGS.contacts, CONFIGS.prospects, CONFIGS.opportunities, CONFIGS.tasks, CONFIGS.campaigns, CONFIGS.products].filter((c) =>
    c.writeRoles.includes(user!.role),
  );
  return (
    <>
      <Menu
        width="w-48"
        trigger={(p) => (
          <Button {...p} variant="primary" icon={Plus} className="max-sm:px-2">
            <span className="max-sm:hidden">New</span>
          </Button>
        )}
      >
        {(close) =>
          items.map((c) => (
            <MenuItem key={c.key} icon={c.icon} onClick={() => (close(), setCfg(c))}>
              {c.label}
            </MenuItem>
          ))
        }
      </Menu>
      {cfg && <EntityForm cfg={cfg} open onClose={() => setCfg(null)} onSaved={(r) => nav(cfg.path(r.id))} />}
    </>
  );
}

function UserMenu() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  return (
    <Menu
      trigger={(p) => (
        <button {...p} className="flex items-center gap-2 rounded-md py-1 pr-2 pl-1 hover:bg-slate-100">
          <Avatar name={user?.name} />
          <span className="text-[13px] font-medium max-md:hidden">{user?.name}</span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="border-b border-line px-2 pt-1 pb-2">
            <div className="font-medium">{user?.name}</div>
            <div className="text-xs text-muted">{user?.email}</div>
            <div className="mt-1 text-[11px] text-brand-700">{labelOf(ROLES, user?.role)}</div>
          </div>
          <div className="pt-1">
            <MenuItem icon={Settings} onClick={() => (close(), nav("/settings"))}>
              Settings
            </MenuItem>
            <MenuItem
              icon={LogOut}
              onClick={async () => {
                await api.post("/auth/logout");
                await refresh();
              }}
            >
              Sign out
            </MenuItem>
          </div>
        </>
      )}
    </Menu>
  );
}

export function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => setMobileNav(false), [loc.pathname]);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-[200px] shrink-0 border-r border-line bg-white lg:block">
        <Sidebar />
      </aside>
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/25" onClick={() => setMobileNav(false)} />
          <aside className="relative h-full w-64 animate-slide-in bg-white shadow-[var(--shadow-pop)]">
            <button aria-label="Close menu" onClick={() => setMobileNav(false)} className="absolute top-3.5 right-3 rounded p-1 text-slate-500 hover:bg-slate-100">
              <X className="size-4" />
            </button>
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-white px-3 sm:px-4">
          <button aria-label="Open menu" onClick={() => setMobileNav(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden">
            <MenuIcon className="size-5" />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-line bg-slate-50/70 px-2.5 text-left text-slate-400 transition-colors hover:border-slate-300 hover:bg-white"
          >
            <Search className="size-3.5" />
            <span className="flex-1 truncate text-[13px]">Search accounts, contacts, campaigns…</span>
            <kbd className="rounded border border-line bg-white px-1 text-[10px] text-slate-500 max-sm:hidden">{mac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <QuickCreate />
            <Reminders />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

export function PageHeader({ title, crumbs, actions, subtitle, icon: Icon }: { title: ReactNode; crumbs?: { label: string; to?: string }[]; actions?: ReactNode; subtitle?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-wrap items-end gap-3 px-4 pt-4 pb-3 sm:px-6">
      <div className="min-w-0 flex-1">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.to ? (
                  <Link to={c.to} className="hover:text-ink">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
                {i < crumbs.length - 1 && <ChevronRight className="size-3" />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="flex items-center gap-2 truncate text-lg font-semibold tracking-tight">
          {Icon && <Icon className="size-4.5 text-slate-400" />}
          {title}
        </h1>
        {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
