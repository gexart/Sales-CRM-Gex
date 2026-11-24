import { Hono } from 'hono';
import { z } from 'zod';
import { billingSettingsSchema, normalizeBillingSettings, normalizeDataSharing, validateNumberTemplate, WORKSPACE_KEYS } from '@billing/shared';
import type { Env } from '../types';
import type { BusinessVariables } from '../middleware/tenant';

export const settingsRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

const getStub = (c: any) => {
  const stub = c.get('businessStub');
  if (!stub) {
    const businessId = c.req.header('X-Business-Id') || 'biz_default';
    return c.env.BILLING_DO.get(c.env.BILLING_DO.idFromName(businessId));
  }
  return stub;
};

// 1. GET /api/settings/branches
settingsRoutes.get('/branches', async (c) => {
  const stub = getStub(c);
  const branches = await (stub as any).listBranches();
  return c.json({ branches });
});

// 2. POST /api/settings/branches
const createBranchSchema = z.object({
  name: z.string().min(1, 'Branch name is required'),
  code: z.string().min(1, 'Branch code is required'),
  gstin: z.string().optional(),
  stateCode: z.string().min(2).max(2),
  address: z.string().min(1),
  phone: z.string().min(1),
  isDefault: z.boolean().optional(),
});

settingsRoutes.post('/branches', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = createBranchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const branch = await (stub as any).createBranch(parsed.data);
  return c.json(branch, 201);
});

// GET /api/settings/locations — the business's branches, readable by every business (Billing core).
// (/settings/branches stays with the Multi-Branch module for creating more branches.)
settingsRoutes.get('/locations', async (c) => {
  const stub = getStub(c);
  const branches = await (stub as any).listBranches();
  return c.json({ branches });
});

// 3. GET /api/settings/config
settingsRoutes.get('/config', async (c) => {
  const stub = getStub(c);
  const settings = await (stub as any).getAllSettings();
  return c.json({ settings });
});

// 4. POST /api/settings/config
settingsRoutes.post('/config', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  for (const [key, value] of Object.entries(body)) {
    await (stub as any).setSetting(key, value);
  }
  const updated = await (stub as any).getAllSettings();
  return c.json({ settings: updated });
});

// 5. GET /api/settings/roles
settingsRoutes.get('/roles', async (c) => {
  const stub = getStub(c);
  const roles = await (stub as any).listRoles();
  return c.json({ roles });
});

// 6. POST /api/settings/roles
const createRoleSchema = z.object({
  name: z.string().min(1, 'Role name is required'),
  description: z.string().optional(),
  permissions: z.array(z.string()).min(1, 'At least one permission is required'),
});

settingsRoutes.post('/roles', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = createRoleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const role = await (stub as any).createRole(parsed.data);
  return c.json(role, 201);
});

// 7. GET /api/settings/members
settingsRoutes.get('/members', async (c) => {
  const stub = getStub(c);
  const team = (await (stub as any).listTeamMembers()) as Record<string, unknown>[];
  // Owners and admins come from the real company memberships (D1), not a placeholder record.
  const businessId = c.get('businessId') as string | undefined;
  const admins =
    businessId && c.env.DB
      ? ((
          await c.env.DB.prepare(
            `SELECT u.id, u.name, u.phone, u.email, m.role_key FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.business_id = ? AND m.status = 'ACTIVE' AND m.role_key IN ('owner', 'admin') ORDER BY m.role_key DESC, u.name`,
          )
            .bind(businessId)
            .all<{ id: string; name: string; phone: string; email: string | null; role_key: string }>()
        ).results ?? [])
      : [];
  const members = [
    ...admins.map((a) => ({ id: a.id, name: a.name, phone: a.phone, email: a.email ?? '', roleKey: a.role_key, status: 'ACTIVE', moduleRoles: {} })),
    ...team,
  ];
  return c.json({ members });
});

// 8. POST /api/settings/members/invite
const inviteMemberSchema = z.object({
  name: z.string().min(1, 'Member name is required'),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  roleKey: z.enum(['owner', 'admin', 'manager', 'cashier', 'waiter', 'accountant', 'staff']),
  branchIds: z.array(z.string()).optional(),
  posPin: z.string().min(4).max(6).optional(),
  moduleRoles: z.record(z.enum(WORKSPACE_KEYS), z.string().min(1).max(40)).optional(),
});

/** Master Admin = company owner/admin (permission '*') or anyone holding user.manage. */
const isMasterAdmin = (c: any): boolean => {
  const m = c.get('membership') as { roleKey?: string; permissions?: string[] } | undefined;
  if (!m) return false;
  return m.roleKey === 'owner' || m.roleKey === 'admin' || !!m.permissions?.includes('*') || !!m.permissions?.includes('user.manage');
};

// GET /api/settings/data-sharing — which workspace may see/add/edit customers, vendors, products
settingsRoutes.get('/data-sharing', async (c) => {
  const stub = getStub(c);
  const settings = (await (stub as any).getAllSettings()) as Record<string, unknown>;
  return c.json({ sharing: normalizeDataSharing(settings?.data_sharing) });
});

// PUT /api/settings/data-sharing — Master Admin only
const shareLevel = z.enum(['none', 'view', 'add', 'edit']);
const sharingSchema = z.record(
  z.enum(WORKSPACE_KEYS),
  z.object({ customers: shareLevel.optional(), vendors: shareLevel.optional(), products: shareLevel.optional() }),
);
settingsRoutes.put('/data-sharing', async (c) => {
  if (!isMasterAdmin(c)) return c.json({ error: 'Only the Master Admin can change data sharing', code: 'FORBIDDEN' }, 403);
  const parsed = sharingSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  const sharing = normalizeDataSharing(parsed.data);
  const stub = getStub(c);
  await (stub as any).setSetting('data_sharing', sharing);
  return c.json({ sharing });
});

// GET /api/settings/numbering — bill-number format of every document type (current FY)
settingsRoutes.get('/numbering', async (c) => {
  const stub = getStub(c);
  const series = await (stub as any).listNumbering(c.req.query('branchId') || undefined);
  return c.json({ series });
});

// PUT /api/settings/numbering — change prefix / suffix / padding of one document type (Master Admin)
const numberingSchema = z.object({
  docType: z.string().min(2).max(40),
  branchId: z.string().max(64).optional(),
  prefix: z.string().max(24),
  suffix: z.string().max(24).default(''),
  padding: z.number().int().min(1).max(10).default(4),
});
settingsRoutes.put('/numbering', async (c) => {
  if (!isMasterAdmin(c)) return c.json({ error: 'Only the Master Admin can change bill numbering', code: 'FORBIDDEN' }, 403);
  const parsed = numberingSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  const tplErr = validateNumberTemplate(parsed.data.prefix) ?? validateNumberTemplate(parsed.data.suffix);
  if (tplErr) return c.json({ error: tplErr, code: 'INVALID_TEMPLATE' }, 400);
  const stub = getStub(c);
  try {
    const series = await (stub as any).saveNumbering(parsed.data);
    return c.json({ series });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return c.json({ error: msg.replace(/^[A-Z_]+: /, '') || 'Could not save numbering', code: msg.split(':')[0] || 'ERROR' }, 400);
  }
});

// GET /api/settings/billing — preferences, print, barcode, logo/signature, notes & terms, reminders, template
settingsRoutes.get('/billing', async (c) => {
  const stub = getStub(c);
  const settings = (await (stub as any).getAllSettings()) as Record<string, unknown>;
  return c.json({ billing: normalizeBillingSettings(settings?.billing_settings) });
});

// PUT /api/settings/billing — Master Admin; partial sections are merged over the saved ones
settingsRoutes.put('/billing', async (c) => {
  if (!isMasterAdmin(c)) return c.json({ error: 'Only the Master Admin can change billing settings', code: 'FORBIDDEN' }, 403);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Send the settings to save' }, 400);
  const stub = getStub(c);
  const current = normalizeBillingSettings(((await (stub as any).getAllSettings()) as Record<string, unknown>)?.billing_settings);
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!(k in current)) return c.json({ error: `Unknown section: ${k}` }, 400);
    merged[k] = k === 'notesTerms' ? { ...(current.notesTerms as object), ...(v as object) } : { ...((current as Record<string, unknown>)[k] as object), ...(v as object) };
  }
  const parsed = billingSettingsSchema.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return c.json({ error: issue?.message ?? 'Invalid settings', field: issue?.path.join('.') }, 400);
  }
  await (stub as any).setSetting('billing_settings', parsed.data);
  return c.json({ billing: parsed.data });
});

// PUT /api/settings/members/:id/module-role — set or remove (role '') a member's role in one workspace
const moduleRoleSchema = z.object({ workspace: z.enum(WORKSPACE_KEYS), role: z.string().max(40) });
settingsRoutes.put('/members/:id/module-role', async (c) => {
  if (!isMasterAdmin(c)) return c.json({ error: 'Only the Master Admin can change user roles', code: 'FORBIDDEN' }, 403);
  const parsed = moduleRoleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  const stub = getStub(c);
  try {
    const member = await (stub as any).setMemberModuleRole(c.req.param('id'), parsed.data.workspace, parsed.data.role);
    return c.json({ member });
  } catch {
    return c.json({ error: 'Member not found', code: 'NOT_FOUND' }, 404);
  }
});

settingsRoutes.post('/members/invite', async (c) => {
  if (!isMasterAdmin(c)) return c.json({ error: 'Only the Master Admin can add users', code: 'FORBIDDEN' }, 403);
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = inviteMemberSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const member = await (stub as any).inviteTeamMember(parsed.data);
  return c.json(member, 201);
});

// 9. GET /api/settings/export
settingsRoutes.get('/export', async (c) => {
  const stub = getStub(c);
  const data = await (stub as any).exportAllBusinessData();
  return c.json(data);
});
