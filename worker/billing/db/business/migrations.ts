/**
 * BusinessDO SQLite Migrations
 * Creates all 40 tenant-level tables and indexes inside the business's dedicated Durable Object.
 */
export const BUSINESS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  gstin TEXT,
  state_code TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS branches_code_idx ON branches(code);
CREATE INDEX IF NOT EXISTS branches_state_code_idx ON branches(state_code);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS warehouses_branch_id_idx ON warehouses(branch_id);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_series (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  doc_type TEXT NOT NULL,
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  fy_suffix_enabled INTEGER NOT NULL DEFAULT 1,
  financial_year TEXT NOT NULL,
  padding INTEGER NOT NULL DEFAULT 4,
  is_default INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS document_series_branch_doctype_idx ON document_series(branch_id, doc_type);

CREATE TABLE IF NOT EXISTS tax_rates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rate_basis_points INTEGER NOT NULL,
  igst_basis_points INTEGER NOT NULL,
  cgst_basis_points INTEGER NOT NULL,
  sgst_basis_points INTEGER NOT NULL,
  cess_basis_points INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  is_decimal_allowed INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'CUSTOMER',
  name TEXT NOT NULL,
  company TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  gstin TEXT,
  pan TEXT,
  billing_address TEXT,
  shipping_address TEXT,
  state_code TEXT NOT NULL,
  credit_limit_paise INTEGER NOT NULL DEFAULT 0,
  credit_days INTEGER NOT NULL DEFAULT 0,
  opening_balance_paise INTEGER NOT NULL DEFAULT 0,
  opening_balance_type TEXT NOT NULL DEFAULT 'RECEIVE',
  tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS parties_phone_idx ON parties(phone);
CREATE INDEX IF NOT EXISTS parties_gstin_idx ON parties(gstin);
CREATE INDEX IF NOT EXISTS parties_type_idx ON parties(type);
CREATE INDEX IF NOT EXISTS parties_deleted_at_idx ON parties(deleted_at);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'GOODS',
  category_id TEXT,
  brand TEXT,
  sku TEXT,
  barcode TEXT,
  hsn_sac TEXT NOT NULL DEFAULT '',
  unit_id TEXT NOT NULL REFERENCES units(id),
  secondary_unit_id TEXT,
  conversion_factor_thousandths INTEGER NOT NULL DEFAULT 1000,
  sale_price_paise INTEGER NOT NULL DEFAULT 0,
  purchase_price_paise INTEGER NOT NULL DEFAULT 0,
  mrp_paise INTEGER NOT NULL DEFAULT 0,
  wholesale_price_paise INTEGER NOT NULL DEFAULT 0,
  min_wholesale_qty_thousandths INTEGER NOT NULL DEFAULT 0,
  tax_rate_id TEXT NOT NULL REFERENCES tax_rates(id),
  price_includes_tax INTEGER NOT NULL DEFAULT 0,
  cess_basis_points INTEGER NOT NULL DEFAULT 0,
  opening_stock_thousandths INTEGER NOT NULL DEFAULT 0,
  low_stock_level_thousandths INTEGER NOT NULL DEFAULT 0,
  track_batch INTEGER NOT NULL DEFAULT 0,
  track_expiry INTEGER NOT NULL DEFAULT 0,
  track_serial INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  show_in_pos INTEGER NOT NULL DEFAULT 1,
  show_in_restaurant INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS items_sku_idx ON items(sku);
CREATE INDEX IF NOT EXISTS items_barcode_idx ON items(barcode);
CREATE INDEX IF NOT EXISTS items_deleted_at_idx ON items(deleted_at);

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  parent_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  sale_price_paise INTEGER NOT NULL DEFAULT 0,
  purchase_price_paise INTEGER NOT NULL DEFAULT 0,
  opening_stock_thousandths INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS variants_parent_item_idx ON variants(parent_item_id);
CREATE INDEX IF NOT EXISTS variants_barcode_idx ON variants(barcode);

CREATE TABLE IF NOT EXISTS price_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  party_id TEXT,
  items_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'BANK',
  account_number_encrypted TEXT,
  last_4 TEXT,
  ifsc TEXT,
  branch TEXT,
  upi_id TEXT,
  opening_balance_paise INTEGER NOT NULL DEFAULT 0,
  current_balance_paise INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  chart_account_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS bank_accounts_deleted_at_idx ON bank_accounts(deleted_at);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT NOT NULL,
  parent_id TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  party_id TEXT,
  balance_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_code_idx ON accounts(code);
CREATE INDEX IF NOT EXISTS accounts_type_idx ON accounts(type);
CREATE INDEX IF NOT EXISTS accounts_party_id_idx ON accounts(party_id);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  doc_id TEXT,
  narration TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_entries_doc_lookup_idx ON journal_entries(doc_type, doc_id);
CREATE INDEX IF NOT EXISTS journal_entries_branch_date_idx ON journal_entries(branch_id, date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  party_id TEXT,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  debit_paise INTEGER NOT NULL DEFAULT 0,
  credit_paise INTEGER NOT NULL DEFAULT 0,
  narration TEXT
);
CREATE INDEX IF NOT EXISTS journal_lines_entry_id_idx ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account_id_idx ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS journal_lines_party_id_idx ON journal_lines(party_id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES document_series(id),
  invoice_no TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  party_name TEXT NOT NULL,
  party_gstin TEXT,
  party_state_code TEXT NOT NULL,
  invoice_type TEXT NOT NULL DEFAULT 'REGULAR',
  date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_total_paise INTEGER NOT NULL DEFAULT 0,
  round_off_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  paid_amount_paise INTEGER NOT NULL DEFAULT 0,
  balance_amount_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  notes TEXT,
  terms TEXT,
  qr_code_data TEXT,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_no_idx ON invoices(invoice_no);
CREATE INDEX IF NOT EXISTS invoices_party_id_idx ON invoices(party_id);
CREATE INDEX IF NOT EXISTS invoices_branch_date_idx ON invoices(branch_id, date);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  variant_id TEXT,
  name TEXT NOT NULL,
  hsn_sac TEXT NOT NULL DEFAULT '',
  quantity_thousandths INTEGER NOT NULL,
  unit_id TEXT NOT NULL REFERENCES units(id),
  unit_price_paise INTEGER NOT NULL,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_rate_basis_points INTEGER NOT NULL DEFAULT 0,
  cgst_amount_paise INTEGER NOT NULL DEFAULT 0,
  sgst_amount_paise INTEGER NOT NULL DEFAULT 0,
  igst_amount_paise INTEGER NOT NULL DEFAULT 0,
  cess_amount_paise INTEGER NOT NULL DEFAULT 0,
  line_total_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_id_idx ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_lines_item_id_idx ON invoice_lines(item_id);

CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  quotation_no TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  tax_total_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quotations_party_id_idx ON quotations(party_id);

CREATE TABLE IF NOT EXISTS quotation_lines (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  name TEXT NOT NULL,
  quantity_thousandths INTEGER NOT NULL,
  unit_price_paise INTEGER NOT NULL,
  tax_rate_basis_points INTEGER NOT NULL DEFAULT 0,
  line_total_paise INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id TEXT PRIMARY KEY,
  note_no TEXT NOT NULL UNIQUE,
  invoice_id TEXT REFERENCES invoices(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  total_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_notes_party_id_idx ON credit_notes(party_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  payment_no TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  type TEXT NOT NULL,
  mode TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  date TEXT NOT NULL,
  reference_no TEXT,
  invoice_id TEXT REFERENCES invoices(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  notes TEXT,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_party_id_idx ON payments(party_id);
CREATE INDEX IF NOT EXISTS payments_branch_date_idx ON payments(branch_id, date);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  po_no TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  total_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_orders_party_id_idx ON purchase_orders(party_id);

CREATE TABLE IF NOT EXISTS purchase_bills (
  id TEXT PRIMARY KEY,
  bill_no TEXT NOT NULL UNIQUE,
  vendor_bill_no TEXT,
  vendor_invoice_date TEXT,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  tax_total_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  paid_amount_paise INTEGER NOT NULL DEFAULT 0,
  rcm_applicable INTEGER NOT NULL DEFAULT 0,
  itc_eligibility TEXT NOT NULL DEFAULT 'ELIGIBLE',
  status TEXT NOT NULL DEFAULT 'UNPAID',
  notes TEXT,
  receipt_file_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_bills_party_id_idx ON purchase_bills(party_id);

CREATE TABLE IF NOT EXISTS purchase_bill_lines (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  quantity_thousandths INTEGER NOT NULL,
  unit_price_paise INTEGER NOT NULL,
  tax_rate_basis_points INTEGER NOT NULL DEFAULT 0,
  taxable_amount_paise INTEGER NOT NULL DEFAULT 0,
  tax_amount_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  line_total_paise INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS debit_notes (
  id TEXT PRIMARY KEY,
  note_no TEXT NOT NULL UNIQUE,
  bill_id TEXT REFERENCES purchase_bills(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT REFERENCES warehouses(id),
  party_id TEXT NOT NULL REFERENCES parties(id),
  date TEXT NOT NULL,
  taxable_amount_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  expense_no TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  category_account_id TEXT NOT NULL REFERENCES accounts(id),
  payment_account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_paise INTEGER NOT NULL,
  tax_rate_basis_points INTEGER NOT NULL DEFAULT 0,
  tax_amount_paise INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'CASH',
  reference_no TEXT,
  payee TEXT,
  notes TEXT,
  receipt_file_key TEXT,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_branch_date_idx ON expenses(branch_id, date);

CREATE TABLE IF NOT EXISTS stock_ledgers (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  variant_id TEXT,
  batch_id TEXT,
  doc_type TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  doc_no TEXT NOT NULL,
  qty_in_thousandths INTEGER NOT NULL DEFAULT 0,
  qty_out_thousandths INTEGER NOT NULL DEFAULT 0,
  rate_paise INTEGER NOT NULL DEFAULT 0,
  balance_qty_thousandths INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_ledgers_item_wh_idx ON stock_ledgers(item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS stock_ledgers_branch_date_idx ON stock_ledgers(branch_id, date);

CREATE TABLE IF NOT EXISTS stock_balances (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  variant_id TEXT,
  current_qty_thousandths INTEGER NOT NULL DEFAULT 0,
  reserved_qty_thousandths INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_balances_lookup_idx ON stock_balances(warehouse_id, item_id, variant_id);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  batch_no TEXT NOT NULL,
  mfg_date TEXT,
  expiry_date TEXT,
  mrp_paise INTEGER NOT NULL DEFAULT 0,
  sale_price_paise INTEGER NOT NULL DEFAULT 0,
  purchase_price_paise INTEGER NOT NULL DEFAULT 0,
  quantity_thousandths INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS batches_item_batch_idx ON batches(item_id, batch_no);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  instructions TEXT,
  is_batch INTEGER NOT NULL DEFAULT 0,
  yield_quantity_thousandths INTEGER NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  raw_item_id TEXT NOT NULL REFERENCES items(id),
  quantity_thousandths INTEGER NOT NULL,
  unit_id TEXT NOT NULL REFERENCES units(id)
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  category_id TEXT NOT NULL REFERENCES menu_categories(id),
  name TEXT NOT NULL,
  short_code TEXT,
  is_veg INTEGER NOT NULL DEFAULT 1,
  spice_level INTEGER NOT NULL DEFAULT 1,
  prep_time_minutes INTEGER NOT NULL DEFAULT 15,
  station TEXT NOT NULL DEFAULT 'Kitchen',
  price_paise INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS menu_items_category_id_idx ON menu_items(category_id);

CREATE TABLE IF NOT EXISTS restaurant_floors (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES restaurant_floors(id),
  table_no TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'VACANT',
  current_order_id TEXT,
  active_since TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS restaurant_tables_floor_id_idx ON restaurant_tables(floor_id);

CREATE TABLE IF NOT EXISTS restaurant_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  table_id TEXT,
  order_type TEXT NOT NULL DEFAULT 'DINE_IN',
  customer_phone TEXT,
  customer_name TEXT,
  guest_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'OPEN',
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  service_charge_paise INTEGER NOT NULL DEFAULT 0,
  tax_total_paise INTEGER NOT NULL DEFAULT 0,
  round_off_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  steward_id TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS restaurant_orders_branch_date_idx ON restaurant_orders(branch_id, created_at);
CREATE INDEX IF NOT EXISTS restaurant_orders_status_idx ON restaurant_orders(status);

CREATE TABLE IF NOT EXISTS kots (
  id TEXT PRIMARY KEY,
  kot_no TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL REFERENCES restaurant_orders(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  table_id TEXT,
  token_no INTEGER NOT NULL DEFAULT 1,
  kitchen_notes TEXT,
  status TEXT NOT NULL DEFAULT 'PRINTED',
  printed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kots_order_id_idx ON kots(order_id);

CREATE TABLE IF NOT EXISTS kot_items (
  id TEXT PRIMARY KEY,
  kot_id TEXT NOT NULL REFERENCES kots(id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL REFERENCES items(id),
  name TEXT NOT NULL,
  quantity_thousandths INTEGER NOT NULL,
  station TEXT NOT NULL DEFAULT 'Kitchen',
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PREPARING'
);

CREATE TABLE IF NOT EXISTS pos_shifts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  register_no TEXT NOT NULL DEFAULT 'REG-01',
  cashier_id TEXT NOT NULL,
  opening_cash_paise INTEGER NOT NULL DEFAULT 0,
  closing_cash_paise INTEGER,
  expected_cash_paise INTEGER NOT NULL DEFAULT 0,
  discrepancy_paise INTEGER NOT NULL DEFAULT 0,
  total_sales_paise INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS pos_shifts_branch_cashier_idx ON pos_shifts(branch_id, cashier_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_lookup_idx ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'INFO',
  is_read INTEGER NOT NULL DEFAULT 0,
  link TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  file_key TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_entity_idx ON attachments(entity, entity_id);

CREATE TABLE IF NOT EXISTS invoice_share_tokens (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  viewed_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_share_tokens_token_idx ON invoice_share_tokens(token);

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id TEXT PRIMARY KEY,
  template_invoice_id TEXT NOT NULL REFERENCES invoices(id),
  frequency TEXT NOT NULL,
  next_run_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  auto_send INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id TEXT PRIMARY KEY,
  transfer_no TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  source_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  destination_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  notes TEXT,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  variant_id TEXT,
  batch_id TEXT,
  quantity_thousandths INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  adjustment_no TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  total_difference_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustment_lines (
  id TEXT PRIMARY KEY,
  adjustment_id TEXT NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  variant_id TEXT,
  batch_id TEXT,
  adjustment_type TEXT NOT NULL,
  quantity_thousandths INTEGER NOT NULL,
  rate_paise INTEGER NOT NULL DEFAULT 0,
  value_paise INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  type TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pos_held_bills (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  cashier_id TEXT NOT NULL,
  label TEXT NOT NULL,
  cart_json TEXT NOT NULL,
  customer_phone TEXT,
  customer_name TEXT,
  total_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_statements (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  statement_date TEXT NOT NULL,
  filename TEXT NOT NULL,
  opening_balance_paise INTEGER NOT NULL DEFAULT 0,
  closing_balance_paise INTEGER NOT NULL DEFAULT 0,
  total_deposits_paise INTEGER NOT NULL DEFAULT 0,
  total_withdrawals_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bank_statements_bank_account_id_idx ON bank_statements(bank_account_id);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  reference_no TEXT,
  amount_paise INTEGER NOT NULL,
  type TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'UNRECONCILED',
  matched_journal_line_id TEXT,
  matched_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS bank_statement_lines_statement_id_idx ON bank_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS bank_statement_lines_recon_status_idx ON bank_statement_lines(reconciliation_status);

CREATE TABLE IF NOT EXISTS cheques (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  party_id TEXT REFERENCES parties(id),
  type TEXT NOT NULL,
  cheque_no TEXT NOT NULL,
  cheque_date TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  payee_payer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  clearing_date TEXT,
  bounce_date TEXT,
  bounce_charges_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cheques_status_idx ON cheques(status);
CREATE INDEX IF NOT EXISTS cheques_bank_account_id_idx ON cheques(bank_account_id);

CREATE TABLE IF NOT EXISTS tds_entries (
  id TEXT PRIMARY KEY,
  voucher_type TEXT NOT NULL,
  voucher_id TEXT NOT NULL,
  party_id TEXT REFERENCES parties(id),
  pan TEXT,
  section TEXT NOT NULL,
  rate_basis_points INTEGER NOT NULL,
  taxable_amount_paise INTEGER NOT NULL,
  tds_amount_paise INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DEDUCTED',
  challan_no TEXT,
  challan_date TEXT,
  bsr_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tds_entries_section_idx ON tds_entries(section);
CREATE INDEX IF NOT EXISTS tds_entries_date_idx ON tds_entries(date);

CREATE TABLE IF NOT EXISTS tcs_entries (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  party_id TEXT REFERENCES parties(id),
  pan TEXT,
  section TEXT NOT NULL DEFAULT '206C_1H',
  rate_basis_points INTEGER NOT NULL DEFAULT 10,
  taxable_amount_paise INTEGER NOT NULL,
  tcs_amount_paise INTEGER NOT NULL,
  date TEXT NOT NULL,
  challan_no TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS advance_adjustments (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  invoice_id TEXT REFERENCES invoices(id),
  purchase_bill_id TEXT REFERENCES purchase_bills(id),
  adjusted_amount_paise INTEGER NOT NULL,
  adjusted_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_centres (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'DEPARTMENT',
  branch_id TEXT REFERENCES branches(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_centre_budgets (
  id TEXT PRIMARY KEY,
  cost_centre_id TEXT NOT NULL REFERENCES cost_centres(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  budget_paise INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id TEXT PRIMARY KEY,
  asset_name TEXT NOT NULL,
  asset_code TEXT NOT NULL UNIQUE,
  cost_centre_id TEXT REFERENCES cost_centres(id),
  purchase_date TEXT NOT NULL,
  purchase_cost_paise INTEGER NOT NULL,
  depreciation_method TEXT NOT NULL DEFAULT 'WDV',
  depreciation_rate_basis_points INTEGER NOT NULL,
  salvage_value_paise INTEGER NOT NULL DEFAULT 0,
  accumulated_depreciation_paise INTEGER NOT NULL DEFAULT 0,
  net_book_value_paise INTEGER NOT NULL,
  asset_account_id TEXT NOT NULL REFERENCES accounts(id),
  depreciation_expense_account_id TEXT NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  disposal_date TEXT,
  disposal_proceeds_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fixed_asset_depreciations (
  id TEXT PRIMARY KEY,
  fixed_asset_id TEXT NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  depreciation_amount_paise INTEGER NOT NULL,
  date TEXT NOT NULL,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS e_invoices (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  irn TEXT NOT NULL UNIQUE,
  ack_no TEXT NOT NULL,
  ack_date TEXT NOT NULL,
  signed_invoice TEXT,
  signed_qr_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  cancel_reason TEXT,
  cancel_remarks TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS e_invoices_invoice_idx ON e_invoices(invoice_id);

CREATE TABLE IF NOT EXISTS e_way_bills (
  id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL DEFAULT 'INVOICE',
  document_id TEXT NOT NULL,
  ewb_number TEXT NOT NULL UNIQUE,
  ewb_date TEXT NOT NULL,
  valid_upto TEXT NOT NULL,
  supply_type TEXT NOT NULL DEFAULT 'O',
  sub_supply_type TEXT NOT NULL DEFAULT '1',
  transporter_id TEXT,
  transporter_name TEXT,
  trans_doc_no TEXT,
  trans_mode TEXT NOT NULL DEFAULT 'ROAD',
  distance_km INTEGER NOT NULL DEFAULT 0,
  vehicle_no TEXT,
  vehicle_type TEXT NOT NULL DEFAULT 'REGULAR',
  from_place TEXT NOT NULL,
  from_pincode INTEGER NOT NULL,
  to_place TEXT NOT NULL,
  to_pincode INTEGER NOT NULL,
  total_value_paise INTEGER NOT NULL,
  part_b_status TEXT NOT NULL DEFAULT 'PENDING',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  cancel_reason TEXT,
  cancel_remarks TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS e_way_bills_doc_idx ON e_way_bills(document_type, document_id);

CREATE TABLE IF NOT EXISTS crm_leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'MANUAL',
  score INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'NEW',
  stage TEXT NOT NULL DEFAULT 'PROSPECT',
  assigned_to_id TEXT,
  branch_id TEXT REFERENCES branches(id),
  estimated_value_paise INTEGER NOT NULL DEFAULT 0,
  probability_percent INTEGER NOT NULL DEFAULT 20,
  expected_close_date TEXT,
  converted_party_id TEXT REFERENCES parties(id),
  tags TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_leads_phone_idx ON crm_leads(phone);
CREATE INDEX IF NOT EXISTS crm_leads_stage_idx ON crm_leads(stage);

CREATE TABLE IF NOT EXISTS crm_deals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  lead_id TEXT REFERENCES crm_leads(id) ON DELETE SET NULL,
  party_id TEXT REFERENCES parties(id),
  stage TEXT NOT NULL DEFAULT 'LEAD_IN',
  value_paise INTEGER NOT NULL DEFAULT 0,
  probability_percent INTEGER NOT NULL DEFAULT 20,
  expected_close_date TEXT,
  closed_at TEXT,
  quotation_id TEXT,
  invoice_id TEXT REFERENCES invoices(id),
  assigned_to_id TEXT,
  branch_id TEXT REFERENCES branches(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_deals_stage_idx ON crm_deals(stage);

CREATE TABLE IF NOT EXISTS crm_activities (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES crm_leads(id) ON DELETE CASCADE,
  party_id TEXT REFERENCES parties(id),
  deal_id TEXT REFERENCES crm_deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_by_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_activities_type_idx ON crm_activities(type);
CREATE INDEX IF NOT EXISTS crm_activities_due_idx ON crm_activities(due_date, status);

CREATE TABLE IF NOT EXISTS loyalty_programs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Standard Rewards',
  points_per_hundred_rupees INTEGER NOT NULL DEFAULT 5,
  paise_per_point_redemption INTEGER NOT NULL DEFAULT 50,
  min_redeem_points INTEGER NOT NULL DEFAULT 100,
  max_redeem_percentage INTEGER NOT NULL DEFAULT 50,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES invoices(id),
  type TEXT NOT NULL,
  points INTEGER NOT NULL,
  balance_points INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS loyalty_tx_party_idx ON loyalty_transactions(party_id);

CREATE TABLE IF NOT EXISTS gift_cards (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  initial_balance_paise INTEGER NOT NULL,
  current_balance_paise INTEGER NOT NULL,
  party_id TEXT REFERENCES parties(id),
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_idx ON gift_cards(code);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  template_id TEXT,
  message_content TEXT NOT NULL,
  segment_criteria TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  scheduled_at TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  opt_out_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_messages (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_email TEXT,
  recipient_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  external_msg_id TEXT,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS campaign_messages_campaign_idx ON campaign_messages(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_messages_phone_idx ON campaign_messages(recipient_phone);

CREATE TABLE IF NOT EXISTS customer_feedbacks (
  id TEXT PRIMARY KEY,
  party_id TEXT REFERENCES parties(id),
  invoice_id TEXT REFERENCES invoices(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  rating INTEGER NOT NULL,
  comment TEXT,
  google_review_clicked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_feedbacks_rating_idx ON customer_feedbacks(rating);

CREATE TABLE IF NOT EXISTS hr_employees (
  id TEXT PRIMARY KEY,
  employee_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  pan TEXT,
  aadhaar_masked TEXT,
  gender TEXT,
  date_of_birth TEXT,
  joining_date TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'Operations',
  designation TEXT NOT NULL DEFAULT 'Staff',
  branch_id TEXT NOT NULL REFERENCES branches(id),
  user_id TEXT,
  bank_account_number_encrypted TEXT,
  bank_ifsc TEXT,
  bank_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  basic_paise INTEGER NOT NULL DEFAULT 1500000,
  hra_paise INTEGER NOT NULL DEFAULT 600000,
  allowances_paise INTEGER NOT NULL DEFAULT 400000,
  pf_opted INTEGER NOT NULL DEFAULT 1,
  esi_opted INTEGER NOT NULL DEFAULT 1,
  pt_state_code TEXT NOT NULL DEFAULT '19',
  tax_regime TEXT NOT NULL DEFAULT 'NEW',
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_employees_code_idx ON hr_employees(employee_code);
CREATE INDEX IF NOT EXISTS hr_employees_branch_idx ON hr_employees(branch_id);

CREATE TABLE IF NOT EXISTS hr_attendance (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  check_in_time TEXT,
  check_out_time TEXT,
  check_in_selfie_r2_key TEXT,
  check_in_latitude TEXT,
  check_in_longitude TEXT,
  status TEXT NOT NULL DEFAULT 'PRESENT',
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  is_regularized INTEGER NOT NULL DEFAULT 0,
  regularization_reason TEXT,
  approval_status TEXT NOT NULL DEFAULT 'APPROVED',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_attendance_emp_date_idx ON hr_attendance(employee_id, date);

CREATE TABLE IF NOT EXISTS hr_leave_types (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  annual_quota_days INTEGER NOT NULL DEFAULT 12,
  requires_approval INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type_id TEXT NOT NULL REFERENCES hr_leave_types(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  total_days INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by_id TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hr_leave_requests_emp_idx ON hr_leave_requests(employee_id);

CREATE TABLE IF NOT EXISTS hr_payroll_runs (
  id TEXT PRIMARY KEY,
  financial_year TEXT NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  total_gross_paise INTEGER NOT NULL DEFAULT 0,
  total_deductions_paise INTEGER NOT NULL DEFAULT 0,
  total_net_paise INTEGER NOT NULL DEFAULT 0,
  total_pf_paise INTEGER NOT NULL DEFAULT 0,
  total_esi_paise INTEGER NOT NULL DEFAULT 0,
  total_pt_paise INTEGER NOT NULL DEFAULT 0,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  finalized_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_payslips (
  id TEXT PRIMARY KEY,
  payroll_run_id TEXT NOT NULL REFERENCES hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES hr_employees(id),
  days_present INTEGER NOT NULL DEFAULT 30,
  days_absent INTEGER NOT NULL DEFAULT 0,
  days_leave INTEGER NOT NULL DEFAULT 0,
  basic_paise INTEGER NOT NULL,
  hra_paise INTEGER NOT NULL,
  allowances_paise INTEGER NOT NULL,
  incentives_paise INTEGER NOT NULL DEFAULT 0,
  gross_salary_paise INTEGER NOT NULL,
  pf_paise INTEGER NOT NULL DEFAULT 0,
  esi_paise INTEGER NOT NULL DEFAULT 0,
  pt_paise INTEGER NOT NULL DEFAULT 0,
  tds_paise INTEGER NOT NULL DEFAULT 0,
  advance_deduction_paise INTEGER NOT NULL DEFAULT 0,
  net_salary_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  payment_mode TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_payslips_run_emp_idx ON hr_payslips(payroll_run_id, employee_id);

CREATE TABLE IF NOT EXISTS hr_salary_advances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  disbursed_date TEXT NOT NULL,
  monthly_emi_paise INTEGER NOT NULL,
  balance_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hr_advances_emp_idx ON hr_salary_advances(employee_id);

CREATE TABLE IF NOT EXISTS mfg_boms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  finished_item_id TEXT NOT NULL REFERENCES items(id),
  finished_variant_id TEXT,
  output_quantity_thousandths INTEGER NOT NULL DEFAULT 1000,
  scrap_percent_basis_points INTEGER NOT NULL DEFAULT 0,
  labour_cost_paise INTEGER NOT NULL DEFAULT 0,
  overhead_cost_paise INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mfg_boms_finished_item_idx ON mfg_boms(finished_item_id);

CREATE TABLE IF NOT EXISTS mfg_bom_lines (
  id TEXT PRIMARY KEY,
  bom_id TEXT NOT NULL REFERENCES mfg_boms(id) ON DELETE CASCADE,
  raw_item_id TEXT NOT NULL REFERENCES items(id),
  raw_variant_id TEXT,
  quantity_thousandths INTEGER NOT NULL,
  scrap_percent_basis_points INTEGER NOT NULL DEFAULT 0,
  cost_share_percent INTEGER NOT NULL DEFAULT 100,
  line_type TEXT NOT NULL DEFAULT 'RAW_MATERIAL',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mfg_bom_lines_bom_idx ON mfg_bom_lines(bom_id);

CREATE TABLE IF NOT EXISTS mfg_production_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  bom_id TEXT NOT NULL REFERENCES mfg_boms(id),
  finished_item_id TEXT NOT NULL REFERENCES items(id),
  target_quantity_thousandths INTEGER NOT NULL,
  produced_quantity_thousandths INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  branch_id TEXT NOT NULL REFERENCES branches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  standard_cost_paise INTEGER NOT NULL DEFAULT 0,
  actual_cost_paise INTEGER NOT NULL DEFAULT 0,
  variance_paise INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  completed_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mfg_prod_orders_status_idx ON mfg_production_orders(status);

CREATE TABLE IF NOT EXISTS mfg_production_materials_issued (
  id TEXT PRIMARY KEY,
  production_order_id TEXT NOT NULL REFERENCES mfg_production_orders(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  planned_quantity_thousandths INTEGER NOT NULL,
  actual_issued_quantity_thousandths INTEGER NOT NULL,
  rate_paise INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mfg_mat_issued_order_idx ON mfg_production_materials_issued(production_order_id);

CREATE TABLE IF NOT EXISTS mfg_job_work (
  id TEXT PRIMARY KEY,
  challan_no TEXT NOT NULL UNIQUE,
  vendor_party_id TEXT NOT NULL REFERENCES parties(id),
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  expected_return_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  raw_materials_json TEXT,
  finished_expected_json TEXT,
  job_work_charges_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mfg_job_work_vendor_idx ON mfg_job_work(vendor_party_id);

CREATE TABLE IF NOT EXISTS mfg_wastage_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  quantity_thousandths INTEGER NOT NULL,
  cost_paise INTEGER NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  created_by_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mfg_wastage_branch_date_idx ON mfg_wastage_logs(branch_id, date);

CREATE TABLE IF NOT EXISTS online_order_configs (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  provider TEXT NOT NULL DEFAULT 'URBANPIPER',
  api_key_encrypted TEXT,
  username TEXT,
  store_id_swiggy TEXT,
  store_id_zomato TEXT,
  is_auto_accept INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS online_order_configs_branch_idx ON online_order_configs(branch_id);

CREATE TABLE IF NOT EXISTS online_menu_mappings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  platform TEXT NOT NULL,
  platform_item_id TEXT,
  price_paise INTEGER NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS online_menu_branch_platform_idx ON online_menu_mappings(branch_id, platform);
CREATE INDEX IF NOT EXISTS online_menu_item_platform_idx ON online_menu_mappings(item_id, platform);

CREATE TABLE IF NOT EXISTS online_orders (
  id TEXT PRIMARY KEY,
  order_id_channel TEXT NOT NULL,
  channel TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  customer_name TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  items_json TEXT NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  commission_paise INTEGER NOT NULL DEFAULT 0,
  net_payout_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLACED',
  rider_name TEXT,
  rider_phone TEXT,
  rider_status TEXT,
  kot_id TEXT,
  invoice_id TEXT,
  placed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS online_orders_channel_order_idx ON online_orders(channel, order_id_channel);
CREATE INDEX IF NOT EXISTS online_orders_branch_status_idx ON online_orders(branch_id, status);

CREATE TABLE IF NOT EXISTS table_qr_sessions (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  table_id TEXT NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS table_qr_token_idx ON table_qr_sessions(session_token);
CREATE INDEX IF NOT EXISTS table_qr_table_status_idx ON table_qr_sessions(table_id, status);

CREATE TABLE IF NOT EXISTS ecommerce_settings (
  id TEXT PRIMARY KEY,
  business_slug TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL,
  tagline TEXT,
  logo_url TEXT,
  banner_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#111C2E',
  custom_domain TEXT,
  merchant_razorpay_key_id TEXT,
  merchant_razorpay_key_secret_enc TEXT,
  cod_enabled INTEGER NOT NULL DEFAULT 1,
  min_order_paise INTEGER NOT NULL DEFAULT 0,
  free_shipping_threshold_paise INTEGER NOT NULL DEFAULT 50000,
  shipping_fee_paise INTEGER NOT NULL DEFAULT 6000,
  service_pincodes_json TEXT,
  shiprocket_api_key_enc TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ecom_settings_slug_idx ON ecommerce_settings(business_slug);

CREATE TABLE IF NOT EXISTS ecommerce_published_items (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE REFERENCES items(id),
  is_published INTEGER NOT NULL DEFAULT 1,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  images_json TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  compare_at_price_paise INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ecom_items_slug_idx ON ecommerce_published_items(slug);
CREATE INDEX IF NOT EXISTS ecom_items_published_idx ON ecommerce_published_items(is_published);

CREATE TABLE IF NOT EXISTS ecommerce_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  shipping_address_json TEXT NOT NULL,
  billing_address_json TEXT,
  items_json TEXT NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  coupon_code TEXT,
  shipping_fee_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'COD',
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  carrier TEXT DEFAULT 'SHIPROCKET',
  waybill_no TEXT,
  tracking_url TEXT,
  invoice_id TEXT,
  placed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ecom_orders_status_idx ON ecommerce_orders(status);
CREATE INDEX IF NOT EXISTS ecom_orders_phone_idx ON ecommerce_orders(customer_phone);

CREATE TABLE IF NOT EXISTS ecommerce_coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL,
  discount_value INTEGER NOT NULL,
  min_order_paise INTEGER NOT NULL DEFAULT 0,
  max_discount_paise INTEGER,
  valid_until TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ecom_coupons_code_idx ON ecommerce_coupons(code);

CREATE TABLE IF NOT EXISTS abandoned_carts (
  id TEXT PRIMARY KEY,
  customer_phone TEXT,
  customer_email TEXT,
  items_json TEXT NOT NULL,
  cart_total_paise INTEGER NOT NULL,
  last_active_at TEXT NOT NULL,
  reminder_sent_at TEXT,
  recovered_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS abandoned_carts_active_idx ON abandoned_carts(last_active_at);

CREATE TABLE IF NOT EXISTS pos_devices (
  id TEXT PRIMARY KEY,
  device_code TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  offline_series_prefix TEXT NOT NULL UNIQUE,
  last_synced_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pos_devices_branch_idx ON pos_devices(branch_id);
CREATE INDEX IF NOT EXISTS pos_devices_code_idx ON pos_devices(device_code);

CREATE TABLE IF NOT EXISTS offline_sync_mutations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES pos_devices(id),
  mutation_id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  conflict_reason TEXT,
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS offline_mutations_uuid_idx ON offline_sync_mutations(mutation_id);
CREATE INDEX IF NOT EXISTS offline_mutations_device_status_idx ON offline_sync_mutations(device_id, sync_status);

CREATE TABLE IF NOT EXISTS approval_rules (
  id TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL,
  threshold_value INTEGER NOT NULL,
  approver_role_key TEXT NOT NULL DEFAULT 'owner',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  rule_id TEXT REFERENCES approval_rules(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by_user_id TEXT,
  rejection_reason TEXT,
  actioned_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approval_requests_status_idx ON approval_requests(status);
CREATE INDEX IF NOT EXISTS approval_requests_entity_idx ON approval_requests(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS custom_fields (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  field_key TEXT NOT NULL UNIQUE,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'TEXT',
  is_required INTEGER NOT NULL DEFAULT 0,
  show_on_pdf INTEGER NOT NULL DEFAULT 1,
  options_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_field_values (
  id TEXT PRIMARY KEY,
  custom_field_id TEXT NOT NULL REFERENCES custom_fields(id),
  entity_id TEXT NOT NULL,
  value_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS custom_values_lookup_idx ON custom_field_values(custom_field_id, entity_id);

CREATE TABLE IF NOT EXISTS invoice_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  primary_colour TEXT NOT NULL DEFAULT '#111C2E',
  font_family TEXT NOT NULL DEFAULT 'Inter',
  header_layout TEXT NOT NULL DEFAULT 'STANDARD',
  show_qr INTEGER NOT NULL DEFAULT 1,
  show_bank_details INTEGER NOT NULL DEFAULT 1,
  terms_text TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  last_used_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outgoing_webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  event_types_json TEXT NOT NULL,
  secret TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tool_calls_json TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);








-- Trade documents (Part 1 billing): quotations, proforma, sales orders, delivery challans, packing lists, purchase orders
CREATE TABLE IF NOT EXISTS trade_documents (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL,
  doc_no TEXT NOT NULL,
  series_id TEXT,
  branch_id TEXT NOT NULL,
  party_id TEXT NOT NULL,
  party_name TEXT NOT NULL,
  party_gstin TEXT,
  party_state_code TEXT NOT NULL,
  date TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  cess_paise INTEGER NOT NULL DEFAULT 0,
  tax_total_paise INTEGER NOT NULL DEFAULT 0,
  round_off_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  shipping_address TEXT,
  transport_json TEXT,
  notes TEXT,
  terms TEXT,
  source_doc_type TEXT,
  source_doc_id TEXT,
  source_doc_no TEXT,
  converted_json TEXT NOT NULL DEFAULT '[]',
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_documents_type_no_idx ON trade_documents(doc_type, doc_no);
CREATE INDEX IF NOT EXISTS trade_documents_type_date_idx ON trade_documents(doc_type, date);
CREATE INDEX IF NOT EXISTS trade_documents_party_idx ON trade_documents(party_id);

CREATE TABLE IF NOT EXISTS trade_document_lines (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES trade_documents(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  item_id TEXT,
  name TEXT NOT NULL,
  hsn_sac TEXT,
  unit_id TEXT,
  quantity_thousandths INTEGER NOT NULL,
  converted_thousandths INTEGER NOT NULL DEFAULT 0,
  unit_price_paise INTEGER NOT NULL,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_rate_basis_points INTEGER NOT NULL DEFAULT 0,
  is_tax_inclusive INTEGER NOT NULL DEFAULT 0,
  taxable_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  line_total_paise INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS trade_document_lines_doc_idx ON trade_document_lines(document_id);

-- CRM support tickets (cases) with priority-based response deadline
CREATE TABLE IF NOT EXISTS crm_tickets (
  id TEXT PRIMARY KEY,
  ticket_no TEXT NOT NULL,
  party_id TEXT REFERENCES parties(id),
  lead_id TEXT REFERENCES crm_leads(id) ON DELETE SET NULL,
  contact_name TEXT,
  contact_phone TEXT,
  subject TEXT NOT NULL,
  description TEXT,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'OPEN',
  channel TEXT NOT NULL DEFAULT 'PHONE',
  assigned_to_id TEXT,
  due_at TEXT,
  resolved_at TEXT,
  resolution TEXT,
  created_by_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_tickets_status_idx ON crm_tickets(status, due_at);
CREATE TABLE IF NOT EXISTS crm_ticket_notes (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES crm_tickets(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_ticket_notes_ticket_idx ON crm_ticket_notes(ticket_id);

-- No-code automations (Part 2 platform): when <event> then <action>
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event TEXT NOT NULL,
  min_amount_paise INTEGER,
  action TEXT NOT NULL,
  template TEXT NOT NULL,
  due_in_days INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflows_event_idx ON workflows(event, is_active);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  event TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_runs_wf_idx ON workflow_runs(workflow_id, created_at);

-- Rack / bin location of an item in a warehouse
CREATE TABLE IF NOT EXISTS item_locations (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  rack_bin TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS item_locations_item_wh_idx ON item_locations(item_id, warehouse_id);

-- Projects & timesheets
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  party_id TEXT REFERENCES parties(id),
  billing_type TEXT NOT NULL DEFAULT 'HOURLY',
  hourly_rate_paise INTEGER NOT NULL DEFAULT 0,
  fixed_price_paise INTEGER NOT NULL DEFAULT 0,
  budget_hours REAL,
  cost_rate_paise INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  due_date TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_name TEXT,
  due_date TEXT,
  estimate_hours REAL,
  status TEXT NOT NULL DEFAULT 'TODO',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_tasks_project_idx ON project_tasks(project_id);
CREATE TABLE IF NOT EXISTS timesheets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES project_tasks(id) ON DELETE SET NULL,
  user_id TEXT,
  user_name TEXT,
  date TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  billable INTEGER NOT NULL DEFAULT 1,
  billed INTEGER NOT NULL DEFAULT 0,
  invoice_no TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS timesheets_project_idx ON timesheets(project_id, date);
CREATE INDEX IF NOT EXISTS timesheets_date_idx ON timesheets(date);

`;

/**
 * Columns added after a table was first created. SQLite has no "ADD COLUMN IF NOT EXISTS", so each one is
 * applied only when PRAGMA table_info shows it missing. Safe to run on every Durable Object start.
 */
export const BUSINESS_COLUMN_ADDITIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'document_series', column: 'suffix', ddl: "ALTER TABLE document_series ADD COLUMN suffix TEXT NOT NULL DEFAULT ''" },
  { table: 'parties', column: 'doc_prefix', ddl: 'ALTER TABLE parties ADD COLUMN doc_prefix TEXT' },
  { table: 'parties', column: 'doc_suffix', ddl: 'ALTER TABLE parties ADD COLUMN doc_suffix TEXT' },
  { table: 'restaurant_orders', column: 'bill_no', ddl: 'ALTER TABLE restaurant_orders ADD COLUMN bill_no TEXT' },
  { table: 'invoices', column: 'shipping_address', ddl: 'ALTER TABLE invoices ADD COLUMN shipping_address TEXT' },
  { table: 'invoices', column: 'transport_json', ddl: 'ALTER TABLE invoices ADD COLUMN transport_json TEXT' },
  { table: 'invoices', column: 'bank_account_id', ddl: 'ALTER TABLE invoices ADD COLUMN bank_account_id TEXT' },
  { table: 'invoices', column: 'signatory_name', ddl: 'ALTER TABLE invoices ADD COLUMN signatory_name TEXT' },
  { table: 'invoices', column: 'source_doc_type', ddl: 'ALTER TABLE invoices ADD COLUMN source_doc_type TEXT' },
  { table: 'invoices', column: 'source_doc_id', ddl: 'ALTER TABLE invoices ADD COLUMN source_doc_id TEXT' },
  { table: 'invoices', column: 'source_doc_no', ddl: 'ALTER TABLE invoices ADD COLUMN source_doc_no TEXT' },
  { table: 'purchase_bills', column: 'source_doc_no', ddl: 'ALTER TABLE purchase_bills ADD COLUMN source_doc_no TEXT' },
  // Weighted-average cost maintained by purchase bills (was read/written but never created)
  { table: 'items', column: 'average_cost_paise', ddl: 'ALTER TABLE items ADD COLUMN average_cost_paise INTEGER NOT NULL DEFAULT 0' },
  // Offline POS bills: device-side id so re-uploads never create a second bill
  { table: 'invoices', column: 'offline_id', ddl: 'ALTER TABLE invoices ADD COLUMN offline_id TEXT' },
  // CRM depth
  { table: 'crm_deals', column: 'lost_reason', ddl: 'ALTER TABLE crm_deals ADD COLUMN lost_reason TEXT' },
  { table: 'crm_deals', column: 'notes', ddl: 'ALTER TABLE crm_deals ADD COLUMN notes TEXT' },
  { table: 'crm_leads', column: 'next_follow_up', ddl: 'ALTER TABLE crm_leads ADD COLUMN next_follow_up TEXT' },
];

interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] };
}

/** Accounts added to the chart after businesses were created; inserted once per business if missing. */
const LATER_SYSTEM_ACCOUNTS: [string, string, string, string][] = [
  ['1210', 'Finished Goods Stock', 'ASSET', 'INVENTORY'],
  ['1150', 'Staff Advances', 'ASSET', 'CURRENT_ASSET'],
  ['2210', 'Salaries Payable', 'LIABILITY', 'CURRENT_LIABILITY'],
  ['2220', 'PF & ESI Payable', 'LIABILITY', 'CURRENT_LIABILITY'],
  ['2230', 'Professional Tax Payable', 'LIABILITY', 'CURRENT_LIABILITY'],
];

export function ensureSystemAccounts(sql: SqlLike): void {
  const has = sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'`).toArray().length > 0;
  if (!has) return;
  const now = new Date().toISOString();
  for (const [code, name, type, subtype] of LATER_SYSTEM_ACCOUNTS) {
    const exists = sql.exec(`SELECT id FROM accounts WHERE code = ?`, code).toArray().length > 0;
    if (!exists) {
      sql.exec(
        `INSERT INTO accounts (id, code, name, type, subtype, parent_id, is_system, party_id, balance_paise, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 1, NULL, 0, ?, ?)`,
        `acc_sys_${code}`,
        code,
        name,
        type,
        subtype,
        now,
        now,
      );
    }
  }
}

export function applyColumnAdditions(sql: SqlLike): void {
  for (const add of BUSINESS_COLUMN_ADDITIONS) {
    const cols = sql.exec(`PRAGMA table_info(${add.table})`).toArray() as { name: string }[];
    if (cols.length > 0 && !cols.some((c) => c.name === add.column)) sql.exec(add.ddl);
  }
}
