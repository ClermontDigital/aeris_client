import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';
import ApiClient from '../services/ApiClient';
import {useHaptics} from '../hooks/useHaptics';
import {useCartStore} from '../stores/cartStore';
import type {Customer} from '../types/api.types';
import type {QuickSaleStackParamList} from '../types/navigation.types';

type Nav = NativeStackNavigationProp<QuickSaleStackParamList, 'CustomerPicker'>;

const PER_PAGE = 50;

// Same client-side filter rationale as CustomersScreen: customers.search
// via the relay is currently blocked by the marketplace dispatcher's
// path-placeholder bug, so we filter the loaded pages locally.
function localFilter(items: Customer[], q: string): Customer[] {
  const trimmed = q.trim().toLowerCase();
  if (!trimmed) return items;
  return items.filter(c => {
    return (
      c.name.toLowerCase().includes(trimmed) ||
      (c.email ?? '').toLowerCase().includes(trimmed) ||
      (c.phone ?? '').toLowerCase().includes(trimmed)
    );
  });
}

export default function CustomerPickerScreen() {
  const navigation = useNavigation<Nav>();
  const haptics = useHaptics();
  const setCustomer = useCartStore(state => state.setCustomer);

  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const fetchPage = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await ApiClient.listCustomers(1, PER_PAGE);
      if (seq !== requestSeq.current) return;
      setItems(result.data);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load customers');
    } finally {
      if (seq === requestSeq.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const handleWalkIn = useCallback(() => {
    haptics.light();
    setCustomer(null, null);
    navigation.goBack();
  }, [haptics, setCustomer, navigation]);

  const handleSelect = useCallback(
    (c: Customer) => {
      haptics.light();
      setCustomer(c.id, c.name || '(unnamed)');
      navigation.goBack();
    },
    [haptics, setCustomer, navigation],
  );

  const visible = useMemo(() => localFilter(items, search), [items, search]);

  const renderItem = ({item}: {item: Customer}) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => handleSelect(item)}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name || '(unnamed)'}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[item.email, item.phone].filter(Boolean).join(' · ') || '—'}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={COLORS.textMuted}
      />
    </TouchableOpacity>
  );

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {search ? 'No customers match your search' : 'No customers found'}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Select Customer</Text>
      </View>

      <TouchableOpacity
        style={styles.walkInBtn}
        activeOpacity={0.8}
        onPress={handleWalkIn}
        accessibilityRole="button"
        accessibilityLabel="Use walk-in customer">
        <Ionicons
          name="walk-outline"
          size={20}
          color={COLORS.white}
          style={styles.walkInIcon}
        />
        <Text style={styles.walkInText}>Use Walk-in Customer</Text>
      </TouchableOpacity>

      <View style={styles.searchRow}>
        <Ionicons
          name="search"
          size={18}
          color={COLORS.textMuted}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search customers by name, email, or phone"
          placeholderTextColor={COLORS.inputPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={fetchPage}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isLoading && items.length === 0 ? (
        <ActivityIndicator
          color={COLORS.accent}
          size="large"
          style={styles.loader}
        />
      ) : (
        <FlatList
          data={visible}
          renderItem={renderItem}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmpty}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  header: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700',
  },
  walkInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.crimson,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
  },
  walkInIcon: {marginRight: SPACING.sm},
  walkInText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    height: 44,
  },
  searchIcon: {marginRight: SPACING.sm},
  searchInput: {flex: 1, color: COLORS.text, fontSize: FONT_SIZE.md},
  clearBtn: {paddingHorizontal: SPACING.xs},
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.danger,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  errorText: {color: COLORS.white, fontSize: FONT_SIZE.sm, flex: 1},
  retryText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    marginLeft: SPACING.md,
    textDecorationLine: 'underline',
  },
  loader: {marginTop: SPACING.xl},
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  rowLeft: {flex: 1, marginRight: SPACING.md},
  rowName: {color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600'},
  rowMeta: {color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginTop: 2},
  emptyContainer: {alignItems: 'center', paddingTop: SPACING.xxl},
  emptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontWeight: '500',
  },
});
