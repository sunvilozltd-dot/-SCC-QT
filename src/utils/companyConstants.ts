import {
  QuotationChargeMode,
  QuotationItem,
  TaxCalculationBase,
  VatCalculationBase,
} from '../types/order';
import { roundMoney2 } from './dateAndPhone';

export const COMPANY_NAME = 'SUNVILOZ Clean Care';
export const COMPANY_ADDRESS = 'HOUSE:30, ROAD: 1/D, NIKUNJA-02, KHILKHET,DHAKA-1229';
export const COMPANY_PHONE = '09649112288';
export const COMPANY_EMAIL = 'info.sunviloz@gmail.com';
export const COMPANY_WEBSITE = 'https://sunvilozcleancare.com/';

export const FIXED_QUOTATION_SUBJECT =
  'Quotation for professional water tank cleaning service.';

export const FIXED_QUOTATION_INTRO =
  'Dear Sir, Greetings from Sunviloz Clean Care. We follow World Health Organization’s (WHO) suggested procedure to clean and disinfect water tanks. We use modern equipment and a trained workforce to complete our job in a professional manner. The work procedure and pricing are given below as per our discussion';

export const FIXED_QUOTATION_STEPS_HEADING = 'Our Basic Steps for Water Tank Cleaning:';

export const FIXED_QUOTATION_STEPS: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: 'Step 1:',
    text: 'The area surrounding the tank and the top of the tank is cleaned.',
  },
  {
    label: 'Step 2:',
    text: 'Remove harmful gases from the water tank.',
  },
  {
    label: 'Step 3:',
    text: 'A sludge pump drains water and sludge from the tank.',
  },
  {
    label: 'Step 4:',
    text: 'Manual scrubbing of the tank is done to remove the dirt, sediments, fungus & stains.',
  },
  {
    label: 'Step 5:',
    text: 'Applying Hydrogen Peroxide all over the tank which works as a bleaching agent, oxidizer, and Antiseptic for disinfection.',
  },
  {
    label: 'Step 6:',
    text: 'Walls, ceiling, and floor of the tank are washed using a high-pressure jet.',
  },
  {
    label: 'Step 7:',
    text: 'Vacuum cleaning is done to ensure that all the dirt is sucked out.',
  },
  {
    label: 'Step 8:',
    text: 'Using Ultraviolet light to kill bacteria in the last turn.',
  },
];

export const FIXED_QUOTATION_FINANCIAL_HEADING = 'Financial Offer';

export const DEFAULT_QUOTATION_TERMS = '';

export interface QuotationCalculationInput {
  items: Pick<QuotationItem, 'quantity' | 'rate_bdt' | 'amount_bdt'>[];
  discount_enabled: boolean;
  discount_type: QuotationChargeMode;
  discount_value: number;
  vat_enabled: boolean;
  vat_type: QuotationChargeMode;
  vat_value: number;
  vat_base: VatCalculationBase;
  tax_enabled: boolean;
  tax_type: QuotationChargeMode;
  tax_value: number;
  tax_base: TaxCalculationBase;
}

export interface QuotationCalculationResult {
  subtotal_bdt: number;
  discount_bdt: number;
  after_discount_bdt: number;
  vat_bdt: number;
  tax_bdt: number;
  total_bdt: number;
}

export function computeQuotationTotals(
  input: QuotationCalculationInput
): QuotationCalculationResult {
  const subtotal_bdt = roundMoney2(
    (input.items || []).reduce((sum, it) => {
      const qty = Math.max(0, Number(it.quantity) || 0);
      const rate = Math.max(0, Number(it.rate_bdt) || 0);
      const lineTotal =
        rate > 0 ? roundMoney2(qty * rate) : roundMoney2(Math.max(0, Number(it.amount_bdt) || 0));
      return sum + lineTotal;
    }, 0)
  );

  let discount_bdt = 0;
  if (input.discount_enabled) {
    const val = Math.max(0, Number(input.discount_value) || 0);
    if (input.discount_type === 'percent') {
      const pct = Math.min(100, val);
      discount_bdt = roundMoney2(subtotal_bdt * (pct / 100));
    } else {
      discount_bdt = roundMoney2(Math.min(subtotal_bdt, val));
    }
  }

  const after_discount_bdt = roundMoney2(Math.max(0, subtotal_bdt - discount_bdt));

  let vat_bdt = 0;
  if (input.vat_enabled) {
    const val = Math.max(0, Number(input.vat_value) || 0);
    if (input.vat_type === 'percent') {
      const base = input.vat_base === 'subtotal' ? subtotal_bdt : after_discount_bdt;
      vat_bdt = roundMoney2(base * (val / 100));
    } else {
      vat_bdt = roundMoney2(val);
    }
  }

  let tax_bdt = 0;
  if (input.tax_enabled) {
    const val = Math.max(0, Number(input.tax_value) || 0);
    if (input.tax_type === 'percent') {
      const base =
        input.tax_base === 'subtotal'
          ? subtotal_bdt
          : input.tax_base === 'after_discount_and_vat'
          ? roundMoney2(after_discount_bdt + vat_bdt)
          : after_discount_bdt;
      tax_bdt = roundMoney2(base * (val / 100));
    } else {
      tax_bdt = roundMoney2(val);
    }
  }

  const total_bdt = roundMoney2(Math.max(0, subtotal_bdt - discount_bdt + vat_bdt + tax_bdt));

  return {
    subtotal_bdt,
    discount_bdt,
    after_discount_bdt,
    vat_bdt,
    tax_bdt,
    total_bdt,
  };
}
