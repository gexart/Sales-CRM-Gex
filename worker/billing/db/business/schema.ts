import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * -----------------------------------------------------------------------------
 * GexGrow Business Database (Cloudflare Durable Object SQLite) — Schema
 * Dedicated tenant SQLite database per business. Full ACID transactions via
 * ctx.storage.transactionSync(). Zero businessId foreign keys needed.
 * Money: INTEGER paise | Quantity: INTEGER thousandths | Rates: INTEGER basis points
 * -----------------------------------------------------------------------------
 */

// 1. Branches & Locations
export const branches = sqliteTable(
  'branches',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    code: text('code').notNull(), // e.g. "MAIN", "BLR-01"
    gstin: text('gstin'),
    stateCode: text('state_code').notNull(), // Drives CGST/SGST vs IGST
    address: text('address').notNull(),
    phone: text('phone').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    codeIdx: uniqueIndex('branches_code_idx').on(table.code),
    stateCodeIdx: index('branches_state_code_idx').on(table.stateCode),
  }),
);

// 2. Warehouses / Stock Locations
export const warehouses = sqliteTable(
  'warehouses',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    name: text('name').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    branchIdIdx: index('warehouses_branch_id_idx').on(table.branchId),
  }),
);

// 3. Settings (Key-Value configuration JSON)
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 4. Document Series (Gapless numbering per series per Financial Year)
export const documentSeries = sqliteTable(
  'document_series',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    docType: text('doc_type').notNull(), // INVOICE, QUOTATION, CREDIT_NOTE, PAYMENT_IN, PO, BILL, DEBIT_NOTE, EXPENSE, KOT
    prefix: text('prefix').notNull(), // e.g. "GX/26-27/"
    nextNumber: integer('next_number').notNull().default(1),
    fySuffixEnabled: integer('fy_suffix_enabled', { mode: 'boolean' }).notNull().default(true),
    financialYear: text('financial_year').notNull(), // e.g. "26-27"
    padding: integer('padding').notNull().default(4), // e.g. 4 -> "0001"
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(true),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    branchDocTypeIdx: index('document_series_branch_doctype_idx').on(table.branchId, table.docType),
  }),
);

// 5. Tax Rates (Data, not code. Seeded: 0, 0.25, 3, 5, 18, 40 active; 12, 28 legacy)
export const taxRates = sqliteTable('tax_rates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // e.g. "GST 18%"
  rateBasisPoints: integer('rate_basis_points').notNull(), // 1800 for 18%
  igstBasisPoints: integer('igst_basis_points').notNull(), // 1800
  cgstBasisPoints: integer('cgst_basis_points').notNull(), // 900
  sgstBasisPoints: integer('sgst_basis_points').notNull(), // 900
  cessBasisPoints: integer('cess_basis_points').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

// 6. Units of Measurement
export const units = sqliteTable('units', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // e.g. "Pieces", "Kilograms"
  code: text('code').notNull().unique(), // PCS, KG, GM, LTR, ML, MTR, BOX, PCK, DOZ, PLATE, SERVE
  symbol: text('symbol').notNull(), // pcs, kg, g, l, ml, m, box, pkt, doz, plt, srv
  isDecimalAllowed: integer('is_decimal_allowed', { mode: 'boolean' }).notNull().default(false),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

// 7. Parties (Customers & Vendors in unified table)
export const parties = sqliteTable(
  'parties',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull().default('CUSTOMER'), // CUSTOMER, VENDOR, BOTH
    name: text('name').notNull(),
    company: text('company'),
    phone: text('phone').notNull(),
    email: text('email'),
    gstin: text('gstin'),
    pan: text('pan'),
    billingAddress: text('billing_address'),
    shippingAddress: text('shipping_address'),
    stateCode: text('state_code').notNull(), // Drives CGST/SGST vs IGST
    creditLimitPaise: integer('credit_limit_paise').notNull().default(0),
    creditDays: integer('credit_days').notNull().default(0),
    openingBalancePaise: integer('opening_balance_paise').notNull().default(0),
    openingBalanceType: text('opening_balance_type').notNull().default('RECEIVE'), // RECEIVE (debit) or PAY (credit)
    tagsJson: text('tags_json').notNull().default('[]'),
    notes: text('notes'),
    loyaltyPoints: integer('loyalty_points').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    phoneIdx: index('parties_phone_idx').on(table.phone),
    gstinIdx: index('parties_gstin_idx').on(table.gstin),
    typeIdx: index('parties_type_idx').on(table.type),
    deletedAtIdx: index('parties_deleted_at_idx').on(table.deletedAt),
  }),
);

// 8. Items & Products
export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull().default('GOODS'), // GOODS, SERVICE
    categoryId: text('category_id'),
    brand: text('brand'),
    sku: text('sku'),
    barcode: text('barcode'),
    hsnSac: text('hsn_sac').notNull().default(''),
    unitId: text('unit_id').notNull().references(() => units.id),
    secondaryUnitId: text('secondary_unit_id'),
    conversionFactorThousandths: integer('conversion_factor_thousandths').notNull().default(1000), // 1000 = 1.0
    salePricePaise: integer('sale_price_paise').notNull().default(0),
    purchasePricePaise: integer('purchase_price_paise').notNull().default(0),
    averageCostPaise: integer('average_cost_paise').notNull().default(0),
    mrpPaise: integer('mrp_paise').notNull().default(0),
    wholesalePricePaise: integer('wholesale_price_paise').notNull().default(0),
    minWholesaleQtyThousandths: integer('min_wholesale_qty_thousandths').notNull().default(0),
    taxRateId: text('tax_rate_id').notNull().references(() => taxRates.id),
    priceIncludesTax: integer('price_includes_tax', { mode: 'boolean' }).notNull().default(false),
    cessBasisPoints: integer('cess_basis_points').notNull().default(0),
    openingStockThousandths: integer('opening_stock_thousandths').notNull().default(0),
    lowStockLevelThousandths: integer('low_stock_level_thousandths').notNull().default(0),
    trackBatch: integer('track_batch', { mode: 'boolean' }).notNull().default(false),
    trackExpiry: integer('track_expiry', { mode: 'boolean' }).notNull().default(false),
    trackSerial: integer('track_serial', { mode: 'boolean' }).notNull().default(false),
    imageUrl: text('image_url'),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    showInPos: integer('show_in_pos', { mode: 'boolean' }).notNull().default(true),
    showInRestaurant: integer('show_in_restaurant', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    skuIdx: index('items_sku_idx').on(table.sku),
    barcodeIdx: index('items_barcode_idx').on(table.barcode),
    deletedAtIdx: index('items_deleted_at_idx').on(table.deletedAt),
  }),
);

// 9. Variants (Child items for Size / Colour / Half-Full)
export const variants = sqliteTable(
  'variants',
  {
    id: text('id').primaryKey(),
    parentItemId: text('parent_item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // e.g. "XL / Blue" or "Full Plate"
    sku: text('sku'),
    barcode: text('barcode'),
    attributesJson: text('attributes_json').notNull().default('{}'),
    salePricePaise: integer('sale_price_paise').notNull().default(0),
    purchasePricePaise: integer('purchase_price_paise').notNull().default(0),
    openingStockThousandths: integer('opening_stock_thousandths').notNull().default(0),
    createdAt: text('created_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    parentItemIdx: index('variants_parent_item_idx').on(table.parentItemId),
    barcodeIdx: index('variants_barcode_idx').on(table.barcode),
  }),
);

// 10. Price Lists (Custom pricing per party or tier)
export const priceLists = sqliteTable('price_lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  partyId: text('party_id'),
  itemsJson: text('items_json').notNull().default('{}'), // itemId -> pricePaise
  createdAt: text('created_at').notNull(),
});

// 10b. Bank Accounts & Cash Accounts (Encrypted AES-256-GCM storage)
export const bankAccounts = sqliteTable(
  'bank_accounts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    accountType: text('account_type').notNull().default('BANK'), // 'BANK' or 'CASH'
    accountNumberEncrypted: text('account_number_encrypted'),
    last4: text('last_4'),
    ifsc: text('ifsc'),
    branch: text('branch'),
    upiId: text('upi_id'),
    openingBalancePaise: integer('opening_balance_paise').notNull().default(0),
    currentBalancePaise: integer('current_balance_paise').notNull().default(0),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    chartAccountId: text('chart_account_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    deletedAtIdx: index('bank_accounts_deleted_at_idx').on(table.deletedAt),
  }),
);

// 11. Chart of Accounts (Double Entry Foundation)
export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(), // e.g. "1001", "2001", "3001"
    name: text('name').notNull(),
    type: text('type').notNull(), // ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
    subtype: text('subtype').notNull(), // CURRENT_ASSET, FIXED_ASSET, CURRENT_LIABILITY, DIRECT_EXPENSE, etc.
    parentId: text('parent_id'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    partyId: text('party_id'), // Linked customer/vendor party
    balancePaise: integer('balance_paise').notNull().default(0), // Running balance cache
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    codeIdx: uniqueIndex('accounts_code_idx').on(table.code),
    typeIdx: index('accounts_type_idx').on(table.type),
    partyIdIdx: index('accounts_party_id_idx').on(table.partyId),
  }),
);

// 12. Journal Entries (Double-Entry Header)
export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: text('id').primaryKey(),
    entryNo: text('entry_no').notNull().unique(), // e.g. "JV/26-27/0001"
    date: text('date').notNull(), // YYYY-MM-DD
    docType: text('doc_type').notNull(), // INVOICE, PAYMENT, EXPENSE, BILL, CREDIT_NOTE, DEBIT_NOTE, MANUAL
    docId: text('doc_id'),
    narration: text('narration').notNull(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    docLookupIdx: index('journal_entries_doc_lookup_idx').on(table.docType, table.docId),
    branchDateIdx: index('journal_entries_branch_date_idx').on(table.branchId, table.date),
  }),
);

// 13. Journal Lines (Debits must equal Credits)
export const journalLines = sqliteTable(
  'journal_lines',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull().references(() => accounts.id),
    partyId: text('party_id'),
    branchId: text('branch_id').notNull().references(() => branches.id),
    debitPaise: integer('debit_paise').notNull().default(0),
    creditPaise: integer('credit_paise').notNull().default(0),
    narration: text('narration'),
  },
  (table) => ({
    entryIdIdx: index('journal_lines_entry_id_idx').on(table.entryId),
    accountIdIdx: index('journal_lines_account_id_idx').on(table.accountId),
    partyIdIdx: index('journal_lines_party_id_idx').on(table.partyId),
  }),
);

// 14. Sales Invoices
export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    seriesId: text('series_id').notNull().references(() => documentSeries.id),
    invoiceNo: text('invoice_no').notNull().unique(), // e.g. "GX/26-27/0001"
    branchId: text('branch_id').notNull().references(() => branches.id),
    warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
    partyId: text('party_id').notNull().references(() => parties.id),
    partyName: text('party_name').notNull(),
    partyGstin: text('party_gstin'),
    partyStateCode: text('party_state_code').notNull(),
    invoiceType: text('invoice_type').notNull().default('REGULAR'), // REGULAR, BILL_OF_SUPPLY, EXPORT, SEZ
    date: text('date').notNull(), // YYYY-MM-DD
    dueDate: text('due_date').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    discountPaise: integer('discount_paise').notNull().default(0),
    taxTotalPaise: integer('tax_total_paise').notNull().default(0),
    roundOffPaise: integer('round_off_paise').notNull().default(0),
    totalPaise: integer('total_paise').notNull(),
    paidAmountPaise: integer('paid_amount_paise').notNull().default(0),
    balanceAmountPaise: integer('balance_amount_paise').notNull().default(0),
    status: text('status').notNull().default('UNPAID'), // PAID, PARTIALLY_PAID, UNPAID, OVERDUE, CANCELLED, DRAFT
    notes: text('notes'),
    terms: text('terms'),
    qrCodeData: text('qr_code_data'),
    createdById: text('created_by_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    invoiceNoIdx: uniqueIndex('invoices_no_idx').on(table.invoiceNo),
    partyIdIdx: index('invoices_party_id_idx').on(table.partyId),
    branchDateIdx: index('invoices_branch_date_idx').on(table.branchId, table.date),
    statusIdx: index('invoices_status_idx').on(table.status),
  }),
);

// 15. Invoice Line Items
export const invoiceLines = sqliteTable(
  'invoice_lines',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull().references(() => items.id),
    variantId: text('variant_id'),
    name: text('name').notNull(),
    hsnSac: text('hsn_sac').notNull().default(''),
    quantityThousandths: integer('quantity_thousandths').notNull(),
    unitId: text('unit_id').notNull().references(() => units.id),
    unitPricePaise: integer('unit_price_paise').notNull(),
    discountPaise: integer('discount_paise').notNull().default(0),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(0),
    cgstAmountPaise: integer('cgst_amount_paise').notNull().default(0),
    sgstAmountPaise: integer('sgst_amount_paise').notNull().default(0),
    igstAmountPaise: integer('igst_amount_paise').notNull().default(0),
    cessAmountPaise: integer('cess_amount_paise').notNull().default(0),
    lineTotalPaise: integer('line_total_paise').notNull(),
  },
  (table) => ({
    invoiceIdIdx: index('invoice_lines_invoice_id_idx').on(table.invoiceId),
    itemIdIdx: index('invoice_lines_item_id_idx').on(table.itemId),
  }),
);

// 16. Quotations / Estimates
export const quotations = sqliteTable(
  'quotations',
  {
    id: text('id').primaryKey(),
    quotationNo: text('quotation_no').notNull().unique(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    partyId: text('party_id').notNull().references(() => parties.id),
    date: text('date').notNull(),
    validUntil: text('valid_until').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    taxTotalPaise: integer('tax_total_paise').notNull().default(0),
    totalPaise: integer('total_paise').notNull(),
    status: text('status').notNull().default('OPEN'), // OPEN, ACCEPTED, REJECTED, EXPIRED, CONVERTED
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    partyIdIdx: index('quotations_party_id_idx').on(table.partyId),
  }),
);

// 17. Quotation Lines
export const quotationLines = sqliteTable('quotation_lines', {
  id: text('id').primaryKey(),
  quotationId: text('quotation_id').notNull().references(() => quotations.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => items.id),
  name: text('name').notNull(),
  quantityThousandths: integer('quantity_thousandths').notNull(),
  unitPricePaise: integer('unit_price_paise').notNull(),
  taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(0),
  lineTotalPaise: integer('line_total_paise').notNull(),
});

// 18. Credit Notes (Sales Return)
export const creditNotes = sqliteTable(
  'credit_notes',
  {
    id: text('id').primaryKey(),
    noteNo: text('note_no').notNull().unique(),
    invoiceId: text('invoice_id').references(() => invoices.id),
    branchId: text('branch_id').notNull().references(() => branches.id),
    partyId: text('party_id').notNull().references(() => parties.id),
    date: text('date').notNull(),
    reason: text('reason').notNull(),
    totalPaise: integer('total_paise').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    partyIdIdx: index('credit_notes_party_id_idx').on(table.partyId),
  }),
);

// 19. Payments (In & Out)
export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    paymentNo: text('payment_no').notNull().unique(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    partyId: text('party_id').notNull().references(() => parties.id),
    type: text('type').notNull(), // IN (received from customer) or OUT (paid to vendor)
    mode: text('mode').notNull(), // CASH, UPI, CARD, BANK, CHEQUE
    amountPaise: integer('amount_paise').notNull(),
    date: text('date').notNull(),
    referenceNo: text('reference_no'),
    invoiceId: text('invoice_id').references(() => invoices.id),
    accountId: text('account_id').notNull().references(() => accounts.id),
    notes: text('notes'),
    createdById: text('created_by_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    partyIdIdx: index('payments_party_id_idx').on(table.partyId),
    branchDateIdx: index('payments_branch_date_idx').on(table.branchId, table.date),
  }),
);

// 20. Purchase Orders
export const purchaseOrders = sqliteTable(
  'purchase_orders',
  {
    id: text('id').primaryKey(),
    poNo: text('po_no').notNull().unique(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    partyId: text('party_id').notNull().references(() => parties.id),
    date: text('date').notNull(),
    dueDate: text('due_date').notNull(),
    totalPaise: integer('total_paise').notNull(),
    status: text('status').notNull().default('OPEN'), // OPEN, RECEIVED, CANCELLED
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    partyIdIdx: index('purchase_orders_party_id_idx').on(table.partyId),
  }),
);

// 21. Purchase Bills
export const purchaseBills = sqliteTable(
  'purchase_bills',
  {
    id: text('id').primaryKey(),
    billNo: text('bill_no').notNull().unique(),
    vendorBillNo: text('vendor_bill_no'),
    vendorInvoiceDate: text('vendor_invoice_date'),
    branchId: text('branch_id').notNull().references(() => branches.id),
    warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
    partyId: text('party_id').notNull().references(() => parties.id),
    date: text('date').notNull(),
    dueDate: text('due_date').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    cgstPaise: integer('cgst_paise').notNull().default(0),
    sgstPaise: integer('sgst_paise').notNull().default(0),
    igstPaise: integer('igst_paise').notNull().default(0),
    taxTotalPaise: integer('tax_total_paise').notNull().default(0),
    totalPaise: integer('total_paise').notNull(),
    paidAmountPaise: integer('paid_amount_paise').notNull().default(0),
    rcmApplicable: integer('rcm_applicable', { mode: 'boolean' }).notNull().default(false),
    itcEligibility: text('itc_eligibility').notNull().default('ELIGIBLE'), // ELIGIBLE, INELIGIBLE, BLOCKED_17_5
    status: text('status').notNull().default('UNPAID'), // PAID, PARTIALLY_PAID, UNPAID, CANCELLED
    notes: text('notes'),
    receiptFileKey: text('receipt_file_key'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    partyIdIdx: index('purchase_bills_party_id_idx').on(table.partyId),
  }),
);

// 22. Purchase Bill Lines
export const purchaseBillLines = sqliteTable('purchase_bill_lines', {
  id: text('id').primaryKey(),
  billId: text('bill_id').notNull().references(() => purchaseBills.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => items.id),
  quantityThousandths: integer('quantity_thousandths').notNull(),
  unitPricePaise: integer('unit_price_paise').notNull(),
  taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(0),
  taxableAmountPaise: integer('taxable_amount_paise').notNull().default(0),
  taxAmountPaise: integer('tax_amount_paise').notNull().default(0),
  discountPaise: integer('discount_paise').notNull().default(0),
  lineTotalPaise: integer('line_total_paise').notNull(),
});

// 23. Debit Notes (Purchase Return)
export const debitNotes = sqliteTable('debit_notes', {
  id: text('id').primaryKey(),
  noteNo: text('note_no').notNull().unique(),
  billId: text('bill_id').references(() => purchaseBills.id),
  branchId: text('branch_id').notNull().references(() => branches.id),
  warehouseId: text('warehouse_id').references(() => warehouses.id),
  partyId: text('party_id').notNull().references(() => parties.id),
  date: text('date').notNull(),
  taxableAmountPaise: integer('taxable_amount_paise').notNull().default(0),
  cgstPaise: integer('cgst_paise').notNull().default(0),
  sgstPaise: integer('sgst_paise').notNull().default(0),
  igstPaise: integer('igst_paise').notNull().default(0),
  totalPaise: integer('total_paise').notNull(),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull(),
});

// 24. Expenses
export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    expenseNo: text('expense_no').notNull().unique(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    categoryAccountId: text('category_account_id').notNull().references(() => accounts.id),
    paymentAccountId: text('payment_account_id').notNull().references(() => accounts.id),
    amountPaise: integer('amount_paise').notNull(),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull().default(0),
    taxAmountPaise: integer('tax_amount_paise').notNull().default(0),
    date: text('date').notNull(),
    paymentMode: text('payment_mode').notNull().default('CASH'),
    referenceNo: text('reference_no'),
    payee: text('payee'),
    notes: text('notes'),
    receiptFileKey: text('receipt_file_key'),
    createdById: text('created_by_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    branchDateIdx: index('expenses_branch_date_idx').on(table.branchId, table.date),
  }),
);

// 25. Stock Ledger (Append-only physical inventory movements)
export const stockLedgers = sqliteTable(
  'stock_ledgers',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
    itemId: text('item_id').notNull().references(() => items.id),
    variantId: text('variant_id'),
    batchId: text('batch_id'),
    docType: text('doc_type').notNull(), // INVOICE, BILL, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT, KOT
    docId: text('doc_id').notNull(),
    docNo: text('doc_no').notNull(),
    qtyInThousandths: integer('qty_in_thousandths').notNull().default(0),
    qtyOutThousandths: integer('qty_out_thousandths').notNull().default(0),
    ratePaise: integer('rate_paise').notNull().default(0),
    balanceQtyThousandths: integer('balance_qty_thousandths').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    itemWarehouseIdx: index('stock_ledgers_item_wh_idx').on(table.itemId, table.warehouseId),
    branchDateIdx: index('stock_ledgers_branch_date_idx').on(table.branchId, table.date),
  }),
);

// 26. Stock Balance Cache (Fast lookups per item & warehouse)
export const stockBalances = sqliteTable(
  'stock_balances',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
    itemId: text('item_id').notNull().references(() => items.id),
    variantId: text('variant_id'),
    currentQtyThousandths: integer('current_qty_thousandths').notNull().default(0),
    reservedQtyThousandths: integer('reserved_qty_thousandths').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    lookupIdx: uniqueIndex('stock_balances_lookup_idx').on(
      table.warehouseId,
      table.itemId,
      table.variantId,
    ),
  }),
);

// 27. Batches & Expiry Tracking
export const batches = sqliteTable(
  'batches',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull().references(() => items.id),
    batchNo: text('batch_no').notNull(),
    mfgDate: text('mfg_date'),
    expiryDate: text('expiry_date'),
    mrpPaise: integer('mrp_paise').notNull().default(0),
    salePricePaise: integer('sale_price_paise').notNull().default(0),
    purchasePricePaise: integer('purchase_price_paise').notNull().default(0),
    quantityThousandths: integer('quantity_thousandths').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    itemBatchIdx: index('batches_item_batch_idx').on(table.itemId, table.batchNo),
  }),
);

// 28. Recipes / Bill of Materials (BOM)
export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  menuItemId: text('menu_item_id').notNull(),
  name: text('name').notNull(),
  instructions: text('instructions'),
  isBatch: integer('is_batch', { mode: 'boolean' }).notNull().default(false),
  yieldQuantityThousandths: integer('yield_quantity_thousandths').notNull().default(1000),
  createdAt: text('created_at').notNull(),
});

// 29. Recipe Raw Items
export const recipeItems = sqliteTable('recipe_items', {
  id: text('id').primaryKey(),
  recipeId: text('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  rawItemId: text('raw_item_id').notNull().references(() => items.id),
  quantityThousandths: integer('quantity_thousandths').notNull(),
  unitId: text('unit_id').notNull().references(() => units.id),
});

// 30. Restaurant Menu Categories
export const menuCategories = sqliteTable('menu_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

// 31. Restaurant Menu Items (Linked to Catalog Item)
export const menuItems = sqliteTable(
  'menu_items',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull().references(() => items.id),
    categoryId: text('category_id').notNull().references(() => menuCategories.id),
    name: text('name').notNull(),
    shortCode: text('short_code'),
    isVeg: integer('is_veg', { mode: 'boolean' }).notNull().default(true),
    spiceLevel: integer('spice_level').notNull().default(1),
    preparationTimeMinutes: integer('prep_time_minutes').notNull().default(15),
    station: text('station').notNull().default('Kitchen'), // Kitchen, Bar, Tandoor
    pricePaise: integer('price_paise').notNull().default(0),
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    categoryIdIdx: index('menu_items_category_id_idx').on(table.categoryId),
  }),
);

// 32. Restaurant Floors
export const restaurantFloors = sqliteTable('restaurant_floors', {
  id: text('id').primaryKey(),
  branchId: text('branch_id').notNull().references(() => branches.id),
  name: text('name').notNull(), // Ground Floor, AC Section, Rooftop
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

// 33. Restaurant Tables
export const restaurantTables = sqliteTable(
  'restaurant_tables',
  {
    id: text('id').primaryKey(),
    floorId: text('floor_id').notNull().references(() => restaurantFloors.id),
    tableNo: text('table_no').notNull(), // T-01, T-02
    capacity: integer('capacity').notNull().default(4),
    status: text('status').notNull().default('VACANT'), // VACANT, OCCUPIED, BILLED, CLEANING
    currentOrderId: text('current_order_id'),
    activeSince: text('active_since'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    floorIdIdx: index('restaurant_tables_floor_id_idx').on(table.floorId),
  }),
);

// 34. Restaurant Orders
export const restaurantOrders = sqliteTable(
  'restaurant_orders',
  {
    id: text('id').primaryKey(),
    orderNo: text('order_no').notNull().unique(), // RO/26-27/0001
    branchId: text('branch_id').notNull().references(() => branches.id),
    tableId: text('table_id'),
    orderType: text('order_type').notNull().default('DINE_IN'), // DINE_IN, TAKEAWAY, DELIVERY
    customerPhone: text('customer_phone'),
    customerName: text('customer_name'),
    guestCount: integer('guest_count').notNull().default(1),
    status: text('status').notNull().default('OPEN'), // OPEN, BILLED, SETTLED, VOID
    subtotalPaise: integer('subtotal_paise').notNull().default(0),
    discountPaise: integer('discount_paise').notNull().default(0),
    serviceChargePaise: integer('service_charge_paise').notNull().default(0),
    taxTotalPaise: integer('tax_total_paise').notNull().default(0),
    roundOffPaise: integer('round_off_paise').notNull().default(0),
    totalPaise: integer('total_paise').notNull().default(0),
    stewardId: text('steward_id'),
    createdAt: text('created_at').notNull(),
    closedAt: text('closed_at'),
  },
  (table) => ({
    branchDateIdx: index('restaurant_orders_branch_date_idx').on(table.branchId, table.createdAt),
    statusIdx: index('restaurant_orders_status_idx').on(table.status),
  }),
);

// 35. Kitchen Order Tickets (KOT)
export const kots = sqliteTable(
  'kots',
  {
    id: text('id').primaryKey(),
    kotNo: text('kot_no').notNull().unique(), // KOT/26-27/0001
    orderId: text('order_id').notNull().references(() => restaurantOrders.id),
    branchId: text('branch_id').notNull().references(() => branches.id),
    tableId: text('table_id'),
    tokenNo: integer('token_no').notNull().default(1),
    kitchenNotes: text('kitchen_notes'),
    status: text('status').notNull().default('PRINTED'), // PRINTED, PREPARING, READY, SERVED, CANCELLED
    printedAt: text('printed_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    orderIdIdx: index('kots_order_id_idx').on(table.orderId),
  }),
);

// 36. KOT Items
export const kotItems = sqliteTable('kot_items', {
  id: text('id').primaryKey(),
  kotId: text('kot_id').notNull().references(() => kots.id, { onDelete: 'cascade' }),
  menuItemId: text('menu_item_id').notNull().references(() => items.id),
  name: text('name').notNull(),
  quantityThousandths: integer('quantity_thousandths').notNull(),
  station: text('station').notNull().default('Kitchen'),
  unitPricePaise: integer('unit_price_paise').notNull().default(0),
  notes: text('notes'),
  status: text('status').notNull().default('PREPARING'), // PREPARING, READY, SERVED, CANCELLED
});

// 37. POS Cashier Shifts (X/Z Reports)
export const posShifts = sqliteTable(
  'pos_shifts',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    registerNo: text('register_no').notNull().default('REG-01'),
    cashierId: text('cashier_id').notNull(),
    openingCashPaise: integer('opening_cash_paise').notNull().default(0),
    closingCashPaise: integer('closing_cash_paise'),
    expectedCashPaise: integer('expected_cash_paise').notNull().default(0),
    discrepancyPaise: integer('discrepancy_paise').notNull().default(0),
    totalSalesPaise: integer('total_sales_paise').notNull().default(0),
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at'),
    isClosed: integer('is_closed', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes'),
  },
  (table) => ({
    branchCashierIdx: index('pos_shifts_branch_cashier_idx').on(table.branchId, table.cashierId),
  }),
);

// 38. Tenant Audit Logs (Append-only immutable audit trail)
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    action: text('action').notNull(), // CREATE, UPDATE, DELETE, POST, REVERSE, PRINT, EXPORT
    entity: text('entity').notNull(), // Invoice, Party, Item, Payment, etc.
    entityId: text('entity_id').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    entityLookupIdx: index('audit_logs_entity_lookup_idx').on(table.entity, table.entityId),
    createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt),
  }),
);

// 39. In-App Notifications
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull().default('INFO'), // INFO, SUCCESS, WARNING, ALERT
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  link: text('link'),
  createdAt: text('created_at').notNull(),
});

// 40. Document Attachments (Files stored in Cloudflare R2)
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    entity: text('entity').notNull(), // Invoice, Expense, Party, Item
    entityId: text('entity_id').notNull(),
    fileKey: text('file_key').notNull(), // R2 object key
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    entityIdx: index('attachments_entity_idx').on(table.entity, table.entityId),
  }),
);

// 41. Public Share Tokens (e.g. connect.gexgrow.com/i/{randomToken})
export const invoiceShareTokens = sqliteTable(
  'invoice_share_tokens',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    viewedAt: text('viewed_at'),
    viewCount: integer('view_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    tokenIdx: uniqueIndex('invoice_share_tokens_token_idx').on(table.token),
  }),
);

// 42. Recurring Invoices (Scheduled via BusinessDO Alarm)
export const recurringInvoices = sqliteTable('recurring_invoices', {
  id: text('id').primaryKey(),
  templateInvoiceId: text('template_invoice_id').notNull().references(() => invoices.id),
  frequency: text('frequency').notNull(), // 'MONTHLY', 'QUARTERLY', 'YEARLY'
  nextRunDate: text('next_run_date').notNull(),
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE', 'PAUSED', 'CANCELLED'
  autoSend: integer('auto_send', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 43. Stock Transfers (Warehouse-to-Warehouse)
export const stockTransfers = sqliteTable('stock_transfers', {
  id: text('id').primaryKey(),
  transferNo: text('transfer_no').notNull().unique(),
  branchId: text('branch_id').notNull().references(() => branches.id),
  sourceWarehouseId: text('source_warehouse_id').notNull().references(() => warehouses.id),
  destinationWarehouseId: text('destination_warehouse_id').notNull().references(() => warehouses.id),
  date: text('date').notNull(),
  status: text('status').notNull().default('COMPLETED'), // IN_TRANSIT, COMPLETED, CANCELLED
  notes: text('notes'),
  createdById: text('created_by_id').notNull(),
  createdAt: text('created_at').notNull(),
});

// 44. Stock Transfer Lines
export const stockTransferLines = sqliteTable('stock_transfer_lines', {
  id: text('id').primaryKey(),
  transferId: text('transfer_id').notNull().references(() => stockTransfers.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => items.id),
  variantId: text('variant_id'),
  batchId: text('batch_id'),
  quantityThousandths: integer('quantity_thousandths').notNull(),
});

// 45. Stock Adjustments (Damage, Theft, Physical Count, Expiry)
export const stockAdjustments = sqliteTable('stock_adjustments', {
  id: text('id').primaryKey(),
  adjustmentNo: text('adjustment_no').notNull().unique(),
  branchId: text('branch_id').notNull().references(() => branches.id),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  date: text('date').notNull(),
  reason: text('reason').notNull(), // PHYSICAL_COUNT, DAMAGE, THEFT, EXPIRY, CORRECTION
  totalDifferencePaise: integer('total_difference_paise').notNull().default(0),
  notes: text('notes'),
  createdById: text('created_by_id').notNull(),
  createdAt: text('created_at').notNull(),
});

// 46. Stock Adjustment Lines
export const stockAdjustmentLines = sqliteTable('stock_adjustment_lines', {
  id: text('id').primaryKey(),
  adjustmentId: text('adjustment_id').notNull().references(() => stockAdjustments.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => items.id),
  variantId: text('variant_id'),
  batchId: text('batch_id'),
  adjustmentType: text('adjustment_type').notNull(), // INCREASE, DECREASE
  quantityThousandths: integer('quantity_thousandths').notNull(),
  ratePaise: integer('rate_paise').notNull().default(0),
  valuePaise: integer('value_paise').notNull().default(0),
});

// 47. POS Cash Movements (Cash In / Cash Out per shift)
export const posCashMovements = sqliteTable('pos_cash_movements', {
  id: text('id').primaryKey(),
  shiftId: text('shift_id').notNull().references(() => posShifts.id, { onDelete: 'cascade' }),
  branchId: text('branch_id').notNull().references(() => branches.id),
  type: text('type').notNull(), // 'CASH_IN', 'CASH_OUT'
  amountPaise: integer('amount_paise').notNull(),
  reason: text('reason').notNull(),
  createdById: text('created_by_id').notNull(),
  createdAt: text('created_at').notNull(),
});

// 48. POS Held / Parked Bills
export const posHeldBills = sqliteTable('pos_held_bills', {
  id: text('id').primaryKey(),
  branchId: text('branch_id').notNull().references(() => branches.id),
  cashierId: text('cashier_id').notNull(),
  label: text('label').notNull(),
  cartJson: text('cart_json').notNull(),
  customerPhone: text('customer_phone'),
  customerName: text('customer_name'),
  totalPaise: integer('total_paise').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

// 49. Bank Statements
export const bankStatements = sqliteTable('bank_statements', {
  id: text('id').primaryKey(),
  bankAccountId: text('bank_account_id').notNull().references(() => bankAccounts.id),
  statementDate: text('statement_date').notNull(),
  filename: text('filename').notNull(),
  openingBalancePaise: integer('opening_balance_paise').notNull().default(0),
  closingBalancePaise: integer('closing_balance_paise').notNull().default(0),
  totalDepositsPaise: integer('total_deposits_paise').notNull().default(0),
  totalWithdrawalsPaise: integer('total_withdrawals_paise').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

// 50. Bank Statement Lines
export const bankStatementLines = sqliteTable('bank_statement_lines', {
  id: text('id').primaryKey(),
  statementId: text('statement_id').notNull().references(() => bankStatements.id, { onDelete: 'cascade' }),
  bankAccountId: text('bank_account_id').notNull().references(() => bankAccounts.id),
  date: text('date').notNull(),
  description: text('description').notNull(),
  referenceNo: text('reference_no'),
  amountPaise: integer('amount_paise').notNull(),
  type: text('type').notNull(), // 'CREDIT' | 'DEBIT'
  reconciliationStatus: text('reconciliation_status').notNull().default('UNRECONCILED'), // 'UNRECONCILED' | 'MATCHED' | 'MANUAL'
  matchedJournalLineId: text('matched_journal_line_id'),
  matchedAt: text('matched_at'),
  notes: text('notes'),
});

// 51. Cheque Register
export const cheques = sqliteTable('cheques', {
  id: text('id').primaryKey(),
  bankAccountId: text('bank_account_id').notNull().references(() => bankAccounts.id),
  partyId: text('party_id').references(() => parties.id),
  type: text('type').notNull(), // 'RECEIVED' | 'ISSUED'
  chequeNo: text('cheque_no').notNull(),
  chequeDate: text('cheque_date').notNull(),
  amountPaise: integer('amount_paise').notNull(),
  payeePayerName: text('payee_payer_name').notNull(),
  status: text('status').notNull().default('PENDING'), // 'PENDING' | 'CLEARED' | 'PDC' | 'BOUNCED'
  clearingDate: text('clearing_date'),
  bounceDate: text('bounce_date'),
  bounceChargesPaise: integer('bounce_charges_paise').notNull().default(0),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

// 52. TDS Entries
export const tdsEntries = sqliteTable('tds_entries', {
  id: text('id').primaryKey(),
  voucherType: text('voucher_type').notNull(), // 'PURCHASE_BILL' | 'PAYMENT' | 'JOURNAL'
  voucherId: text('voucher_id').notNull(),
  partyId: text('party_id').references(() => parties.id),
  pan: text('pan'),
  section: text('section').notNull(), // '194C' | '194J' | '194I' | '194Q' | '194H'
  rateBasisPoints: integer('rate_basis_points').notNull(),
  taxableAmountPaise: integer('taxable_amount_paise').notNull(),
  tdsAmountPaise: integer('tds_amount_paise').notNull(),
  date: text('date').notNull(),
  status: text('status').notNull().default('DEDUCTED'), // 'DEDUCTED' | 'PAID_TO_GOV' | 'ADJUSTED'
  challanNo: text('challan_no'),
  challanDate: text('challan_date'),
  bsrCode: text('bsr_code'),
  createdAt: text('created_at').notNull(),
});

// 53. TCS Entries
export const tcsEntries = sqliteTable('tcs_entries', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id),
  partyId: text('party_id').references(() => parties.id),
  pan: text('pan'),
  section: text('section').notNull().default('206C_1H'),
  rateBasisPoints: integer('rate_basis_points').notNull().default(10), // 0.1% = 10 bps
  taxableAmountPaise: integer('taxable_amount_paise').notNull(),
  tcsAmountPaise: integer('tcs_amount_paise').notNull(),
  date: text('date').notNull(),
  challanNo: text('challan_no'),
  createdAt: text('created_at').notNull(),
});

// 54. Advance Adjustments
export const advanceAdjustments = sqliteTable('advance_adjustments', {
  id: text('id').primaryKey(),
  paymentId: text('payment_id').notNull().references(() => payments.id),
  invoiceId: text('invoice_id').references(() => invoices.id),
  purchaseBillId: text('purchase_bill_id').references(() => purchaseBills.id),
  adjustedAmountPaise: integer('adjusted_amount_paise').notNull(),
  adjustedDate: text('adjusted_date').notNull(),
  createdAt: text('created_at').notNull(),
});

// 55. Cost Centres
export const costCentres = sqliteTable('cost_centres', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  category: text('category').notNull().default('DEPARTMENT'), // 'BRANCH' | 'DEPARTMENT' | 'PROJECT'
  branchId: text('branch_id').references(() => branches.id),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

// 56. Cost Centre Budgets
export const costCentreBudgets = sqliteTable('cost_centre_budgets', {
  id: text('id').primaryKey(),
  costCentreId: text('cost_centre_id').notNull().references(() => costCentres.id, { onDelete: 'cascade' }),
  financialYear: text('financial_year').notNull(), // e.g. "26-27"
  budgetPaise: integer('budget_paise').notNull(),
  createdAt: text('created_at').notNull(),
});

// 57. Fixed Assets Register
export const fixedAssets = sqliteTable('fixed_assets', {
  id: text('id').primaryKey(),
  assetName: text('asset_name').notNull(),
  assetCode: text('asset_code').notNull().unique(),
  costCentreId: text('cost_centre_id').references(() => costCentres.id),
  purchaseDate: text('purchase_date').notNull(),
  purchaseCostPaise: integer('purchase_cost_paise').notNull(),
  depreciationMethod: text('depreciation_method').notNull().default('WDV'), // 'WDV' | 'SLM'
  depreciationRateBasisPoints: integer('depreciation_rate_basis_points').notNull(), // e.g. 1500 = 15%
  salvageValuePaise: integer('salvage_value_paise').notNull().default(0),
  accumulatedDepreciationPaise: integer('accumulated_depreciation_paise').notNull().default(0),
  netBookValuePaise: integer('net_book_value_paise').notNull(),
  assetAccountId: text('asset_account_id').notNull().references(() => accounts.id),
  depreciationExpenseAccountId: text('depreciation_expense_account_id').notNull().references(() => accounts.id),
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'DISPOSED'
  disposalDate: text('disposal_date'),
  disposalProceedsPaise: integer('disposal_proceeds_paise').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

// 58. Fixed Asset Depreciations
export const fixedAssetDepreciations = sqliteTable('fixed_asset_depreciations', {
  id: text('id').primaryKey(),
  fixedAssetId: text('fixed_asset_id').notNull().references(() => fixedAssets.id, { onDelete: 'cascade' }),
  financialYear: text('financial_year').notNull(),
  depreciationAmountPaise: integer('depreciation_amount_paise').notNull(),
  date: text('date').notNull(),
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdAt: text('created_at').notNull(),
});

// 59. E-Invoices (IRN registration via GSP/IRP)
export const eInvoices = sqliteTable(
  'e_invoices',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    irn: text('irn').notNull().unique(), // 64-character SHA-256 hash
    ackNo: text('ack_no').notNull(),
    ackDate: text('ack_date').notNull(),
    signedInvoice: text('signed_invoice'),
    signedQrCode: text('signed_qr_code').notNull(),
    status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'CANCELLED'
    cancelReason: text('cancel_reason'), // '1' - Duplicate, '2' - Data entry mistake, '3' - Order cancelled, '4' - Other
    cancelRemarks: text('cancel_remarks'),
    cancelledAt: text('cancelled_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    invoiceIdx: index('e_invoices_invoice_idx').on(table.invoiceId),
  }),
);

// 60. E-Way Bills (Part A + Part B)
export const eWayBills = sqliteTable(
  'e_way_bills',
  {
    id: text('id').primaryKey(),
    documentType: text('document_type').notNull().default('INVOICE'), // 'INVOICE' | 'DELIVERY_CHALLAN'
    documentId: text('document_id').notNull(),
    ewbNumber: text('ewb_number').notNull().unique(), // 12-digit numeric
    ewbDate: text('ewb_date').notNull(),
    validUpto: text('valid_upto').notNull(),
    supplyType: text('supply_type').notNull().default('O'), // 'O' Outward, 'I' Inward
    subSupplyType: text('sub_supply_type').notNull().default('1'),
    transporterId: text('transporter_id'),
    transporterName: text('transporter_name'),
    transDocNo: text('trans_doc_no'),
    transMode: text('trans_mode').notNull().default('ROAD'), // 'ROAD' | 'RAIL' | 'AIR' | 'SHIP'
    distanceKm: integer('distance_km').notNull().default(0),
    vehicleNo: text('vehicle_no'),
    vehicleType: text('vehicle_type').notNull().default('REGULAR'), // 'REGULAR' | 'OVER_DIMENSIONAL'
    fromPlace: text('from_place').notNull(),
    fromPincode: integer('from_pincode').notNull(),
    toPlace: text('to_place').notNull(),
    toPincode: integer('to_pincode').notNull(),
    totalValuePaise: integer('total_value_paise').notNull(),
    partBStatus: text('part_b_status').notNull().default('PENDING'), // 'PENDING' | 'GENERATED' | 'UPDATED'
    status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'CANCELLED' | 'EXTENDED'
    cancelReason: text('cancel_reason'),
    cancelRemarks: text('cancel_remarks'),
    cancelledAt: text('cancelled_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    docIdx: index('e_way_bills_doc_idx').on(table.documentType, table.documentId),
  }),
);

// 61. CRM Leads
export const crmLeads = sqliteTable(
  'crm_leads',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    company: text('company'),
    phone: text('phone').notNull(),
    email: text('email'),
    source: text('source').notNull().default('MANUAL'), // 'WALK_IN' | 'WEBSITE' | 'WHATSAPP' | 'META_ADS' | 'INDIAMART' | 'JUSTDIAL' | 'MANUAL' | 'IMPORT'
    score: integer('score').notNull().default(50), // 0 to 100
    status: text('status').notNull().default('NEW'), // 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'LOST'
    stage: text('stage').notNull().default('PROSPECT'), // 'PROSPECT' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'CLOSED_WON' | 'CLOSED_LOST'
    assignedToId: text('assigned_to_id'),
    branchId: text('branch_id').references(() => branches.id),
    estimatedValuePaise: integer('estimated_value_paise').notNull().default(0),
    probabilityPercent: integer('probability_percent').notNull().default(20),
    expectedCloseDate: text('expected_close_date'),
    convertedPartyId: text('converted_party_id').references(() => parties.id),
    tags: text('tags'), // JSON array
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    phoneIdx: index('crm_leads_phone_idx').on(table.phone),
    stageIdx: index('crm_leads_stage_idx').on(table.stage),
  }),
);

// 62. CRM Deals
export const crmDeals = sqliteTable(
  'crm_deals',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    leadId: text('lead_id').references(() => crmLeads.id, { onDelete: 'set null' }),
    partyId: text('party_id').references(() => parties.id),
    stage: text('stage').notNull().default('LEAD_IN'), // 'LEAD_IN' | 'CONTACT_MADE' | 'DEMO_SCHEDULED' | 'PROPOSAL_SENT' | 'NEGOTIATION' | 'WON' | 'LOST'
    valuePaise: integer('value_paise').notNull().default(0),
    probabilityPercent: integer('probability_percent').notNull().default(20),
    expectedCloseDate: text('expected_close_date'),
    closedAt: text('closed_at'),
    quotationId: text('quotation_id'),
    invoiceId: text('invoice_id').references(() => invoices.id),
    assignedToId: text('assigned_to_id'),
    branchId: text('branch_id').references(() => branches.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    stageIdx: index('crm_deals_stage_idx').on(table.stage),
  }),
);

// 63. CRM Activities (Outreach, meetings, calls, tasks)
export const crmActivities = sqliteTable(
  'crm_activities',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id').references(() => crmLeads.id, { onDelete: 'cascade' }),
    partyId: text('party_id').references(() => parties.id),
    dealId: text('deal_id').references(() => crmDeals.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'CALL' | 'MEETING' | 'NOTE' | 'TASK' | 'WHATSAPP' | 'EMAIL'
    subject: text('subject').notNull(),
    description: text('description'),
    dueDate: text('due_date'),
    completedAt: text('completed_at'),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'COMPLETED' | 'CANCELLED'
    createdById: text('created_by_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    typeIdx: index('crm_activities_type_idx').on(table.type),
    dueIdx: index('crm_activities_due_idx').on(table.dueDate, table.status),
  }),
);

// 64. Loyalty Program Settings
export const loyaltyPrograms = sqliteTable('loyalty_programs', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default('Standard Rewards'),
  pointsPerHundredRupees: integer('points_per_hundred_rupees').notNull().default(5), // 5 points per ₹100
  paisePerPointRedemption: integer('paise_per_point_redemption').notNull().default(50), // 1 point = 50 paise (₹0.50)
  minRedeemPoints: integer('min_redeem_points').notNull().default(100),
  maxRedeemPercentage: integer('max_redeem_percentage').notNull().default(50), // max 50% bill paid with points
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

// 65. Loyalty Ledger Transactions
export const loyaltyTransactions = sqliteTable(
  'loyalty_transactions',
  {
    id: text('id').primaryKey(),
    partyId: text('party_id').notNull().references(() => parties.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id').references(() => invoices.id),
    type: text('type').notNull(), // 'EARN' | 'REDEEM' | 'BONUS' | 'ADJUSTMENT'
    points: integer('points').notNull(),
    balancePoints: integer('balance_points').notNull(),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    partyIdx: index('loyalty_tx_party_idx').on(table.partyId),
  }),
);

// 66. Gift Cards / Vouchers
export const giftCards = sqliteTable(
  'gift_cards',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(), // e.g. GC-8839-1122
    initialBalancePaise: integer('initial_balance_paise').notNull(),
    currentBalancePaise: integer('current_balance_paise').notNull(),
    partyId: text('party_id').references(() => parties.id),
    expiryDate: text('expiry_date'),
    status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'REDEEMED' | 'EXPIRED'
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    codeIdx: uniqueIndex('gift_cards_code_idx').on(table.code),
  }),
);

// 67. Marketing Campaigns (WhatsApp / SMS / Email batches)
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  channel: text('channel').notNull().default('WHATSAPP'), // 'WHATSAPP' | 'SMS' | 'EMAIL'
  templateId: text('template_id'),
  messageContent: text('message_content').notNull(),
  segmentCriteria: text('segment_criteria'), // JSON
  status: text('status').notNull().default('DRAFT'), // 'DRAFT' | 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED'
  scheduledAt: text('scheduled_at'),
  totalRecipients: integer('total_recipients').notNull().default(0),
  sentCount: integer('sent_count').notNull().default(0),
  deliveredCount: integer('delivered_count').notNull().default(0),
  readCount: integer('read_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  optOutCount: integer('opt_out_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

// 68. Campaign Messages (Per recipient tracking)
export const campaignMessages = sqliteTable(
  'campaign_messages',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    recipientPhone: text('recipient_phone').notNull(),
    recipientEmail: text('recipient_email'),
    recipientName: text('recipient_name').notNull(),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'OPT_OUT'
    externalMsgId: text('external_msg_id'),
    error: text('error'),
    sentAt: text('sent_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    campaignIdx: index('campaign_messages_campaign_idx').on(table.campaignId),
    phoneIdx: index('campaign_messages_phone_idx').on(table.recipientPhone),
  }),
);

// 69. Customer Feedbacks (1 to 5 stars + Google Review redirect)
export const customerFeedbacks = sqliteTable(
  'customer_feedbacks',
  {
    id: text('id').primaryKey(),
    partyId: text('party_id').references(() => parties.id),
    invoiceId: text('invoice_id').references(() => invoices.id),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'),
    rating: integer('rating').notNull(), // 1 to 5
    comment: text('comment'),
    googleReviewClicked: integer('google_review_clicked', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    ratingIdx: index('customer_feedbacks_rating_idx').on(table.rating),
  }),
);

// 70. HR Employees
export const hrEmployees = sqliteTable(
  'hr_employees',
  {
    id: text('id').primaryKey(),
    employeeCode: text('employee_code').notNull().unique(), // e.g. EMP-001
    name: text('name').notNull(),
    phone: text('phone').notNull().unique(),
    email: text('email'),
    pan: text('pan'),
    aadhaarMasked: text('aadhaar_masked'),
    gender: text('gender'), // 'MALE' | 'FEMALE' | 'OTHER'
    dateOfBirth: text('date_of_birth'),
    joiningDate: text('joining_date').notNull(),
    department: text('department').notNull().default('Operations'),
    designation: text('designation').notNull().default('Staff'),
    branchId: text('branch_id').notNull().references(() => branches.id),
    userId: text('user_id'),
    bankAccountNumberEncrypted: text('bank_account_number_encrypted'),
    bankIfsc: text('bank_ifsc'),
    bankName: text('bank_name'),
    status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'ON_LEAVE' | 'PROBATION' | 'TERMINATED'
    basicPaise: integer('basic_paise').notNull().default(1500000), // Default ₹15,000 basic
    hraPaise: integer('hra_paise').notNull().default(600000), // Default ₹6,000 HRA
    allowancesPaise: integer('allowances_paise').notNull().default(400000), // Default ₹4,000 other allowances
    pfOpted: integer('pf_opted', { mode: 'boolean' }).notNull().default(true),
    esiOpted: integer('esi_opted', { mode: 'boolean' }).notNull().default(true),
    ptStateCode: text('pt_state_code').notNull().default('19'), // '19' West Bengal
    taxRegime: text('tax_regime').notNull().default('NEW'), // 'NEW' | 'OLD'
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    empCodeIdx: uniqueIndex('hr_employees_code_idx').on(table.employeeCode),
    branchIdx: index('hr_employees_branch_idx').on(table.branchId),
  }),
);

// 71. HR Attendance (Daily punches, selfies, geofence, and overtime)
export const hrAttendance = sqliteTable(
  'hr_attendance',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id').notNull().references(() => hrEmployees.id, { onDelete: 'cascade' }),
    date: text('date').notNull(), // YYYY-MM-DD
    checkInTime: text('check_in_time'),
    checkOutTime: text('check_out_time'),
    checkInSelfieR2Key: text('check_in_selfie_r2_key'),
    checkInLatitude: text('check_in_latitude'),
    checkInLongitude: text('check_in_longitude'),
    status: text('status').notNull().default('PRESENT'), // 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'HOLIDAY'
    overtimeMinutes: integer('overtime_minutes').notNull().default(0),
    isRegularized: integer('is_regularized', { mode: 'boolean' }).notNull().default(false),
    regularizationReason: text('regularization_reason'),
    approvalStatus: text('approval_status').notNull().default('APPROVED'), // 'PENDING' | 'APPROVED' | 'REJECTED'
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    empDateIdx: uniqueIndex('hr_attendance_emp_date_idx').on(table.employeeId, table.date),
  }),
);

// 72. HR Leave Types
export const hrLeaveTypes = sqliteTable('hr_leave_types', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(), // 'CL' | 'SL' | 'EL'
  name: text('name').notNull(),
  annualQuotaDays: integer('annual_quota_days').notNull().default(12),
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

// 73. HR Leave Requests
export const hrLeaveRequests = sqliteTable(
  'hr_leave_requests',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id').notNull().references(() => hrEmployees.id, { onDelete: 'cascade' }),
    leaveTypeId: text('leave_type_id').notNull().references(() => hrLeaveTypes.id),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    totalDays: integer('total_days').notNull().default(1),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'APPROVED' | 'REJECTED'
    approvedById: text('approved_by_id'),
    approvedAt: text('approved_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    empLeaveIdx: index('hr_leave_requests_emp_idx').on(table.employeeId),
  }),
);

// 74. HR Payroll Runs (Monthly salary calculations and accounting postings)
export const hrPayrollRuns = sqliteTable('hr_payroll_runs', {
  id: text('id').primaryKey(),
  financialYear: text('financial_year').notNull(), // '26-27'
  month: integer('month').notNull(), // 1 to 12
  year: integer('year').notNull(), // 2026
  status: text('status').notNull().default('DRAFT'), // 'DRAFT' | 'FINALIZED' | 'PAID'
  totalGrossPaise: integer('total_gross_paise').notNull().default(0),
  totalDeductionsPaise: integer('total_deductions_paise').notNull().default(0),
  totalNetPaise: integer('total_net_paise').notNull().default(0),
  totalPfPaise: integer('total_pf_paise').notNull().default(0),
  totalEsiPaise: integer('total_esi_paise').notNull().default(0),
  totalPtPaise: integer('total_pt_paise').notNull().default(0),
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  finalizedAt: text('finalized_at'),
  createdAt: text('created_at').notNull(),
});

// 75. HR Payslips (Individual employee breakdown per payroll run)
export const hrPayslips = sqliteTable(
  'hr_payslips',
  {
    id: text('id').primaryKey(),
    payrollRunId: text('payroll_run_id').notNull().references(() => hrPayrollRuns.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id').notNull().references(() => hrEmployees.id),
    daysPresent: integer('days_present').notNull().default(30),
    daysAbsent: integer('days_absent').notNull().default(0),
    daysLeave: integer('days_leave').notNull().default(0),
    basicPaise: integer('basic_paise').notNull(),
    hraPaise: integer('hra_paise').notNull(),
    allowancesPaise: integer('allowances_paise').notNull(),
    incentivesPaise: integer('incentives_paise').notNull().default(0),
    grossSalaryPaise: integer('gross_salary_paise').notNull(),
    pfPaise: integer('pf_paise').notNull().default(0),
    esiPaise: integer('esi_paise').notNull().default(0),
    ptPaise: integer('pt_paise').notNull().default(0),
    tdsPaise: integer('tds_paise').notNull().default(0),
    advanceDeductionPaise: integer('advance_deduction_paise').notNull().default(0),
    netSalaryPaise: integer('net_salary_paise').notNull(),
    status: text('status').notNull().default('DRAFT'), // 'DRAFT' | 'GENERATED' | 'PAID'
    paymentMode: text('payment_mode').notNull().default('BANK_TRANSFER'), // 'BANK_TRANSFER' | 'CASH' | 'CHEQUE'
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    runEmpIdx: uniqueIndex('hr_payslips_run_emp_idx').on(table.payrollRunId, table.employeeId),
  }),
);

// 76. HR Salary Advances & Loans
export const hrSalaryAdvances = sqliteTable(
  'hr_salary_advances',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id').notNull().references(() => hrEmployees.id, { onDelete: 'cascade' }),
    amountPaise: integer('amount_paise').notNull(),
    disbursedDate: text('disbursed_date').notNull(),
    monthlyEmiPaise: integer('monthly_emi_paise').notNull(),
    balancePaise: integer('balance_paise').notNull(),
    status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'CLOSED'
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    empIdx: index('hr_advances_emp_idx').on(table.employeeId),
  }),
);

// 77. Manufacturing BOMs (Bill of Materials)
export const mfgBoms = sqliteTable(
  'mfg_boms',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    code: text('code').notNull().unique(), // e.g. BOM-001
    finishedItemId: text('finished_item_id').notNull().references(() => items.id),
    finishedVariantId: text('finished_variant_id'),
    outputQuantityThousandths: integer('output_quantity_thousandths').notNull().default(1000), // Default 1.000 unit
    scrapPercentBasisPoints: integer('scrap_percent_basis_points').notNull().default(0), // e.g. 500 = 5.00%
    labourCostPaise: integer('labour_cost_paise').notNull().default(0),
    overheadCostPaise: integer('overhead_cost_paise').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    finishedItemIdx: index('mfg_boms_finished_item_idx').on(table.finishedItemId),
  }),
);

// 78. Manufacturing BOM Lines (Raw materials & sub-assemblies)
export const mfgBomLines = sqliteTable(
  'mfg_bom_lines',
  {
    id: text('id').primaryKey(),
    bomId: text('bom_id').notNull().references(() => mfgBoms.id, { onDelete: 'cascade' }),
    rawItemId: text('raw_item_id').notNull().references(() => items.id),
    rawVariantId: text('raw_variant_id'),
    quantityThousandths: integer('quantity_thousandths').notNull(),
    scrapPercentBasisPoints: integer('scrap_percent_basis_points').notNull().default(0),
    costSharePercent: integer('cost_share_percent').notNull().default(100),
    lineType: text('line_type').notNull().default('RAW_MATERIAL'), // 'RAW_MATERIAL' | 'SUB_ASSEMBLY' | 'BY_PRODUCT'
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    bomIdx: index('mfg_bom_lines_bom_idx').on(table.bomId),
  }),
);

// 79. Manufacturing Production Orders
export const mfgProductionOrders = sqliteTable(
  'mfg_production_orders',
  {
    id: text('id').primaryKey(),
    orderNo: text('order_no').notNull().unique(), // e.g. PO-MFG-001
    bomId: text('bom_id').notNull().references(() => mfgBoms.id),
    finishedItemId: text('finished_item_id').notNull().references(() => items.id),
    targetQuantityThousandths: integer('target_quantity_thousandths').notNull(),
    producedQuantityThousandths: integer('produced_quantity_thousandths').notNull().default(0),
    status: text('status').notNull().default('PLANNED'), // 'PLANNED' | 'MATERIALS_ISSUED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
    branchId: text('branch_id').notNull().references(() => branches.id),
    warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
    standardCostPaise: integer('standard_cost_paise').notNull().default(0),
    actualCostPaise: integer('actual_cost_paise').notNull().default(0),
    variancePaise: integer('variance_paise').notNull().default(0),
    startDate: text('start_date'),
    completedDate: text('completed_date'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    statusIdx: index('mfg_prod_orders_status_idx').on(table.status),
  }),
);

// 80. Manufacturing Production Materials Issued
export const mfgProductionMaterialsIssued = sqliteTable(
  'mfg_production_materials_issued',
  {
    id: text('id').primaryKey(),
    productionOrderId: text('production_order_id').notNull().references(() => mfgProductionOrders.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull().references(() => items.id),
    plannedQuantityThousandths: integer('planned_quantity_thousandths').notNull(),
    actualIssuedQuantityThousandths: integer('actual_issued_quantity_thousandths').notNull(),
    ratePaise: integer('rate_paise').notNull(),
    totalPaise: integer('total_paise').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    orderIdx: index('mfg_mat_issued_order_idx').on(table.productionOrderId),
  }),
);

// 81. Manufacturing Job Work (Send out / Receive in)
export const mfgJobWork = sqliteTable(
  'mfg_job_work',
  {
    id: text('id').primaryKey(),
    challanNo: text('challan_no').notNull().unique(), // e.g. JW-CHL-001
    vendorPartyId: text('vendor_party_id').notNull().references(() => parties.id),
    type: text('type').notNull(), // 'SEND_OUT' | 'RECEIVE_IN'
    date: text('date').notNull(),
    expectedReturnDate: text('expected_return_date'),
    status: text('status').notNull().default('OPEN'), // 'OPEN' | 'PARTIAL' | 'COMPLETED'
    rawMaterialsJson: text('raw_materials_json'), // JSON
    finishedExpectedJson: text('finished_expected_json'), // JSON
    jobWorkChargesPaise: integer('job_work_charges_paise').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    vendorIdx: index('mfg_job_work_vendor_idx').on(table.vendorPartyId),
  }),
);

// 82. Wastage Logs (Restaurant & Bakery Kitchen Spoilage / Trimming)
export const mfgWastageLogs = sqliteTable(
  'mfg_wastage_logs',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    itemId: text('item_id').notNull().references(() => items.id),
    quantityThousandths: integer('quantity_thousandths').notNull(),
    costPaise: integer('cost_paise').notNull(),
    reason: text('reason').notNull(), // 'SPOILAGE' | 'BURNT' | 'EXPIRY' | 'TRIMMING' | 'SPILLAGE'
    notes: text('notes'),
    createdById: text('created_by_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    branchDateIdx: index('mfg_wastage_branch_date_idx').on(table.branchId, table.date),
  }),
);

// 83. Online Order Configuration (Swiggy, Zomato, UrbanPiper credentials per branch)
export const onlineOrderConfigs = sqliteTable(
  'online_order_configs',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    provider: text('provider').notNull().default('URBANPIPER'), // 'URBANPIPER' | 'DIRECT'
    apiKeyEncrypted: text('api_key_encrypted'),
    username: text('username'),
    storeIdSwiggy: text('store_id_swiggy'),
    storeIdZomato: text('store_id_zomato'),
    isAutoAccept: integer('is_auto_accept').notNull().default(1),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    branchIdx: index('online_order_configs_branch_idx').on(table.branchId),
  }),
);

// 84. Online Menu Item Mappings & Overrides
export const onlineMenuMappings = sqliteTable(
  'online_menu_mappings',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    itemId: text('item_id').notNull().references(() => items.id),
    platform: text('platform').notNull(), // 'SWIGGY' | 'ZOMATO' | 'OWN'
    platformItemId: text('platform_item_id'),
    pricePaise: integer('price_paise').notNull(), // override price
    isAvailable: integer('is_available').notNull().default(1), // out of stock toggle
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    branchPlatformIdx: index('online_menu_branch_platform_idx').on(table.branchId, table.platform),
    itemPlatformIdx: index('online_menu_item_platform_idx').on(table.itemId, table.platform),
  }),
);

// 85. Online Aggregator & Own Channel Orders
export const onlineOrders = sqliteTable(
  'online_orders',
  {
    id: text('id').primaryKey(),
    orderIdChannel: text('order_id_channel').notNull(), // Swiggy/Zomato external ID
    channel: text('channel').notNull(), // 'SWIGGY' | 'ZOMATO' | 'DIRECT_QR' | 'DIRECT_WEB'
    branchId: text('branch_id').notNull().references(() => branches.id),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    deliveryAddress: text('delivery_address'),
    itemsJson: text('items_json').notNull(), // Array of items with qty, rate, add-ons
    subtotalPaise: integer('subtotal_paise').notNull(),
    taxPaise: integer('tax_paise').notNull().default(0),
    discountPaise: integer('discount_paise').notNull().default(0),
    totalPaise: integer('total_paise').notNull(),
    commissionPaise: integer('commission_paise').notNull().default(0),
    netPayoutPaise: integer('net_payout_paise').notNull(),
    status: text('status').notNull().default('PLACED'), // 'PLACED' | 'ACCEPTED' | 'KOT_PRINTED' | 'READY' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED'
    riderName: text('rider_name'),
    riderPhone: text('rider_phone'),
    riderStatus: text('rider_status'),
    kotId: text('kot_id'),
    invoiceId: text('invoice_id'),
    placedAt: text('placed_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    channelOrderIdx: index('online_orders_channel_order_idx').on(table.channel, table.orderIdChannel),
    branchStatusIdx: index('online_orders_branch_status_idx').on(table.branchId, table.status),
  }),
);

// 86. Dine-in Table QR Ordering Sessions
export const tableQrSessions = sqliteTable(
  'table_qr_sessions',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    tableId: text('table_id').notNull(),
    sessionToken: text('session_token').notNull().unique(),
    status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'ORDERED' | 'SETTLED'
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    tokenIdx: index('table_qr_token_idx').on(table.sessionToken),
    tableStatusIdx: index('table_qr_table_status_idx').on(table.tableId, table.status),
  }),
);

// 87. E-Commerce Storefront Settings
export const ecommerceSettings = sqliteTable(
  'ecommerce_settings',
  {
    id: text('id').primaryKey(),
    businessSlug: text('business_slug').notNull().unique(),
    storeName: text('store_name').notNull(),
    tagline: text('tagline'),
    logoUrl: text('logo_url'),
    bannerUrl: text('banner_url'),
    primaryColor: text('primary_color').notNull().default('#111C2E'),
    customDomain: text('custom_domain'),
    merchantRazorpayKeyId: text('merchant_razorpay_key_id'),
    merchantRazorpayKeySecretEnc: text('merchant_razorpay_key_secret_enc'),
    codEnabled: integer('cod_enabled').notNull().default(1),
    minOrderPaise: integer('min_order_paise').notNull().default(0),
    freeShippingThresholdPaise: integer('free_shipping_threshold_paise').notNull().default(50000), // ₹500
    shippingFeePaise: integer('shipping_fee_paise').notNull().default(6000), // ₹60
    servicePincodesJson: text('service_pincodes_json'), // array of serviceable pincodes or '*'
    shiprocketApiKeyEnc: text('shiprocket_api_key_enc'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    slugIdx: index('ecom_settings_slug_idx').on(table.businessSlug),
  }),
);

// 88. Published E-Commerce Catalog Items
export const ecommercePublishedItems = sqliteTable(
  'ecommerce_published_items',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull().references(() => items.id).unique(),
    isPublished: integer('is_published').notNull().default(1),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    imagesJson: text('images_json'), // JSON array of image URLs
    displayOrder: integer('display_order').notNull().default(0),
    isFeatured: integer('is_featured').notNull().default(0),
    compareAtPricePaise: integer('compare_at_price_paise'), // strike-through MRP
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    slugIdx: index('ecom_items_slug_idx').on(table.slug),
    publishedIdx: index('ecom_items_published_idx').on(table.isPublished),
  }),
);

// 89. E-Commerce Orders
export const ecommerceOrders = sqliteTable(
  'ecommerce_orders',
  {
    id: text('id').primaryKey(),
    orderNumber: text('order_number').notNull().unique(),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email'),
    customerPhone: text('customer_phone').notNull(),
    shippingAddressJson: text('shipping_address_json').notNull(),
    billingAddressJson: text('billing_address_json'),
    itemsJson: text('items_json').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    discountPaise: integer('discount_paise').notNull().default(0),
    couponCode: text('coupon_code'),
    shippingFeePaise: integer('shipping_fee_paise').notNull().default(0),
    taxPaise: integer('tax_paise').notNull().default(0),
    totalPaise: integer('total_paise').notNull(),
    paymentMethod: text('payment_method').notNull().default('COD'), // 'RAZORPAY' | 'COD'
    paymentStatus: text('payment_status').notNull().default('PENDING'), // 'PENDING' | 'PAID' | 'FAILED'
    razorpayOrderId: text('razorpay_order_id'),
    razorpayPaymentId: text('razorpay_payment_id'),
    status: text('status').notNull().default('NEW'), // 'NEW' | 'CONFIRMED' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED'
    carrier: text('carrier').default('SHIPROCKET'),
    waybillNo: text('waybill_no'),
    trackingUrl: text('tracking_url'),
    invoiceId: text('invoice_id'),
    placedAt: text('placed_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    statusIdx: index('ecom_orders_status_idx').on(table.status),
    phoneIdx: index('ecom_orders_phone_idx').on(table.customerPhone),
  }),
);

// 90. E-Commerce Coupons
export const ecommerceCoupons = sqliteTable(
  'ecommerce_coupons',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    discountType: text('discount_type').notNull(), // 'PERCENT' | 'FLAT_PAISE'
    discountValue: integer('discount_value').notNull(), // % basis points or paise
    minOrderPaise: integer('min_order_paise').notNull().default(0),
    maxDiscountPaise: integer('max_discount_paise'),
    validUntil: text('valid_until'),
    isActive: integer('is_active').notNull().default(1),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    codeIdx: index('ecom_coupons_code_idx').on(table.code),
  }),
);

// 91. Abandoned Carts
export const abandonedCarts = sqliteTable(
  'abandoned_carts',
  {
    id: text('id').primaryKey(),
    customerPhone: text('customer_phone'),
    customerEmail: text('customer_email'),
    itemsJson: text('items_json').notNull(),
    cartTotalPaise: integer('cart_total_paise').notNull(),
    lastActiveAt: text('last_active_at').notNull(),
    reminderSentAt: text('reminder_sent_at'),
    recoveredAt: text('recovered_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    activeIdx: index('abandoned_carts_active_idx').on(table.lastActiveAt),
  }),
);

// 92. Registered Offline POS Devices (Terminals)
export const posDevices = sqliteTable(
  'pos_devices',
  {
    id: text('id').primaryKey(),
    deviceCode: text('device_code').notNull().unique(), // e.g. 'POS-01'
    deviceName: text('device_name').notNull(),
    branchId: text('branch_id').notNull().references(() => branches.id),
    offlineSeriesPrefix: text('offline_series_prefix').notNull().unique(), // e.g. 'GX/POS1/'
    lastSyncedAt: text('last_synced_at'),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    branchIdx: index('pos_devices_branch_idx').on(table.branchId),
    codeIdx: index('pos_devices_code_idx').on(table.deviceCode),
  }),
);

// 93. Offline Sync Mutations Log (Client UUID Idempotency & Conflict Tracking)
export const offlineSyncMutations = sqliteTable(
  'offline_sync_mutations',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id').notNull().references(() => posDevices.id),
    mutationId: text('mutation_id').notNull().unique(), // client-generated UUID
    entityType: text('entity_type').notNull(), // 'INVOICE' | 'KOT' | 'PAYMENT'
    payloadJson: text('payload_json').notNull(),
    syncStatus: text('sync_status').notNull().default('SYNCED'), // 'SYNCED' | 'CONFLICT' | 'REJECTED'
    conflictReason: text('conflict_reason'),
    syncedAt: text('synced_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    mutationIdx: index('offline_mutations_uuid_idx').on(table.mutationId),
    deviceStatusIdx: index('offline_mutations_device_status_idx').on(table.deviceId, table.syncStatus),
  }),
);

// 94. Approval Rules (11.1)
export const approvalRules = sqliteTable('approval_rules', {
  id: text('id').primaryKey(),
  ruleType: text('rule_type').notNull(), // 'PURCHASE_ABOVE', 'DISCOUNT_ABOVE', 'CREDIT_LIMIT_ABOVE', 'REFUND_ABOVE'
  thresholdValue: integer('threshold_value').notNull(), // Amount in paise or basis points for discount
  approverRoleKey: text('approver_role_key').notNull().default('owner'), // 'owner', 'manager'
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 95. Approval Requests (11.1)
export const approvalRequests = sqliteTable(
  'approval_requests',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id').references(() => approvalRules.id),
    entityType: text('entity_type').notNull(), // 'PURCHASE' | 'INVOICE' | 'CREDIT_NOTE' | 'PARTY'
    entityId: text('entity_id').notNull(),
    requestedByUserId: text('requested_by_user_id').notNull(),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'APPROVED' | 'REJECTED'
    approvedByUserId: text('approved_by_user_id'),
    rejectionReason: text('rejection_reason'),
    actionedAt: text('actioned_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    statusIdx: index('approval_requests_status_idx').on(table.status),
    entityIdx: index('approval_requests_entity_idx').on(table.entityType, table.entityId),
  }),
);

// 96. Custom Fields Definitions (11.2)
export const customFields = sqliteTable('custom_fields', {
  id: text('id').primaryKey(),
  entityType: text('entity_type').notNull(), // 'ITEM' | 'PARTY' | 'INVOICE'
  fieldKey: text('field_key').notNull().unique(), // e.g. 'batch_serial', 'fssai_licence'
  fieldLabel: text('field_label').notNull(),
  fieldType: text('field_type').notNull().default('TEXT'), // 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT'
  isRequired: integer('is_required').notNull().default(0),
  showOnPdf: integer('show_on_pdf').notNull().default(1),
  optionsJson: text('options_json'), // JSON array for SELECT
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 97. Custom Field Values (11.2)
export const customFieldValues = sqliteTable(
  'custom_field_values',
  {
    id: text('id').primaryKey(),
    customFieldId: text('custom_field_id').notNull().references(() => customFields.id),
    entityId: text('entity_id').notNull(),
    valueText: text('value_text').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    fieldEntityIdx: index('custom_values_lookup_idx').on(table.customFieldId, table.entityId),
  }),
);

// 98. Custom Invoice Templates (11.2)
export const invoiceTemplates = sqliteTable('invoice_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  primaryColour: text('primary_colour').notNull().default('#111C2E'),
  fontFamily: text('font_family').notNull().default('Inter'),
  headerLayout: text('header_layout').notNull().default('STANDARD'), // 'STANDARD' | 'CENTERED' | 'MODERN'
  showQr: integer('show_qr').notNull().default(1),
  showBankDetails: integer('show_bank_details').notNull().default(1),
  termsText: text('terms_text'),
  isDefault: integer('is_default').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 99. Public API Keys (11.3)
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(), // e.g. 'gx_live_...'
  keyHash: text('key_hash').notNull().unique(), // SHA-256 hash of secret key
  scopesJson: text('scopes_json').notNull(), // JSON array of scopes
  rateLimitRpm: integer('rate_limit_rpm').notNull().default(60),
  lastUsedAt: text('last_used_at'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 100. Outgoing Webhooks (11.3)
export const outgoingWebhooks = sqliteTable('outgoing_webhooks', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  eventTypesJson: text('event_types_json').notNull(), // ['invoice.created', 'payment.received']
  secret: text('secret').notNull(), // Webhook HMAC signing secret
  failureCount: integer('failure_count').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 101. AI Conversations ("Ask GexGrow") (11.5)
export const aiConversations = sqliteTable('ai_conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  toolCallsJson: text('tool_calls_json'),
  tokensUsed: integer('tokens_used').notNull().default(0),
  createdAt: text('created_at').notNull(),
});








