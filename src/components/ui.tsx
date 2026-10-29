import { clsx } from "clsx";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, type LucideIcon } from "lucide-react";
import { initials } from "../lib/format";

export const cn = clsx;

// ─── Buttons ───
type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm border border-brand-700/20",
  secondary: "bg-white text-ink border border-line hover:bg-slate-50 hover:border-slate-300 shadow-[var(--shadow-card)]",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-ink",
  subtle: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors select-none",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, ...rest }: { icon: LucideIcon; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn("inline-flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink", className)}
      {...rest}
    >
      <Icon className="size-4" />
    </button>
  );
}

// ─── Form bits ───
export function Field({ label, error, help, children, className, required }: { label: string; error?: string; help?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : help ? <p className="mt-1 text-xs text-muted">{help}</p> : null}
    </div>
  );
}

export function Select({ options, placeholder, className, ...rest }: { options: { value: string; label: string }[]; placeholder?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("input pr-7", className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Display ───
const TONES = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  new: "blue", discovered: "blue", draft: "gray", planned: "blue", open: "blue", not_contacted: "gray", not_assessed: "gray", queued: "gray",
  researching: "violet", to_qualify: "violet", in_progress: "violet", needs_assessment: "violet", running: "violet", discovery: "violet",
  contacted: "amber", engaged: "amber", responded: "amber", paused: "amber", relevant: "amber", discussed: "amber", meeting_scheduled: "amber",
  meeting_completed: "amber", proposal_prep: "amber", proposal_sent: "amber", negotiation: "amber", completed_warnings: "amber", medium: "amber",
  qualified: "green", active: "green", active_customer: "green", converted: "green", completed: "green", won: "green", closed_won: "green",
  proposed: "brand", high: "green",
  disqualified: "red", lost: "red", closed_lost: "red", failed: "red", do_not_contact: "red", unresponsive: "gray", cancelled: "gray",
  inactive: "gray", archived: "gray", not_applicable: "gray", low: "gray", needs_research: "violet", urgent: "red",
};
export function StatusBadge({ value, label }: { value: string | null | undefined; label: string }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return <Badge tone={STATUS_TONE[value] ?? "gray"}>{label}</Badge>;
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, icon: Icon, action, subtitle }: { title: ReactNode; icon?: LucideIcon; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-2 border-b border-line px-4 py-2">
      {Icon && (
        <span className="flex size-6 items-center justify-center rounded-md bg-brand-50 text-brand-600">
          <Icon className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="section-title truncate">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-3", className)} />;
}

export function EmptyState({ icon: Icon, title, body, action, compact }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-6" : "px-6 py-12")}>
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon className="size-5" />
      </span>
      <div className="font-medium text-ink">{title}</div>
      {body && <div className="mt-1 max-w-sm text-xs text-muted">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-red-800">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">{error instanceof Error ? error.message : "Something went wrong."}</div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Avatar({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700",
        size === "sm" ? "size-5 text-[9px]" : size === "lg" ? "size-10 text-sm" : "size-7 text-[11px]",
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-0.5 overflow-x-auto border-b border-line [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "relative -mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium transition-colors",
            value === t.value ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-start gap-3 py-1">
      <div className="w-32 shrink-0 text-xs text-muted">{label}</div>
      <div className="min-w-0 flex-1 break-words">{children ?? <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

// ─── Overlays ───
function useEscape(onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, active]);
}

export function SlideOver({ open, onClose, title, subtitle, children, footer, width = "max-w-xl" }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(onClose, open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/25" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("relative flex h-full w-full animate-slide-in flex-col bg-white shadow-[var(--shadow-pop)]", width)}>
        <div className="flex items-start gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Dialog({ open, onClose, title, children, footer, width = "max-w-md" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(onClose, open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[12vh]">
      <div className="fixed inset-0 animate-fade-in bg-slate-900/25" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("relative w-full animate-pop-in rounded-xl bg-white shadow-[var(--shadow-pop)]", width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-slate-50/60 px-5 py-3 rounded-b-xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = "Confirm", danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-slate-600">{body}</div>
    </Dialog>
  );
}

/** Lightweight dropdown menu anchored to its trigger. */
export function Menu({ trigger, children, align = "right", width = "w-56" }: { trigger: (p: { onClick: () => void; "aria-expanded": boolean }) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; width?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open })}
      {open && (
        <div role="menu" className={cn("absolute z-40 mt-1 animate-pop-in rounded-lg border border-line bg-white p-1 shadow-[var(--shadow-pop)]", width, align === "right" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, onClick, disabled, hint }: { icon?: LucideIcon; children: ReactNode; onClick?: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button
      role="menuitem"
      type="button"
      disabled={disabled}
      title={hint}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {Icon && <Icon className="size-3.5 text-slate-500" />}
      <span className="flex-1">{children}</span>
    </button>
  );
}

// ─── Toasts ───
type Toast = { id: number; tone: "success" | "error" | "info"; message: string };
const ToastCtx = createContext<(tone: Toast["tone"], message: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertTriangle : Info;
          return (
            <div key={t.id} className="pointer-events-auto flex animate-pop-in items-start gap-2 rounded-lg border border-line bg-white px-3 py-2.5 shadow-[var(--shadow-pop)]">
              <Icon className={cn("mt-0.5 size-4 shrink-0", t.tone === "success" ? "text-emerald-600" : t.tone === "error" ? "text-red-600" : "text-brand-600")} />
              <div className="flex-1 text-[13px]">{t.message}</div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-slate-400", className)} />;
}

export function useStableId() {
  return useId();
}

export function ScoreRing({ score, size = 44 }: { score: number | null | undefined; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const v = score ?? 0;
  const color = score === null || score === undefined ? "#cbd5e1" : v >= 80 ? "#059669" : v >= 50 ? "#d97706" : "#dc2626";
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f3" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * v) / 100} className="transition-[stroke-dashoffset] duration-500" />
      </svg>
      <span className="absolute text-[11px] font-semibold" style={{ color }}>
        {score === null || score === undefined ? "–" : score}
      </span>
    </div>
  );
}

export { Avatar as UserAvatar, initials };
