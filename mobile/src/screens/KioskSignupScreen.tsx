import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Platform,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import PinPad from '../components/PinPad';
import {COLORS, SPACING, FONT_SIZE, FONT_FAMILY, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useKioskStore} from '../stores/kioskStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useAuthStore} from '../stores/authStore';
import {useAppLockStore} from '../stores/appLockStore';
import {useHaptics} from '../hooks/useHaptics';
import {
  EMPTY_FORM,
  validateKioskForm,
  kioskFormToCreateInput,
  formatPhoneOnBlur,
  type CustomerFormValues,
  type CustomerFormErrors,
} from '../utils/customerForm';

// How the customer-facing surface can never expose the app: the whole screen
// is a blank form → thank-you. Exiting is staff-only behind the app PIN, with
// its OWN bounded backoff that STAYS in kiosk on failure (never logs out or
// wipes the PIN — that would be a customer-triggered DoS + escape). Auto-lock
// is suppressed while active (appLockStore.lockNow), hardware back is
// swallowed, and an idle timeout clears any entered PII.
const IDLE_MS = 90_000;
const EXIT_MAX_ATTEMPTS = 5;
const EXIT_COOLDOWN_MS = 30_000;

type Stage = 'form' | 'thanks' | 'exit';

// Shared props that neutralise the OS keyboard/autofill so one customer's PII
// never surfaces to the next (learned words, QuickType, Contacts autofill).
const PRIVATE_INPUT_PROPS = {
  autoComplete: 'off' as const,
  autoCorrect: false,
  spellCheck: false,
  textContentType: 'none' as const,
  importantForAutofill: 'no' as const,
  contextMenuHidden: true,
  placeholderTextColor: COLORS.textDim,
};

const KioskSignupScreen: React.FC = () => {
  const haptics = useHaptics();
  const exitKiosk = useKioskStore(s => s.exit);
  const businessName = useSettingsStore(s => s.settings.businessName ?? '');
  const siteName = useAuthStore(s => s.user?.location?.name ?? '');
  const verifyPin = useAppLockStore(s => s.verifyPin);
  const hasPin = useAppLockStore(s => s.hasPin);

  // Store display name: staff-set business name ▸ assigned site ▸ nothing.
  // Never fall through to an unfamiliar app name — a stranger seeing a SaaS
  // wordmark they don't recognise reads as phishing (product review §1).
  const storeName = (businessName || siteName || '').trim();

  const [stage, setStage] = useState<Stage>('form');
  const [values, setValues] = useState<CustomerFormValues>({...EMPTY_FORM});
  const [errors, setErrors] = useState<CustomerFormErrors>({});
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Exit-PIN backoff — local to the kiosk, never touches appLockStore's
  // logout/reset failure handler.
  const [exitError, setExitError] = useState<string | undefined>();
  const exitAttemptsRef = useRef(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  // Idle timeout: clear entered PII if the device is abandoned mid-form.
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetForm = useCallback(() => {
    setValues({...EMPTY_FORM});
    setErrors({});
    setMarketingOptIn(false);
  }, []);
  const bumpIdle = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => {
      resetForm();
      setStage('form');
    }, IDLE_MS);
  }, [resetForm]);
  useEffect(() => {
    bumpIdle();
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
    };
  }, [bumpIdle]);

  // Every keystroke counts as activity so a slow typist isn't wiped mid-form
  // by the idle timeout (review fix — the target demographic types slowly).
  const set = useCallback(
    (k: keyof CustomerFormValues, v: string) => {
      bumpIdle();
      setValues(prev => ({...prev, [k]: v}));
    },
    [bumpIdle],
  );

  // Swallow Android hardware/gesture back while in kiosk.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const handleSave = useCallback(async () => {
    bumpIdle();
    const errs = validateKioskForm(values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      haptics.error();
      return;
    }
    setSubmitting(true);
    try {
      await ApiClient.createCustomer(
        kioskFormToCreateInput(values, marketingOptIn),
      );
      haptics.success();
      resetForm();
      setStage('thanks');
    } catch {
      // The customer must NEVER see a raw error, a duplicate-exists message
      // (leaks that someone with their number is on file), or a network
      // failure that reads as broken/scam. Show the reassuring end state; the
      // record either saved or staff will re-capture. (security + product
      // reviews.)
      haptics.success();
      resetForm();
      setStage('thanks');
    } finally {
      setSubmitting(false);
    }
  }, [values, marketingOptIn, bumpIdle, haptics, resetForm]);

  const now = Date.now;
  const handleExitSubmit = useCallback(
    async (pin: string) => {
      if (cooldownUntil > now()) return;
      // Stale/legacy PIN payload wiped hasPin — don't strand the customer;
      // allow exit.
      if (!hasPin) {
        exitKiosk();
        return;
      }
      const ok = await verifyPin(pin);
      if (ok) {
        exitAttemptsRef.current = 0;
        setExitError(undefined);
        exitKiosk();
        return;
      }
      exitAttemptsRef.current += 1;
      if (exitAttemptsRef.current >= EXIT_MAX_ATTEMPTS) {
        exitAttemptsRef.current = 0;
        setCooldownUntil(now() + EXIT_COOLDOWN_MS);
        setExitError('Too many attempts. Try again shortly.');
      } else {
        setExitError('Incorrect PIN.');
      }
    },
    [cooldownUntil, hasPin, verifyPin, exitKiosk, now],
  );

  // ---- Exit PIN stage ----
  if (stage === 'exit') {
    const cooling = cooldownUntil > now();
    return (
      <SafeAreaView style={styles.pinRoot}>
        <PinPad
          title={cooling ? 'Locked — wait a moment' : 'Staff PIN to exit kiosk'}
          onSubmit={handleExitSubmit}
          onCancel={() => {
            setExitError(undefined);
            setStage('form');
          }}
          error={exitError}
        />
      </SafeAreaView>
    );
  }

  const goExit = () => {
    setExitError(undefined);
    setStage('exit');
  };

  // ---- Thank-you stage ----
  if (stage === 'thanks') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.thanksWrap}>
          <View style={styles.thanksBadge}>
            <Icon name="check" size={48} color={COLORS.surface} />
          </View>
          <Text style={styles.thanksTitle} maxFontSizeMultiplier={2}>
            You're all set!
          </Text>
          <Text style={styles.thanksBody} maxFontSizeMultiplier={2}>
            Thanks for signing up. Please hand the device back to our team.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.staffExit}
          onPress={goExit}
          accessibilityRole="button"
          accessibilityLabel="Staff: exit kiosk">
          <Text style={styles.staffExitText}>Staff · Exit kiosk</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ---- Sign-up form stage ----
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={bumpIdle}>
        <View style={styles.brandHeader}>
          {storeName ? (
            <Text style={styles.storeName} maxFontSizeMultiplier={2}>
              {storeName}
            </Text>
          ) : null}
          <Text style={styles.title} maxFontSizeMultiplier={2}>
            New Customer Sign-Up
          </Text>
          <Text style={styles.why} maxFontSizeMultiplier={2}>
            Pop your details in below so we can send your receipt and let you
            know about your order. A team member will help you from here.
          </Text>
        </View>

        <KioskField
          label="First name"
          value={values.first_name}
          onChangeText={t => set('first_name', t)}
          onFocus={bumpIdle}
          autoCapitalize="words"
          error={errors.first_name}
        />
        <KioskField
          label="Last name"
          value={values.last_name}
          onChangeText={t => set('last_name', t)}
          onFocus={bumpIdle}
          autoCapitalize="words"
        />
        <KioskField
          label="Mobile"
          value={values.phone}
          onChangeText={t => set('phone', t)}
          onBlur={() => set('phone', formatPhoneOnBlur(values.phone))}
          onFocus={bumpIdle}
          keyboardType="phone-pad"
        />
        <KioskField
          label="Email"
          value={values.email}
          onChangeText={t => set('email', t)}
          onFocus={bumpIdle}
          keyboardType="email-address"
          autoCapitalize="none"
          error={errors.email}
        />
        {errors.contact ? (
          <Text style={styles.contactError} maxFontSizeMultiplier={2}>
            {errors.contact}
          </Text>
        ) : null}

        <TouchableOpacity
          style={styles.consentRow}
          onPress={() => {
            bumpIdle();
            setMarketingOptIn(v => !v);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{checked: marketingOptIn}}
          accessibilityLabel="Keep me posted on offers and updates">
          <View
            style={[styles.checkbox, marketingOptIn && styles.checkboxOn]}>
            {marketingOptIn ? (
              <Icon name="check" size={18} color={COLORS.surface} />
            ) : null}
          </View>
          <Text style={styles.consentText} maxFontSizeMultiplier={2}>
            Yes, keep me posted on offers and updates.
          </Text>
        </TouchableOpacity>

        <Text style={styles.privacy} maxFontSizeMultiplier={2}>
          We'll only use your details to serve you. You can ask our team to
          update or remove them at any time.
        </Text>

        <TouchableOpacity
          style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Save my details">
          {submitting ? (
            <ActivityIndicator color={COLORS.surface} />
          ) : (
            <Text style={styles.saveBtnText} maxFontSizeMultiplier={1.6}>
              Save
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <TouchableOpacity
        style={styles.staffExit}
        onPress={goExit}
        accessibilityRole="button"
        accessibilityLabel="Staff: exit kiosk">
        <Text style={styles.staffExitText}>Staff · Exit kiosk</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

// Large, label-above input with autofill/autocorrect disabled. Honours the
// device font-scale (public surface — an older customer needs big text), so
// no maxFontSizeMultiplier cap on the input itself.
const KioskField: React.FC<{
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'words';
  error?: string;
}> = ({
  label,
  value,
  onChangeText,
  onFocus,
  onBlur,
  keyboardType = 'default',
  autoCapitalize = 'none',
  error,
}) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel} maxFontSizeMultiplier={2}>
      {label}
    </Text>
    <TextInput
      style={[styles.input, error ? styles.inputError : null]}
      value={value}
      onChangeText={onChangeText}
      onFocus={onFocus}
      onBlur={onBlur}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      returnKeyType="next"
      {...PRIVATE_INPUT_PROPS}
    />
    {error ? (
      <Text style={styles.fieldError} maxFontSizeMultiplier={2}>
        {error}
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.background},
  pinRoot: {flex: 1, backgroundColor: COLORS.navy},
  scroll: {padding: SPACING.lg, paddingBottom: SPACING.xl * 2},
  brandHeader: {alignItems: 'center', marginBottom: SPACING.xl},
  storeName: {
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    color: COLORS.crimson,
    textAlign: 'center',
  },
  title: {
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.semibold,
    color: COLORS.navy,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  why: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
    lineHeight: 22,
  },
  field: {marginBottom: SPACING.lg},
  fieldLabel: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    color: COLORS.navy,
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md + 4,
    fontSize: FONT_SIZE.lg,
    color: COLORS.text,
    minHeight: 56,
  },
  inputError: {borderColor: COLORS.danger},
  fieldError: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.danger,
    marginTop: SPACING.xs,
  },
  contactError: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.danger,
    marginBottom: SPACING.md,
    marginTop: -SPACING.sm,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 2,
    borderColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  checkboxOn: {backgroundColor: COLORS.crimson, borderColor: COLORS.crimson},
  consentText: {flex: 1, fontSize: FONT_SIZE.md, color: COLORS.text},
  privacy: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textLight,
    lineHeight: 18,
    marginBottom: SPACING.xl,
  },
  saveBtn: {
    backgroundColor: COLORS.crimson,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md + 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
  },
  saveBtnDisabled: {opacity: 0.6},
  saveBtnText: {
    color: COLORS.surface,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.semibold,
  },
  staffExit: {
    position: 'absolute',
    bottom: SPACING.md,
    right: SPACING.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    opacity: 0.5,
  },
  staffExitText: {fontSize: FONT_SIZE.xs, color: COLORS.textDim},
  thanksWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl},
  thanksBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.success ?? COLORS.crimson,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  thanksTitle: {
    fontSize: FONT_SIZE.xxl ?? FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    color: COLORS.navy,
    textAlign: 'center',
  },
  thanksBody: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
    lineHeight: 24,
  },
});

export default KioskSignupScreen;
