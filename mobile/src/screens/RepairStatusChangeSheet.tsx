import React, {useCallback, useEffect, useRef, useState} from 'react';
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
import ApiClient from '../services/ApiClient';
import ErrorBanner from '../components/ErrorBanner';
import EyebrowLabel from '../components/EyebrowLabel';
import PillButton from '../components/PillButton';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';
import {RelayError} from '@aeris/shared';
import type {RepairDetail, RepairStatus} from '../types/api.types';
import type {RepairsStackParamList} from '../types/navigation.types';
import {
  BORDER_RADIUS,
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  SPACING,
} from '../constants/theme';

type Nav = NativeStackNavigationProp<RepairsStackParamList, 'RepairStatusChange'>;
type RouteProps = RouteProp<RepairsStackParamList, 'RepairStatusChange'>;

// Closed union - kept in the same order as RepairStatus for the picker to
// read left-to-right through the normal repair lifecycle. Cancelled sits
// last since it's off the happy path. Labels mirror RepairDetailScreen's
// getRepairStatusLabel but expressed as a table so the picker binds to
// them without re-deriving.
const STATUS_OPTIONS: ReadonlyArray<{
  value: RepairStatus;
  label: string;
}> = [
  {value: 'pending', label: 'Pending'},
  {value: 'diagnosed', label: 'Diagnosed'},
  {value: 'in_progress', label: 'In Progress'},
  {value: 'waiting_parts', label: 'Waiting for Parts'},
  {value: 'ready', label: 'Ready for Pickup'},
  {value: 'completed', label: 'Completed'},
  {value: 'cancelled', label: 'Cancelled'},
];

function getRepairStatusLabel(status: RepairStatus): string {
  return STATUS_OPTIONS.find(o => o.value === status)?.label ?? status;
}

// A note on optimistic dismiss: the sitrep asks that Save fire-and-forget
// and pop back to RepairDetail immediately. RepairDetail refetches via
// useFocusEffect, so the timeline + status chip reconcile from the server
// on the next focus. If the write fails the parent won't know - the
// sitrep accepts that trade for the speed. We still surface the error
// inside THIS sheet if the user is still on it when the promise rejects,
// but by then we've already returned control to the parent.
//
// The sitrep is explicit: "Optimistic UI: dismiss immediately after firing
// the call". Any future change that wants a pessimistic (wait-for-2xx)
// flow should introduce a settings switch, not silently regress this.

const RepairStatusChangeSheet: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletCap = isTablet
    ? ({maxWidth: 560, alignSelf: 'center', width: '100%'} as const)
    : null;
  const {id: repairId} = route.params;

  // ---------------- state (all hooks live ABOVE the early-return guards
  // per feedback_hooks_above_early_returns - mirrors RepairDetailScreen). --
  const [repair, setRepair] = useState<RepairDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newStatus, setNewStatus] = useState<RepairStatus | null>(null);
  const [notes, setNotes] = useState('');

  // Cancellation gate: when newStatus === 'cancelled' we show a warning and
  // require a confirm tap before the primary Save button activates. This
  // resets any time the operator moves off cancelled so re-entering the
  // status re-arms the warning.
  const [cancelConfirmed, setCancelConfirmed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Synchronous double-tap guard - matches StockAdjustModal's pattern. Set
  // before any await so a 60Hz double-tap can't fire two updateRepairStatus
  // calls before the disabled state paints.
  const submitLockRef = useRef(false);

  // ---------------- fetch current status ----------------
  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await ApiClient.getRepairDetail(repairId);
      if (data == null) {
        setLoadError('Repair not found or was deleted.');
      } else {
        setRepair(data);
        setNewStatus(data.status);
      }
    } catch (e) {
      const msg =
        e instanceof RelayError
          ? e.message
          : 'Could not load the current repair status. Please try again.';
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [repairId]);

  useEffect(() => {
    load();
  }, [load]);

  // Workspace-flag mount guard (T7-006 remediation, parity with
  // RepairsListScreen + RepairEditScreen + RepairDetailScreen). A deep
  // link into the sheet while the workspace has repairs disabled should
  // signal + bounce rather than silently succeed.
  useEffect(() => {
    if (!useWorkspaceFeaturesStore.getState().repairs_enabled) {
      Alert.alert('Repairs', 'Repairs are not enabled for this site.');
      navigation.goBack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track mounted state so the finally-block after the optimistic dismiss
  // doesn't setState on an unmounted component (T7-005). The store toggle
  // is still safe to call - that's global state.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------- derived gating ----------------
  // Save gating: at minimum something must change. Either the operator
  // picked a different status, OR they added notes to the current status
  // (e.g. a shift-handover note that shouldn't move the ticket). Also
  // disabled while the detail is loading or a submit is in-flight.
  const currentStatus = repair?.status ?? null;
  const trimmedNotes = notes.trim();
  const hasStatusChange = newStatus !== null && newStatus !== currentStatus;
  const hasNotes = trimmedNotes.length > 0;
  const isCancelling = newStatus === 'cancelled' && hasStatusChange;
  const cancelGatePassed = !isCancelling || cancelConfirmed;

  const canSave =
    !isLoading &&
    !submitting &&
    currentStatus !== null &&
    newStatus !== null &&
    (hasStatusChange || hasNotes) &&
    cancelGatePassed;

  // Reset the cancel confirmation any time the operator changes away from
  // 'cancelled'. Prevents a stale confirm from arming an accidental cancel.
  useEffect(() => {
    if (!isCancelling && cancelConfirmed) {
      setCancelConfirmed(false);
    }
  }, [isCancelling, cancelConfirmed]);

  // ---------------- handlers ----------------
  const handleCancel = useCallback(() => {
    if (submitting) return;
    haptics.light();
    navigation.goBack();
  }, [navigation, haptics, submitting]);

  const handleStatusPick = useCallback(
    (value: RepairStatus) => {
      haptics.selection();
      setNewStatus(value);
      // Any status change resets the previous submit error so the sheet
      // doesn't keep surfacing a stale banner while the operator retries.
      if (submitError) setSubmitError(null);
    },
    [haptics, submitError],
  );

  const handleConfirmCancel = useCallback(() => {
    haptics.medium();
    setCancelConfirmed(true);
  }, [haptics]);

  const performSave = useCallback(() => {
    if (submitLockRef.current) return;
    if (!canSave || newStatus === null) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    // Mark the write in-flight so the DR auto-failover cascade defers a
    // mid-write swap. Matches StockAdjustModal + RefundModal.
    useTransactionActivityStore
      .getState()
      .setSettlementOrPrintInFlight(true);

    // Optimistic dismiss: pop the sheet before awaiting. RepairDetail's
    // useFocusEffect will refetch on the next focus and reconcile the
    // status chip + history timeline from the server. See the header
    // comment above for the sitrep rationale.
    navigation.goBack();

    ApiClient.updateRepairStatus(
      repairId,
      newStatus,
      trimmedNotes.length > 0 ? trimmedNotes : undefined,
    )
      .then(() => {
        // Fire the success haptic only after the server has ack'd. The
        // previous "haptic before RPC" pattern gave a false-positive
        // buzz on the DirectClient POST→405 path (BLOCKER: server route
        // is PATCH). Now the buzz means "actually persisted".
        haptics.success();
      })
      .catch(e => {
        // Sheet is already dismissed - nothing to render an inline error
        // on. Surface via Alert.alert so the cashier gets an unmissable
        // signal (the previous silent console.warn hid the PATCH-vs-POST
        // failure entirely). RepairDetail's useFocusEffect refetch will
        // still reconcile the (unchanged) status chip.
        haptics.error();
        const message =
          e instanceof RelayError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Failed to update repair status.';
        Alert.alert('Status change failed', message);
        // eslint-disable-next-line no-console
        console.warn('updateRepairStatus failed after optimistic dismiss', e);
      })
      .finally(() => {
        submitLockRef.current = false;
        // Store toggle is global - always safe. setState is only safe if
        // the sheet is still mounted (the optimistic goBack usually
        // unmounts it before this fires; T7-005 remediation).
        useTransactionActivityStore
          .getState()
          .setSettlementOrPrintInFlight(false);
        if (mountedRef.current) {
          setSubmitting(false);
        }
      });
  }, [
    canSave,
    newStatus,
    trimmedNotes,
    repairId,
    navigation,
    haptics,
  ]);

  // Retry variant used by ErrorBanner when a NON-optimistic error surfaces.
  // In the current shipped flow the sheet dismisses before the promise
  // settles, so an error banner is only visible if a synchronous exception
  // (thrown pre-await) landed. The Retry path re-runs performSave which
  // will re-fire the RPC.
  const handleRetry = useCallback(() => {
    setSubmitError(null);
    performSave();
  }, [performSave]);

  // ---------------- early-return guards ----------------
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel">
            <Text style={styles.headerCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Change Status</Text>
          <Text style={styles.headerSpacer}>{'  '}</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.loadingText}>Loading current status…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !repair || currentStatus === null) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel">
            <Text style={styles.headerCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Change Status</Text>
          <Text style={styles.headerSpacer}>{'  '}</Text>
        </View>
        <View style={styles.bannerWrap}>
          <ErrorBanner
            message={loadError ?? 'Repair unavailable.'}
            onRetry={() => {
              haptics.light();
              load();
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      {/* -------- Sheet header: Cancel · Title · Save -------- */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleCancel}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Text
            style={[
              styles.headerCancel,
              submitting ? styles.headerActionDisabled : null,
            ]}>
            Cancel
          </Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Status</Text>
        <TouchableOpacity
          onPress={performSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save status change"
          accessibilityState={{disabled: !canSave}}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Text
            style={[
              styles.headerSave,
              canSave ? null : styles.headerActionDisabled,
            ]}>
            Save
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.kbAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, tabletCap]}
          keyboardShouldPersistTaps="handled">
          {submitError ? (
            <View style={styles.bannerWrap}>
              <ErrorBanner
                message={submitError}
                onRetry={handleRetry}
                onDismiss={() => setSubmitError(null)}
              />
            </View>
          ) : null}

          <EyebrowLabel>Current status</EyebrowLabel>
          <Text style={styles.currentStatusText}>
            {getRepairStatusLabel(currentStatus)}
          </Text>

          {/* -------- Status picker (segmented rows) -------- */}
          <View style={styles.section}>
            <EyebrowLabel>New status</EyebrowLabel>
            <View
              style={styles.statusList}
              accessibilityRole="radiogroup"
              accessibilityLabel="Repair status">
              {STATUS_OPTIONS.map(opt => {
                const selected = newStatus === opt.value;
                const isCurrent = opt.value === currentStatus;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.statusRow,
                      selected ? styles.statusRowActive : null,
                    ]}
                    onPress={() => handleStatusPick(opt.value)}
                    accessibilityRole="radio"
                    accessibilityLabel={`Status: ${opt.label}${isCurrent ? ' (current)' : ''}`}
                    accessibilityState={{selected}}>
                    <View style={styles.statusRowContent}>
                      <Text
                        style={[
                          styles.statusLabel,
                          selected ? styles.statusLabelActive : null,
                        ]}>
                        {opt.label}
                      </Text>
                      {isCurrent ? (
                        <Text style={styles.currentTag}>Current</Text>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.radioDot,
                        selected ? styles.radioDotActive : null,
                      ]}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* -------- Cancellation warning -------- */}
          {isCancelling ? (
            <View
              style={[
                styles.warningBox,
                cancelConfirmed ? styles.warningBoxConfirmed : null,
              ]}>
              <Text style={styles.warningTitle}>
                Cancelling will release any stock reservations on this repair.
                Are you sure?
              </Text>
              {cancelConfirmed ? (
                <Text style={styles.warningConfirmedText}>
                  Confirmed. Tap Save to apply.
                </Text>
              ) : (
                <PillButton
                  label="Confirm cancellation"
                  variant="destructive"
                  onPress={handleConfirmCancel}
                  accessibilityLabel="Confirm cancellation"
                  style={styles.warningBtn}
                />
              )}
            </View>
          ) : null}

          {/* -------- Notes -------- */}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add optional notes for the timeline"
              placeholderTextColor={COLORS.inputPlaceholder}
              multiline
              numberOfLines={3}
              accessibilityLabel="Status change notes"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  kbAvoid: {
    flex: 1,
  },
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

  // Sheet header - Cancel · Title · Save. We roll our own instead of
  // using the stack header because the formSheet chrome swaps between
  // iOS and Android differently and we want a consistent tap-target set.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
  },
  headerCancel: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.semibold,
  },
  headerSave: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  headerActionDisabled: {
    opacity: 0.4,
  },
  // Reserved space so the title stays centred when Save is disabled and
  // isn't rendered as a coloured pill. Nudged by hand.
  headerSpacer: {
    color: COLORS.transparent,
    fontSize: FONT_SIZE.md,
  },

  scroll: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  bannerWrap: {
    padding: SPACING.md,
  },

  currentStatusText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.semibold,
    marginBottom: SPACING.md,
  },

  section: {
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
  },

  // Status picker - vertical list of tap rows with a radio dot on the
  // right. Selected row fills with a light crimson tint, matching the
  // reasonChipActive pattern from StockAdjustModal.
  statusList: {
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
    overflow: 'hidden',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surface,
  },
  statusRowActive: {
    backgroundColor: 'rgba(193, 18, 31, 0.06)',
  },
  statusRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: SPACING.sm,
  },
  statusLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  statusLabelActive: {
    color: COLORS.crimson,
    fontFamily: FONT_FAMILY.semibold,
  },
  currentTag: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  radioDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
  },
  radioDotActive: {
    borderColor: COLORS.crimson,
    backgroundColor: COLORS.crimson,
  },

  // Cancellation warning box - warning-tone tint that darkens once the
  // operator has confirmed. Uses the danger palette because the action is
  // destructive-adjacent (stock reservations get released).
  warningBox: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(193, 18, 31, 0.35)',
    backgroundColor: 'rgba(193, 18, 31, 0.08)',
  },
  warningBoxConfirmed: {
    borderColor: 'rgba(193, 18, 31, 0.55)',
    backgroundColor: 'rgba(193, 18, 31, 0.14)',
  },
  warningTitle: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.sm,
  },
  warningBtn: {
    alignSelf: 'flex-start',
  },
  warningConfirmedText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
  },

  // Notes textarea - same shape as StockAdjustModal's notes field so the
  // two mutation surfaces feel consistent.
  fieldLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.xs,
  },
  input: {
    minHeight: 44,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
  },
  notesInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
});

export default RepairStatusChangeSheet;
