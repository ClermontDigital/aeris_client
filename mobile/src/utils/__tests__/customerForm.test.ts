import {
  EMPTY_FORM,
  validateKioskForm,
  kioskFormToCreateInput,
} from '../customerForm';

describe('validateKioskForm', () => {
  it('requires a first name', () => {
    const errs = validateKioskForm({...EMPTY_FORM, phone: '0400000000'});
    expect(errs.first_name).toBeTruthy();
  });

  it('requires at least one contact (mobile OR email)', () => {
    const errs = validateKioskForm({...EMPTY_FORM, first_name: 'Ada'});
    expect(errs.contact).toBeTruthy();
  });

  it('accepts a first name + a phone (no email needed)', () => {
    const errs = validateKioskForm({
      ...EMPTY_FORM,
      first_name: 'Ada',
      phone: '0400 000 000',
    });
    expect(errs).toEqual({});
  });

  it('accepts a first name + an email (no phone needed)', () => {
    const errs = validateKioskForm({
      ...EMPTY_FORM,
      first_name: 'Ada',
      email: 'ada@example.com',
    });
    expect(errs).toEqual({});
  });

  it('rejects a malformed email even when a phone is present', () => {
    const errs = validateKioskForm({
      ...EMPTY_FORM,
      first_name: 'Ada',
      phone: '0400000000',
      email: 'nope',
    });
    expect(errs.email).toBeTruthy();
  });
});

describe('kioskFormToCreateInput', () => {
  const base = {...EMPTY_FORM, first_name: 'Ada', phone: '0400 000 000'};

  it('opting in sets the marketing channels + source=kiosk', () => {
    const out = kioskFormToCreateInput(base, true);
    expect(out.marketing_emails).toBe(true);
    expect(out.marketing_sms).toBe(true);
    expect(out.marketing_consent_source).toBe('kiosk');
  });

  it('opting out sends the flags off and NO consent source', () => {
    const out = kioskFormToCreateInput(base, false);
    expect(out.marketing_emails).toBe(false);
    expect(out.marketing_sms).toBe(false);
    expect(out.marketing_consent_source).toBeUndefined();
  });

  it('writes the number to phone (not mobile-only) so it shows in the list', () => {
    const out = kioskFormToCreateInput(base, false);
    expect(out.phone).toBe('0400 000 000');
    expect(out.mobile).toBeUndefined();
  });
});
