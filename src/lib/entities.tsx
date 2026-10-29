// Client-side description of each CRM entity: form fields, list columns and filters.
// Validation itself comes from shared/schemas.ts, the same schemas the Worker enforces.
import type { ReactNode } from "react";
import type { ZodObject } from "zod";
import {
  Building2, Briefcase, CheckSquare, FileText, FolderOpen, ListOrdered, Megaphone, Package, Search as SearchIcon, Send, Tags, Users, type LucideIcon,
} from "lucide-react";
import * as E from "../../shared/enums";
import * as S from "../../shared/schemas";
import { StatusBadge } from "../components/ui";
import { date, dateTime, hostOf, isOverdue, money, relative } from "./format";
import type { Row } from "./api";

export type RefKind = "accounts" | "contacts" | "campaigns" | "users" | "prospects" | "opportunities" | "products" | "templates";

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "email" | "url" | "date" | "datetime" | "money" | "number" | "ref" | "multiref";
  options?: E.Option[];
  ref?: RefKind;
  required?: boolean;
  placeholder?: string;
  wide?: boolean;
  help?: string;
  section?: string;
  managerOnly?: boolean;
  /** Only shown when editing an existing record. */
  editOnly?: boolean;
}

export interface ColumnDef {
  key: string;
  label: string;
  sort?: string;
  render?: (r: Row) => ReactNode;
  hidden?: boolean;
  className?: string;
}

export interface FilterDef {
  name: string;
  label: string;
  options?: E.Option[];
  ref?: RefKind;
}

export interface EntityConfig {
  key: string;
  route: string;
  label: string;
  plural: string;
  icon: LucideIcon;
  schema: ZodObject;
  titleOf: (r: Row) => string;
  subtitleOf?: (r: Row) => ReactNode;
  path: (id: string) => string;
  fields: FieldDef[];
  columns: ColumnDef[];
  filters: FilterDef[];
  defaultSort: string;
  defaultDir?: "asc" | "desc";
  writeRoles: E.Role[];
  searchPlaceholder: string;
}

const L = E.labelOf;
export const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const link = (url: string | null) =>
  url ? (
    <a href={url} target="_blank" rel="noreferrer noopener" className="font-medium text-ink underline decoration-stone-300 underline-offset-2 hover:decoration-ink" onClick={(e) => e.stopPropagation()}>
      {hostOf(url)}
    </a>
  ) : null;
const muted = (v: ReactNode) => (v === null || v === undefined || v === "" ? <span className="text-slate-400">—</span> : v);

export const accountsConfig: EntityConfig = {
  key: "account",
  route: "accounts",
  label: "Account",
  plural: "Accounts",
  icon: Building2,
  schema: S.accountSchema,
  titleOf: (r) => r.name,
  subtitleOf: (r) => [r.industry, r.city].filter(Boolean).join(" · "),
  path: (id) => `/accounts/${id}`,
  searchPlaceholder: "Search name, website, city, industry…",
  defaultSort: "updated_at",
  writeRoles: ["admin", "manager", "rep"],
  fields: [
    { name: "name", label: "Company name", type: "text", required: true, section: "Company" },
    { name: "website", label: "Website", type: "url", placeholder: "example.com" },
    { name: "industry", label: "Industry", type: "text", placeholder: "e.g. Real estate" },
    { name: "company_size", label: "Company size", type: "select", options: E.COMPANY_SIZES.options },
    { name: "business_type", label: "Business type", type: "text", placeholder: "e.g. Multispeciality hospital" },
    { name: "legal_name", label: "Legal name", type: "text" },
    { name: "type", label: "Account type", type: "select", options: E.ACCOUNT_TYPES.options, required: true, section: "Pipeline" },
    { name: "status", label: "Status", type: "select", options: E.ACCOUNT_STATUSES.options, required: true },
    { name: "owner_id", label: "Owner", type: "ref", ref: "users" },
    { name: "qualification", label: "Qualification", type: "select", options: E.QUALIFICATION_LEVELS.options },
    { name: "lead_source", label: "Lead source", type: "select", options: E.LEAD_SOURCES.options },
    { name: "source_campaign_id", label: "Source campaign", type: "ref", ref: "campaigns" },
    { name: "qualification_note", label: "Qualification evidence", type: "textarea", wide: true, help: "Record observed facts that support the qualification level." },
    { name: "email", label: "General email", type: "email", section: "Contact & location" },
    { name: "phone", label: "General phone", type: "text" },
    { name: "address", label: "Address", type: "text", wide: true },
    { name: "city", label: "City", type: "text" },
    { name: "state", label: "State", type: "text" },
    { name: "country", label: "Country", type: "text" },
    { name: "postal_code", label: "Postal code", type: "text" },
    { name: "linkedin_url", label: "LinkedIn", type: "url", section: "Online presence" },
    { name: "instagram_url", label: "Instagram", type: "url" },
    { name: "facebook_url", label: "Facebook", type: "url" },
    { name: "youtube_url", label: "YouTube", type: "url" },
    { name: "google_business_url", label: "Google Business Profile", type: "url", wide: true },
    { name: "notes", label: "Internal notes", type: "textarea", wide: true, section: "Notes" },
  ],
  columns: [
    { key: "name", label: "Company", sort: "name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "website", label: "Website", render: (r) => muted(link(r.website)) },
    { key: "industry", label: "Industry", sort: "industry", render: (r) => muted(r.industry) },
    { key: "city", label: "City", sort: "city", render: (r) => muted(r.city) },
    { key: "status", label: "Status", sort: "status", render: (r) => <StatusBadge value={r.status} label={L(E.ACCOUNT_STATUSES, r.status)} /> },
    { key: "type", label: "Type", render: (r) => L(E.ACCOUNT_TYPES, r.type), hidden: true },
    { key: "qualification", label: "Priority", render: (r) => <StatusBadge value={r.qualification} label={L(E.QUALIFICATION_LEVELS, r.qualification)} /> },
    { key: "contact_count", label: "Contacts", className: "text-right tabular-nums" },
    { key: "open_opportunity_count", label: "Open opps", className: "text-right tabular-nums" },
    { key: "owner_name", label: "Owner", render: (r) => muted(r.owner_name) },
    { key: "updated_at", label: "Updated", sort: "updated_at", render: (r) => <span className="text-muted">{relative(r.updated_at)}</span> },
  ],
  filters: [
    { name: "status", label: "Status", options: E.ACCOUNT_STATUSES.options },
    { name: "type", label: "Type", options: E.ACCOUNT_TYPES.options },
    { name: "qualification", label: "Priority", options: E.QUALIFICATION_LEVELS.options },
    { name: "owner_id", label: "Owner", ref: "users" },
  ],
};

export const contactsConfig: EntityConfig = {
  key: "contact",
  route: "contacts",
  label: "Contact",
  plural: "Contacts",
  icon: Users,
  schema: S.contactSchema,
  titleOf: (r) => r.full_name ?? [r.first_name, r.last_name].filter(Boolean).join(" "),
  subtitleOf: (r) => [r.job_title, r.account_name].filter(Boolean).join(" · "),
  path: (id) => `/contacts/${id}`,
  searchPlaceholder: "Search name, email, phone, title, company…",
  defaultSort: "updated_at",
  writeRoles: ["admin", "manager", "rep"],
  fields: [
    { name: "first_name", label: "First name", type: "text", required: true, section: "Person" },
    { name: "last_name", label: "Last name", type: "text" },
    { name: "job_title", label: "Job title", type: "text" },
    { name: "department", label: "Department", type: "text" },
    { name: "account_id", label: "Account", type: "ref", ref: "accounts", wide: true },
    { name: "email", label: "Work email", type: "email", section: "Reach" },
    { name: "phone", label: "Phone", type: "text" },
    { name: "linkedin_url", label: "LinkedIn", type: "url" },
    { name: "preferred_channel", label: "Preferred channel", type: "select", options: E.CHANNELS.options },
    { name: "status", label: "Status", type: "select", options: E.CONTACT_STATUSES.options, required: true, section: "Sales" },
    { name: "decision_role", label: "Decision role", type: "select", options: E.DECISION_ROLES.options },
    { name: "owner_id", label: "Owner", type: "ref", ref: "users" },
    { name: "source", label: "Source", type: "select", options: E.LEAD_SOURCES.options },
    { name: "next_follow_up_at", label: "Next follow-up", type: "datetime" },
    { name: "last_contacted_at", label: "Last contacted", type: "datetime", editOnly: true },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  columns: [
    { key: "name", label: "Name", sort: "name", render: (r) => <span className="font-medium text-ink">{r.full_name}</span> },
    { key: "job_title", label: "Title", render: (r) => muted(r.job_title) },
    { key: "account", label: "Account", sort: "account", render: (r) => muted(r.account_name) },
    { key: "email", label: "Email", render: (r) => muted(r.email) },
    { key: "phone", label: "Phone", render: (r) => muted(r.phone), hidden: true },
    { key: "decision_role", label: "Role", render: (r) => (r.decision_role ? L(E.DECISION_ROLES, r.decision_role) : muted(null)) },
    { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} label={L(E.CONTACT_STATUSES, r.status)} /> },
    { key: "last_contacted_at", label: "Last contacted", sort: "last_contacted_at", render: (r) => <span className="text-muted">{relative(r.last_contacted_at)}</span> },
    { key: "next_follow_up_at", label: "Follow-up", sort: "next_follow_up_at", render: (r) => <span className={isOverdue(r.next_follow_up_at) ? "text-red-600" : "text-muted"}>{date(r.next_follow_up_at)}</span> },
    { key: "owner_name", label: "Owner", render: (r) => muted(r.owner_name), hidden: true },
  ],
  filters: [
    { name: "status", label: "Status", options: E.CONTACT_STATUSES.options },
    { name: "decision_role", label: "Role", options: E.DECISION_ROLES.options },
    { name: "owner_id", label: "Owner", ref: "users" },
  ],
};

export const productsConfig: EntityConfig = {
  key: "product",
  route: "products",
  label: "Product",
  plural: "Products & services",
  icon: Package,
  schema: S.productSchema,
  titleOf: (r) => r.name,
  subtitleOf: (r) => `${r.sku} · ${L(E.PRODUCT_CATEGORIES, r.category)}`,
  path: (id) => `/products/${id}`,
  searchPlaceholder: "Search name, SKU, description…",
  defaultSort: "name",
  defaultDir: "asc",
  writeRoles: ["admin", "manager"],
  fields: [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "sku", label: "SKU / code", type: "text", required: true, placeholder: "GX-MKT-SEO" },
    { name: "category", label: "Category", type: "select", options: E.PRODUCT_CATEGORIES.options, required: true },
    { name: "status", label: "Status", type: "select", options: E.ACTIVE_STATUSES.options, required: true },
    { name: "short_description", label: "Short description", type: "text", wide: true },
    { name: "description", label: "Detailed description", type: "textarea", wide: true },
    { name: "pricing_model", label: "Pricing model", type: "select", options: E.PRICING_MODELS.options, required: true, section: "Pricing" },
    { name: "billing_frequency", label: "Billing frequency", type: "select", options: E.BILLING_FREQUENCIES.options },
    { name: "default_price_minor", label: "Default price", type: "money" },
    { name: "currency", label: "Currency", type: "text", placeholder: "INR" },
    { name: "internal_cost_minor", label: "Internal cost", type: "money", managerOnly: true, help: "Visible to managers and admins only." },
    { name: "features", label: "Features & deliverables", type: "textarea", wide: true, help: "One per line.", section: "Positioning" },
    { name: "target_industries", label: "Target industries", type: "text", wide: true },
  ],
  columns: [
    { key: "name", label: "Name", sort: "name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "sku", label: "SKU", sort: "sku", render: (r) => <code className="text-xs text-slate-600">{r.sku}</code> },
    { key: "category", label: "Category", sort: "category", render: (r) => L(E.PRODUCT_CATEGORIES, r.category) },
    { key: "pricing_model", label: "Pricing", render: (r) => L(E.PRICING_MODELS, r.pricing_model) },
    { key: "default_price_minor", label: "Default price", sort: "default_price_minor", className: "text-right tabular-nums", render: (r) => (r.default_price_minor === null ? <span className="text-slate-400">Custom</span> : money(r.default_price_minor, r.currency)) },
    { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} label={L(E.ACTIVE_STATUSES, r.status)} /> },
    { key: "opportunity_count", label: "In deals", className: "text-right tabular-nums" },
  ],
  filters: [
    { name: "category", label: "Category", options: E.PRODUCT_CATEGORIES.options },
    { name: "status", label: "Status", options: E.ACTIVE_STATUSES.options },
  ],
};

export const campaignsConfig: EntityConfig = {
  key: "campaign",
  route: "campaigns",
  label: "Campaign",
  plural: "Campaigns",
  icon: Megaphone,
  schema: S.campaignSchema,
  titleOf: (r) => r.name,
  subtitleOf: (r) => `${r.code} · ${L(E.CAMPAIGN_TYPES, r.type)}`,
  path: (id) => `/campaigns/${id}`,
  searchPlaceholder: "Search name, code, industry, geography…",
  defaultSort: "updated_at",
  writeRoles: ["admin", "manager"],
  fields: [
    { name: "name", label: "Campaign name", type: "text", required: true },
    { name: "code", label: "Campaign code", type: "text", required: true, placeholder: "KOL-RE-Q4" },
    { name: "type", label: "Type", type: "select", options: E.CAMPAIGN_TYPES.options, required: true },
    { name: "status", label: "Status", type: "select", options: E.CAMPAIGN_STATUSES.options, required: true },
    { name: "owner_id", label: "Owner", type: "ref", ref: "users" },
    { name: "lead_source", label: "Lead source", type: "select", options: E.LEAD_SOURCES.options },
    { name: "objective", label: "Objective", type: "text", wide: true },
    { name: "description", label: "Description", type: "textarea", wide: true },
    { name: "target_industry", label: "Target industry", type: "text", section: "Targeting" },
    { name: "target_geography", label: "Target geography", type: "text" },
    { name: "target_audience", label: "Target audience", type: "text", wide: true },
    { name: "product_ids", label: "Products & services", type: "multiref", ref: "products", wide: true },
    { name: "start_date", label: "Start date", type: "date", section: "Budget & dates" },
    { name: "end_date", label: "End date", type: "date" },
    { name: "budget_minor", label: "Budget", type: "money" },
    { name: "actual_spend_minor", label: "Actual spend", type: "money" },
    { name: "currency", label: "Currency", type: "text", placeholder: "INR" },
    { name: "target_leads", label: "Target leads", type: "number" },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  columns: [
    { key: "name", label: "Campaign", sort: "name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "code", label: "Code", render: (r) => <code className="text-xs text-slate-600">{r.code}</code> },
    { key: "type", label: "Type", render: (r) => L(E.CAMPAIGN_TYPES, r.type) },
    { key: "status", label: "Status", sort: "status", render: (r) => <StatusBadge value={r.status} label={L(E.CAMPAIGN_STATUSES, r.status)} /> },
    { key: "start_date", label: "Dates", sort: "start_date", render: (r) => <span className="text-muted">{date(r.start_date)} – {date(r.end_date)}</span> },
    { key: "prospect_count", label: "Prospects", className: "text-right tabular-nums", render: (r) => `${r.prospect_count}${r.target_leads ? ` / ${r.target_leads}` : ""}` },
    { key: "opportunity_count", label: "Opps", className: "text-right tabular-nums" },
    { key: "budget_minor", label: "Budget", sort: "budget_minor", className: "text-right tabular-nums", render: (r) => money(r.budget_minor, r.currency) },
    { key: "owner_name", label: "Owner", render: (r) => muted(r.owner_name) },
  ],
  filters: [
    { name: "status", label: "Status", options: E.CAMPAIGN_STATUSES.options },
    { name: "type", label: "Type", options: E.CAMPAIGN_TYPES.options },
    { name: "owner_id", label: "Owner", ref: "users" },
  ],
};

export const prospectsConfig: EntityConfig = {
  key: "prospect",
  route: "prospects",
  label: "Prospect",
  plural: "Prospects",
  icon: SearchIcon,
  schema: S.prospectSchema,
  titleOf: (r) => r.company_name,
  subtitleOf: (r) => [r.industry, r.geography].filter(Boolean).join(" · "),
  path: (id) => `/prospecting/${id}`,
  searchPlaceholder: "Search company, website, contact, service fit…",
  defaultSort: "updated_at",
  writeRoles: ["admin", "manager", "rep"],
  fields: [
    { name: "company_name", label: "Company name", type: "text", required: true, section: "Company" },
    { name: "website", label: "Website", type: "url" },
    { name: "industry", label: "Industry", type: "text" },
    { name: "geography", label: "Geography", type: "text", placeholder: "City / region" },
    { name: "company_size", label: "Company size", type: "select", options: E.COMPANY_SIZES.options },
    { name: "linkedin_url", label: "LinkedIn", type: "url" },
    { name: "contact_name", label: "Primary contact", type: "text", section: "Known contact" },
    { name: "contact_title", label: "Contact title", type: "text" },
    { name: "email", label: "Business email (verified)", type: "email", help: "Only enter addresses you have verified." },
    { name: "phone", label: "Phone (verified)", type: "text" },
    { name: "status", label: "Qualification stage", type: "select", options: E.PROSPECT_STATUSES.options.filter((o) => o.value !== "converted"), required: true, section: "Qualification" },
    { name: "owner_id", label: "Owner", type: "ref", ref: "users" },
    { name: "campaign_id", label: "Campaign", type: "ref", ref: "campaigns" },
    { name: "discovery_source", label: "Discovery source", type: "select", options: E.LEAD_SOURCES.options },
    { name: "service_fit", label: "Potential service fit", type: "text", wide: true, placeholder: "e.g. SEO, website redesign" },
    { name: "estimated_value_minor", label: "Estimated value", type: "money" },
    { name: "last_researched_at", label: "Last researched", type: "datetime" },
    { name: "next_action", label: "Next action", type: "text", wide: true },
    { name: "research_notes", label: "Research notes", type: "textarea", wide: true },
    { name: "qualification_evidence", label: "Qualification evidence", type: "textarea", wide: true, help: "Observed facts that justify the stage." },
  ],
  columns: [
    { key: "company_name", label: "Company", sort: "company_name", render: (r) => <span className="font-medium text-ink">{r.company_name}</span> },
    { key: "website", label: "Website", render: (r) => muted(link(r.website)) },
    { key: "industry", label: "Industry", render: (r) => muted(r.industry) },
    { key: "geography", label: "Location", render: (r) => muted(r.geography) },
    { key: "status", label: "Stage", sort: "status", render: (r) => <StatusBadge value={r.status} label={L(E.PROSPECT_STATUSES, r.status)} /> },
    { key: "service_fit", label: "Service fit", render: (r) => muted(r.service_fit) },
    { key: "campaign_name", label: "Campaign", render: (r) => muted(r.campaign_name) },
    { key: "discovery_source", label: "Source", render: (r) => (r.discovery_source ? L(E.LEAD_SOURCES, r.discovery_source) : muted(null)), hidden: true },
    { key: "estimated_value_minor", label: "Est. value", sort: "estimated_value_minor", className: "text-right tabular-nums", render: (r) => money(r.estimated_value_minor, r.currency) },
    { key: "owner_name", label: "Owner", render: (r) => muted(r.owner_name) },
    { key: "updated_at", label: "Updated", sort: "updated_at", render: (r) => <span className="text-muted">{relative(r.updated_at)}</span> },
  ],
  filters: [
    { name: "status", label: "Stage", options: E.PROSPECT_STATUSES.options },
    { name: "campaign_id", label: "Campaign", ref: "campaigns" },
    { name: "discovery_source", label: "Source", options: E.LEAD_SOURCES.options },
    { name: "owner_id", label: "Owner", ref: "users" },
  ],
};

export const opportunitiesConfig: EntityConfig = {
  key: "opportunity",
  route: "opportunities",
  label: "Opportunity",
  plural: "Opportunities",
  icon: Briefcase,
  schema: S.opportunitySchema,
  titleOf: (r) => r.name,
  subtitleOf: (r) => r.account_name,
  path: (id) => `/opportunities/${id}`,
  searchPlaceholder: "Search deal or account…",
  defaultSort: "updated_at",
  writeRoles: ["admin", "manager", "rep"],
  fields: [
    { name: "name", label: "Opportunity name", type: "text", required: true, wide: true },
    { name: "account_id", label: "Account", type: "ref", ref: "accounts", required: true },
    { name: "primary_contact_id", label: "Primary contact", type: "ref", ref: "contacts", help: "Must belong to the selected account." },
    { name: "stage", label: "Stage", type: "select", options: E.OPPORTUNITY_STAGES.options, required: true },
    { name: "probability", label: "Probability %", type: "number", help: "Defaults from the stage when left blank." },
    { name: "amount_minor", label: "Deal value", type: "money" },
    { name: "currency", label: "Currency", type: "text", placeholder: "INR" },
    { name: "expected_close_date", label: "Expected close", type: "date" },
    { name: "owner_id", label: "Owner", type: "ref", ref: "users" },
    { name: "campaign_id", label: "Campaign attribution", type: "ref", ref: "campaigns" },
    { name: "next_action", label: "Next action", type: "text", wide: true },
    { name: "proposal_url", label: "Proposal link", type: "url", wide: true },
    { name: "competitors", label: "Competitors", type: "text", wide: true },
    { name: "win_loss_reason", label: "Win / loss reason", type: "textarea", wide: true, editOnly: true },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  columns: [
    { key: "name", label: "Opportunity", sort: "name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "account", label: "Account", sort: "account", render: (r) => r.account_name },
    { key: "stage", label: "Stage", sort: "stage", render: (r) => <StatusBadge value={r.stage} label={L(E.OPPORTUNITY_STAGES, r.stage)} /> },
    { key: "amount_minor", label: "Value", sort: "amount_minor", className: "text-right tabular-nums", render: (r) => money(r.amount_minor, r.currency) },
    { key: "probability", label: "Prob.", className: "text-right tabular-nums", render: (r) => `${r.probability}%` },
    { key: "weighted_minor", label: "Weighted", className: "text-right tabular-nums", render: (r) => money(r.weighted_minor, r.currency) },
    { key: "expected_close_date", label: "Close date", sort: "expected_close_date", render: (r) => <span className="text-muted">{date(r.expected_close_date)}</span> },
    { key: "owner_name", label: "Owner", render: (r) => muted(r.owner_name) },
  ],
  filters: [
    { name: "stage", label: "Stage", options: E.OPPORTUNITY_STAGES.options },
    { name: "owner_id", label: "Owner", ref: "users" },
    { name: "campaign_id", label: "Campaign", ref: "campaigns" },
  ],
};

export const tasksConfig: EntityConfig = {
  key: "task",
  route: "tasks",
  label: "Task",
  plural: "Tasks",
  icon: CheckSquare,
  schema: S.taskSchema,
  titleOf: (r) => r.title,
  subtitleOf: (r) => [L(E.TASK_TYPES, r.type), r.account_name ?? r.prospect_name].filter(Boolean).join(" · "),
  path: (id) => `/tasks/${id}`,
  searchPlaceholder: "Search tasks…",
  defaultSort: "due_at",
  defaultDir: "asc",
  writeRoles: ["admin", "manager", "rep"],
  fields: [
    { name: "title", label: "Title", type: "text", required: true, wide: true },
    { name: "type", label: "Type", type: "select", options: E.TASK_TYPES.options, required: true },
    { name: "priority", label: "Priority", type: "select", options: E.PRIORITIES.options, required: true },
    { name: "due_at", label: "Due", type: "datetime" },
    { name: "owner_id", label: "Assigned to", type: "ref", ref: "users" },
    { name: "status", label: "Status", type: "select", options: E.TASK_STATUSES.options, required: true, editOnly: true },
    { name: "description", label: "Description", type: "textarea", wide: true },
    { name: "account_id", label: "Account", type: "ref", ref: "accounts", section: "Related to" },
    { name: "contact_id", label: "Contact", type: "ref", ref: "contacts" },
    { name: "prospect_id", label: "Prospect", type: "ref", ref: "prospects" },
    { name: "opportunity_id", label: "Opportunity", type: "ref", ref: "opportunities" },
    { name: "outcome", label: "Outcome notes", type: "textarea", wide: true, editOnly: true },
  ],
  columns: [
    { key: "title", label: "Task", sort: "title", render: (r) => <span className="font-medium text-ink">{r.title}</span> },
    { key: "type", label: "Type", render: (r) => L(E.TASK_TYPES, r.type) },
    { key: "related", label: "Related to", render: (r) => muted(r.account_name ?? r.prospect_name ?? r.contact_name ?? r.opportunity_name) },
    {
      key: "due_at",
      label: "Due",
      sort: "due_at",
      render: (r) => {
        const late = ["open", "in_progress"].includes(r.status) && isOverdue(r.due_at);
        return <span className={late ? "font-medium text-red-600" : "text-muted"}>{r.due_at ? dateTime(r.due_at) : "—"}{late && " · overdue"}</span>;
      },
    },
    { key: "priority", label: "Priority", sort: "priority", render: (r) => <StatusBadge value={r.priority} label={L(E.PRIORITIES, r.priority)} /> },
    { key: "status", label: "Status", sort: "status", render: (r) => <StatusBadge value={r.status} label={L(E.TASK_STATUSES, r.status)} /> },
    { key: "owner_name", label: "Assigned to", render: (r) => muted(r.owner_name) },
  ],
  filters: [
    { name: "status", label: "Status", options: E.TASK_STATUSES.options },
    { name: "priority", label: "Priority", options: E.PRIORITIES.options },
    { name: "type", label: "Type", options: E.TASK_TYPES.options },
    { name: "owner_id", label: "Assigned to", ref: "users" },
  ],
};

export const outreachConfig: EntityConfig = {
  key: "outreach",
  route: "outreach",
  label: "Outreach",
  plural: "Outreach",
  icon: Send,
  schema: S.outreachSchema,
  titleOf: (r) => r.title,
  subtitleOf: (r) => [L(E.OUTREACH_CHANNELS, r.channel), r.contact_name, r.account_name ?? r.prospect_name].filter(Boolean).join(" · "),
  path: (id) => `/outreach/${id}`,
  searchPlaceholder: "Search title, subject, recipient, company…",
  defaultSort: "updated_at",
  writeRoles: ["admin", "manager", "rep"],
  fields: [
    { name: "title", label: "Title", type: "text", required: true, wide: true },
    { name: "channel", label: "Channel", type: "select", options: E.OUTREACH_CHANNELS.options.filter((o) => o.value !== "brevo"), required: true },
    { name: "status", label: "Status", type: "select", options: E.OUTREACH_STATUSES.options.filter((o) => E.EDITABLE_OUTREACH_STATUSES.includes(o.value)), required: true },
    { name: "contact_id", label: "Contact", type: "ref", ref: "contacts" },
    { name: "account_id", label: "Account", type: "ref", ref: "accounts" },
    { name: "prospect_id", label: "Prospect", type: "ref", ref: "prospects" },
    { name: "campaign_id", label: "Campaign", type: "ref", ref: "campaigns" },
    { name: "planned_send_at", label: "Planned send", type: "datetime" },
    { name: "next_follow_up_at", label: "Next follow-up", type: "datetime" },
    { name: "outcome", label: "Outcome", type: "textarea", wide: true },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  columns: [
    { key: "title", label: "Outreach", sort: "title", render: (r) => <span className="font-medium text-ink">{r.title}</span> },
    { key: "recipient", label: "Recipient", render: (r) => muted(r.contact_name ?? r.prospect_name) },
    { key: "company", label: "Company", render: (r) => muted(r.account_name ?? r.prospect_name) },
    { key: "channel", label: "Channel", render: (r) => L(E.OUTREACH_CHANNELS, r.channel) },
    { key: "status", label: "Status", sort: "status", render: (r) => <StatusBadge value={r.status} label={L(E.OUTREACH_STATUSES, r.status)} /> },
    { key: "planned_send_at", label: "Planned", sort: "planned_send_at", render: (r) => <span className="text-muted">{date(r.planned_send_at)}</span> },
    { key: "sent_at", label: "Sent", sort: "sent_at", render: (r) => <span className="text-muted">{date(r.sent_at)}</span> },
    { key: "owner_name", label: "Owner", render: (r) => muted(r.owner_name), hidden: true },
    { key: "updated_at", label: "Updated", sort: "updated_at", render: (r) => <span className="text-muted">{relative(r.updated_at)}</span> },
  ],
  filters: [
    { name: "status", label: "Status", options: E.OUTREACH_STATUSES.options },
    { name: "channel", label: "Channel", options: E.OUTREACH_CHANNELS.options },
    { name: "campaign_id", label: "Campaign", ref: "campaigns" },
    { name: "owner_id", label: "Owner", ref: "users" },
  ],
};

export const templatesConfig: EntityConfig = {
  key: "email_template",
  route: "templates",
  label: "Template",
  plural: "Email templates",
  icon: FileText,
  schema: S.templateSchema,
  titleOf: (r) => r.name,
  subtitleOf: (r) => [r.category && L(E.TEMPLATE_CATEGORIES, r.category), r.product_name].filter(Boolean).join(" · "),
  path: (id) => `/outreach/templates/${id}`,
  searchPlaceholder: "Search name, subject, body…",
  defaultSort: "name",
  defaultDir: "asc",
  writeRoles: ["admin", "manager", "rep"],
  fields: [
    { name: "name", label: "Template name", type: "text", required: true, wide: true },
    { name: "category", label: "Category", type: "select", options: E.TEMPLATE_CATEGORIES.options },
    { name: "tone", label: "Tone", type: "select", options: E.TONES.options },
    { name: "product_id", label: "Intended service", type: "ref", ref: "products" },
    { name: "intended_industry", label: "Intended industry", type: "text" },
    { name: "status", label: "Status", type: "select", options: E.ACTIVE_STATUSES.options, required: true },
    { name: "subject", label: "Subject", type: "text", required: true, wide: true, section: "Message", help: "Placeholders like {{contact_first_name}} are filled per recipient." },
    {
      name: "body",
      label: "Body",
      type: "textarea",
      required: true,
      wide: true,
      help: "Supported: {{contact_first_name}}, {{contact_last_name}}, {{contact_full_name}}, {{contact_title}}, {{company_name}}, {{company_website}}, {{company_city}}, {{company_industry}}, {{sender_name}}, {{sender_email}}, {{service_name}}.",
    },
  ],
  columns: [
    { key: "name", label: "Template", sort: "name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "subject", label: "Subject", render: (r) => <span className="text-slate-600">{r.subject}</span> },
    { key: "category", label: "Category", sort: "category", render: (r) => (r.category ? L(E.TEMPLATE_CATEGORIES, r.category) : muted(null)) },
    { key: "product_name", label: "Service", render: (r) => muted(r.product_name) },
    { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} label={L(E.ACTIVE_STATUSES, r.status)} /> },
    { key: "owner_name", label: "Owner", render: (r) => muted(r.owner_name ?? "Starter template") },
  ],
  filters: [
    { name: "category", label: "Category", options: E.TEMPLATE_CATEGORIES.options },
    { name: "status", label: "Status", options: E.ACTIVE_STATUSES.options },
    { name: "product_id", label: "Service", ref: "products" },
  ],
};

export const sequencesConfig: EntityConfig = {
  key: "sequence",
  route: "sequences",
  label: "Sequence",
  plural: "Sequences",
  icon: ListOrdered,
  schema: S.sequenceSchema,
  titleOf: (r) => r.name,
  subtitleOf: (r) => `${r.step_count} steps over ${Number(r.span_days ?? 0) + 1} days`,
  path: (id) => `/outreach/sequences/${id}`,
  searchPlaceholder: "Search sequences…",
  defaultSort: "name",
  defaultDir: "asc",
  writeRoles: ["admin", "manager"],
  fields: [
    { name: "name", label: "Name", type: "text", required: true, wide: true },
    { name: "description", label: "Description", type: "textarea", wide: true },
    { name: "status", label: "Status", type: "select", options: E.ACTIVE_STATUSES.options, required: true },
  ],
  columns: [
    { key: "name", label: "Sequence", sort: "name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "description", label: "Description", render: (r) => <span className="text-slate-600">{r.description}</span> },
    { key: "step_count", label: "Steps", className: "text-right tabular-nums" },
    { key: "span", label: "Span", render: (r) => `${Number(r.span_days ?? 0) + 1} days` },
    { key: "active_enrollments", label: "Active contacts", className: "text-right tabular-nums" },
    { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} label={L(E.ACTIVE_STATUSES, r.status)} /> },
  ],
  filters: [{ name: "status", label: "Status", options: E.ACTIVE_STATUSES.options }],
};

export const assetsConfig: EntityConfig = {
  key: "sales_asset",
  route: "assets",
  label: "Asset",
  plural: "Sales assets",
  icon: FolderOpen,
  schema: S.assetUpdateSchema,
  titleOf: (r) => r.name,
  subtitleOf: (r) => `${L(E.ASSET_TYPES, r.type)} · v${r.version}${r.source === "generated" ? " · generated" : ""}`,
  path: (id) => `/sales-assets/${id}`,
  searchPlaceholder: "Search name, file, description…",
  defaultSort: "updated_at",
  writeRoles: ["admin", "manager", "rep"],
  fields: [
    { name: "name", label: "Name", type: "text", required: true, wide: true },
    { name: "type", label: "Type", type: "select", options: E.ASSET_TYPES.options, required: true },
    { name: "visibility", label: "Visibility", type: "select", options: E.ASSET_VISIBILITY.options, required: true },
    { name: "intended_industry", label: "Intended industry", type: "text" },
    { name: "external_url", label: "External link", type: "url", help: "For demo links and online documents (no file)." },
    { name: "description", label: "Description", type: "textarea", wide: true },
  ],
  columns: [
    { key: "name", label: "Asset", sort: "name", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "type", label: "Type", sort: "type", render: (r) => L(E.ASSET_TYPES, r.type) },
    { key: "version", label: "Version", render: (r) => `v${r.version}` },
    { key: "source", label: "Source", render: (r) => (r.source === "generated" ? "Generated" : r.external_url && !r.file_name ? "Link" : "Upload") },
    { key: "visibility", label: "Visibility", render: (r) => <StatusBadge value={r.visibility === "confidential" ? "medium" : "active"} label={L(E.ASSET_VISIBILITY, r.visibility).split(" (")[0]} /> },
    { key: "size_bytes", label: "Size", sort: "size_bytes", className: "text-right tabular-nums", render: (r) => (r.size_bytes ? fileSize(r.size_bytes) : muted(null)) },
    { key: "link_count", label: "Linked", className: "text-right tabular-nums" },
    { key: "owner_name", label: "Owner", render: (r) => muted(r.owner_name) },
    { key: "updated_at", label: "Updated", sort: "updated_at", render: (r) => <span className="text-muted">{relative(r.updated_at)}</span> },
  ],
  filters: [
    { name: "type", label: "Type", options: E.ASSET_TYPES.options },
    { name: "visibility", label: "Visibility", options: E.ASSET_VISIBILITY.options },
    { name: "owner_id", label: "Owner", ref: "users" },
  ],
};

export const packagesConfig: EntityConfig = {
  key: "package",
  route: "packages",
  label: "Package",
  plural: "Packages",
  icon: Tags,
  schema: S.packageSchema,
  titleOf: (r) => r.name,
  subtitleOf: (r) => r.product_name,
  path: () => "/products/price-book",
  searchPlaceholder: "Search packages…",
  defaultSort: "position",
  defaultDir: "asc",
  writeRoles: ["admin", "manager"],
  fields: [
    { name: "product_id", label: "Service", type: "ref", ref: "products", required: true, wide: true },
    { name: "name", label: "Package name", type: "text", required: true, placeholder: "e.g. Starter, Growth, Enterprise" },
    { name: "status", label: "Status", type: "select", options: E.ACTIVE_STATUSES.options, required: true },
    { name: "price_minor", label: "Price", type: "money", help: "Leave blank for “Custom quote”." },
    { name: "billing_frequency", label: "Billing", type: "select", options: E.PACKAGE_BILLING.options, required: true },
    { name: "currency", label: "Currency", type: "text", placeholder: "INR" },
    { name: "position", label: "Sort order", type: "number" },
    { name: "timeline", label: "Timeline", type: "text", placeholder: "e.g. 4–6 weeks", wide: true },
    { name: "description", label: "Description", type: "textarea", wide: true },
    { name: "deliverables", label: "Deliverables", type: "textarea", wide: true, help: "One per line. Used in proposals and decks." },
  ],
  columns: [],
  filters: [],
};

export const CONFIGS = {
  accounts: accountsConfig,
  contacts: contactsConfig,
  products: productsConfig,
  campaigns: campaignsConfig,
  prospects: prospectsConfig,
  opportunities: opportunitiesConfig,
  tasks: tasksConfig,
  outreach: outreachConfig,
  templates: templatesConfig,
  sequences: sequencesConfig,
  assets: assetsConfig,
  packages: packagesConfig,
};

export const REF_SOURCES: Record<RefKind, { path: string; label: (r: Row) => string; sub?: (r: Row) => string | undefined }> = {
  accounts: { path: "/accounts", label: (r) => r.name, sub: (r) => r.city ?? undefined },
  contacts: { path: "/contacts", label: (r) => r.full_name, sub: (r) => r.account_name ?? undefined },
  campaigns: { path: "/campaigns", label: (r) => r.name, sub: (r) => r.code },
  prospects: { path: "/prospects", label: (r) => r.company_name },
  opportunities: { path: "/opportunities", label: (r) => r.name, sub: (r) => r.account_name },
  products: { path: "/products", label: (r) => r.name, sub: (r) => r.sku },
  users: { path: "/users", label: (r) => r.name, sub: (r) => r.email },
  templates: { path: "/templates", label: (r) => r.name, sub: (r) => r.subject },
};
