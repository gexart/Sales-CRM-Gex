import { newId, encryptAesGcm, decryptAesGcm } from '@billing/shared';

export interface BankAccountInput {
  name: string;
  accountType?: 'BANK' | 'CASH';
  accountNumber?: string;
  ifsc?: string;
  branch?: string;
  upiId?: string;
  openingBalancePaise?: number;
  isDefault?: boolean;
}

export interface BankAccountRecord {
  id: string;
  name: string;
  accountType: 'BANK' | 'CASH';
  maskedAccountNumber?: string;
  last4?: string;
  ifsc?: string;
  branch?: string;
  upiId?: string;
  openingBalancePaise: number;
  currentBalancePaise: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export class BankService {
  constructor(
    private sql: any,
    private encryptionSecret: string,
  ) {}

  async create(data: BankAccountInput): Promise<BankAccountRecord> {
    const id = `bnk_${newId()}`;
    const now = new Date().toISOString();

    const accountType = data.accountType === 'CASH' ? 'CASH' : 'BANK';
    const cleanAccNo = data.accountNumber?.trim() || '';
    const last4 = cleanAccNo.length >= 4 ? cleanAccNo.slice(-4) : cleanAccNo;
    const encryptedAcc = cleanAccNo ? await encryptAesGcm(cleanAccNo, this.encryptionSecret) : null;
    const isDefault = data.isDefault ? 1 : 0;

    if (isDefault) {
      // Only one default bank account
      this.sql.exec(`UPDATE bank_accounts SET is_default = 0 WHERE account_type = 'BANK'`);
    }

    this.sql.exec(
      `INSERT INTO bank_accounts (
        id, name, account_type, account_number_encrypted, last_4, ifsc, branch, upi_id,
        opening_balance_paise, current_balance_paise, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name.trim(),
      accountType,
      encryptedAcc,
      last4 || null,
      data.ifsc?.trim().toUpperCase() || null,
      data.branch?.trim() || null,
      data.upiId?.trim() || null,
      Math.trunc(data.openingBalancePaise || 0),
      Math.trunc(data.openingBalancePaise || 0),
      isDefault,
      now,
      now,
    );

    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<BankAccountRecord | null> {
    const row = this.sql.exec(`SELECT * FROM bank_accounts WHERE id = ? AND deleted_at IS NULL LIMIT 1`, String(id)).toArray()[0];
    return row ? this.mapRow(row) : null;
  }

  /**
   * Decrypts the full account number for owner display
   */
  async revealAccountNumber(id: string): Promise<string | null> {
    const row = this.sql
      .exec(`SELECT account_number_encrypted FROM bank_accounts WHERE id = ? AND deleted_at IS NULL LIMIT 1`, String(id))
      .toArray()[0];
    if (!row || !row.account_number_encrypted) return null;
    return decryptAesGcm(String(row.account_number_encrypted), this.encryptionSecret);
  }

  list(): BankAccountRecord[] {
    return this.sql
      .exec('SELECT * FROM bank_accounts WHERE deleted_at IS NULL ORDER BY is_default DESC, name ASC')
      .toArray()
      .map((r: any) => this.mapRow(r));
  }

  delete(id: string): boolean {
    const now = new Date().toISOString();
    this.sql.exec(`UPDATE bank_accounts SET deleted_at = ?, updated_at = ? WHERE id = ?`, now, now, String(id));
    return true;
  }

  private mapRow(row: any): BankAccountRecord {
    const last4 = row.last_4 ? String(row.last_4) : undefined;
    return {
      id: String(row.id),
      name: String(row.name),
      accountType: row.account_type,
      last4,
      maskedAccountNumber: last4 ? `•••• ${last4}` : undefined,
      ifsc: row.ifsc ? String(row.ifsc) : undefined,
      branch: row.branch ? String(row.branch) : undefined,
      upiId: row.upi_id ? String(row.upi_id) : undefined,
      openingBalancePaise: Number(row.opening_balance_paise || 0),
      currentBalancePaise: Number(row.current_balance_paise || 0),
      isDefault: Boolean(row.is_default),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    };
  }
}
