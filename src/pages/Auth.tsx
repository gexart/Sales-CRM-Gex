// Signed-out pages: sign in, first-run setup, forgot password and the emailed "set a new password" link.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, CheckCircle2, MailCheck, MailWarning } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { BrandMark, Logo } from "../components/layout";
import { Button, Field, PasswordInput } from "../components/ui";

const errorText = (err: unknown) => (err instanceof ApiError && err.code === "validation_error" ? Object.values(err.fieldErrors).join(" ") || err.message : (err as Error).message);

function Banner({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const cls = tone === "error" ? "bg-red-50 text-red-700" : tone === "success" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700";
  return <p role={tone === "error" ? "alert" : "status"} className={`rounded-md px-2.5 py-2 text-xs ${cls}`}>{children}</p>;
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-night p-12 text-snow lg:flex lg:flex-col">
        <Logo onDark />
        <BrandMark variant="dark" className="pointer-events-none absolute -right-28 bottom-[-12%] w-[80%] opacity-[0.07]" />
        <div className="pointer-events-none absolute -top-40 -left-40 size-[480px] rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative mt-auto max-w-md">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-brand-400 uppercase">Gexart Sales CRM</p>
          <h2 className="mt-3 text-3xl leading-tight font-semibold">Every account, audit, pitch and call in one place.</h2>
          <p className="mt-3 text-sm text-snow/55">Research prospects, run audits, send proposals and track every deal from first touch to close.</p>
        </div>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
          {children}
          <p className="mt-10 text-[11px] text-stone-400">© {new Date().getFullYear()} Gexart</p>
        </div>
      </main>
    </div>
  );
}

// ─── Sign in & first-run setup ───
export function AuthPage({ mode }: { mode: "login" | "setup" }) {
  const { refresh, emailEnabled } = useAuth();
  const [sp] = useSearchParams();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(mode === "setup" ? "/auth/setup" : "/auth/login", mode === "setup" ? form : { email: form.email, password: form.password });
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell
      title={mode === "setup" ? "Create the administrator account" : "Welcome back"}
      subtitle={mode === "setup" ? "No users exist yet. This first account becomes the administrator; setup closes once it is created." : "Sign in to the Gexart sales workspace. Access is by invitation."}
    >
      <form onSubmit={submit} className="mt-7 space-y-4">
        {mode === "login" && sp.get("reset") === "1" && (
          <Banner tone="success">Your password has been updated. Sign in with the new password.</Banner>
        )}
        {mode === "setup" && (
          <Field label="Full name">
            <input className="input h-10" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
        )}
        <Field label="Work email">
          <input className="input h-10" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" help={mode === "setup" ? "At least 10 characters." : undefined}>
          <PasswordInput className="h-10" autoComplete={mode === "setup" ? "new-password" : "current-password"} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {mode === "login" && (
          <div className="-mt-2 text-right text-xs">
            {emailEnabled ? (
              <Link to="/forgot-password" className="font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink">
                Forgot password?
              </Link>
            ) : (
              <span className="text-muted">Forgot your password? Ask an administrator to reset it.</span>
            )}
          </div>
        )}
        {error && <Banner tone="error">{error}</Banner>}
        <Button type="submit" variant="primary" loading={busy} className="h-10 w-full">
          {mode === "setup" ? "Create administrator" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}

// ─── Forgot password ───
export function ForgotPasswordPage() {
  const { emailEnabled } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/forgot", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const back = (
    <Link to="/" className="mt-6 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
      <ArrowLeft className="size-3.5" /> Back to sign in
    </Link>
  );
  if (!emailEnabled)
    return (
      <AuthShell title="Reset your password">
        <div className="mt-6 flex gap-3 rounded-lg border border-line bg-white p-4 text-[13px] text-slate-700">
          <MailWarning className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <span>Password emails are not set up for this workspace yet. Ask an administrator to reset your password from <b>Settings → Users &amp; roles</b>.</span>
        </div>
        {back}
      </AuthShell>
    );
  if (sent)
    return (
      <AuthShell title="Check your email">
        <div className="mt-6 flex gap-3 rounded-lg border border-line bg-white p-4 text-[13px] text-slate-700">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <span>
            If an active account exists for <b>{email.trim()}</b>, we have sent a link to choose a new password. It works once and expires in 60 minutes. Check your spam folder if it does not arrive within a few minutes.
          </span>
        </div>
        {back}
      </AuthShell>
    );
  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your work email and we will send you a link to choose a new one.">
      <form onSubmit={submit} className="mt-7 space-y-4">
        <Field label="Work email">
          <input className="input h-10" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
        <Button type="submit" variant="primary" loading={busy} className="h-10 w-full">
          Email me a reset link
        </Button>
      </form>
      {back}
    </AuthShell>
  );
}

// ─── Set a new password from the emailed link ───
export function ResetPasswordPage() {
  const [sp] = useSearchParams();
  const token = sp.get("token") ?? "";
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const mismatch = confirm.length > 0 && pw !== confirm;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/reset", { token, password: pw });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (!token)
    return (
      <AuthShell title="This link is not valid">
        <p className="mt-2 text-[13px] text-muted">The password link is missing or incomplete. Request a new one from the sign-in page.</p>
        <Link to="/forgot-password" className="mt-6 inline-block text-xs font-medium text-ink underline underline-offset-2">Request a new link</Link>
      </AuthShell>
    );
  if (done)
    return (
      <AuthShell title="Password updated">
        <div className="mt-6 flex gap-3 rounded-lg border border-line bg-white p-4 text-[13px] text-slate-700">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <span>Your new password is saved and any other signed-in sessions were ended. Sign in to continue.</span>
        </div>
        {/* Full page load so a stale signed-in state is cleared. */}
        <a href="/?reset=1"><Button variant="primary" className="mt-5 h-10 w-full">Go to sign in</Button></a>
      </AuthShell>
    );
  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 10 characters. A passphrase of several words is easy to remember and hard to guess.">
      <form onSubmit={submit} className="mt-7 space-y-4">
        <Field label="New password" help="At least 10 characters.">
          <PasswordInput className="h-10" autoComplete="new-password" required minLength={10} autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password" error={mismatch ? "Passwords do not match" : undefined}>
          <PasswordInput className="h-10" autoComplete="new-password" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
        <Button type="submit" variant="primary" loading={busy} disabled={pw.length < 10 || mismatch} className="h-10 w-full">
          Save password
        </Button>
        {error && /expired|already used/i.test(error) && (
          <Link to="/forgot-password" className="block text-center text-xs font-medium text-ink underline underline-offset-2">Request a new link</Link>
        )}
      </form>
    </AuthShell>
  );
}
