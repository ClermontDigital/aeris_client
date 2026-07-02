import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import EyebrowLabel from '../components/EyebrowLabel';
import PillButton from '../components/PillButton';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useAuthStore} from '../stores/authStore';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';
import type {
  Customer,
  RepairCreateInput,
  RepairDetail,
  RepairPriority,
  RepairUpdateInput,
} from '../types/api.types';
import type {RepairsStackParamList} from '../types/navigation.types';
import {
  BORDER_RADIUS,
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  ICON_SIZE,
  SPACING,
} from '../constants/theme';

type Nav = NativeStackNavigationProp<RepairsStackParamList, 'RepairEdit'>;
type EditRoute = RouteProp<RepairsStackParamList, 'RepairEdit'>;

// Server-side priority enum. Kept as a local const array so the picker
// renders in a stable operator-friendly order (low → normal → high →
// urgent) rather than whatever alphabetical order the type union
// produces. Values match RepairPriority literals on the wire.
const PRIORITY_OPTIONS: {value: RepairPriority; label: string}[] = [
  {value: 'low', label: 'Low'},
  {value: 'normal', label: 'Normal'},
  {value: 'high', label: 'High'},
  {value: 'urgent', label: 'Urgent'},
];

// Debounce interval for customer typeahead. Mirrors CustomerPickerScreen's
// search debounce so the two feel consistent to the cashier.
const CUSTOMER_SEARCH_DEBOUNCE_MS = 300;

// Basic ISO-date shape check. The wire accepts either YYYY-MM-DD or a full
// ISO datetime, but the free-text input in this screen is intentionally
// scoped to YYYY-MM-DD for readability; a proper date picker is future
// polish. We surface a friendly inline error rather than let the server
// 422 with a "not a valid date" message.
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Local form shape - all strings so RN inputs bind directly. Cast happens
// at submit-time in buildCreatePayload / buildUpdatePayload.
export interface RepairFormValues {
  customerId: number | null;
  customerLabel: string;
  device_type: string;
  brand: string;
  model: string;
  serial_number: string;
  issue_description: string;
  diagnosis: string;
  notes: string;
  priority: RepairPriority;
  estimated_cost: string;
  estimated_completion: string;
}

// Field-error map. Keys match the wire attribute names the server 422s on
// so the server-error parser (parseServerFieldErrors) can drop values in
// without a translation table.
export interface RepairFormErrors {
  customer_id?: string;
  device_type?: string;
  brand?: string;
  model?: string;
  serial_number?: string;
  issue_description?: string;
  diagnosis?: string;
  notes?: string;
  priority?: string;
  estimated_cost?: string;
  estimated_completion?: string;
  // Surfaced when the current user has no location_id assigned (blocks
  // create) or when the server 422s on the location_id field.
  location_id?: string;
}

const EMPTY_FORM: RepairFormValues = {
  customerId: null,
  customerLabel: '',
  device_type: '',
  brand: '',
  model: '',
  serial_number: '',
  issue_description: '',
  diagnosis: '',
  notes: '',
  priority: 'normal',
  estimated_cost: '',
  estimated_completion: '',
};

// Pure helpers - exported for unit testing without mounting the RN tree.

// Dollar-string → number. Empty / whitespace / NaN all coerce to null so
// the payload omits the field entirely (matches the RepairCreateInput
// optional-null contract). Wire is dollars; NO cents conversion.
export function parseDollars(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed);
  if (Number.isNaN(n) || !Number.isFinite(n) || n < 0) return null;
  return n;
}

export function validateRepairForm(
  values: RepairFormValues,
  isEdit: boolean,
): RepairFormErrors {
  const errors: RepairFormErrors = {};
  // Customer is server-locked after create; only enforce in create mode.
  if (!isEdit && values.customerId == null) {
    errors.customer_id = 'Select a customer';
  }
  if (!values.issue_description.trim()) {
    errors.issue_description = 'Describe the issue';
  }
  const cost = values.estimated_cost.trim();
  if (cost) {
    const n = Number.parseFloat(cost);
    if (Number.isNaN(n) || !Number.isFinite(n) || n < 0) {
      errors.estimated_cost = 'Enter a valid amount';
    }
  }
  const eta = values.estimated_completion.trim();
  if (eta && !ISO_DATE_REGEX.test(eta)) {
    errors.estimated_completion = 'Use YYYY-MM-DD';
  }
  return errors;
}

export function repairDetailToFormValues(r: RepairDetail): RepairFormValues {
  return {
    customerId: r.customer_id,
    customerLabel: r.customer?.name ?? r.customer_name ?? '',
    device_type: r.device_type ?? '',
    brand: r.brand ?? '',
    model: r.model ?? '',
    serial_number: r.serial_number ?? '',
    issue_description: r.issue_description ?? '',
    diagnosis: r.diagnosis ?? '',
    notes: r.notes ?? '',
    priority: r.priority || 'normal',
    estimated_cost:
      r.estimated_cost == null ? '' : r.estimated_cost.toFixed(2),
    estimated_completion: r.estimated_completion
      ? r.estimated_completion.slice(0, 10)
      : '',
  };
}

// Trim + treat empty as absent. The server accepts null OR absent
// identically, so we send null to keep the payload shape explicit.
function optStr(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

// buildCreatePayload takes the current user's `locationId` as a required
// second argument (rather than reading the store from inside a pure helper)
// so this function stays trivially unit-testable. The server's
// StoreRepairRequest declares `location_id => required|exists:locations,id`
// (see the RepairCreateInput doc-comment for the H1 background); the caller
// (handleSubmit) sources locationId from `useAuthStore(s => s.user?.location_id)`
// and MUST block submit when it's null.
export function buildCreatePayload(
  values: RepairFormValues,
  locationId: number,
): RepairCreateInput {
  if (values.customerId == null) {
    // Caller has already validated; belt-and-braces so the type narrows.
    throw new Error('customer_id is required');
  }
  const out: RepairCreateInput = {
    customer_id: values.customerId,
    location_id: locationId,
    issue_description: values.issue_description.trim(),
    device_type: optStr(values.device_type),
    brand: optStr(values.brand),
    model: optStr(values.model),
    serial_number: optStr(values.serial_number),
    diagnosis: optStr(values.diagnosis),
    notes: optStr(values.notes),
    priority: values.priority,
    estimated_cost: parseDollars(values.estimated_cost),
    estimated_completion: optStr(values.estimated_completion),
  };
  return out;
}

export function buildUpdatePayload(
  values: RepairFormValues,
): RepairUpdateInput {
  const out: RepairUpdateInput = {
    issue_description: values.issue_description.trim(),
    device_type: optStr(values.device_type),
    brand: optStr(values.brand),
    model: optStr(values.model),
    serial_number: optStr(values.serial_number),
    diagnosis: optStr(values.diagnosis),
    notes: optStr(values.notes),
    priority: values.priority,
    estimated_cost: parseDollars(values.estimated_cost),
    estimated_completion: optStr(values.estimated_completion),
  };
  return out;
}

// Best-effort server-error parser. RelayError only exposes {code, message};
// Aeris2 422s frequently pack the field-name into the message tail - we
// scan for known attribute names as a substring match. Anything we can't
// map lands in a top-level banner (non-field error).
export function parseServerFieldErrors(err: unknown): RepairFormErrors {
  if (!err || typeof err !== 'object') return {};
  const msg = String((err as {message?: unknown}).message ?? '').toLowerCase();
  if (!msg) return {};
  const out: RepairFormErrors = {};
  // Try a JSON tail first - Direct-mode errors carry `{errors: {field: [..]}}`
  // per Laravel's standard 422 body. We look for the leading brace after
  // the standard "Request failed (422): " prefix.
  const braceIdx = msg.indexOf('{');
  if (braceIdx >= 0) {
    try {
      const tail = String((err as {message?: unknown}).message ?? '').slice(
        braceIdx,
      );
      const parsed = JSON.parse(tail) as {
        errors?: Record<string, string[] | string>;
      };
      if (parsed?.errors && typeof parsed.errors === 'object') {
        for (const [k, v] of Object.entries(parsed.errors)) {
          const first = Array.isArray(v) ? v[0] : v;
          if (typeof first !== 'string') continue;
          if (k === 'customer_id') out.customer_id = first;
          else if (k === 'issue_description') out.issue_description = first;
          else if (k === 'device_type') out.device_type = first;
          else if (k === 'brand') out.brand = first;
          else if (k === 'model') out.model = first;
          else if (k === 'serial_number') out.serial_number = first;
          else if (k === 'diagnosis') out.diagnosis = first;
          else if (k === 'notes') out.notes = first;
          else if (k === 'priority') out.priority = first;
          else if (k === 'estimated_cost') out.estimated_cost = first;
          else if (k === 'estimated_completion')
            out.estimated_completion = first;
          else if (k === 'location_id') out.location_id = first;
        }
        if (Object.keys(out).length > 0) return out;
      }
    } catch {
      // Not JSON - fall through to substring scanning.
    }
  }
  // Substring scan fallback - a message like "The issue description field
  // is required." should still route to issue_description.
  if (msg.includes('customer')) out.customer_id = 'Select a customer';
  if (msg.includes('issue') || msg.includes('description'))
    out.issue_description = 'Describe the issue';
  if (msg.includes('estimated cost') || msg.includes('estimated_cost'))
    out.estimated_cost = 'Invalid amount';
  if (msg.includes('completion') || msg.includes('estimated_completion'))
    out.estimated_completion = 'Invalid date';
  if (msg.includes('location'))
    out.location_id =
      'Your account has no location assigned - contact your administrator';
  return out;
}

const RepairEditScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<EditRoute>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;

  const repairId = route.params?.id;
  const isEdit = typeof repairId === 'number';

  // ---------------- state (all hooks live ABOVE early-return guards per
  // feedback_hooks_above_early_returns). ----------------
  // H1 fix: source location_id from the signed-in user's assigned deployment
  // site. Server StoreRepairRequest declares location_id required, so a null
  // here MUST block Save in create mode. Edit mode never sends location_id
  // (server-locked after create), so a null user.location_id there is fine.
  const userLocationId = useAuthStore(s => s.user?.location_id ?? null);
  const [values, setValues] = useState<RepairFormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<RepairFormErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(isEdit);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [priorityPickerOpen, setPriorityPickerOpen] = useState(false);

  // Customer picker state (create mode only).
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);

  // Dirty flag drives the discard-confirm on Back. Any setField call flips
  // this ref; save clears it. Kept as ref so the Alert closure sees the
  // latest value without a stale-capture bug.
  const dirtyRef = useRef(false);

  // Synchronous double-tap guard for Save (mirrors CustomerEditScreen's
  // submitLockRef pattern - setIsSubmitting is async and a 60Hz double-tap
  // can fire two calls before the render lands).
  const submitLockRef = useRef(false);

  // ---------------- workspace-flag mount guard (T6-parity) ----------------
  useEffect(() => {
    if (!useWorkspaceFeaturesStore.getState().repairs_enabled) {
      Alert.alert('Repairs', 'Repairs are not enabled for this site.');
      navigation.goBack();
    }
    // Mount-only; a mid-session flag flip is handled by the tab conditional
    // in AppTabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- edit-mode: hydrate the form from getRepairDetail -----
  useEffect(() => {
    if (!isEdit || repairId === undefined) return;
    // Orphan-fetch guard mirrors RepairDetailScreen: if the mount-guard
    // bounce is in flight, don't kick off a getRepairDetail that would
    // race the goBack and produce a spurious REPAIRS_DISABLED toast.
    if (!useWorkspaceFeaturesStore.getState().repairs_enabled) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setTopError(null);
    setNotFound(false);
    ApiClient.getRepairDetail(repairId)
      .then(detail => {
        if (cancelled) return;
        if (detail == null) {
          setNotFound(true);
        } else {
          const next = repairDetailToFormValues(detail);
          setValues(next);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setTopError(
          e instanceof Error ? e.message : 'Failed to load repair',
        );
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, repairId]);

  // ---------------- form field setter ----------------
  const setField = useCallback(
    <K extends keyof RepairFormValues>(
      key: K,
      value: RepairFormValues[K],
    ) => {
      dirtyRef.current = true;
      setValues(prev => ({...prev, [key]: value}));
      // Clear field-level error for the touched key. Keeping the wire
      // attribute name and the form key aligned means we can do a direct
      // delete without a translation table.
      setFieldErrors(prev => {
        const k = key as string;
        if (!(k in prev)) return prev;
        const next = {...prev};
        delete (next as Record<string, string>)[k];
        return next;
      });
    },
    [],
  );

  // ---------------- customer typeahead (create mode) ----------------
  // Debounce the search: fire ONE request per pause rather than one per
  // keystroke. Empty query short-circuits to the empty result set so the
  // picker collapses cleanly.
  useEffect(() => {
    if (isEdit) return;
    const q = customerSearchQuery.trim();
    if (!q) {
      setCustomerResults([]);
      setCustomerSearching(false);
      return;
    }
    let cancelled = false;
    setCustomerSearching(true);
    const timer = setTimeout(() => {
      ApiClient.searchCustomers(q, 1)
        .then(res => {
          if (cancelled) return;
          setCustomerResults(res.data ?? []);
        })
        .catch(() => {
          if (cancelled) return;
          // Search errors are non-blocking: an empty list + retry-on-next-
          // keystroke is friendlier than a modal.
          setCustomerResults([]);
        })
        .finally(() => {
          if (cancelled) return;
          setCustomerSearching(false);
        });
    }, CUSTOMER_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerSearchQuery, isEdit]);

  const selectCustomer = useCallback(
    (c: Customer) => {
      haptics.selection();
      dirtyRef.current = true;
      setValues(prev => ({
        ...prev,
        customerId: c.id,
        customerLabel: c.name || c.company || '(unnamed)',
      }));
      setFieldErrors(prev => {
        if (!('customer_id' in prev)) return prev;
        const next = {...prev};
        delete next.customer_id;
        return next;
      });
      setCustomerPickerOpen(false);
      setCustomerSearchQuery('');
      setCustomerResults([]);
    },
    [haptics],
  );

  const clearCustomer = useCallback(() => {
    haptics.light();
    dirtyRef.current = true;
    setValues(prev => ({...prev, customerId: null, customerLabel: ''}));
  }, [haptics]);

  const selectPriority = useCallback(
    (p: RepairPriority) => {
      haptics.selection();
      setField('priority', p);
      setPriorityPickerOpen(false);
    },
    [setField],
  );

  // ---------------- submit ----------------
  const handleSubmit = useCallback(async () => {
    if (submitLockRef.current) return;
    const errs = validateRepairForm(values, isEdit);
    // H1 guard: create mode requires the current user's location_id.
    // The server StoreRepairRequest rejects a missing/invalid location_id
    // with 422; we short-circuit here with an inline banner so cashiers
    // whose account is missing a location assignment get a clear message
    // rather than a cryptic server error tail.
    if (!isEdit && userLocationId == null) {
      errs.location_id =
        'Your account has no location assigned - contact your administrator';
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      haptics.error();
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    setTopError(null);
    try {
      if (isEdit && repairId !== undefined) {
        const payload = buildUpdatePayload(values);
        await ApiClient.updateRepair(repairId, payload);
        haptics.success();
        dirtyRef.current = false;
        // RepairDetailScreen refetches on focus (T6), so goBack is enough.
        navigation.goBack();
      } else {
        // userLocationId is non-null here: the guard above blocks submit
        // when it's null. The `!` is safe.
        const payload = buildCreatePayload(values, userLocationId!);
        const created = await ApiClient.createRepair(payload);
        haptics.success();
        dirtyRef.current = false;
        // Replace so a Back tap doesn't drop the cashier onto a dead
        // create form with a stale customer selection.
        navigation.replace('RepairDetail', {id: created.id});
      }
    } catch (e: unknown) {
      haptics.error();
      const parsed = parseServerFieldErrors(e);
      if (Object.keys(parsed).length > 0) {
        setFieldErrors(prev => ({...prev, ...parsed}));
      } else {
        setTopError(
          e instanceof Error ? e.message : 'Failed to save repair',
        );
      }
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  }, [values, isEdit, repairId, haptics, navigation, userLocationId]);

  // ---------------- discard-confirm on Back ----------------
  // Three-way confirm mirrors the spec: Discard / Keep editing / Save. Save
  // routes back through handleSubmit which will surface field errors inline
  // if validation fails (rather than a silent no-op).
  const promptDiscard = useCallback(
    (onDiscard: () => void) => {
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes. What would you like to do?',
        [
          {text: 'Keep editing', style: 'cancel'},
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              dirtyRef.current = false;
              onDiscard();
            },
          },
          {
            text: 'Save',
            onPress: () => {
              void handleSubmit();
            },
          },
        ],
      );
    },
    [handleSubmit],
  );

  const handleBack = useCallback(() => {
    if (!dirtyRef.current) {
      haptics.light();
      navigation.goBack();
      return;
    }
    promptDiscard(() => navigation.goBack());
  }, [navigation, haptics, promptDiscard]);

  // Catch swipe-back / hardware-back / parent-nav-driven removals. The
  // header Back button routes through handleBack directly, but iOS edge
  // swipe and Android hardware back both bypass it - beforeRemove intercepts
  // those so the discard-confirm actually fires. dispatch(e.data.action)
  // replays the original removal so 'Discard' cleanly navigates back.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', e => {
      if (!dirtyRef.current || isSubmitting) return;
      e.preventDefault();
      promptDiscard(() => navigation.dispatch(e.data.action));
    });
    return sub;
  }, [navigation, isSubmitting, promptDiscard]);

  // ---------------- derived (memoised above early-returns) ----------------
  const canSubmit = useMemo(() => {
    if (isSubmitting) return false;
    if (!values.issue_description.trim()) return false;
    if (!isEdit && values.customerId == null) return false;
    return true;
  }, [
    isSubmitting,
    values.issue_description,
    values.customerId,
    isEdit,
  ]);

  const priorityLabel = useMemo(
    () =>
      PRIORITY_OPTIONS.find(p => p.value === values.priority)?.label ??
      'Normal',
    [values.priority],
  );

  // ---------------- early-return guards -----------------------------------
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.loadingText}>Loading repair…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (notFound) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <EmptyState
          icon="construct-outline"
          title="Repair not found"
          description="Repair not found or was deleted"
          action={{
            label: 'Back',
            onPress: () => {
              haptics.light();
              navigation.goBack();
            },
          }}
        />
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
          {/* Header: Back on the left, Save on the right, title beneath. */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
              style={styles.backTap}>
              <Icon
                name="chevron-back"
                size={ICON_SIZE.hero}
                color={COLORS.navy}
              />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <PillButton
              label={isSubmitting ? 'Saving…' : 'Save'}
              variant="solid"
              onPress={handleSubmit}
              disabled={!canSubmit}
              accessibilityLabel={
                isEdit ? 'Save changes' : 'Save new repair'
              }
            />
          </View>
          <Text style={styles.title}>
            {isEdit ? 'Edit repair' : 'New repair'}
          </Text>

          {topError ? (
            <View style={styles.bannerWrap}>
              <ErrorBanner
                message={topError}
                onDismiss={() => setTopError(null)}
              />
            </View>
          ) : null}

          {/* H1: location_id is required by the server; surface a top-level
              banner rather than an inline field error because there is no
              user-facing location picker on this screen. */}
          {fieldErrors.location_id ? (
            <View style={styles.bannerWrap}>
              <ErrorBanner
                message={fieldErrors.location_id}
                onDismiss={() =>
                  setFieldErrors(prev => {
                    const next = {...prev};
                    delete next.location_id;
                    return next;
                  })
                }
              />
            </View>
          ) : null}

          {/* -------- Customer -------- */}
          <EyebrowLabel>Customer</EyebrowLabel>
          {isEdit ? (
            <View style={styles.readonlyChip}>
              <Icon
                name="person-outline"
                size={ICON_SIZE.action}
                color={COLORS.textMuted}
                style={styles.readonlyChipIcon}
              />
              <Text style={styles.readonlyChipText} numberOfLines={1}>
                {values.customerLabel || 'Unknown customer'}
              </Text>
              <Text style={styles.readonlyChipHint}>Locked</Text>
            </View>
          ) : (
            <View style={styles.fieldWrap}>
              {values.customerId != null ? (
                <View style={styles.selectedCustomerRow}>
                  <Text style={styles.selectedCustomerText}>
                    {values.customerLabel}
                  </Text>
                  <TouchableOpacity
                    onPress={clearCustomer}
                    accessibilityRole="button"
                    accessibilityLabel="Change customer">
                    <Text style={styles.changeLink}>Change</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={[
                      styles.input,
                      styles.pickerRow,
                      fieldErrors.customer_id ? styles.inputError : null,
                    ]}
                    onPress={() => {
                      haptics.light();
                      setCustomerPickerOpen(v => !v);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Select customer"
                    accessibilityState={{expanded: customerPickerOpen}}>
                    <Text style={styles.pickerRowText}>
                      {customerPickerOpen
                        ? 'Type to search customers'
                        : 'Select a customer'}
                    </Text>
                    <Icon
                      name={
                        customerPickerOpen ? 'chevron-down' : 'chevron-forward'
                      }
                      size={ICON_SIZE.action}
                      color={COLORS.textMuted}
                    />
                  </TouchableOpacity>
                  {customerPickerOpen ? (
                    <View style={styles.pickerList}>
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search by name, company, email…"
                        placeholderTextColor={COLORS.inputPlaceholder}
                        value={customerSearchQuery}
                        onChangeText={setCustomerSearchQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel="Customer search"
                        testID="repair-edit-customer-search"
                      />
                      {customerSearching ? (
                        <View style={styles.searchStatusRow}>
                          <ActivityIndicator
                            color={COLORS.accent}
                            size="small"
                          />
                          <Text style={styles.searchStatusText}>Searching…</Text>
                        </View>
                      ) : null}
                      {!customerSearching && customerResults.length === 0 &&
                      customerSearchQuery.trim().length > 0 ? (
                        <Text style={styles.searchEmptyText}>
                          No customers found
                        </Text>
                      ) : null}
                      {customerResults.map(c => (
                        <TouchableOpacity
                          key={c.id}
                          style={styles.pickerItem}
                          onPress={() => selectCustomer(c)}
                          accessibilityRole="button"
                          accessibilityLabel={`Select customer ${c.name}`}>
                          <Text style={styles.pickerItemText} numberOfLines={1}>
                            {c.name || c.company || '(unnamed)'}
                          </Text>
                          {c.email ? (
                            <Text
                              style={styles.pickerItemMeta}
                              numberOfLines={1}>
                              {c.email}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </>
              )}
              {fieldErrors.customer_id ? (
                <Text style={styles.fieldError}>
                  {fieldErrors.customer_id}
                </Text>
              ) : null}
            </View>
          )}

          {/* -------- Device -------- */}
          <EyebrowLabel>Device</EyebrowLabel>
          <FormField
            label="Device type"
            value={values.device_type}
            onChangeText={t => setField('device_type', t)}
            placeholder="Phone, laptop, watch…"
            autoCapitalize="sentences"
            error={fieldErrors.device_type}
          />
          <FormField
            label="Brand"
            value={values.brand}
            onChangeText={t => setField('brand', t)}
            placeholder="Apple, Samsung, HP…"
            autoCapitalize="words"
            error={fieldErrors.brand}
          />
          <FormField
            label="Model"
            value={values.model}
            onChangeText={t => setField('model', t)}
            placeholder="iPhone 13, Galaxy S22…"
            autoCapitalize="sentences"
            error={fieldErrors.model}
          />
          <FormField
            label="Serial number"
            value={values.serial_number}
            onChangeText={t => setField('serial_number', t)}
            placeholder="Optional"
            autoCapitalize="characters"
            autoCorrect={false}
            error={fieldErrors.serial_number}
          />

          {/* -------- Issue / Diagnosis / Notes -------- */}
          <EyebrowLabel>Repair details</EyebrowLabel>
          <FormField
            label="Issue description"
            value={values.issue_description}
            onChangeText={t => setField('issue_description', t)}
            placeholder="What's wrong with the device?"
            multiline
            required
            error={fieldErrors.issue_description}
            testID="repair-edit-issue-description"
          />
          <FormField
            label="Diagnosis"
            value={values.diagnosis}
            onChangeText={t => setField('diagnosis', t)}
            placeholder="Technician diagnosis, if known"
            multiline
            error={fieldErrors.diagnosis}
          />
          <FormField
            label="Notes"
            value={values.notes}
            onChangeText={t => setField('notes', t)}
            placeholder="Any additional notes"
            multiline
            error={fieldErrors.notes}
          />

          {/* -------- Priority -------- */}
          <EyebrowLabel>Priority</EyebrowLabel>
          <View style={styles.fieldWrap}>
            <TouchableOpacity
              style={[styles.input, styles.pickerRow]}
              onPress={() => {
                haptics.light();
                setPriorityPickerOpen(v => !v);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Priority: ${priorityLabel}. Tap to change.`}
              accessibilityState={{expanded: priorityPickerOpen}}>
              <Text style={styles.pickerRowText}>{priorityLabel}</Text>
              <Icon
                name={priorityPickerOpen ? 'chevron-down' : 'chevron-forward'}
                size={ICON_SIZE.action}
                color={COLORS.textMuted}
              />
            </TouchableOpacity>
            {priorityPickerOpen ? (
              <View style={styles.pickerList}>
                {PRIORITY_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={styles.pickerItem}
                    onPress={() => selectPriority(opt.value)}
                    accessibilityRole="button"
                    accessibilityLabel={`Priority ${opt.label}`}>
                    <Text style={styles.pickerItemText}>{opt.label}</Text>
                    {values.priority === opt.value ? (
                      <Icon
                        name="check"
                        size={ICON_SIZE.action}
                        color={COLORS.crimson}
                      />
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {fieldErrors.priority ? (
              <Text style={styles.fieldError}>{fieldErrors.priority}</Text>
            ) : null}
          </View>

          {/* -------- Cost / ETA -------- */}
          <EyebrowLabel>Quote (optional)</EyebrowLabel>
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>Estimated cost</Text>
            <View
              style={[
                styles.input,
                styles.priceRow,
                fieldErrors.estimated_cost ? styles.inputError : null,
              ]}>
              <Text style={styles.pricePrefix}>$</Text>
              <TextInput
                style={styles.priceInput}
                value={values.estimated_cost}
                onChangeText={t => setField('estimated_cost', t)}
                placeholder="0.00"
                placeholderTextColor={COLORS.inputPlaceholder}
                keyboardType="decimal-pad"
                accessibilityLabel="Estimated cost"
                testID="repair-edit-estimated-cost"
              />
            </View>
            {fieldErrors.estimated_cost ? (
              <Text style={styles.fieldError}>
                {fieldErrors.estimated_cost}
              </Text>
            ) : null}
          </View>
          <FormField
            label="Estimated completion"
            value={values.estimated_completion}
            onChangeText={t => setField('estimated_completion', t)}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            autoCorrect={false}
            hint="A proper date picker lands in a follow-up polish"
            error={fieldErrors.estimated_completion}
          />

          <View style={styles.footerSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// -----------------------------------------------------------------------
// FormField - matches the CustomerEditScreen sub-component. Kept inline so
// this screen is a single-file drop rather than dragging a new primitive
// into the components/ dir. A shared FormField extraction is a codebase-
// wide follow-up.
// -----------------------------------------------------------------------
interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
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
  loadingText: {
    marginTop: SPACING.md,
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    minHeight: 44,
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

  // Picker row (used by priority + customer). Same shape as
  // ProductEditScreen's collapsible pickerRow / pickerList pattern.
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerRowText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    flexShrink: 1,
  },
  pickerList: {
    marginTop: SPACING.xs,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
    minHeight: 44,
  },
  pickerItemText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    flexShrink: 1,
  },
  pickerItemMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
  },

  // Customer picker specifics.
  searchInput: {
    backgroundColor: COLORS.inputBg,
    color: COLORS.text,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    minHeight: 44,
  },
  searchStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  searchStatusText: {
    marginLeft: SPACING.sm,
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
  },
  searchEmptyText: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
  },
  selectedCustomerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    minHeight: 44,
  },
  selectedCustomerText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    flexShrink: 1,
  },
  changeLink: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginLeft: SPACING.sm,
  },

  // Read-only chip (edit-mode customer + assignment).
  readonlyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    minHeight: 44,
    marginBottom: SPACING.md,
  },
  readonlyChipIcon: {marginRight: SPACING.sm},
  readonlyChipText: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  readonlyChipHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginLeft: SPACING.sm,
  },

  // Dollar-prefix row for estimated_cost.
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pricePrefix: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginRight: SPACING.xs,
  },
  priceInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    padding: 0,
  },

  footerSpacer: {height: SPACING.lg},
});

export default RepairEditScreen;
