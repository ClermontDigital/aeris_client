import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  ICON_SIZE,
} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import EyebrowLabel from '../components/EyebrowLabel';
import PillButton from '../components/PillButton';
import ErrorBanner from '../components/ErrorBanner';
import Icon from '../components/Icon';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useCartStore} from '../stores/cartStore';
import {useHeaderBackStore} from '../stores/headerBackStore';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import type {Customer, CustomerCreateInput} from '../types/api.types';
import type {
  CustomersStackParamList,
  QuickSaleStackParamList,
} from '../types/navigation.types';
import {
  EMPTY_FORM,
  validateCustomerForm,
  customerToFormValues,
  formToCreateInput,
  formatPhoneOnBlur,
  type CustomerFormValues,
  type CustomerFormErrors,
} from '../utils/customerForm';

// CustomerEditScreen is registered in both CustomersStack and
// QuickSaleStack — each tab owns its own stack history so a cashier
// creating a customer mid-sale doesn't ping-pong tabs on Save. The
// route prop is therefore a union of the two stack types; the screen
// only reads {customerId?, returnTo?} which lives on both shapes.
type EditRoute = RouteProp<
  CustomersStackParamList & QuickSaleStackParamList,
  'CustomerEdit'
>;
type EditNav = NativeStackNavigationProp<
  CustomersStackParamList & QuickSaleStackParamList,
  'CustomerEdit'
>;

// Form validation + form↔wire shaping now live in utils/customerForm — a
// single source of truth shared with the kiosk self-signup, so the server's
// "first_name OR company" rule and the empty-address omission can't drift
// between the two screens. Re-exported here so existing importers (the
// unit-level form-validation test) keep resolving them from this module.
export {
  validateCustomerForm,
  customerToFormValues,
  formToCreateInput,
  formatPhoneOnBlur,
};
export type {CustomerFormValues, CustomerFormErrors};

const CustomerEditScreen: React.FC = () => {
  const navigation = useNavigation<EditNav>();
  const route = useRoute<EditRoute>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
  const setCartCustomer = useCartStore(state => state.setCustomer);

  const customerId = route.params?.customerId;
  const returnTo = route.params?.returnTo;
  const isEdit = typeof customerId === 'number';

  const [values, setValues] = useState<CustomerFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<CustomerFormErrors>({});
  const [showAddress, setShowAddress] = useState(false);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // Synchronous double-tap guards. `setIsSubmitting`/`setIsDeleting` are
  // async — a 60Hz double-tap inside the same render frame can fire two
  // API calls. The refs flip before any await. Mirrors CheckoutScreen's
  // submitLockRef pattern. Alert's destructive button stays tappable
  // during the dismiss animation, so the delete lock matters as much as
  // the save lock.
  const submitLockRef = useRef(false);
  const deleteLockRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing customer in edit mode. We deliberately don't use
  // useFocusEffect here — the form is single-shot, the user backs out
  // when they're done. Re-fetching on focus would clobber unsaved edits.
  useEffect(() => {
    if (!isEdit || customerId === undefined) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    ApiClient.getCustomerDetail(customerId)
      .then(c => {
        if (cancelled) return;
        if (c) {
          setValues(customerToFormValues(c));
          // If the loaded customer already has an address, expand the
          // group so the user sees what's there.
          if (c.default_address) setShowAddress(true);
        } else {
          setError('Customer not found');
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load customer');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, customerId]);

  // This screen renders its own in-content Back (headerRow), so clear the
  // shared brand-header chrome back that CustomerDetail set on its way in —
  // otherwise both render and the user sees two "Back" buttons.
  useFocusEffect(
    useCallback(() => {
      useHeaderBackStore.getState().clearOnBack();
      return undefined;
    }, []),
  );

  const setField = useCallback(
    <K extends keyof CustomerFormValues>(
      key: K,
      value: CustomerFormValues[K],
    ) => {
      setValues(prev => ({...prev, [key]: value}));
      // Clear field-level error as soon as the user edits the field.
      setErrors(prev => {
        if (!(key in prev)) return prev;
        const next = {...prev};
        delete (next as Record<string, string>)[key as string];
        return next;
      });
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (submitLockRef.current) return;
    const validation = validateCustomerForm(values);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      haptics.error();
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(null);
    // BLOCKER-2 (§19.2 rule 1): a customer create/update is an open account
    // write — defer any auto-failover swap until it completes (don't drop it
    // mid-POST).
    useTransactionActivityStore.getState().setAccountWriteInFlight(true);
    try {
      const payload = formToCreateInput(values);
      if (isEdit && customerId !== undefined) {
        await ApiClient.updateCustomer(customerId, payload);
        haptics.success();
        navigation.goBack();
      } else {
        const created = await ApiClient.createCustomer(payload);
        haptics.success();
        // Picker flow: drop the freshly-created customer onto the cart
        // and pop back past the picker so the cashier lands on Cart.
        if (returnTo === 'CustomerPicker') {
          setCartCustomer(created.id, created.name || '(unnamed)');
          // pop the edit screen + the picker beneath it
          if (typeof navigation.pop === 'function') {
            navigation.pop(2);
          } else {
            navigation.goBack();
            navigation.goBack();
          }
        } else {
          navigation.goBack();
        }
      }
    } catch (e: unknown) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Failed to save customer');
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
      useTransactionActivityStore.getState().setAccountWriteInFlight(false);
    }
  }, [
    values,
    isEdit,
    customerId,
    returnTo,
    navigation,
    haptics,
    setCartCustomer,
  ]);

  const handleDelete = useCallback(() => {
    if (!isEdit || customerId === undefined) return;
    Alert.alert(
      'Delete customer?',
      'This will permanently remove the customer and their contact details. Recent sales stay attached to the receipt history.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Alert's destructive button stays tappable during the
            // dismiss animation; rapid double-tap queues two delete
            // calls without this synchronous guard.
            if (deleteLockRef.current) return;
            deleteLockRef.current = true;
            setIsDeleting(true);
            setError(null);
            // BLOCKER-2 (§19.2 rule 1): a customer delete is an open account
            // write — defer any auto-failover swap until it completes.
            useTransactionActivityStore
              .getState()
              .setAccountWriteInFlight(true);
            try {
              await ApiClient.deleteCustomer(customerId);
              haptics.success();
              // popToTop lands the cashier back on CustomersList with a
              // fresh useFocusEffect refresh — the deleted row drops
              // out automatically.
              if (typeof navigation.popToTop === 'function') {
                navigation.popToTop();
              } else {
                navigation.goBack();
              }
            } catch (e: unknown) {
              haptics.error();
              setError(
                e instanceof Error ? e.message : 'Failed to delete customer',
              );
            } finally {
              setIsDeleting(false);
              deleteLockRef.current = false;
              useTransactionActivityStore
                .getState()
                .setAccountWriteInFlight(false);
            }
          },
        },
      ],
    );
  }, [isEdit, customerId, navigation, haptics]);

  const submitLabel = useMemo(
    () => (isEdit ? 'Save changes' : 'Save customer'),
    [isEdit],
  );
  // Disabled-until-name-filled per the spec. We mirror the validation
  // OR-clause: company alone is also enough.
  const canSubmit =
    (values.first_name.trim().length > 0 || values.company.trim().length > 0) &&
    !isSubmitting &&
    !isDeleting;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        {/* Keep a Back during the edit-mode fetch — this screen clears the
            shared chrome back on focus, so the loading window would otherwise
            have no way out. */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel and go back"
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
            style={styles.backTap}>
            <Icon
              name="chevron-back"
              size={ICON_SIZE.hero}
              color={COLORS.navy}
            />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.scroll, tabletColumnCap]}
          keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => {
                haptics.light();
                navigation.goBack();
              }}
              accessibilityRole="button"
              accessibilityLabel="Cancel and go back"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
              style={styles.backTap}>
              <Icon
                name="chevron-back"
                size={ICON_SIZE.hero}
                color={COLORS.navy}
              />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>
            {isEdit ? 'Edit customer' : 'New customer'}
          </Text>

          {error ? (
            <View style={styles.bannerWrap}>
              <ErrorBanner
                message={error}
                onRetry={handleSubmit}
                onDismiss={() => setError(null)}
              />
            </View>
          ) : null}

          <EyebrowLabel>Customer details</EyebrowLabel>
          <FormField
            label="First name"
            value={values.first_name}
            onChangeText={t => setField('first_name', t)}
            placeholder="Ada"
            autoCapitalize="words"
            required
            error={errors.first_name}
            testID="customer-edit-first-name"
          />
          <FormField
            label="Last name"
            value={values.last_name}
            onChangeText={t => setField('last_name', t)}
            placeholder="Lovelace"
            autoCapitalize="words"
          />
          <FormField
            label="Company"
            value={values.company}
            onChangeText={t => setField('company', t)}
            placeholder="Optional"
            autoCapitalize="words"
            hint="First name or company is required"
          />
          <FormField
            label="Email"
            value={values.email}
            onChangeText={t => setField('email', t)}
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            error={errors.email}
            testID="customer-edit-email"
          />
          <FormField
            label="Phone"
            value={values.phone}
            onChangeText={t => setField('phone', t)}
            onBlur={() =>
              setField('phone', formatPhoneOnBlur(values.phone))
            }
            placeholder="+61 …"
            keyboardType="phone-pad"
          />
          <FormField
            label="Notes"
            value={values.notes}
            onChangeText={t => setField('notes', t)}
            placeholder="Preferences, allergies, anything worth remembering"
            multiline
          />

          <TouchableOpacity
            style={styles.disclosureRow}
            activeOpacity={0.7}
            onPress={() => {
              haptics.light();
              setShowAddress(v => !v);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              showAddress ? 'Hide address fields' : 'Add address'
            }
            accessibilityState={{expanded: showAddress}}>
            <Icon
              name={showAddress ? 'chevron-down' : 'plus'}
              size={ICON_SIZE.action}
              color={COLORS.navy}
            />
            <Text style={styles.disclosureText}>
              {showAddress ? 'Address (optional)' : 'Add address'}
            </Text>
          </TouchableOpacity>

          {showAddress ? (
            <View style={styles.addressGroup}>
              <EyebrowLabel>Address (optional)</EyebrowLabel>
              <FormField
                label="Street address"
                value={values.address}
                onChangeText={t => setField('address', t)}
                placeholder="123 Example St"
                autoCapitalize="words"
              />
              <FormField
                label="Address line 2"
                value={values.address_line_2}
                onChangeText={t => setField('address_line_2', t)}
                placeholder="Unit, suite, etc."
                autoCapitalize="words"
              />
              <FormField
                label="City"
                value={values.city}
                onChangeText={t => setField('city', t)}
                placeholder="Brisbane"
                autoCapitalize="words"
              />
              <FormField
                label="State"
                value={values.state}
                onChangeText={t => setField('state', t)}
                placeholder="QLD"
                autoCapitalize="characters"
              />
              <FormField
                label="Postcode"
                value={values.postcode}
                onChangeText={t => setField('postcode', t)}
                placeholder="4000"
                keyboardType="number-pad"
              />
              <FormField
                label="Country"
                value={values.country}
                onChangeText={t => setField('country', t)}
                placeholder="Australia"
                autoCapitalize="words"
              />
            </View>
          ) : null}

          <View style={styles.submitWrap}>
            <PillButton
              label={isSubmitting ? 'Saving…' : submitLabel}
              variant="solid"
              onPress={handleSubmit}
              disabled={!canSubmit}
              accessibilityLabel={submitLabel}
            />
          </View>

          {isEdit ? (
            <View style={styles.deleteWrap}>
              <PillButton
                label={isDeleting ? 'Deleting…' : 'Delete customer'}
                variant="destructive"
                onPress={handleDelete}
                disabled={isSubmitting || isDeleting}
                icon="trash"
                accessibilityLabel="Delete customer"
              />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  testID?: string;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  required,
  error,
  hint,
  multiline,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  testID,
}) => {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          error && styles.inputError,
        ]}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={COLORS.inputPlaceholder}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        accessibilityLabel={label}
        accessibilityHint={hint}
        testID={testID}
      />
      {error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  flex: {flex: 1},
  scroll: {padding: SPACING.md, paddingBottom: SPACING.xxl},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  backTap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: SPACING.xs,
    paddingRight: SPACING.sm,
  },
  backText: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginLeft: SPACING.xs,
  },
  title: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: -0.3,
    marginBottom: SPACING.md,
  },
  bannerWrap: {marginBottom: SPACING.md},
  fieldWrap: {marginBottom: SPACING.md},
  fieldLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.xs,
  },
  required: {color: COLORS.crimson},
  input: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    minHeight: 44, // 44pt tap target
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: COLORS.danger,
  },
  fieldError: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.xs,
  },
  fieldHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.regular,
    marginTop: SPACING.xs,
  },
  disclosureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  disclosureText: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
    marginLeft: SPACING.sm,
  },
  addressGroup: {
    marginBottom: SPACING.sm,
  },
  submitWrap: {
    marginTop: SPACING.lg,
  },
  deleteWrap: {
    marginTop: SPACING.lg,
    paddingTop: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
});

export default CustomerEditScreen;
