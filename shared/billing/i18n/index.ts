/**
 * GexGrow Multi-Language (i18n) Catalog
 * Supports English (en), Hindi (hi), and Bengali (bn)
 */

export type SupportedLanguage = 'en' | 'hi' | 'bn';

export interface TranslationDictionary {
  dashboard: string;
  sales: string;
  invoices: string;
  retailPos: string;
  restaurant: string;
  inventory: string;
  accounting: string;
  reports: string;
  settings: string;
  total: string;
  subtotal: string;
  tax: string;
  paid: string;
  balanceDue: string;
  save: string;
  cancel: string;
  print: string;
  search: string;
  createNew: string;
  askAi: string;
}

export const translations: Record<SupportedLanguage, TranslationDictionary> = {
  en: {
    dashboard: 'Dashboard',
    sales: 'Sales',
    invoices: 'Invoices',
    retailPos: 'Retail POS',
    restaurant: 'Restaurant',
    inventory: 'Inventory',
    accounting: 'Accounting',
    reports: 'Reports',
    settings: 'Settings',
    total: 'Total Amount',
    subtotal: 'Subtotal',
    tax: 'GST Tax',
    paid: 'Paid',
    balanceDue: 'Balance Due',
    save: 'Save Changes',
    cancel: 'Cancel',
    print: 'Print Receipt',
    search: 'Search...',
    createNew: '+ Create New',
    askAi: 'Ask GexGrow AI',
  },
  hi: {
    dashboard: 'डैशबोर्ड',
    sales: 'बिक्री (सेल्स)',
    invoices: 'बिल / इनवॉयस',
    retailPos: 'रिटेल पीओएस',
    restaurant: 'रेस्टोरेंट',
    inventory: 'स्टॉक / इन्वेंट्री',
    accounting: 'खाताबही / अकाउंटिंग',
    reports: 'रिपोर्ट्स',
    settings: 'सेटिंग्स',
    total: 'कुल राशि',
    subtotal: 'उप-योग',
    tax: 'जीएसटी कर',
    paid: 'भुगतान किया गया',
    balanceDue: 'बकाया राशि',
    save: 'सुरक्षित करें',
    cancel: 'रद्द करें',
    print: 'रसीद प्रिंट करें',
    search: 'खोजें...',
    createNew: '+ नया बनाएं',
    askAi: 'जेक्सप्रो एआई से पूछें',
  },
  bn: {
    dashboard: 'ড্যাশবোর্ড',
    sales: 'বিক্রয় (সেলস)',
    invoices: 'বিল / চালান',
    retailPos: 'রিটেল পিওএস',
    restaurant: 'রেস্তোরাঁ',
    inventory: 'স্টক / ইনভেন্টরি',
    accounting: 'হিসাবরক্ষণ',
    reports: 'রিপোর্ট',
    settings: 'সেটিংস',
    total: 'মোট টাকা',
    subtotal: 'সাবটোটাল',
    tax: 'জিএসটি কর',
    paid: 'পরিশোধিত',
    balanceDue: 'বকেয়া টাকা',
    save: 'সংরক্ষণ করুন',
    cancel: 'বাতিল করুন',
    print: 'রসিদ প্রিন্ট করুন',
    search: 'খুঁজুন...',
    createNew: '+ নতুন তৈরি করুন',
    askAi: 'জেক্সপ্রো এআই জিজ্ঞাসা করুন',
  },
};

export function getTranslation(lang: SupportedLanguage = 'en'): TranslationDictionary {
  return translations[lang] || translations.en;
}

export * from './nav';
