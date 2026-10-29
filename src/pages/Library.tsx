import { useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, FileUp, FolderOpen, History, Link2, Package, Pencil, Plus, Tags, Trash2, Upload } from "lucide-react";
import { api, qs, type Page, type Row } from "../lib/api";
import { useAuth } from "../lib/auth";
import { CONFIGS, fileSize } from "../lib/entities";
import * as E from "../../shared/enums";
import { dateTime, money, relative } from "../lib/format";
import { PageHeader } from "../components/layout";
import { EntityForm } from "../components/forms";
import { AuditTrail, invalidateRecord, useArchive } from "../components/records";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, KeyValue, Select, Skeleton, cn, useToast } from "../components/ui";
import { EntityListPage } from "./EntityListPage";
import { useRecord } from "./RecordDetailPage";

// ─── Upload ───
export function UploadAssetDialog({ open, onClose, link, previous }: { open: boolean; onClose: () => void; link?: { type: string; id: string }; previous?: Row | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(previous?.name ?? "");
  const [type, setType] = useState(previous?.type ?? "brochure");
  const [visibility, setVisibility] = useState(previous?.visibility ?? "internal");
  const [description, setDescription] = useState("");
  const m = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.set("file", file!);
      f.set("name", name || file!.name);
      f.set("type", type);
      f.set("visibility", visibility);
      if (description) f.set("description", description);
      if (previous) f.set("previous_version_id", previous.id);
      if (link) (f.set("link_type", link.type), f.set("link_id", link.id));
      return api.upload("/assets/upload", f);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      invalidateRecord(qc);
      toast("success", previous ? "New version uploaded" : "Asset uploaded");
      onClose();
    },
  });
  const tooBig = !!file && file.size > E.ASSET_MAX_BYTES;
  const badType = !!file && !E.ASSET_MIME_TYPES[file.type];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={previous ? `New version of ${previous.name}` : "Upload sales asset"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Upload} disabled={!file || tooBig || badType} loading={m.isPending} onClick={() => m.mutate()}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-line p-5 text-center hover:border-brand-300 hover:bg-brand-50/30">
          <FileUp className="size-5 text-slate-400" />
          <span className="font-medium">{file ? file.name : "Choose a file"}</span>
          <span className="text-xs text-muted">PDF, PPTX, DOCX, XLSX, CSV, TXT, PNG, JPG, WEBP or MP4 · up to 25 MB · stored privately</span>
          <input
            type="file"
            className="sr-only"
            accept={Object.keys(E.ASSET_MIME_TYPES).join(",")}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
            }}
          />
        </label>
        {tooBig && <p className="text-xs text-red-600">File is larger than 25 MB.</p>}
        {badType && <p className="text-xs text-red-600">This file type is not allowed.</p>}
        {!previous && (
          <>
            <Field label="Name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select options={E.ASSET_TYPES.options} value={type} onChange={(e) => setType(e.target.value)} />
              </Field>
              <Field label="Visibility">
                <Select options={E.ASSET_VISIBILITY.options} value={visibility} onChange={(e) => setVisibility(e.target.value)} />
              </Field>
            </div>
            <Field label="Description">
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </>
        )}
        {m.error && <p className="text-xs text-red-600">{(m.error as Error).message}</p>}
      </div>
    </Dialog>
  );
}

export function SalesAssetsPage() {
  const [uploading, setUploading] = useState(false);
  const [linking, setLinking] = useState(false);
  return (
    <>
      <EntityListPage
        cfg={CONFIGS.assets}
        presets={{ latest: "1" }}
        onCreate={() => setUploading(true)}
        headerExtra={<Button icon={Link2} onClick={() => setLinking(true)}>Add link</Button>}
      />
      <UploadAssetDialog open={uploading} onClose={() => setUploading(false)} key={uploading ? "u" : "x"} />
      <EntityForm cfg={CONFIGS.assets} open={linking} onClose={() => setLinking(false)} defaults={{ type: "demo_link" }} />
    </>
  );
}

const LINK_PATH: Record<string, string> = { account: "/accounts/", contact: "/contacts/", campaign: "/campaigns/", opportunity: "/opportunities/", product: "/products/", prospect: "/prospecting/", outreach: "/outreach/" };

export function AssetDetailPage() {
  const { id = "" } = useParams();
  const { user, isManager } = useAuth();
  const q = useRecord(CONFIGS.assets, id);
  const qc = useQueryClient();
  const versions = useQuery({ queryKey: ["assets", "versions", id], queryFn: () => api.get<{ data: Row[] }>(`/assets/${id}/versions`).then((r) => r.data) });
  const links = useQuery({ queryKey: ["assets", "links", id], queryFn: () => api.get<{ data: Row[] }>(`/assets/${id}/links`).then((r) => r.data) });
  const [editing, setEditing] = useState(false);
  const [newVersion, setNewVersion] = useState(false);
  const archive = useArchive("assets", id);
  const unlink = useMutation({ mutationFn: (l: Row) => api.del(`/assets/${id}/links/${l.entity_type}/${l.entity_id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }) });
  if (q.isError) return <div className="p-6"><ErrorState error={q.error} /></div>;
  if (!q.data) return <div className="p-6"><Skeleton className="h-64" /></div>;
  const a = q.data;
  const canEdit = isManager || a.owner_id === user!.id;
  const previewable = /^(application\/pdf|image\/)/.test(a.mime_type ?? "");
  return (
    <div className="pb-10">
      <PageHeader
        crumbs={[{ label: "Sales Assets", to: "/sales-assets" }, { label: a.name }]}
        title={<span className="flex items-center gap-2">{a.name} <Badge>v{a.version}</Badge>{a.source === "generated" && <Badge tone="brand">Generated</Badge>}{!a.is_latest && <Badge tone="amber">Older version</Badge>}</span>}
        subtitle={`${E.labelOf(E.ASSET_TYPES, a.type)} · ${E.labelOf(E.ASSET_VISIBILITY, a.visibility)}`}
        actions={
          <>
            {a.file_name && <a href={`/api/v1/assets/${a.id}/download`}><Button variant="primary" icon={Download}>Download</Button></a>}
            {a.external_url && !a.file_name && <a href={a.external_url} target="_blank" rel="noreferrer noopener"><Button variant="primary" icon={ExternalLink}>Open link</Button></a>}
            {canEdit && a.file_name && <Button icon={History} onClick={() => setNewVersion(true)}>Upload new version</Button>}
            {canEdit && <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
            {canEdit && !a.archived_at && <Button variant="ghost" onClick={() => archive.mutate(true)}>Archive</Button>}
          </>
        }
      />
      <div className="grid gap-4 px-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {previewable ? (
            <Card className="overflow-hidden">
              {a.mime_type === "application/pdf" ? (
                <iframe title="Preview" src={`/api/v1/assets/${a.id}/download?inline=1`} className="h-[70vh] w-full" />
              ) : (
                <img alt={a.name} src={`/api/v1/assets/${a.id}/download?inline=1`} className="max-h-[70vh] w-full object-contain" />
              )}
            </Card>
          ) : (
            <Card><EmptyState icon={FolderOpen} title={a.file_name ?? "External link"} body={a.file_name ? "Preview isn't available for this file type. Download it to view." : a.external_url} /></Card>
          )}
          {a.description && <Card className="p-4">{a.description}</Card>}
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <KeyValue label="File">{a.file_name}</KeyValue>
            <KeyValue label="Size">{a.size_bytes ? fileSize(a.size_bytes) : null}</KeyValue>
            <KeyValue label="Owner">{a.owner_name}</KeyValue>
            <KeyValue label="Industry">{a.intended_industry}</KeyValue>
            <KeyValue label="Updated">{dateTime(a.updated_at)}</KeyValue>
          </Card>
          <Card>
            <CardHeader title="Linked to" icon={Link2} />
            <ul className="divide-y divide-line px-4">
              {links.data?.map((l) => (
                <li key={`${l.entity_type}-${l.entity_id}`} className="flex items-center gap-2 py-2">
                  <Badge>{l.entity_type.replace("_", " ")}</Badge>
                  {LINK_PATH[l.entity_type] ? <Link to={`${LINK_PATH[l.entity_type]}${l.entity_id}`} className="min-w-0 flex-1 truncate hover:text-brand-700">{l.label ?? l.entity_id}</Link> : <span className="flex-1 truncate">{l.label ?? l.entity_id}</span>}
                  {canEdit && <button aria-label="Unlink" onClick={() => unlink.mutate(l)} className="text-slate-400 hover:text-red-600"><Trash2 className="size-3.5" /></button>}
                </li>
              ))}
              {links.data && !links.data.length && <li className="py-4 text-center text-xs text-muted">Not linked yet. Attach it from an account, deal or outreach.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Versions" icon={History} />
            <ul className="divide-y divide-line px-4">
              {versions.data?.map((v) => (
                <li key={v.id} className={cn("flex items-center gap-2 py-2", v.id === a.id && "font-medium")}>
                  <Badge>v{v.version}</Badge>
                  <Link to={`/sales-assets/${v.id}`} className="min-w-0 flex-1 truncate hover:text-brand-700">{v.file_name ?? v.name}</Link>
                  <span className="text-xs text-muted">{relative(v.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <AuditTrail entityType="sales_asset" entityId={id} />
        </div>
      </div>
      <EntityForm cfg={CONFIGS.assets} open={editing} onClose={() => setEditing(false)} record={a} />
      <UploadAssetDialog open={newVersion} onClose={() => setNewVersion(false)} previous={a} key={newVersion ? "v" : "x"} />
    </div>
  );
}

/** Assets linked to a record, with upload and attach-existing. */
export function LinkedAssets({ type, id, title = "Sales assets & documents" }: { type: string; id: string; title?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [pick, setPick] = useState("");
  const q = useQuery({ queryKey: ["assets", "linked", type, id], queryFn: () => api.get<Page<Row>>(`/assets${qs({ linked: `${type}:${id}`, pageSize: 50 })}`) });
  const library = useQuery({ queryKey: ["assets", "list", { latest: 1, pageSize: 100 }], queryFn: () => api.get<Page<Row>>(`/assets${qs({ latest: 1, pageSize: 100 })}`), enabled: attaching });
  const attach = useMutation({
    mutationFn: () => api.post(`/assets/${pick}/links`, { entity_type: type, entity_id: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast("success", "Attached");
      setAttaching(false);
      setPick("");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const rows = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader
        title={title}
        icon={FolderOpen}
        action={
          <div className="flex gap-1">
            <Button size="sm" icon={Link2} onClick={() => setAttaching(true)}>Attach existing</Button>
            <Button size="sm" icon={Upload} onClick={() => setUploading(true)}>Upload</Button>
          </div>
        }
      />
      {q.isLoading ? (
        <div className="p-4"><Skeleton className="h-10" /></div>
      ) : rows.length ? (
        <ul className="divide-y divide-line px-4">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <button onClick={() => nav(`/sales-assets/${a.id}`)} className="block truncate text-left font-medium hover:text-brand-700">{a.name}</button>
                <div className="text-xs text-muted">{E.labelOf(E.ASSET_TYPES, a.type)} · v{a.version} · {relative(a.created_at)}{a.source === "generated" ? " · generated" : ""}</div>
              </div>
              {a.file_name && <a href={`/api/v1/assets/${a.id}/download`} aria-label="Download" className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><Download className="size-4" /></a>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={FolderOpen} title="No documents yet" body="Generated proposals and decks, and anything you attach, appear here." />
      )}
      <UploadAssetDialog open={uploading} onClose={() => setUploading(false)} link={{ type, id }} key={uploading ? "u" : "x"} />
      <Dialog open={attaching} onClose={() => setAttaching(false)} title="Attach from library" footer={<><Button onClick={() => setAttaching(false)}>Cancel</Button><Button variant="primary" disabled={!pick} loading={attach.isPending} onClick={() => attach.mutate()}>Attach</Button></>}>
        <Field label="Asset">
          <Select placeholder="Choose…" options={(library.data?.data ?? []).map((a) => ({ value: a.id, label: `${a.name} (${E.labelOf(E.ASSET_TYPES, a.type)})` }))} value={pick} onChange={(e) => setPick(e.target.value)} />
        </Field>
      </Dialog>
    </Card>
  );
}

// ─── Price book ───
export function ProductsNav() {
  return (
    <div className="flex rounded-md border border-line bg-white p-0.5 shadow-[var(--shadow-card)]">
      {[
        { to: "/products", label: "Catalogue", icon: Package, end: true },
        { to: "/products/price-book", label: "Price book", icon: Tags },
      ].map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn("flex h-7 items-center gap-1 rounded px-2 text-xs font-medium", isActive ? "bg-slate-100 text-ink" : "text-slate-500 hover:text-ink")}>
          <i.icon className="size-3.5" /> {i.label}
        </NavLink>
      ))}
    </div>
  );
}

export function PriceBookPage() {
  const { isManager } = useAuth();
  const q = useQuery({ queryKey: ["packages", "price-book"], queryFn: () => api.get<{ data: Row[] }>("/price-book").then((r) => r.data) });
  const [editing, setEditing] = useState<{ record?: Row; defaults?: Row } | null>(null);
  const groups = E.PRODUCT_CATEGORIES.options.map((c) => ({ ...c, items: (q.data ?? []).filter((p) => p.category === c.value) })).filter((g) => g.items.length);
  return (
    <div className="pb-10">
      <PageHeader title="Price book" icon={Tags} subtitle="Packages and prices used by pitches, PDF proposals, decks and deal line items" actions={<ProductsNav />} />
      <div className="space-y-6 px-4 sm:px-6">
        {q.isError && <ErrorState error={q.error} />}
        {q.isLoading && <Skeleton className="h-64" />}
        {groups.map((g) => (
          <section key={g.value}>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{g.label}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {g.items.map((p) => (
                <Card key={p.id}>
                  <CardHeader
                    title={<Link to={`/products/${p.id}`} className="hover:text-brand-700">{p.name}</Link>}
                    subtitle={`${p.sku} · catalogue price: ${p.default_price_minor === null ? "custom" : money(p.default_price_minor, p.currency)}`}
                    action={isManager && <Button size="sm" icon={Plus} onClick={() => setEditing({ defaults: { product_id: p.id, product_name: p.name, billing_frequency: "one_time", currency: p.currency } })}>Package</Button>}
                  />
                  {p.packages.length ? (
                    <ul className="divide-y divide-line">
                      {p.packages.map((k: Row) => (
                        <li key={k.id} className={cn("flex items-start gap-3 px-4 py-2.5", k.status !== "active" && "opacity-50")}>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{k.name}{k.status !== "active" && " (inactive)"}</div>
                            {k.description && <div className="text-xs text-muted">{k.description}</div>}
                            {k.deliverables && <div className="mt-1 line-clamp-2 text-xs text-slate-600">{String(k.deliverables).split("\n").filter(Boolean).join(" · ")}</div>}
                          </div>
                          <div className="text-right">
                            <div className="font-semibold tabular-nums">{k.price_minor === null ? "Custom quote" : money(k.price_minor, k.currency)}</div>
                            <div className="text-[11px] text-muted">{E.labelOf(E.PACKAGE_BILLING, k.billing_frequency)}{k.timeline ? ` · ${k.timeline}` : ""}</div>
                          </div>
                          {isManager && <button aria-label="Edit package" onClick={() => setEditing({ record: { ...k, product_name: p.name } })} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-ink"><Pencil className="size-3.5" /></button>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-3 text-xs text-muted">No packages yet.{isManager ? " Add one so proposals can show prices." : ""}</p>
                  )}
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
      <EntityForm cfg={CONFIGS.packages} open={!!editing} onClose={() => setEditing(null)} record={editing?.record} defaults={editing?.defaults} />
    </div>
  );
}

