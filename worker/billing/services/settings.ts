import { hashPassword, newId } from '@billing/shared';

export interface BranchInput {
  name: string;
  code: string;
  gstin?: string;
  stateCode: string;
  address: string;
  phone: string;
  isDefault?: boolean;
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface TeamMemberInput {
  name: string;
  phone?: string;
  email?: string;
  roleKey: 'owner' | 'admin' | 'manager' | 'cashier' | 'waiter' | 'accountant' | 'staff';
  branchIds?: string[];
  posPin?: string;
  /** Per-workspace role, e.g. { restaurant: 'captain', pos_retail: 'cashier' }. Absent workspace = no access. */
  moduleRoles?: Record<string, string>;
}

export class SettingsService {
  constructor(private db: any) {}

  private getSql(): any {
    return (this.db as any).session?.client || (this.db as any).sql || this.db;
  }

  // 1. Branch Management
  async listBranches(): Promise<any[]> {
    const rawSql = this.getSql();
    const branches: any[] = [];
    if (rawSql?.exec) {
      const cur = rawSql.exec(
        `SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY is_default DESC, name ASC`,
      );
      for (const b of cur) {
        branches.push({
          id: b.id,
          name: b.name,
          code: b.code,
          gstin: b.gstin,
          stateCode: b.state_code,
          address: b.address,
          phone: b.phone,
          isDefault: Boolean(b.is_default),
          createdAt: b.created_at,
        });
      }
    }
    return branches;
  }

  async createBranch(input: BranchInput): Promise<any> {
    const rawSql = this.getSql();
    const id = newId();
    const now = new Date().toISOString();
    const currentFy = '26-27';

    if (rawSql?.exec) {
      rawSql.exec(
        `INSERT INTO branches (id, name, code, gstin, state_code, address, phone, is_default, created_at, updated_at) ` +
          `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.name,
        input.code,
        input.gstin || null,
        input.stateCode,
        input.address,
        input.phone,
        input.isDefault ? 1 : 0,
        now,
        now,
      );

      // Create default warehouse for this branch
      const whId = newId();
      rawSql.exec(
        `INSERT INTO warehouses (id, branch_id, name, is_default, created_at, updated_at) ` +
          `VALUES (?, ?, ?, 1, ?, ?)`,
        whId,
        id,
        `${input.name} Main Warehouse`,
        now,
        now,
      );

      // Create standard document series for this branch matching all types from seed
      const seriesList = [
        { type: 'INVOICE', prefix: `${input.code}/INV/26-27/` },
        { type: 'POS_BILL', prefix: `${input.code}/POS/26-27/` },
        { type: 'QUOTATION', prefix: `${input.code}/QT/26-27/` },
        { type: 'SALES_ORDER', prefix: `${input.code}/SO/26-27/` },
        { type: 'PROFORMA', prefix: `${input.code}/PI/26-27/` },
        { type: 'DELIVERY_CHALLAN', prefix: `${input.code}/DC/26-27/` },
        { type: 'PACKING_LIST', prefix: `${input.code}/PL/26-27/` },
        { type: 'CREDIT_NOTE', prefix: `${input.code}/CN/26-27/` },
        { type: 'PAYMENT_IN', prefix: `${input.code}/RCPT/26-27/` },
        { type: 'PAYMENT_OUT', prefix: `${input.code}/PAY/26-27/` },
        { type: 'PURCHASE_ORDER', prefix: `${input.code}/PO/26-27/` },
        { type: 'PURCHASE_BILL', prefix: `${input.code}/BILL/26-27/` },
        { type: 'DEBIT_NOTE', prefix: `${input.code}/DN/26-27/` },
        { type: 'EXPENSE', prefix: `${input.code}/EXP/26-27/` },
        { type: 'KOT', prefix: `${input.code}/KOT/` },
      ];

      for (const s of seriesList) {
        const sId = newId();
        rawSql.exec(
          `INSERT INTO document_series (id, branch_id, doc_type, prefix, next_number, fy_suffix_enabled, financial_year, padding, is_default, updated_at) ` +
            `VALUES (?, ?, ?, ?, 1, 1, ?, 4, 1, ?)`,
          sId,
          id,
          s.type,
          s.prefix,
          currentFy,
          now,
        );
      }
    }

    return { id, ...input, createdAt: now };
  }

  // 2. Settings Store (Key-Value)
  async getSetting(key: string, defaultValue: any = null): Promise<any> {
    const rawSql = this.getSql();
    if (rawSql?.exec) {
      const cur = rawSql.exec(`SELECT value_json FROM settings WHERE key = ? LIMIT 1`, key);
      const row = cur.next();
      if (!row.done && row.value?.value_json) {
        try {
          return JSON.parse(row.value.value_json);
        } catch {
          return row.value.value_json;
        }
      }
    }
    return defaultValue;
  }

  async setSetting(key: string, value: any): Promise<void> {
    const rawSql = this.getSql();
    const now = new Date().toISOString();
    const valJson = JSON.stringify(value);

    if (rawSql?.exec) {
      rawSql.exec(
        `INSERT INTO settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ` +
          `ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        `set_${key}`,
        key,
        valJson,
        now,
      );
    }
  }

  async getAllSettings(): Promise<Record<string, any>> {
    const rawSql = this.getSql();
    // Operational defaults only. Business identity (name, GSTIN, address) lives in the company record and
    // branches — never placeholder values here, they would print on every customer's documents.
    const map: Record<string, any> = {
      allow_negative_stock: false,
      valuation_method: 'WAC',
      pos_scale_prefix: '21',
      restaurant_service_charge_percent: 5,
      printer_paper_size: '80mm',
    };

    if (rawSql?.exec) {
      const cur = rawSql.exec(`SELECT key, value_json FROM settings`);
      for (const row of cur) {
        try {
          map[row.key] = JSON.parse(row.value_json);
        } catch {
          map[row.key] = row.value_json;
        }
      }
    }
    return map;
  }

  // 3. Roles & Permissions Management
  async listRoles(): Promise<any[]> {
    const customRoles = (await this.getSetting('custom_roles', [])) as any[];
    const systemRoles = [
      {
        id: 'role_owner',
        name: 'Business Owner',
        description: 'Unrestricted full access across all modules, settings, and branches',
        permissions: ['*'],
        isSystem: true,
      },
      {
        id: 'role_admin',
        name: 'Administrator',
        description: 'Full operational access excluding business ownership transfer and close',
        permissions: ['billing.*', 'pos.*', 'restaurant.*', 'inventory.*', 'accounting.*', 'reports.*'],
        isSystem: true,
      },
      {
        id: 'role_cashier',
        name: 'POS Cashier',
        description: 'POS register, barcode scanning, payments, and shift close report only',
        permissions: ['pos.checkout', 'pos.shift', 'pos.receipt'],
        isSystem: true,
      },
      {
        id: 'role_waiter',
        name: 'Restaurant Steward / Captain',
        description: 'Floor tables, punching orders, and sending KOTs to kitchen only',
        permissions: ['restaurant.tables', 'restaurant.kot'],
        isSystem: true,
      },
      {
        id: 'role_accountant',
        name: 'Accountant',
        description: 'Journal vouchers, chart of accounts, GSTR-1, and financial statements',
        permissions: ['accounting.*', 'reports.*', 'billing.view'],
        isSystem: true,
      },
    ];

    return [...systemRoles, ...customRoles];
  }

  async createRole(input: RoleInput): Promise<any> {
    const currentRoles = (await this.getSetting('custom_roles', [])) as any[];
    const newRole = {
      id: `role_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: input.name,
      description: input.description || '',
      permissions: input.permissions,
      isSystem: false,
      createdAt: new Date().toISOString(),
    };
    currentRoles.push(newRole);
    await this.setSetting('custom_roles', currentRoles);
    return newRole;
  }

  // 4. Team Members Management
  async listTeamMembers(): Promise<any[]> {
    const members = (await this.getSetting('team_members', [])) as any[];

    // Never return PIN hashes to the browser.
    return members.map(({ posPinHash: _hidden, ...safe }) => safe);
  }

  async inviteTeamMember(input: TeamMemberInput): Promise<any> {
    const currentMembers = (await this.getSetting('team_members', [])) as any[];
    const memberId = `tm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    let posPinHash = null;
    if (input.posPin) {
      posPinHash = await hashPassword(input.posPin);
    }

    const newMember = {
      id: memberId,
      name: input.name,
      phone: input.phone || '',
      email: input.email || '',
      roleKey: input.roleKey,
      branchIds: input.branchIds || ['*'],
      moduleRoles: input.moduleRoles ?? {},
      hasPosPin: Boolean(posPinHash),
      posPinHash,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    currentMembers.push(newMember);
    await this.setSetting('team_members', currentMembers);
    const { posPinHash: _hidden, ...safe } = newMember;
    return safe;
  }

  /** Change one member's role inside one workspace ('' removes their access to it). */
  async setMemberModuleRole(memberId: string, workspace: string, role: string): Promise<any> {
    const members = (await this.getSetting('team_members', [])) as any[];
    const m = members.find((x) => x.id === memberId);
    if (!m) throw new Error('MEMBER_NOT_FOUND');
    const roles: Record<string, string> = { ...(m.moduleRoles ?? {}) };
    if (role) roles[workspace] = role;
    else delete roles[workspace];
    m.moduleRoles = roles;
    await this.setSetting('team_members', members);
    const { posPinHash: _hidden, ...safe } = m;
    return safe;
  }

  // 5. Full Business Data Export (JSON format)
  async exportAllData(): Promise<any> {
    const rawSql = this.getSql();
    const payload: Record<string, any> = {
      exportedAt: new Date().toISOString(),
      branches: [],
      items: [],
      parties: [],
      invoices: [],
      settings: await this.getAllSettings(),
    };

    if (rawSql?.exec) {
      const bCur = rawSql.exec(`SELECT * FROM branches WHERE deleted_at IS NULL`);
      for (const b of bCur) payload.branches.push(b);

      const iCur = rawSql.exec(`SELECT * FROM items WHERE deleted_at IS NULL`);
      for (const it of iCur) payload.items.push(it);

      const pCur = rawSql.exec(`SELECT * FROM parties WHERE deleted_at IS NULL`);
      for (const p of pCur) payload.parties.push(p);

      const invCur = rawSql.exec(`SELECT * FROM invoices WHERE deleted_at IS NULL`);
      for (const inv of invCur) payload.invoices.push(inv);
    }

    return payload;
  }
}
