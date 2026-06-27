import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  Switch,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute, useFocusEffect} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {useHeaderBackStore} from '../stores/headerBackStore';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import EyebrowLabel from '../components/EyebrowLabel';
import PillButton from '../components/PillButton';
import ErrorBanner from '../components/ErrorBanner';
import Icon from '../components/Icon';
import Barcode from '../components/Barcode';
import ProductImagePicker from '../components/ProductImagePicker';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
} from '../constants/theme';
import * as ExpoCrypto from 'expo-crypto';
import ApiClient from '../services/ApiClient';
import {useProductCacheStore} from '../stores/productCacheStore';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import type {
  Category,
  ProductCreateInput,
  ProductDetail,
  ProductUpdateInput,
} from '../types/api.types';
import type {ItemsStackParamList} from '../types/navigation.types';

type Nav = NativeStackNavigationProp<ItemsStackParamList, 'ProductEdit'>;
type Route = RouteProp<ItemsStackParamList, 'ProductEdit'>;

// Tax-rate quick picks — 10% is the AU GST default; "0" covers GST-free
// items (e.g. fresh produce). Operator can override via the free input.
const TAX_RATE_PRESETS = [0, 5, 10, 15] as const;

// Default form values surfaced on first paint in create mode. Edit mode
// hydrates from getProductDetail; until that resolves we keep these so the
// inputs are controlled.
const EMPTY_FORM = {
  name: '',
  sku: '',
  barcode: '',
  // Dollar-string (not cents) so the user types $19.99 directly. Converted
  // to cents at submit time and the relay-client converts cents → dollars on
  // the wire (see shared/RelayClient::toProductWirePayload).
  basePriceDollars: '',
  costPriceDollars: '',
  taxRate: '10',
  trackStock: true,
  stockOnHand: '0',
  categoryId: null as number | null,
};

type FormState = typeof EMPTY_FORM;

// Convert a "12.34" dollar string to integer cents. Returns null when the
// input is empty/non-numeric so the caller can skip the field. We round
// rather than truncate so "0.105" becomes 11¢ (avoids accumulating fractional
// cent drift in the operator's mental price).
function dollarsToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed);
  if (Number.isNaN(n) || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function centsToDollarsString(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

// Generate a client-side SKU on CREATE. SKUs are product-specific
// identifiers managed by the core system — the in-app UI shouldn't ask
// the user to type one. Server-side `unique:products,sku` collisions
// on user-typed values were the cause of the recurring "This SKU is
// already in use" pain (raised 10+ times). Prefer barcode-derived (it
// makes the SKU stable across re-imports), fall back to a short UUID
// suffix. Caller pre-checks against `cachedProducts` for collisions.
function generateAutoSku(barcode: string | undefined): string {
  const trimmed = (barcode ?? '').trim();
  if (trimmed) {
    return `SKU-${trimmed}`;
  }
  const uuid = ExpoCrypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `SKU-${uuid}`;
}

const ProductEditScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const haptics = useHaptics();
  const {isTablet} = useResponsiveLayout();

  // Surface a Back button in the shared brand header while focused. NOTE:
  // no cleanup. With react-native-screens v4 + native-stack, the popped
  // screen's blur fires BEFORE the revealed screen's focus on goBack(),
  // so an identity-matched cleanup here wipes the slot just as
  // ProductDetail is about to re-install its own handler — chrome's
  // first paint after goBack() then shows no Back button (the v1.3.69
  // regression). The next focused screen always overwrites the slot;
  // tab-root focus handlers null it when returning to a list.
  const setHeaderBack = useHeaderBackStore(s => s.setOnBack);
  const handleHeaderBack = useCallback(() => {
    haptics.light();
    navigation.goBack();
  }, [haptics, navigation]);
  useFocusEffect(
    useCallback(() => {
      setHeaderBack(handleHeaderBack);
      return undefined;
    }, [setHeaderBack, handleHeaderBack]),
  );
  const formCap = isTablet
    ? ({maxWidth: 720, alignSelf: 'center', width: '100%'} as const)
    : null;

  const productId = route.params?.productId ?? null;
  const isEdit = productId !== null;
  const scannedBarcodeParam = route.params?.scannedBarcode ?? null;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Snapshot of the loaded product so we can diff against the form on
  // save and send ONLY changed fields. This is the v1.3.38 fix for the
  // "This SKU is already in use" error on a barcode-only update: the
  // server's unique:products,sku validator on UPDATE doesn't reliably
  // exclude the current product, so re-sending the unchanged SKU trips
  // a false-positive 422. Sending a real partial patch keeps the
  // server's validator out of the way.
  const [originalDetail, setOriginalDetail] = useState<ProductDetail | null>(
    null,
  );
  const [categories, setCategories] = useState<Category[]>([]);
  // Current product image URL in edit mode. Hydrated from the loaded detail
  // and updated in place when ProductImagePicker reports a successful upload,
  // so the card reflects the new photo without waiting for a re-fetch.
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  // Field-level errors so the user sees what's missing on submit attempt.
  // Cleared as the relevant field is edited.
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    sku?: string;
    basePrice?: string;
    stockOnHand?: string;
    category?: string;
  }>({});

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({...prev, [key]: value}));
  }, []);

  // Pick up a value returned from the Scanner (capture mode). The Scanner
  // merges {scannedBarcode} onto our route params via popTo(); we hydrate
  // the form field and immediately clear the param. Synchronously clearing
  // the param is the dedupe — once cleared, the effect's guard short-
  // circuits until the user makes a fresh trip through the Scanner.
  //
  // Earlier versions tracked the last-applied string in a ref and skipped
  // matching values. That broke the "scan the same code twice" flow:
  // ProductEdit → Scanner → barcode 1234 → back → realise something's off
  // → Scanner → barcode 1234 again → ref shortcuts → field doesn't update
  // → user sees no feedback and reports "it says it's a duplicate."
  // Identity-based dedupe is the wrong tool here; the param-clear handles
  // re-fires and a genuine re-scan should always re-hydrate.
  useEffect(() => {
    if (!scannedBarcodeParam) return;
    const trimmed = scannedBarcodeParam.trim();
    // Clear first so a synchronous re-render from setForm doesn't see the
    // param still set and queue a second pass.
    navigation.setParams({scannedBarcode: undefined});
    if (!trimmed) return;
    setForm(prev =>
      prev.barcode === trimmed ? prev : {...prev, barcode: trimmed},
    );
    haptics.success();
  }, [scannedBarcodeParam, haptics, navigation]);

  // Hydrate categories alongside the product so the picker has options as
  // soon as the form is interactive. Two parallel awaits, both errors land
  // in the same banner.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cats, detail] = await Promise.all([
          ApiClient.getCategories(),
          isEdit && productId !== null
            ? ApiClient.getProductDetail(productId)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setCategories(cats);
        if (detail) {
          setOriginalDetail(detail);
          setCurrentImageUrl(detail.featured_image ?? detail.image_url ?? null);
          setForm({
            name: detail.name ?? '',
            sku: detail.sku ?? '',
            barcode: detail.barcode ?? '',
            basePriceDollars: centsToDollarsString(detail.price_cents),
            costPriceDollars: centsToDollarsString(detail.cost_cents),
            taxRate: String(detail.tax_rate ?? 10),
            // The Product type doesn't expose track_stock — infer from
            // category presence + stock > 0 (a sensible default for edit).
            // Server retains the original flag if we omit it from patch.
            trackStock: detail.stock_on_hand > 0 || detail.stock_levels.length > 0,
            stockOnHand: String(detail.stock_on_hand ?? 0),
            categoryId: detail.category_id,
          });
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load item');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, productId]);

  // Required-field validity drives the submit button disabled state. We
  // compute it inline rather than gating on `fieldErrors` so the button
  // enables/disables as the user types instead of only after a submit
  // attempt populates the errors map.
  const isValid = useMemo(() => {
    if (!form.name.trim()) return false;
    // SKU is NEVER validated user-side. On EDIT it's read-only (hydrated
    // from server). On CREATE it's auto-generated client-side from the
    // barcode (or a short UUID) at submit time — the user never types
    // an SKU, so the "already in use" server error class can't be
    // triggered from this form.
    const cents = dollarsToCents(form.basePriceDollars);
    if (cents === null || cents <= 0) return false;
    // category_id is required server-side (Rule::exists on the FK). The
    // form's "No category" option is therefore not a valid submit state;
    // gate the button + show a field error.
    if (form.categoryId == null) return false;
    if (!isEdit && form.trackStock) {
      const n = parseInt(form.stockOnHand, 10);
      if (Number.isNaN(n) || n < 0) return false;
    }
    return true;
  }, [form, isEdit]);

  const runValidation = useCallback((): boolean => {
    const errs: typeof fieldErrors = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    // SKU validation removed — see isValid above.
    const cents = dollarsToCents(form.basePriceDollars);
    if (cents === null) errs.basePrice = 'Price is required';
    else if (cents <= 0) errs.basePrice = 'Price must be greater than zero';
    if (form.categoryId == null) errs.category = 'Category is required';
    if (!isEdit && form.trackStock) {
      const n = parseInt(form.stockOnHand, 10);
      if (Number.isNaN(n) || n < 0)
        errs.stockOnHand = 'Stock on hand must be zero or more';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form, isEdit]);

  // Synchronous double-tap guard — see CustomerEditScreen for rationale.
  const submitLockRef = useRef(false);
  // What we last sent to the server on update — drives the smart error
  // routing below. If the server complains about a field we deliberately
  // OMITTED from the patch (because the user didn't change it), the
  // message is bogus and we reframe instead of misleading the user.
  const lastSentPatchRef = useRef<ProductUpdateInput | null>(null);
  const syncProducts = useProductCacheStore(s => s.syncProducts);
  const getByBarcode = useProductCacheStore(s => s.getByBarcode);
  const cachedProducts = useProductCacheStore(s => s.products);

  const handleSubmit = useCallback(async () => {
    if (submitLockRef.current) return;
    if (!runValidation()) {
      haptics.error();
      return;
    }

    // Client-side pre-check against the cached catalog. The server is
    // the source of truth, but the barcode guard turns a confusing
    // server-side "already in use" round-trip into an immediate, clearly
    // labelled error. SKU is NEVER pre-checked here because:
    //  - CREATE: the SKU is auto-generated below with its own cache
    //    collision retry (see `resolvedSku` block in handleSubmit).
    //  - EDIT: SKU is read-only, never changed from the loaded value,
    //    and never sent in the update patch. There's nothing to clash
    //    against.
    const trimmedBarcode = form.barcode.trim();
    const barcodeUnchanged =
      isEdit && originalDetail
        ? trimmedBarcode === (originalDetail.barcode ?? '').trim()
        : false;
    const barcodeClash =
      trimmedBarcode && !barcodeUnchanged
        ? (() => {
            const hit = getByBarcode(trimmedBarcode);
            return hit && (productId === null || hit.id !== productId)
              ? hit
              : null;
          })()
        : null;
    if (barcodeClash) {
      haptics.error();
      setError(
        `This barcode is already on "${barcodeClash.name}". Edit that item instead, or scan a different barcode.`,
      );
      return;
    }

    submitLockRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const baseCents = dollarsToCents(form.basePriceDollars) ?? 0;
      const costCents = dollarsToCents(form.costPriceDollars);
      const taxRate = Number.parseFloat(form.taxRate);
      const trackStock = form.trackStock;
      const stockQty = parseInt(form.stockOnHand, 10);

      // Build the typed input. RelayClient::toProductWirePayload converts
      // cents-named fields to dollar fields on the wire — see
      // shared/__tests__/RelayClientWrites.test.ts for the contract.
      // runValidation gates category_id being non-null before we get here,
      // so the non-null assertion is safe. category_id is a real FK on the
      // server (Rule::exists) — sending 0 or omitting it trips validation.
      // SKU resolution:
      //  - EDIT: form.sku is the loaded server value (input field is
      //    read-only). Used for the diff comparison; never sent in the
      //    update patch (server validator misbehaves on update).
      //  - CREATE: auto-generate client-side. Prefer barcode-derived
      //    (stable + identifies the product), fall back to a short UUID
      //    suffix. Loop-with-collision-check against the cached catalog
      //    to avoid a doomed round-trip when the derived value already
      //    exists. ProductCreateInput.sku is required by the server.
      let resolvedSku = form.sku.trim();
      if (!isEdit) {
        let candidate = generateAutoSku(form.barcode);
        let attempts = 0;
        // Walk the cache for an unused SKU. UUID collisions are
        // astronomically rare; barcode-derived collisions happen when
        // the same physical item is re-added (which is the user's
        // problem to resolve via the existing item's edit screen, but
        // we still don't want to crash the form). Cap at 5 retries
        // before giving up and shipping the candidate to the server.
        while (
          attempts < 5 &&
          cachedProducts.some(
            p =>
              typeof p?.sku === 'string' &&
              p.sku.toLowerCase() === candidate.toLowerCase(),
          )
        ) {
          attempts += 1;
          candidate = generateAutoSku(undefined); // force UUID path on retry
        }
        resolvedSku = candidate;
      }

      const input: ProductCreateInput = {
        name: form.name.trim(),
        sku: resolvedSku,
        category_id: form.categoryId!,
        base_price_cents: baseCents,
        ...(form.barcode.trim() ? {barcode: form.barcode.trim()} : {}),
        ...(costCents !== null ? {cost_price_cents: costCents} : {}),
        ...(Number.isFinite(taxRate) ? {tax_rate: taxRate} : {}),
        track_stock: trackStock,
        ...(!isEdit && trackStock && !Number.isNaN(stockQty)
          ? {stock_quantity: stockQty}
          : {}),
      };

      if (isEdit && productId !== null) {
        // Real partial patch: send ONLY fields the user actually changed.
        // The server's unique:products,sku validator on UPDATE has been
        // observed to false-positive against the current row (the rule
        // isn't excluding by id reliably across the dispatcher), and
        // re-sending an unchanged SKU trips it every time. Diffing the
        // form against the loaded `originalDetail` keeps the validator
        // out of the way for the common "I'm only changing the barcode"
        // workflow. Stock + track_stock excluded on edit by design (see
        // earlier comment).
        const patch: ProductUpdateInput = {};
        if (originalDetail) {
          const orig = originalDetail;
          if (input.name !== (orig.name ?? '').trim()) patch.name = input.name;
          // SKU is never sent in an update patch. SKUs are product-specific
          // identifiers managed by the core system — the in-app UI renders
          // the SKU field read-only on edit (see the SKU input above), so
          // by definition it can't have been edited here. Omitting it also
          // sidesteps the known server-side `unique:products,sku`
          // validator that doesn't reliably exclude the current row on
          // update.
          if (input.category_id !== orig.category_id) {
            patch.category_id = input.category_id;
          }
          if (input.base_price_cents !== orig.price_cents) {
            patch.base_price_cents = input.base_price_cents;
          }
          const origBarcode = (orig.barcode ?? '').trim();
          const newBarcode = (input.barcode ?? '').trim();
          if (newBarcode !== origBarcode) {
            patch.barcode = newBarcode;
          }
          if (
            input.cost_price_cents !== undefined &&
            input.cost_price_cents !== orig.cost_cents
          ) {
            patch.cost_price_cents = input.cost_price_cents;
          }
          if (
            input.tax_rate !== undefined &&
            input.tax_rate !== orig.tax_rate
          ) {
            patch.tax_rate = input.tax_rate;
          }
        } else {
          // No baseline — defensive fall-through to the old "send everything"
          // behaviour minus stock/track_stock.
          const {stock_quantity: _stock, track_stock: _track, ...full} = input;
          Object.assign(patch, full);
        }
        // Nothing to send → treat as a no-op success so the user gets the
        // expected "Saved" feedback even when the form is untouched.
        if (Object.keys(patch).length === 0) {
          haptics.success();
          navigation.goBack();
          return;
        }
        lastSentPatchRef.current = patch;
        await ApiClient.updateProduct(productId, patch);
      } else {
        await ApiClient.createProduct(input);
      }

      haptics.success();
      // Fire-and-forget invalidate the catalog cache so QuickSale's
      // product grid + ItemsScreen's low-stock tiles reflect the new /
      // edited row at next mount, instead of waiting up to 5 minutes
      // for the TTL refresh.
      void syncProducts();
      navigation.goBack();
    } catch (e) {
      haptics.error();
      const msg = e instanceof Error ? e.message : 'Failed to save item';
      const lower = msg.toLowerCase();
      // Smart routing: if the server complains about a field we did NOT
      // send in the patch, the message is bogus (server-side validator
      // bug — known to mislabel a BARCODE conflict as an SKU error on
      // update). Reframe so the user understands the actual likely
      // cause is the field they just edited.
      const sentSku = lastSentPatchRef.current?.sku !== undefined;
      const sentBarcode = lastSentPatchRef.current?.barcode !== undefined;
      const looksLikeSkuError = lower.includes('sku');
      const looksLikeBarcodeError = lower.includes('barcode');
      if (looksLikeSkuError && !sentSku && sentBarcode) {
        // Server said "SKU" but we sent a barcode-only patch. Treat as
        // a barcode conflict (the actual likely cause) and show under
        // the barcode field's banner.
        setError(
          'That barcode is already in use on another item. Try a different barcode or open the existing item.',
        );
      } else if (looksLikeSkuError && sentSku) {
        setFieldErrors(p => ({...p, sku: msg}));
      } else if (looksLikeBarcodeError) {
        setError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
      submitLockRef.current = false;
    }
  }, [
    form,
    isEdit,
    productId,
    runValidation,
    haptics,
    navigation,
    syncProducts,
    cachedProducts,
    getByBarcode,
    originalDetail,
  ]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const selectedCategoryName =
    form.categoryId === null
      ? 'None'
      : categories.find(c => c.id === form.categoryId)?.name ?? 'Unknown';

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, formCap]}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>
              {isEdit ? 'Edit item' : 'New item'}
            </Text>
          </View>

          {error ? (
            <View style={styles.bannerWrap}>
              <ErrorBanner message={error} onDismiss={() => setError(null)} />
            </View>
          ) : null}

          <View style={styles.section}>
            <EyebrowLabel>Item details</EyebrowLabel>
            <View style={styles.field}>
              <Text style={styles.label}>Name *</Text>
              <TextInput
                style={[styles.input, fieldErrors.name ? styles.inputError : null]}
                value={form.name}
                onChangeText={t => {
                  set('name', t);
                  if (fieldErrors.name)
                    setFieldErrors(p => ({...p, name: undefined}));
                }}
                placeholder="e.g. Flat white"
                placeholderTextColor={COLORS.inputPlaceholder}
                accessibilityLabel="Item name"
              />
              {fieldErrors.name ? (
                <Text style={styles.fieldError}>{fieldErrors.name}</Text>
              ) : null}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>SKU</Text>
              <TextInput
                style={[styles.input, styles.inputReadOnly]}
                value={form.sku}
                editable={false}
                placeholder={
                  isEdit ? '' : 'Auto-generated when saved'
                }
                placeholderTextColor={COLORS.inputPlaceholder}
                accessibilityLabel={
                  isEdit
                    ? `SKU ${form.sku}. Read-only — set by the system.`
                    : 'SKU. Auto-generated when saved.'
                }
              />
              <Text style={styles.hint}>
                {isEdit
                  ? "SKU is set by the system and can't be changed from the app."
                  : "SKU is generated automatically when the item is saved."}
              </Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Barcode</Text>
              <View style={styles.barcodeRow}>
                <TextInput
                  style={[styles.input, styles.barcodeInput]}
                  value={form.barcode}
                  onChangeText={t => set('barcode', t)}
                  placeholder="Optional"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Barcode"
                />
                <TouchableOpacity
                  style={styles.scanBtn}
                  onPress={() => {
                    haptics.light();
                    navigation.navigate('Scanner', {mode: 'capture'});
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Scan barcode to fill this field">
                  <Icon name="barcode" size={18} color={COLORS.white} />
                  <Text style={styles.scanBtnText}>Scan</Text>
                </TouchableOpacity>
              </View>
              {form.barcode.trim() ? (
                <View style={styles.barcodePreview}>
                  <Barcode
                    value={form.barcode.trim()}
                    width={260}
                    height={70}
                    showText={false}
                  />
                </View>
              ) : (
                <Text style={styles.hint}>
                  Tap Scan to capture a barcode with the camera, or type one in
                  manually.
                </Text>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <EyebrowLabel>Photo</EyebrowLabel>
            {isEdit && productId !== null ? (
              <>
                <ProductImagePicker
                  productId={productId}
                  type="featured"
                  currentImageUrl={currentImageUrl}
                  onUploaded={product => {
                    // Reflect the new photo immediately, then refresh the
                    // catalog cache so QuickSale / Items tiles pick it up.
                    setCurrentImageUrl(
                      product.featured_image ?? product.image_url ?? null,
                    );
                    void syncProducts();
                  }}
                />
                {/* App-Review consent: disclose that the photo can be public. */}
                <Text style={styles.hint}>
                  This photo may be shown publicly — for example on printed
                  receipts or a connected website.
                </Text>
              </>
            ) : (
              <Text style={styles.hint}>
                Save the item first, then re-open it to add a photo.
              </Text>
            )}
          </View>

          <View style={styles.section}>
            <EyebrowLabel>Pricing</EyebrowLabel>
            <View style={styles.field}>
              <Text style={styles.label}>Sell price *</Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceCurrency}>$</Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.priceInput,
                    fieldErrors.basePrice ? styles.inputError : null,
                  ]}
                  value={form.basePriceDollars}
                  onChangeText={t => {
                    set('basePriceDollars', t);
                    if (fieldErrors.basePrice)
                      setFieldErrors(p => ({...p, basePrice: undefined}));
                  }}
                  placeholder="0.00"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Sell price in dollars"
                />
              </View>
              {fieldErrors.basePrice ? (
                <Text style={styles.fieldError}>{fieldErrors.basePrice}</Text>
              ) : null}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Cost price</Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceCurrency}>$</Text>
                <TextInput
                  style={[styles.input, styles.priceInput]}
                  value={form.costPriceDollars}
                  onChangeText={t => set('costPriceDollars', t)}
                  placeholder="Optional"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Cost price in dollars"
                />
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Tax rate (%)</Text>
              <View style={styles.taxChipsRow}>
                {TAX_RATE_PRESETS.map(preset => {
                  const active = String(preset) === form.taxRate.trim();
                  return (
                    <TouchableOpacity
                      key={preset}
                      style={[
                        styles.taxChip,
                        active && styles.taxChipActive,
                      ]}
                      onPress={() => {
                        haptics.selection();
                        set('taxRate', String(preset));
                      }}
                      accessibilityRole="button"
                      accessibilityState={{selected: active}}
                      accessibilityLabel={`Tax rate ${preset} percent`}>
                      <Text
                        style={[
                          styles.taxChipText,
                          active && styles.taxChipTextActive,
                        ]}>
                        {preset}%
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TextInput
                  style={[styles.input, styles.taxInput]}
                  value={form.taxRate}
                  onChangeText={t => set('taxRate', t)}
                  keyboardType="decimal-pad"
                  placeholder="10"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  accessibilityLabel="Custom tax rate"
                />
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <EyebrowLabel>Inventory</EyebrowLabel>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelWrap}>
                <Text style={styles.label}>Track stock</Text>
                <Text style={styles.hint}>
                  {form.trackStock
                    ? 'On-hand counts update with each sale.'
                    : 'Item sells without depleting inventory.'}
                </Text>
              </View>
              <Switch
                value={form.trackStock}
                onValueChange={v => {
                  haptics.selection();
                  set('trackStock', v);
                }}
                accessibilityLabel="Track stock"
              />
            </View>
            {form.trackStock && !isEdit ? (
              <View style={styles.field}>
                <Text style={styles.label}>Opening stock on hand</Text>
                <TextInput
                  style={[
                    styles.input,
                    fieldErrors.stockOnHand ? styles.inputError : null,
                  ]}
                  value={form.stockOnHand}
                  onChangeText={t => {
                    set('stockOnHand', t);
                    if (fieldErrors.stockOnHand)
                      setFieldErrors(p => ({...p, stockOnHand: undefined}));
                  }}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.inputPlaceholder}
                  accessibilityLabel="Stock on hand"
                />
                {fieldErrors.stockOnHand ? (
                  <Text style={styles.fieldError}>{fieldErrors.stockOnHand}</Text>
                ) : null}
              </View>
            ) : null}
            {form.trackStock && isEdit ? (
              <Text style={styles.hint}>
                To change current stock, use "Adjust stock" from the item
                detail.
              </Text>
            ) : null}
          </View>

          <View style={styles.section}>
            <EyebrowLabel>Category</EyebrowLabel>
            <TouchableOpacity
              style={[
                styles.pickerRow,
                fieldErrors.category ? styles.inputError : null,
              ]}
              onPress={() => {
                haptics.light();
                setCategoryPickerOpen(o => !o);
                if (fieldErrors.category)
                  setFieldErrors(p => ({...p, category: undefined}));
              }}
              accessibilityRole="button"
              accessibilityLabel={`Category: ${selectedCategoryName}. Tap to change.`}>
              <Text style={styles.pickerValue}>{selectedCategoryName}</Text>
              <Icon
                name={categoryPickerOpen ? 'chevron-down' : 'chevron-forward'}
                size={18}
                color={COLORS.textMuted}
              />
            </TouchableOpacity>
            {categoryPickerOpen ? (
              <View style={styles.pickerList}>
                <TouchableOpacity
                  style={[
                    styles.pickerItem,
                    form.categoryId === null && styles.pickerItemActive,
                  ]}
                  onPress={() => {
                    haptics.selection();
                    set('categoryId', null);
                    setCategoryPickerOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="No category">
                  <Text style={styles.pickerItemText}>None</Text>
                </TouchableOpacity>
                {categories.map(c => (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.pickerItem,
                      form.categoryId === c.id && styles.pickerItemActive,
                    ]}
                    onPress={() => {
                      haptics.selection();
                      set('categoryId', c.id);
                      setCategoryPickerOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Category ${c.name}`}>
                    <Text style={styles.pickerItemText}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {fieldErrors.category ? (
              <Text style={styles.fieldError}>{fieldErrors.category}</Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <PillButton
              label="Cancel"
              variant="tertiary"
              onPress={() => navigation.goBack()}
              disabled={saving}
              accessibilityLabel={isEdit ? 'Cancel editing item' : 'Cancel new item'}
            />
            <PillButton
              label={saving ? 'Saving...' : isEdit ? 'Save changes' : 'Save item'}
              variant="solid"
              onPress={handleSubmit}
              disabled={!isValid || saving}
            />
          </View>
          {saving ? (
            <View style={styles.loaderRow}>
              <ActivityIndicator color={COLORS.crimson} size="small" />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background},
  flex: {flex: 1},
  scroll: {padding: SPACING.md, paddingBottom: SPACING.xxl},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  header: {marginBottom: SPACING.md},
  title: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    letterSpacing: -0.3,
  },
  bannerWrap: {marginBottom: SPACING.md},
  section: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  field: {marginBottom: SPACING.md},
  label: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.xs + 2,
  },
  hint: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.xs,
  },
  input: {
    minHeight: 44,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontFamily: FONT_FAMILY.regular,
  },
  inputError: {borderColor: COLORS.danger},
  // Read-only inputs (e.g. SKU on edit) get a muted background + slightly
  // dimmed text so it's visually obvious the field can't be tapped to
  // change. The `editable={false}` prop blocks focus + keyboard.
  inputReadOnly: {
    backgroundColor: COLORS.surfaceHover ?? '#f1ece1',
    color: COLORS.textMuted,
  },
  fieldError: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.xs,
  },
  barcodeRow: {flexDirection: 'row', alignItems: 'center', gap: SPACING.sm},
  barcodeInput: {flex: 1},
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.text,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    minHeight: 44,
    gap: SPACING.xs,
  },
  scanBtnText: {
    color: COLORS.white,
    fontFamily: FONT_FAMILY.medium,
    fontSize: FONT_SIZE.sm,
  },
  barcodePreview: {
    marginTop: SPACING.sm,
    alignItems: 'center',
  },
  priceRow: {flexDirection: 'row', alignItems: 'center'},
  priceCurrency: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    marginRight: SPACING.sm,
  },
  priceInput: {flex: 1},
  taxChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs + 2,
    alignItems: 'center',
  },
  taxChip: {
    minHeight: 36,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxChipActive: {borderColor: COLORS.crimson, backgroundColor: COLORS.crimson},
  taxChipText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  taxChipTextActive: {color: COLORS.white},
  taxInput: {width: 80, minHeight: 36, paddingVertical: SPACING.xs + 2},
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
    minHeight: 44,
  },
  switchLabelWrap: {flex: 1, marginRight: SPACING.md},
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  pickerValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  pickerList: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  pickerItem: {
    minHeight: 44,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceBorder,
    justifyContent: 'center',
  },
  pickerItemActive: {backgroundColor: 'rgba(193, 18, 31, 0.08)'},
  pickerItemText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  loaderRow: {alignItems: 'center', marginTop: SPACING.sm},
});

export default ProductEditScreen;
