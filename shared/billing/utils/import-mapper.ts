import { validateGstin } from '../gst/gstin';

export interface ColumnMappingConfig {
  internalKey: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const ITEM_IMPORT_FIELDS: ColumnMappingConfig[] = [
  {
    internalKey: 'name',
    label: 'Item Name',
    required: true,
    aliases: ['item name', 'product name', 'item', 'product', 'particulars', 'item description', 'description'],
  },
  {
    internalKey: 'salePrice',
    label: 'Sale Price (₹)',
    required: true,
    aliases: ['sale price', 'selling price', 'sales price', 'rate', 'price', 'unit price'],
  },
  {
    internalKey: 'purchasePrice',
    label: 'Purchase Price (₹)',
    required: false,
    aliases: ['purchase price', 'cost price', 'buying price', 'cost', 'purchase rate'],
  },
  {
    internalKey: 'taxRate',
    label: 'GST Rate (%)',
    required: false,
    aliases: ['tax rate', 'gst rate', 'gst %', 'tax %', 'gst', 'tax'],
  },
  {
    internalKey: 'hsnSac',
    label: 'HSN / SAC Code',
    required: false,
    aliases: ['hsn', 'hsn code', 'hsn/sac', 'sac', 'sac code'],
  },
  {
    internalKey: 'sku',
    label: 'SKU / Item Code',
    required: false,
    aliases: ['sku', 'item code', 'product code', 'item id', 'code'],
  },
  {
    internalKey: 'barcode',
    label: 'Barcode',
    required: false,
    aliases: ['barcode', 'upc', 'ean', 'isbn', 'barcode no'],
  },
  {
    internalKey: 'unit',
    label: 'Unit of Measure',
    required: false,
    aliases: ['unit', 'uom', 'measuring unit', 'unit of measure'],
  },
  {
    internalKey: 'openingStock',
    label: 'Opening Stock',
    required: false,
    aliases: ['opening stock', 'stock', 'quantity', 'qty', 'current stock', 'opening qty'],
  },
  {
    internalKey: 'category',
    label: 'Category',
    required: false,
    aliases: ['category', 'group', 'item group', 'item category'],
  },
];

export const PARTY_IMPORT_FIELDS: ColumnMappingConfig[] = [
  {
    internalKey: 'name',
    label: 'Party Name',
    required: true,
    aliases: ['party name', 'customer name', 'vendor name', 'name', 'contact name', 'ledger name'],
  },
  {
    internalKey: 'phone',
    label: 'Mobile / Phone',
    required: true,
    aliases: ['phone', 'mobile', 'contact', 'mobile no', 'phone no', 'contact number'],
  },
  {
    internalKey: 'type',
    label: 'Party Type',
    required: false,
    aliases: ['party type', 'type', 'customer or vendor'],
  },
  {
    internalKey: 'gstin',
    label: 'GSTIN',
    required: false,
    aliases: ['gstin', 'gst no', 'gst number', 'gstin/uin'],
  },
  {
    internalKey: 'stateCode',
    label: 'State Code',
    required: false,
    aliases: ['state code', 'state', 'place of supply'],
  },
  {
    internalKey: 'company',
    label: 'Company Name',
    required: false,
    aliases: ['company', 'company name', 'business name', 'trade name'],
  },
  {
    internalKey: 'email',
    label: 'Email',
    required: false,
    aliases: ['email', 'email address', 'e-mail'],
  },
  {
    internalKey: 'billingAddress',
    label: 'Billing Address',
    required: false,
    aliases: ['address', 'billing address', 'street', 'city'],
  },
  {
    internalKey: 'openingBalance',
    label: 'Opening Balance (₹)',
    required: false,
    aliases: ['opening balance', 'balance', 'opening bal', 'current balance'],
  },
];

/**
 * Automatically suggests column mappings based on header text from CSV/Excel
 */
export function autoDetectColumnMapping(
  headers: string[],
  configs: ColumnMappingConfig[],
): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const header of headers) {
    const cleanHeader = header.trim().toLowerCase();
    for (const config of configs) {
      if (
        cleanHeader === config.internalKey.toLowerCase() ||
        config.aliases.some((alias) => cleanHeader === alias || cleanHeader.includes(alias))
      ) {
        if (!mapping[config.internalKey]) {
          mapping[config.internalKey] = header;
          break;
        }
      }
    }
  }

  return mapping;
}

export interface ParsedRowResult<T> {
  rowNumber: number;
  data: T;
  isValid: boolean;
  errors: string[];
}

/**
 * Parses and validates an item import row
 */
export function parseItemImportRow(
  row: Record<string, any>,
  mapping: Record<string, string>,
  rowNumber: number,
): ParsedRowResult<any> {
  const errors: string[] = [];

  const nameHeader = mapping['name'];
  const name = nameHeader ? String(row[nameHeader] || '').trim() : '';
  if (!name) {
    errors.push('Item name is required');
  }

  const priceHeader = mapping['salePrice'];
  const rawPrice = priceHeader ? String(row[priceHeader] || '').replace(/[^0-9.]/g, '') : '0';
  const salePrice = parseFloat(rawPrice) || 0;
  if (salePrice < 0) {
    errors.push('Sale price cannot be negative');
  }

  const purchaseHeader = mapping['purchasePrice'];
  const rawPurchase = purchaseHeader ? String(row[purchaseHeader] || '').replace(/[^0-9.]/g, '') : '0';
  const purchasePrice = parseFloat(rawPurchase) || 0;

  const taxHeader = mapping['taxRate'];
  const rawTax = taxHeader ? String(row[taxHeader] || '').replace(/[^0-9.]/g, '') : '18';
  const taxRate = parseFloat(rawTax) || 0;

  const hsnHeader = mapping['hsnSac'];
  const hsnSac = hsnHeader ? String(row[hsnHeader] || '').trim() : '';

  const skuHeader = mapping['sku'];
  const sku = skuHeader ? String(row[skuHeader] || '').trim() : '';

  const barcodeHeader = mapping['barcode'];
  const barcode = barcodeHeader ? String(row[barcodeHeader] || '').trim() : '';

  const unitHeader = mapping['unit'];
  const unit = unitHeader ? String(row[unitHeader] || 'PCS').trim().toUpperCase() : 'PCS';

  const stockHeader = mapping['openingStock'];
  const rawStock = stockHeader ? String(row[stockHeader] || '0').replace(/[^0-9.]/g, '') : '0';
  const openingStock = parseFloat(rawStock) || 0;

  return {
    rowNumber,
    data: {
      name,
      salePricePaise: Math.round(salePrice * 100),
      purchasePricePaise: Math.round(purchasePrice * 100),
      taxRateBasisPoints: Math.round(taxRate * 100),
      hsnSac,
      sku,
      barcode,
      unit,
      openingStockThousandths: Math.round(openingStock * 1000),
    },
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Parses and validates a party import row
 */
export function parsePartyImportRow(
  row: Record<string, any>,
  mapping: Record<string, string>,
  rowNumber: number,
): ParsedRowResult<any> {
  const errors: string[] = [];

  const nameHeader = mapping['name'];
  const name = nameHeader ? String(row[nameHeader] || '').trim() : '';
  if (!name) {
    errors.push('Party name is required');
  }

  const phoneHeader = mapping['phone'];
  const phone = phoneHeader ? String(row[phoneHeader] || '').replace(/[^0-9]/g, '') : '';
  if (!phone || phone.length < 10) {
    errors.push('Valid 10-digit phone number is required');
  }

  const gstinHeader = mapping['gstin'];
  const gstin = gstinHeader ? String(row[gstinHeader] || '').trim().toUpperCase() : '';
  let stateCode = '19'; // default

  if (gstin) {
    const gstinResult = validateGstin(gstin);
    if (!gstinResult.isValid) {
      errors.push(`Invalid GSTIN: ${gstinResult.error}`);
    } else if (gstinResult.stateCode) {
      stateCode = gstinResult.stateCode;
    }
  }

  const stateHeader = mapping['stateCode'];
  if (stateHeader && row[stateHeader]) {
    const rawState = String(row[stateHeader]).trim();
    if (rawState.length === 2 && /^\d{2}$/.test(rawState)) {
      stateCode = rawState;
    }
  }

  const typeHeader = mapping['type'];
  let type = 'CUSTOMER';
  if (typeHeader && row[typeHeader]) {
    const rawType = String(row[typeHeader]).trim().toUpperCase();
    if (rawType.includes('VENDOR') || rawType.includes('SUPPLIER')) {
      type = 'VENDOR';
    } else if (rawType.includes('BOTH')) {
      type = 'BOTH';
    }
  }

  const companyHeader = mapping['company'];
  const company = companyHeader ? String(row[companyHeader] || '').trim() : '';

  const emailHeader = mapping['email'];
  const email = emailHeader ? String(row[emailHeader] || '').trim() : '';

  const addressHeader = mapping['billingAddress'];
  const billingAddress = addressHeader ? String(row[addressHeader] || '').trim() : '';

  const balHeader = mapping['openingBalance'];
  const rawBal = balHeader ? String(row[balHeader] || '0').replace(/[^0-9.]/g, '') : '0';
  const openingBalance = parseFloat(rawBal) || 0;

  return {
    rowNumber,
    data: {
      name,
      phone,
      type,
      gstin: gstin || undefined,
      stateCode,
      company: company || undefined,
      email: email || undefined,
      billingAddress: billingAddress || undefined,
      openingBalancePaise: Math.round(openingBalance * 100),
      openingBalanceType: 'RECEIVE',
    },
    isValid: errors.length === 0,
    errors,
  };
}

