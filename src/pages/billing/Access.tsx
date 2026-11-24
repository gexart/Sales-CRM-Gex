import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Select, Skeleton, SlideOver, Tabs, useToast } from "../../components/ui";
import { dateTime } from "../../lib/format";
import { access, errMsg, useBillingAccess } from "../../lib/billing";

type Tab = "roles" | "users" | "audit";
interface Role { id: string; name: string; description: string | null; is_system: number; permissions: string[]; limits: { maxDiscountPct?: number; approvalAboveRupees?: number }; user_count: number }
interface Perm { key: string; label: string; group: string }

/** Roles, who has which role, and the audit trail. Needs the "roles.manage" permission (administrators always have it). */
export function AccessPage() {
  const { can } = useBillingAccess();
  const [tab, setTab] = useState<Tab>("roles");
  if (!can("roles.manage") && !can("audit.view")) return <div className="p-6"><EmptyState icon={Lock} title="Not available" body="Ask an administrator for access." /></div>;
  const tabs: { value: Tab; label: string }[] = [];
  if (can("roles.manage")) tabs.push({ value: "roles", label: "Roles" }, { value: "users", label: "Team" });
  if (can("audit.view")) tabs.push({ value: "audit", label: "Audit log" });
  const cur = tabs.some((t) => t.value === tab) ? tab : tabs[0]!.value;
  return (
    <div className="pb-8">
      <PageHeader title="Roles & access" icon={ShieldCheck} subtitle="Decide who can create, approve and see what in billing" />
      <div className="px-4 sm:px-6">
        <Tabs<Tab> tabs={tabs} value={cur} onChange={setTab} />
        <div className="mt-3">{cur === "roles" ? <Roles /> : cur === "users" ? <Team /> : <Audit />}</div>
      </div>
    </div>
  );
}

function Roles() {
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<Role> | null>(null);
  const [del, setDel] = useState<Role | null>(null);
  const roles = useQuery({ queryKey: ["billing-roles"], queryFn: () => access.get("/roles") });
  const cat = useQuery({ queryKey: ["billing-catalogue"], queryFn: () => access.get("/catalogue"), staleTime: Infinity });
  const rows: Role[] = roles.data?.data ?? [];
  const remove = useMutation({
    mutationFn: (id: string) => access.del(`/roles/${id}`),
    onSuccess: () => (toast("success", "Role deleted"), setDel(null), qc.invalidateQueries({ queryKey: ["billing-roles"] })),
    onError: (e) => (toast("error", errMsg(e)), setDel(null)),
  });
  return (
    <>
      <div className="mb-3 flex justify-end"><Button variant="primary" icon={Plus} onClick={() => setEdit({ name: "", description: "", permissions: ["billing.access"], limits: {} })}>New role</Button></div>
      {roles.isError ? <ErrorState error={roles.error} /> : roles.isLoading ? <Skeleton className="h-32" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id} className="p-3.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.name}</span>{r.is_system ? <Badge tone="blue">Built-in</Badge> : <Badge>Custom</Badge>}</div>
                  <p className="mt-0.5 text-xs text-muted">{r.description}</p>
                  <p className="mt-1.5 text-xs text-muted">{r.permissions.length} permissions · {r.user_count} user{r.user_count === 1 ? "" : "s"}
                    {r.limits.maxDiscountPct ? ` · max discount ${r.limits.maxDiscountPct}%` : ""}{r.limits.approvalAboveRupees ? ` · approval above ₹${r.limits.approvalAboveRupees}` : ""}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" icon={r.is_system ? Copy : undefined} onClick={() => setEdit(r.is_system ? { name: `${r.name} (copy)`, description: r.description, permissions: r.permissions, limits: r.limits } : r)}>{r.is_system ? "Copy" : "Edit"}</Button>
                  {!r.is_system && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete role" onClick={() => setDel(r)} />}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <RoleEditor role={edit} perms={cat.data?.data?.permissions ?? []} onClose={() => setEdit(null)} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} title={`Delete "${del?.name}"?`} body="Only roles nobody holds can be deleted." confirmLabel="Delete" danger loading={remove.isPending} />
    </>
  );
}

function RoleEditor({ role, perms, onClose }: { role: Partial<Role> | null; perms: Perm[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<Partial<Role> | null>(null);
  const [seed, setSeed] = useState<Partial<Role> | null>(null);
  if (role !== seed) (setSeed(role), setForm(role ? { ...role, permissions: [...(role.permissions ?? [])], limits: { ...(role.limits ?? {}) } } : null));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form!.name, description: form!.description || undefined, permissions: form!.permissions, limits: form!.limits ?? {} };
      return form!.id ? access.put(`/roles/${form!.id}`, body) : access.post("/roles", body);
    },
    onSuccess: () => (toast("success", "Role saved"), qc.invalidateQueries({ queryKey: ["billing-roles"] }), onClose()),
    onError: (e) => toast("error", errMsg(e)),
  });
  if (!role || !form) return null;
  const has = (k: string) => form.permissions?.includes(k);
  const flip = (k: string) => setForm({ ...form, permissions: has(k) ? form.permissions!.filter((x) => x !== k) : [...(form.permissions ?? []), k] });
  const groups = [...new Set(perms.map((p) => p.group))];
  return (
    <SlideOver open onClose={onClose} title={form.id ? "Edit role" : "New role"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!form.name || form.name.trim().length < 2} onClick={() => save.mutate()}>Save role</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required><input className="input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Description"><input className="input" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max discount %" help="Above this, an invoice waits for approval"><input className="input" type="number" min={0} max={100} value={form.limits?.maxDiscountPct ?? ""} onChange={(e) => setForm({ ...form, limits: { ...form.limits, maxDiscountPct: e.target.value === "" ? undefined : Number(e.target.value) } })} /></Field>
          <Field label="Approval above (₹)" help="Invoices at or above this always wait"><input className="input" type="number" min={0} value={form.limits?.approvalAboveRupees ?? ""} onChange={(e) => setForm({ ...form, limits: { ...form.limits, approvalAboveRupees: e.target.value === "" ? undefined : Number(e.target.value) } })} /></Field>
        </div>
        {groups.map((g) => (
          <fieldset key={g}>
            <legend className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{g}</legend>
            <div className="space-y-0.5">
              {perms.filter((p) => p.group === g).map((p) => (
                <label key={p.key} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-[13px] hover:bg-slate-50 dark:hover:bg-white/5">
                  <input type="checkbox" className="size-4" checked={!!has(p.key)} onChange={() => flip(p.key)} />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </SlideOver>
  );
}

function Team() {
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ["billing-users"], queryFn: () => access.get("/users") });
  const roles = useQuery({ queryKey: ["billing-roles"], queryFn: () => access.get("/roles") });
  const set = useMutation({
    mutationFn: (v: { id: string; roleId: string | null; extra: string[]; denied: string[] }) => access.put(`/users/${v.id}`, { roleId: v.roleId, extra: v.extra, denied: v.denied }),
    onSuccess: () => (toast("success", "Access updated"), qc.invalidateQueries({ queryKey: ["billing-users"] }), qc.invalidateQueries({ queryKey: ["billing-roles"] })),
    onError: (e) => toast("error", errMsg(e)),
  });
  const opts = ((roles.data?.data ?? []) as Role[]).map((r) => ({ value: r.id, label: r.name }));
  if (users.isError) return <ErrorState error={users.error} />;
  if (users.isLoading) return <Skeleton className="h-32" />;
  return (
    <Card className="divide-y divide-line">
      {(users.data?.data ?? []).map((u: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
        <div key={u.id} className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-0 flex-1 basis-48">
            <div className="truncate font-medium">{u.name} {u.status !== "active" && <Badge>disabled</Badge>}</div>
            <div className="truncate text-xs text-muted">{u.email} · CRM: {u.crm_role}</div>
          </div>
          {u.crm_role === "admin" ? <Badge tone="green">Administrator · full access</Badge> : (
            <Select aria-label={`Billing role for ${u.name}`} className="w-full sm:w-56" value={u.billing_role_id ?? ""} placeholder="No billing access" options={opts} onChange={(e) => set.mutate({ id: u.id, roleId: e.target.value || null, extra: u.extra, denied: u.denied })} />
          )}
        </div>
      ))}
    </Card>
  );
}

function Audit() {
  const q = useQuery({ queryKey: ["billing-audit"], queryFn: () => access.get("/audit?limit=100") });
  const rows: any[] = q.data?.data ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (q.isError) return <ErrorState error={q.error} />;
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (!rows.length) return <Card><EmptyState icon={ShieldCheck} title="Nothing logged yet" /></Card>;
  return (
    <Card className="divide-y divide-line">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
          <span className="font-medium">{r.action}</span>
          <span className="text-muted">{r.actor_name ?? "system"}</span>
          {r.status ? <Badge tone={r.status < 300 ? "green" : r.status < 500 ? "amber" : "red"}>{r.status}</Badge> : null}
          <span className="ml-auto text-xs text-muted">{dateTime(r.created_at)}</span>
        </div>
      ))}
    </Card>
  );
}
