import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import type {Customer} from '../types/api.types';
import type {CustomersStackParamList} from '../types/navigation.types';

type CustomerDetailRouteProp = RouteProp<
  CustomersStackParamList,
  'CustomerDetail'
>;

const formatCurrency = (cents: number): string => '$' + (cents / 100).toFixed(2);

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
          <Text style={styles.errorTitle}>Detail view is not available yet</Text>
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

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.name}>{customer.name || '(unnamed)'}</Text>
          {customer.email ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Email</Text>
              <Text style={styles.rowValue}>{customer.email}</Text>
            </View>
          ) : null}
          {customer.phone ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Phone</Text>
              <Text style={styles.rowValue}>{customer.phone}</Text>
            </View>
          ) : null}
          {showBalance ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Balance</Text>
              <Text
                style={[
                  styles.rowValue,
                  balance > 0 && styles.balanceOwed,
                ]}>
                {formatCurrency(balance)}
              </Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            haptics.light();
            navigation.goBack();
          }}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  scroll: {padding: SPACING.md, paddingBottom: SPACING.xxl},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  name: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  rowLabel: {color: COLORS.textMuted, fontSize: FONT_SIZE.md},
  rowValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: SPACING.md,
  },
  balanceOwed: {color: COLORS.crimson},
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
  linkText: {color: COLORS.accent, fontSize: FONT_SIZE.md},
  backBtn: {
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  backBtnText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
});
