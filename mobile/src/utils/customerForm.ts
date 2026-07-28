import type {Customer, CustomerCreateInput} from '../types/api.types';

// Pure, RN-tree-free helpers for the customer create/edit forms AND the
// kiosk self-signup. Extracted from CustomerEditScreen so the kiosk can reuse
// validation + payload shaping without dragging the edit screen's import
// graph (delete flow, getCustomerDetail, cart) along.

// Basic RFC-5322 subset — anything local@domain.tld passes; the server is the
// source of truth for obscure-but-valid forms.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CustomerFormValues {
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  phone: string;
  notes: string;
  // Address group — all blank ⇒ omitted from the wire payload so the server
  // doesn't create an empty address row.
  address: string;
  address_line_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

export interface CustomerFormErrors {
  first_name?: string;
  email?: string;
  // Kiosk-only: shown when neither a phone nor an email was given.
  contact?: string;
}

export const EMPTY_FORM: CustomerFormValues = {
  first_name: '',
  last_name: '',
  company: '',
  email: '',
  phone: '',
  notes: '',
  address: '',
  address_line_2: '',
  city: '',
  state: '',
  postcode: '',
  country: '',
};

export function validateCustomerForm(
  values: CustomerFormValues,
): CustomerFormErrors {
  const errors: CustomerFormErrors = {};
  // Server rule (StoreCustomerRequest): first_name OR company required.
  if (!values.first_name.trim() && !values.company.trim()) {
    errors.first_name = 'Name or company is required';
  }
  const email = values.email.trim();
  if (email && !EMAIL_REGEX.test(email)) {
    errors.email = 'Enter a valid email address';
  }
  return errors;
}

// Kiosk-specific: the whole point is capturing a contact, so require a first
// name AND at least one of phone/email (a name-only record is useless). Still
// validates email FORMAT when one is given. Never requires BOTH contacts —
// forcing email on someone who only wants to give a phone is the friction
// that reads as pushy (product review §2).
export function validateKioskForm(
  values: CustomerFormValues,
): CustomerFormErrors {
  const errors: CustomerFormErrors = {};
  if (!values.first_name.trim()) {
    errors.first_name = 'Please enter your first name';
  }
  const email = values.email.trim();
  const phone = values.phone.trim();
  if (email && !EMAIL_REGEX.test(email)) {
    errors.email = 'Enter a valid email address';
  }
  if (!email && !phone) {
    errors.contact = 'Please add a mobile or email so we can reach you';
  }
  return errors;
}

export function customerToFormValues(c: Customer): CustomerFormValues {
  const defaultAddress = c.default_address;
  return {
    first_name: c.first_name ?? '',
    last_name: c.last_name ?? '',
    company: c.company ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    notes: c.notes ?? '',
    address: defaultAddress?.line_1 ?? '',
    address_line_2: defaultAddress?.line_2 ?? '',
    city: defaultAddress?.city ?? '',
    state: defaultAddress?.state ?? '',
    postcode: defaultAddress?.postcode ?? '',
    country: defaultAddress?.country ?? '',
  };
}

// Strip empty strings — the API treats null and "absent" the same, but a
// literal empty string can trip validation that runs before the empty check.
export function formToCreateInput(
  values: CustomerFormValues,
): CustomerCreateInput {
  const v = values;
  const trim = (s: string) => s.trim();
  const opt = (s: string) => {
    const t = trim(s);
    return t === '' ? undefined : t;
  };
  const out: CustomerCreateInput = {
    first_name: opt(v.first_name) ?? null,
    last_name: opt(v.last_name) ?? null,
    company: opt(v.company) ?? null,
    email: opt(v.email) ?? null,
    phone: opt(v.phone) ?? null,
    notes: opt(v.notes) ?? null,
  };
  const hasAddress = [
    v.address,
    v.address_line_2,
    v.city,
    v.state,
    v.postcode,
    v.country,
  ].some(s => trim(s) !== '');
  if (hasAddress) {
    out.address = opt(v.address) ?? null;
    out.address_line_2 = opt(v.address_line_2) ?? null;
    out.city = opt(v.city) ?? null;
    out.state = opt(v.state) ?? null;
    out.postcode = opt(v.postcode) ?? null;
    out.country = opt(v.country) ?? null;
  }
  return out;
}

// Kiosk payload: the customer's own details + their marketing choice. When
// they opt in we set the email + SMS channels and stamp the source as 'kiosk'
// so the server records HOW consent was captured (it stamps the WHEN itself,
// per Aeris2 StoreCustomerRequest). Only phone is written (never `mobile`
// alone) so the number is visible in the list + editable by staff.
export function kioskFormToCreateInput(
  values: CustomerFormValues,
  marketingOptIn: boolean,
): CustomerCreateInput {
  const out = formToCreateInput(values);
  if (marketingOptIn) {
    out.marketing_emails = true;
    out.marketing_sms = true;
    out.marketing_consent_source = 'kiosk';
  } else {
    out.marketing_emails = false;
    out.marketing_sms = false;
    out.marketing_post = false;
  }
  return out;
}

// Light phone formatter — collapse whitespace runs, trim edges. Cosmetic only;
// E.164 coercion is the server's job.
export function formatPhoneOnBlur(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
