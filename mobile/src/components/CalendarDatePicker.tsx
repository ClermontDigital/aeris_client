import React, {useCallback, useMemo, useState} from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Modal from 'react-native-modal';
import Icon from './Icon';
import EyebrowLabel from './EyebrowLabel';
import PillButton from './PillButton';
import {useHaptics} from '../hooks/useHaptics';
import {
  BORDER_RADIUS,
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  ICON_SIZE,
  SPACING,
} from '../constants/theme';

// ---- date helpers (all local, no timezone epoch math) -------------------
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD -> {y, m (0-based), d} or null if unparseable. */
export function parseYmd(
  value: string | null | undefined,
): {y: number; m: number; d: number} | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return {y, m, d};
}

export function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/** Human-readable label for the field row, e.g. "1 August 2026". */
export function formatHuman(value: string | null | undefined): string | null {
  const p = parseYmd(value);
  if (!p) return null;
  return `${p.d} ${MONTHS[p.m]} ${p.y}`;
}

function daysInMonth(y: number, m: number): number {
  // m is 0-based; day 0 of next month = last day of this month.
  return new Date(y, m + 1, 0).getDate();
}

function firstWeekday(y: number, m: number): number {
  return new Date(y, m, 1).getDay(); // 0 = Sunday
}

interface CalendarDatePickerProps {
  label: string;
  /** Current value as YYYY-MM-DD, or '' / null when unset. */
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** Optional inclusive lower bound as YYYY-MM-DD; earlier days disable. */
  minDate?: string | null;
  testID?: string;
}

/**
 * Pure-JS calendar date field. Renders a tappable row showing the selected
 * date (or placeholder); tapping opens a month-grid modal. No native module
 * (@react-native-community/datetimepicker et al.) so it can't break the
 * Expo prebuild / Gradle / Xcode Cloud build — deliberate given a native
 * date-picker dependency would need SDK-matched version pinning.
 *
 * The value contract is YYYY-MM-DD (matches RepairCreateInput.
 * estimated_completion). Optional field: the modal offers a Clear action.
 */
const CalendarDatePicker: React.FC<CalendarDatePickerProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Select a date',
  hint,
  error,
  minDate,
  testID,
}) => {
  const haptics = useHaptics();
  const [open, setOpen] = useState(false);

  // The month currently shown in the grid. Seeded from the value, else the
  // minDate, else today.
  const seed = useMemo(() => {
    return parseYmd(value) ?? parseYmd(minDate ?? null) ?? seedToday();
  }, [value, minDate]);
  const [viewY, setViewY] = useState(seed.y);
  const [viewM, setViewM] = useState(seed.m);

  const selected = useMemo(() => parseYmd(value), [value]);
  const min = useMemo(() => parseYmd(minDate ?? null), [minDate]);
  const humanLabel = useMemo(() => formatHuman(value), [value]);

  const openPicker = useCallback(() => {
    haptics.light();
    // Re-seed the visible month each open so it lands on the selected date.
    const s = parseYmd(value) ?? parseYmd(minDate ?? null) ?? seedToday();
    setViewY(s.y);
    setViewM(s.m);
    setOpen(true);
  }, [haptics, value, minDate]);

  const close = useCallback(() => setOpen(false), []);

  const goPrevMonth = useCallback(() => {
    haptics.selection();
    setViewM(m => {
      if (m === 0) {
        setViewY(y => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, [haptics]);

  const goNextMonth = useCallback(() => {
    haptics.selection();
    setViewM(m => {
      if (m === 11) {
        setViewY(y => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, [haptics]);

  const isBeforeMin = useCallback(
    (y: number, m: number, d: number): boolean => {
      if (!min) return false;
      if (y !== min.y) return y < min.y;
      if (m !== min.m) return m < min.m;
      return d < min.d;
    },
    [min],
  );

  const pickDay = useCallback(
    (d: number) => {
      if (isBeforeMin(viewY, viewM, d)) return;
      haptics.selection();
      onChange(formatYmd(viewY, viewM, d));
      setOpen(false);
    },
    [viewY, viewM, isBeforeMin, haptics, onChange],
  );

  const clearDate = useCallback(() => {
    haptics.light();
    onChange(null);
    setOpen(false);
  }, [haptics, onChange]);

  // Build the 6x7 grid of day cells (null = blank leading/trailing cell).
  const cells = useMemo(() => {
    const total = daysInMonth(viewY, viewM);
    const lead = firstWeekday(viewY, viewM);
    const out: Array<number | null> = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= total; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [viewY, viewM]);

  const today = useMemo(() => seedToday(), []);

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity
        style={[styles.field, error ? styles.fieldError : null]}
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${humanLabel ?? 'not set'}. Tap to choose a date.`}
        testID={testID}>
        <Text
          style={[
            styles.fieldText,
            humanLabel ? null : styles.fieldPlaceholder,
          ]}
          numberOfLines={1}>
          {humanLabel ?? placeholder}
        </Text>
        <Icon
          name="calendar-outline"
          size={ICON_SIZE.action}
          color={COLORS.textMuted}
        />
      </TouchableOpacity>
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}

      <Modal
        isVisible={open}
        onBackdropPress={close}
        onBackButtonPress={close}
        backdropColor={COLORS.modalBg}
        backdropOpacity={1}
        style={styles.modal}
        useNativeDriver>
        <View style={styles.sheet}>
          <EyebrowLabel>{label}</EyebrowLabel>

          {/* Month nav */}
          <View style={styles.monthRow}>
            <TouchableOpacity
              onPress={goPrevMonth}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
              style={styles.monthNavBtn}>
              <Icon
                name="chevron-back"
                size={ICON_SIZE.action}
                color={COLORS.navy}
              />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>
              {MONTHS[viewM]} {viewY}
            </Text>
            <TouchableOpacity
              onPress={goNextMonth}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
              style={styles.monthNavBtn}>
              <Icon
                name="chevron-forward"
                size={ICON_SIZE.action}
                color={COLORS.navy}
              />
            </TouchableOpacity>
          </View>

          {/* Weekday header */}
          <View style={styles.weekRow}>
            {WEEKDAYS.map(w => (
              <View key={w} style={styles.weekCell}>
                <Text style={styles.weekText}>{w}</Text>
              </View>
            ))}
          </View>

          {/* Day grid */}
          <View style={styles.grid}>
            {cells.map((d, i) => {
              if (d == null) {
                return <View key={`blank-${i}`} style={styles.dayCell} />;
              }
              const isSelected =
                selected != null &&
                selected.y === viewY &&
                selected.m === viewM &&
                selected.d === d;
              const isToday =
                today.y === viewY && today.m === viewM && today.d === d;
              const disabled = isBeforeMin(viewY, viewM, d);
              return (
                <TouchableOpacity
                  key={`d-${d}`}
                  style={styles.dayCell}
                  disabled={disabled}
                  onPress={() => pickDay(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`${d} ${MONTHS[viewM]} ${viewY}`}
                  accessibilityState={{selected: isSelected, disabled}}>
                  <View
                    style={[
                      styles.dayInner,
                      isSelected ? styles.daySelected : null,
                      !isSelected && isToday ? styles.dayToday : null,
                    ]}>
                    <Text
                      style={[
                        styles.dayText,
                        isSelected ? styles.dayTextSelected : null,
                        disabled ? styles.dayTextDisabled : null,
                      ]}>
                      {d}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Footer actions */}
          <View style={styles.footer}>
            <PillButton
              label="Clear"
              variant="secondary"
              onPress={clearDate}
              disabled={value == null || value === ''}
              accessibilityLabel="Clear date"
              style={styles.footerBtn}
            />
            <PillButton
              label="Done"
              variant="solid"
              onPress={close}
              accessibilityLabel="Close date picker"
              style={styles.footerBtn}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

function seedToday(): {y: number; m: number; d: number} {
  const now = new Date();
  return {y: now.getFullYear(), m: now.getMonth(), d: now.getDate()};
}

const styles = StyleSheet.create({
  fieldWrap: {marginBottom: SPACING.md},
  fieldLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.xs,
  },
  field: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  fieldError: {borderColor: COLORS.danger},
  fieldText: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    marginRight: SPACING.sm,
  },
  fieldPlaceholder: {color: COLORS.inputPlaceholder},
  errorText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.xs,
  },
  hintText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.regular,
    marginTop: SPACING.xs,
  },

  modal: {justifyContent: 'center', margin: SPACING.lg},
  sheet: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 380,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  monthNavBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.semibold,
  },
  weekRow: {flexDirection: 'row'},
  weekCell: {flex: 1, alignItems: 'center', paddingVertical: SPACING.xs},
  weekText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.semibold,
    textTransform: 'uppercase',
  },
  grid: {flexDirection: 'row', flexWrap: 'wrap'},
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  dayInner: {
    width: '100%',
    height: '100%',
    maxWidth: 40,
    maxHeight: 40,
    borderRadius: BORDER_RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: {backgroundColor: COLORS.crimson},
  dayToday: {borderWidth: 1, borderColor: COLORS.crimson},
  dayText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  dayTextSelected: {
    color: COLORS.cream,
    fontFamily: FONT_FAMILY.semibold,
  },
  dayTextDisabled: {color: COLORS.inputPlaceholder},
  footer: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  footerBtn: {flex: 1},
});

export default CalendarDatePicker;
