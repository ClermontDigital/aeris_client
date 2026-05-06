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
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {Ionicons} from '@expo/vector-icons';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import type {Customer} from '../types/api.types';
import type {CustomersStackParamList} from '../types/navigation.types';
import {formatCurrency} from '../utils/format';

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

export default function CustomerDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<CustomerDetailRouteProp>();
  const haptics = useHaptics();
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

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isUnavailable) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Ionicons
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
            }}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              navigation.goBack();
            }}>
            <Text style={styles.linkText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !customer) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <Ionicons
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
            }}>
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
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initialsOf(customer.name)}</Text>
          </View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.subtitle}>Customer</Text>
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

        <Text style={styles.sectionLabel}>Activity</Text>
        <View style={styles.placeholderCard}>
          <Ionicons
            name="time-outline"
            size={20}
            color={COLORS.textMuted}
            style={styles.placeholderIcon}
          />
          <View style={styles.placeholderTextWrap}>
            <Text style={styles.placeholderTitle}>More detail coming soon</Text>
            <Text style={styles.placeholderBody}>
              Recent transactions, addresses, and notes will appear here once
              the server enriches the response.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            haptics.light();
            navigation.goBack();
          }}>
          <Ionicons
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

const ContactRow: React.FC<{
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string | null;
  onPress?: () => void;
  isFirst?: boolean;
}> = ({icon, label, value, onPress, isFirst}) => {
  const inner = (
    <View style={[styles.contactRow, !isFirst && styles.contactRowDivider]}>
      <View style={styles.contactIconWrap}>
        <Ionicons name={icon} size={18} color={COLORS.crimson} />
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
        <Ionicons
          name="chevron-forward"
          size={16}
          color={COLORS.textDim}
        />
      ) : null}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
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
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  name: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontWeight: '500',
    marginTop: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionLabel: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
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
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contactValue: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    marginTop: 2,
  },
  contactValueLink: {color: COLORS.text},
  contactValueEmpty: {color: COLORS.textDim, fontWeight: '500'},
  balanceCard: {
    ...cardBase,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  balance: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  balanceOwed: {color: COLORS.crimson},
  balanceLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: SPACING.xs,
  },
  placeholderCard: {
    ...cardBase,
    backgroundColor: COLORS.cream,
    flexDirection: 'row',
    padding: SPACING.md,
    borderColor: COLORS.surfaceBorder,
  },
  placeholderIcon: {marginRight: SPACING.sm, marginTop: 2},
  placeholderTextWrap: {flex: 1},
  placeholderTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
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
    fontWeight: '700',
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
  primaryBtnText: {color: COLORS.white, fontWeight: '700', fontSize: FONT_SIZE.md},
  linkText: {color: COLORS.accent, fontSize: FONT_SIZE.md, fontWeight: '600'},
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
    fontWeight: '600',
  },
});
