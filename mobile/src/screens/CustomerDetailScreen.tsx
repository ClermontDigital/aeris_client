import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute, useFocusEffect} from '@react-navigation/native';
import type {CompositeNavigationProp, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import Icon from '../components/Icon';
import PillButton from '../components/PillButton';
import {COLORS, SPACING, FONT_SIZE, FONT_FAMILY, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import type {Address, Customer, Sale} from '../types/api.types';
import type {
  AppTabParamList,
  CustomersStackParamList,
} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

const formatShortDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const statusColor = (status: Sale['status']): string => {
  switch (status) {
    case 'completed':
      return COLORS.success;
    case 'refunded':
      return COLORS.danger;
    case 'voided':
      return COLORS.warning;
    default:
      return COLORS.textDim;
  }
};

function renderAddressLines(a: Address): string {
  const parts: string[] = [];
  if (a.line_1) parts.push(a.line_1);
  if (a.line_2) parts.push(a.line_2);
  const cityState = [a.city, a.state].filter(Boolean).join(', ');
  if (cityState || a.postcode) {
    parts.push([cityState, a.postcode].filter(Boolean).join(' '));
  }
  if (a.country) parts.push(a.country);
  return parts.filter(Boolean).join('\n');
}

type CustomerDetailRouteProp = RouteProp<
  CustomersStackParamList,
  'CustomerDetail'
>;

const initialsOf = (name: string | undefined): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
};

type NavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<CustomersStackParamList, 'CustomerDetail'>,
  BottomTabNavigationProp<AppTabParamList>
>;

export default function CustomerDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<CustomerDetailRouteProp>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();
  const tabletColumnCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;
  const {customerId} = route.params;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setIsUnavailable(false);
    setNotFound(false);
    try {
      const data = await ApiClient.getCustomerDetail(customerId);
      if (data == null) {
        setNotFound(true);
      } else {
        setCustomer(data);
      }
    } catch {
      setIsUnavailable(true);
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-fetch on focus so the detail view reflects edits made on
  // CustomerEditScreen. The initial useEffect above handles the cold-
  // mount; useFocusEffect kicks in every subsequent return-to-detail.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openMail = useCallback(
    (email: string) => {
      haptics.light();
      Linking.openURL(`mailto:${email}`).catch(() => {});
    },
    [haptics],
  );

  const openTel = useCallback(
    (phone: string) => {
      haptics.light();
      // Strip spaces / dashes; tel: is usually tolerant but cleaner is safer.
      const cleaned = phone.replace(/[^+\d]/g, '');
      Linking.openURL(`tel:${cleaned}`).catch(() => {});
    },
    [haptics],
  );

  // SaleDetail lives under the Transactions tab. The composite nav type
  // includes the parent BottomTab nav, so navigating across tabs with
  // nested screen+params is type-safe directly on `navigation`.
  const goToSale = useCallback(
    (saleId: number) => {
      haptics.light();
      // `initial: false` preserves TransactionList under SaleDetail so
      // back goes to the list, not to the previous tab. See CheckoutScreen
      // for the full rationale.
      navigation.navigate('Transactions', {
        screen: 'SaleDetail',
        params: {saleId},
        initial: false,
      });
    },
    [haptics, navigation],
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isUnavailable) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <Icon
            name="cloud-offline-outline"
            size={36}
            color={COLORS.textDim}
            style={styles.errorIcon}
          />
          <Text style={styles.errorTitle}>Detail view not available</Text>
          <Text style={styles.errorBody}>
            We couldn&apos;t load this customer right now. Please try again in a
            moment.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              haptics.light();
              load();
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading customer">
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !customer) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <Icon
            name="person-outline"
            size={36}
            color={COLORS.textDim}
            style={styles.errorIcon}
          />
          <Text style={styles.errorTitle}>Customer not found</Text>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const balance = customer.account_balance_cents;
  const showBalance = balance != null && balance !== 0;
  const owed = balance != null && balance > 0;
  const displayName = customer.name?.trim() || '(Unnamed)';

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={[styles.scroll, tabletColumnCap]}>
        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initialsOf(customer.name)}</Text>
          </View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.subtitle}>Customer</Text>
          <View style={styles.heroActions}>
            <PillButton
              label="Edit"
              icon="user"
              variant="secondary"
              onPress={() => {
                haptics.light();
                navigation.navigate('CustomerEdit', {customerId: customer.id});
              }}
              accessibilityLabel={`Edit ${displayName}`}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>Contact</Text>
        <View style={styles.card}>
          <ContactRow
            icon="mail-outline"
            label="Email"
            value={customer.email}
            onPress={
              customer.email ? () => openMail(customer.email as string) : undefined
            }
            isFirst
          />
          <ContactRow
            icon="call-outline"
            label="Phone"
            value={customer.phone}
            onPress={
              customer.phone ? () => openTel(customer.phone as string) : undefined
            }
          />
        </View>

        {showBalance ? (
          <>
            <Text style={styles.sectionLabel}>Account</Text>
            <View style={styles.balanceCard}>
              <Text style={[styles.balance, owed && styles.balanceOwed]}>
                {formatCurrency(Math.abs(balance as number))}
              </Text>
              <Text style={styles.balanceLabel}>
                {owed ? 'Owed by customer' : 'Credit on account'}
              </Text>
            </View>
          </>
        ) : null}

        {(customer.payment_terms ||
          customer.credit_limit_cents != null ||
          customer.loyalty_points != null ||
          customer.total_orders != null ||
          customer.total_spent_cents != null) ? (
          <>
            <Text style={styles.sectionLabel}>Account terms</Text>
            <View style={styles.card}>
              {customer.payment_terms ? (
                <TermsRow
                  label="Payment terms"
                  value={customer.payment_terms}
                  isFirst
                />
              ) : null}
              {customer.credit_limit_cents != null ? (
                <TermsRow
                  label="Credit limit"
                  value={formatCurrency(customer.credit_limit_cents)}
                  isFirst={!customer.payment_terms}
                />
              ) : null}
              {customer.loyalty_points != null ? (
                <TermsRow
                  label="Loyalty points"
                  value={customer.loyalty_points.toLocaleString()}
                  isFirst={
                    !customer.payment_terms &&
                    customer.credit_limit_cents == null
                  }
                />
              ) : null}
              {customer.total_orders != null ? (
                <TermsRow
                  label="Total orders"
                  value={customer.total_orders.toLocaleString()}
                />
              ) : null}
              {customer.total_spent_cents != null ? (
                <TermsRow
                  label="Lifetime value"
                  value={formatCurrency(customer.total_spent_cents)}
                />
              ) : null}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionLabel}>Activity</Text>
        {customer.recent_sales.length > 0 ? (
          <View style={styles.card}>
            {customer.recent_sales.map((s, idx) => (
              <TouchableOpacity
                key={s.id}
                activeOpacity={0.7}
                onPress={() => goToSale(s.id)}
                accessibilityRole="button"
                accessibilityLabel={`Sale ${s.sale_number}, ${formatCurrency(s.total_cents)}, ${s.status}. Tap to view.`}
                style={[
                  styles.activityRow,
                  idx > 0 && styles.activityRowDivider,
                ]}>
                <View style={styles.activityLeft}>
                  <Text style={styles.activitySaleNumber}>{s.sale_number}</Text>
                  <Text style={styles.activitySaleDate}>
                    {formatShortDate(s.created_at)}
                  </Text>
                </View>
                <View style={styles.activityRight}>
                  <Text style={styles.activityAmount}>
                    {formatCurrency(s.total_cents)}
                  </Text>
                  <View
                    style={[
                      styles.activityStatusChip,
                      {backgroundColor: statusColor(s.status)},
                    ]}>
                    <Text style={styles.activityStatusText}>{s.status}</Text>
                  </View>
                </View>
                <Icon
                  name="chevron-forward"
                  size={16}
                  color={COLORS.textDim}
                  style={styles.activityChevron}
                />
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.placeholderCard}>
            <Icon
              name="time-outline"
              size={20}
              color={COLORS.textMuted}
              style={styles.placeholderIcon}
            />
            <View style={styles.placeholderTextWrap}>
              <Text style={styles.placeholderTitle}>No recent activity</Text>
              <Text style={styles.placeholderBody}>
                This customer&apos;s recent transactions will appear here.
              </Text>
            </View>
          </View>
        )}

        {(customer.default_address || customer.addresses.length > 0) ? (
          <>
            <Text style={styles.sectionLabel}>Addresses</Text>
            {customer.default_address ? (
              <View style={styles.addressDefault}>
                <View style={styles.addressBadgeRow}>
                  <Text style={styles.addressBadge}>Default</Text>
                  {customer.default_address.label ? (
                    <Text style={styles.addressLabel}>
                      {customer.default_address.label}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.addressLines}>
                  {renderAddressLines(customer.default_address)}
                </Text>
              </View>
            ) : null}
            {customer.addresses
              .filter(a => {
                // Reference-equality alone misses the common case where the
                // API returns `default_address` as a separate object whose
                // id matches an entry in `addresses` — the two are different
                // JS objects, so `!==` always passes and the default address
                // is rendered a second time below. Compare by id when
                // available; fall back to reference equality for unsaved
                // addresses (id may be null per the Address shape).
                if (!customer.default_address) return true;
                const d = customer.default_address;
                if (typeof a.id === 'number' && typeof d.id === 'number') {
                  return a.id !== d.id;
                }
                return a !== d;
              })
              .map((a, idx) => (
                <View key={a.id ?? idx} style={styles.addressOther}>
                  {a.label ? (
                    <Text style={styles.addressLabel}>{a.label}</Text>
                  ) : null}
                  <Text style={styles.addressLines}>
                    {renderAddressLines(a)}
                  </Text>
                </View>
              ))}
          </>
        ) : null}

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            haptics.light();
            navigation.goBack();
          }}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Icon
            name="chevron-back"
            size={20}
            color={COLORS.white}
            style={styles.backBtnIcon}
          />
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const TermsRow: React.FC<{
  label: string;
  value: string;
  isFirst?: boolean;
}> = ({label, value, isFirst}) => (
  <View style={[styles.termsRow, !isFirst && styles.termsRowDivider]}>
    <Text style={styles.termsLabel}>{label}</Text>
    <Text style={styles.termsValue}>{value}</Text>
  </View>
);

const ContactRow: React.FC<{
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  value: string | null;
  onPress?: () => void;
  isFirst?: boolean;
}> = ({icon, label, value, onPress, isFirst}) => {
  const inner = (
    <View style={[styles.contactRow, !isFirst && styles.contactRowDivider]}>
      <View style={styles.contactIconWrap}>
        <Icon name={icon} size={18} color={COLORS.crimson} />
      </View>
      <View style={styles.contactTextWrap}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text
          style={[
            styles.contactValue,
            value ? styles.contactValueLink : styles.contactValueEmpty,
          ]}
          numberOfLines={1}>
          {value || '—'}
        </Text>
      </View>
      {onPress ? (
        <Icon
          name="chevron-forward"
          size={16}
          color={COLORS.textDim}
        />
      ) : null}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}${value ? `, ${value}` : ''}`}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
};

const cardBase = {
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.surfaceBorder,
  borderRadius: BORDER_RADIUS.lg,
  marginBottom: SPACING.md,
  shadowColor: COLORS.black,
  shadowOffset: {width: 0, height: 1},
  shadowOpacity: 0.06,
  shadowRadius: 3,
  elevation: 1,
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  scroll: {padding: SPACING.md, paddingBottom: SPACING.xxl},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  errorIcon: {marginBottom: SPACING.md},
  heroCard: {
    ...cardBase,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  heroActions: {
    marginTop: SPACING.md,
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
  },
  avatarText: {
    color: COLORS.crimson,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: 0.5,
  },
  name: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionLabel: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  card: {
    ...cardBase,
    paddingHorizontal: SPACING.md,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  contactRowDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  contactIconWrap: {
    width: 36,
    height: 36,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  contactTextWrap: {flex: 1},
  contactLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contactValue: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginTop: 2,
  },
  contactValueLink: {color: COLORS.text},
  contactValueEmpty: {color: COLORS.textDim, fontFamily: FONT_FAMILY.medium},
  balanceCard: {
    ...cardBase,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  balance: {
    fontSize: FONT_SIZE.title,
    fontFamily: FONT_FAMILY.bold,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  balanceOwed: {color: COLORS.crimson},
  balanceLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: SPACING.xs,
  },
  placeholderCard: {
    ...cardBase,
    // cardBase already sets backgroundColor: surface (white). Don't override
    // to cream — the body bg is now Clermont Cream per Brand Guidelines §04
    // and a cream card on a cream body loses all distinction.
    flexDirection: 'row',
    padding: SPACING.md,
    borderColor: COLORS.surfaceBorder,
  },
  placeholderIcon: {marginRight: SPACING.sm, marginTop: 2},
  placeholderTextWrap: {flex: 1},
  placeholderTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: 2,
  },
  placeholderBody: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    lineHeight: 20,
  },
  errorTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  errorBody: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  primaryBtn: {
    backgroundColor: COLORS.crimson,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.sm,
  },
  primaryBtnText: {color: COLORS.white, fontFamily: FONT_FAMILY.bold, fontSize: FONT_SIZE.md},
  linkText: {color: COLORS.accent, fontSize: FONT_SIZE.md, fontFamily: FONT_FAMILY.medium},
  backBtn: {
    flexDirection: 'row',
    backgroundColor: COLORS.text,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  backBtnIcon: {marginRight: SPACING.xs},
  backBtnText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  termsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  termsRowDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  termsLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  termsValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  activityRowDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  activityLeft: {flex: 1},
  activitySaleNumber: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  activitySaleDate: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  activityRight: {alignItems: 'flex-end', marginRight: SPACING.sm},
  activityAmount: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.bold,
    marginBottom: 4,
  },
  activityStatusChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  activityStatusText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'capitalize',
  },
  activityChevron: {marginLeft: 4},
  addressDefault: {
    ...cardBase,
    padding: SPACING.md,
  },
  addressOther: {
    ...cardBase,
    padding: SPACING.md,
    // Don't override cardBase's white surface — body bg is Clermont Cream
    // (post-v1.3.19 brand pass) so a cream-on-cream card would disappear.
    // The "Default" badge above the first address is the differentiator.
  },
  addressBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
    gap: SPACING.sm,
  },
  addressBadge: {
    color: COLORS.white,
    backgroundColor: COLORS.crimson,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
    overflow: 'hidden',
  },
  addressLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addressLines: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    lineHeight: 22,
    marginTop: 2,
  },
});
