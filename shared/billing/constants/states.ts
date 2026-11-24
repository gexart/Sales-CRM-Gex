export interface IndianState {
  code: string; // 2-digit GST state code
  name: string;
  tin: string;
  isUnionTerritory: boolean;
}

export const INDIAN_STATES: readonly IndianState[] = [
  { code: '01', name: 'Jammu and Kashmir', tin: '01', isUnionTerritory: true },
  { code: '02', name: 'Himachal Pradesh', tin: '02', isUnionTerritory: false },
  { code: '03', name: 'Punjab', tin: '03', isUnionTerritory: false },
  { code: '04', name: 'Chandigarh', tin: '04', isUnionTerritory: true },
  { code: '05', name: 'Uttarakhand', tin: '05', isUnionTerritory: false },
  { code: '06', name: 'Haryana', tin: '06', isUnionTerritory: false },
  { code: '07', name: 'Delhi', tin: '07', isUnionTerritory: true },
  { code: '08', name: 'Rajasthan', tin: '08', isUnionTerritory: false },
  { code: '09', name: 'Uttar Pradesh', tin: '09', isUnionTerritory: false },
  { code: '10', name: 'Bihar', tin: '10', isUnionTerritory: false },
  { code: '11', name: 'Sikkim', tin: '11', isUnionTerritory: false },
  { code: '12', name: 'Arunachal Pradesh', tin: '12', isUnionTerritory: false },
  { code: '13', name: 'Nagaland', tin: '13', isUnionTerritory: false },
  { code: '14', name: 'Manipur', tin: '14', isUnionTerritory: false },
  { code: '15', name: 'Mizoram', tin: '15', isUnionTerritory: false },
  { code: '16', name: 'Tripura', tin: '16', isUnionTerritory: false },
  { code: '17', name: 'Meghalaya', tin: '17', isUnionTerritory: false },
  { code: '18', name: 'Assam', tin: '18', isUnionTerritory: false },
  { code: '19', name: 'West Bengal', tin: '19', isUnionTerritory: false },
  { code: '20', name: 'Jharkhand', tin: '20', isUnionTerritory: false },
  { code: '21', name: 'Odisha', tin: '21', isUnionTerritory: false },
  { code: '22', name: 'Chhattisgarh', tin: '22', isUnionTerritory: false },
  { code: '23', name: 'Madhya Pradesh', tin: '23', isUnionTerritory: false },
  { code: '24', name: 'Gujarat', tin: '24', isUnionTerritory: false },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', tin: '26', isUnionTerritory: true },
  { code: '27', name: 'Maharashtra', tin: '27', isUnionTerritory: false },
  { code: '28', name: 'Andhra Pradesh (Old)', tin: '28', isUnionTerritory: false },
  { code: '29', name: 'Karnataka', tin: '29', isUnionTerritory: false },
  { code: '30', name: 'Goa', tin: '30', isUnionTerritory: false },
  { code: '31', name: 'Lakshadweep', tin: '31', isUnionTerritory: true },
  { code: '32', name: 'Kerala', tin: '32', isUnionTerritory: false },
  { code: '33', name: 'Tamil Nadu', tin: '33', isUnionTerritory: false },
  { code: '34', name: 'Puducherry', tin: '34', isUnionTerritory: true },
  { code: '35', name: 'Andaman and Nicobar Islands', tin: '35', isUnionTerritory: true },
  { code: '36', name: 'Telangana', tin: '36', isUnionTerritory: false },
  { code: '37', name: 'Andhra Pradesh (New)', tin: '37', isUnionTerritory: false },
  { code: '38', name: 'Ladakh', tin: '38', isUnionTerritory: true },
  { code: '97', name: 'Other Territory', tin: '97', isUnionTerritory: true },
] as const;

export function getStateByCode(code: string): IndianState | undefined {
  return INDIAN_STATES.find((s) => s.code === code.padStart(2, '0'));
}

export function getStateFromGstin(gstin: string): IndianState | undefined {
  if (!gstin || gstin.length < 2) return undefined;
  const code = gstin.slice(0, 2);
  return getStateByCode(code);
}

export const STATE_CODES = INDIAN_STATES;


