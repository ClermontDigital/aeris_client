import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native';
import {CameraView, useCameraPermissions} from 'expo-camera';
import {useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from '../components/Icon';
import {useProductCacheStore} from '../stores/productCacheStore';
import {useCartStore} from '../stores/cartStore';
import {useHaptics} from '../hooks/useHaptics';
import ApiClient from '../services/ApiClient';
import type {Product, ProductDetail} from '../types/api.types';
import type {ItemsStackParamList} from '../types/navigation.types';
import {COLORS, SPACING, FONT_SIZE, FONT_FAMILY, BORDER_RADIUS} from '../constants/theme';

const formatCents = (cents: number): string => '$' + (cents / 100).toFixed(2);

// In 'detail' mode, found products are pushed to ProductDetail (Items tab).
// In 'cart' mode (default), they show a card with Add-to-Cart (QuickSale tab).
// In 'capture' mode, the first valid scan is merged back onto the previous
// screen's params as `scannedBarcode` and the scanner pops — used by
// ProductEdit's "Scan" affordance, where the goal is to capture the digits,
// not look up an existing product.
type ScanMode = 'cart' | 'detail' | 'capture';

// Scanner is registered in both QuickSaleStack and ItemsStack. The 'detail'
// mode replace() target ProductDetail only exists in ItemsStackParamList,
// so we type against that — 'cart' mode never calls .replace().
type Nav = NativeStackNavigationProp<ItemsStackParamList, 'Scanner'>;

const BarcodeScannerScreen: React.FC = () => {
  const isFocused = useIsFocused();
  // Both stacks declare Scanner with different param shapes; we read the
  // mode via a permissive route type and default to 'cart'.
  const route = useRoute<RouteProp<ItemsStackParamList, 'Scanner'>>();
  const mode: ScanMode =
    route.params?.mode === 'detail'
      ? 'detail'
      : route.params?.mode === 'capture'
      ? 'capture'
      : 'cart';
  const navigation = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<
    Product | ProductDetail | null
  >(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [scanLock, setScanLock] = useState(false);
  const [manualFocused, setManualFocused] = useState(false);
  // Synchronous lock for capture mode. expo-camera can call onBarcodeScanned
  // twice within the same tick before React commits a setScanLock(true), so
  // the state-driven gate isn't enough to prevent double pops/double lookups.
  // A ref flips immediately and blocks the second call dead.
  const scanLockRef = useRef(false);

  const getByBarcode = useProductCacheStore(s => s.getByBarcode);
  const addItem = useCartStore(s => s.addItem);
  const haptics = useHaptics();

  const lookupBarcode = useCallback(
    async (barcode: string) => {
      if (scanLockRef.current || isLookingUp || scanLock) return;
      scanLockRef.current = true;
      setScanLock(true);
      // Capture mode: don't bother looking up the product. We're just
      // sourcing a string for a form field, so hand it straight back to
      // the previous screen with the value merged onto its params. The
      // ref-based lock above is what actually prevents the double-pop —
      // the state lock alone races the camera's same-tick double-fire.
      if (mode === 'capture') {
        // Cross-stack guard: capture mode hardcodes ProductEdit as the
        // return target. The Scanner is also registered in QuickSaleStack
        // where ProductEdit doesn't exist; bail loudly rather than leave
        // the user stranded in the camera view.
        const navState = (navigation as unknown as {
          getState?: () => {routes: Array<{name: string}>};
        }).getState?.();
        const hasProductEdit =
          navState?.routes.some(r => r.name === 'ProductEdit') ?? false;
        if (!hasProductEdit) {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.warn(
              "Scanner: capture mode used in a stack without 'ProductEdit'. Going back instead.",
            );
          }
          navigation.goBack();
          return;
        }
        haptics.success();
        // popTo is part of React Navigation 7's native-stack API. Defensive
        // fallback in case a runtime mismatch leaves it undefined: read the
        // existing ProductEdit params off navState and call navigate with
        // a MERGED params object so we don't clobber productId (which is
        // already on the route in edit mode). React Navigation 7 native-
        // stack `navigate` replaces params by default — merging manually
        // is what gives us the same behaviour popTo would have given.
        const navWithPopTo = navigation as unknown as {
          popTo?: (name: string, params?: object) => void;
        };
        if (typeof navWithPopTo.popTo === 'function') {
          navWithPopTo.popTo('ProductEdit', {scannedBarcode: barcode});
        } else {
          const existing = navState?.routes.find(r => r.name === 'ProductEdit') as
            | {params?: Record<string, unknown>}
            | undefined;
          navigation.navigate('ProductEdit', {
            ...(existing?.params ?? {}),
            scannedBarcode: barcode,
          });
        }
        return;
      }
      setIsLookingUp(true);
      setNotFound(false);
      setScannedProduct(null);

      const refreshStock = async (productId: number) => {
        try {
          const snapshot = await ApiClient.getStock(productId);
          setScannedProduct(prev =>
            prev && prev.id === productId
              ? {...prev, stock_on_hand: snapshot.available}
              : prev,
          );
        } catch {
          // Live stock is best-effort; keep showing cached value on failure.
        }
      };

      // In detail mode, jump straight to the product page on a hit. We
      // navigation.replace rather than navigate so the Scanner doesn't
      // pile up in the back stack between scans.
      const goDetail = (productId: number) => {
        haptics.success();
        navigation.replace('ProductDetail', {productId});
      };

      // Try local cache first
      const cached = getByBarcode(barcode);
      if (cached) {
        if (mode === 'detail') {
          setIsLookingUp(false);
          goDetail(cached.id);
          return;
        }
        setScannedProduct(cached);
        setIsLookingUp(false);
        haptics.success();
        refreshStock(cached.id);
        return;
      }

      // Fallback to API
      try {
        const product = await ApiClient.getProductByBarcode(barcode);
        if (product) {
          if (mode === 'detail') {
            goDetail(product.id);
            return;
          }
          setScannedProduct(product);
          haptics.success();
          refreshStock(product.id);
        } else {
          setNotFound(true);
          haptics.error();
        }
      } catch {
        setNotFound(true);
        haptics.error();
      } finally {
        setIsLookingUp(false);
      }
    },
    [getByBarcode, isLookingUp, scanLock, haptics, mode, navigation],
  );

  const handleBarcodeScanned = useCallback(
    (result: {data: string}) => {
      if (scanLock) return;
      lookupBarcode(result.data);
    },
    [lookupBarcode, scanLock],
  );

  // Auto re-arm after a not-found result so the user doesn't have to tap
  // "Scan Again" to retry. Manual entry / found-product flow still owns its
  // own dismiss button because the user needs to choose Add-to-Cart first.
  useEffect(() => {
    if (!notFound) return;
    const t = setTimeout(() => {
      setNotFound(false);
      setScanLock(false);
      scanLockRef.current = false;
    }, 1500);
    return () => clearTimeout(t);
  }, [notFound]);

  const handleManualSubmit = useCallback(() => {
    const code = manualBarcode.trim();
    if (!code) return;
    lookupBarcode(code);
    setManualBarcode('');
  }, [manualBarcode, lookupBarcode]);

  const handleAddToCart = useCallback(() => {
    if (!scannedProduct) return;
    addItem(scannedProduct as Product);
    Alert.alert('Added', `${scannedProduct.name} added to cart.`);
    setScannedProduct(null);
    setScanLock(false);
    scanLockRef.current = false;
  }, [scannedProduct, addItem]);

  const handleDismiss = useCallback(() => {
    setScannedProduct(null);
    setNotFound(false);
    setScanLock(false);
    scanLockRef.current = false;
  }, []);

  // Permission not yet determined
  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  // Permission denied. We have two flavours:
  // - First-time / soft-deny: canAskAgain=true → the OS-level prompt will
  //   appear on requestPermission(). Show "Grant Permission".
  // - Hard-deny (user disabled it in Settings, or denied with "Don't ask
  //   again" on Android): canAskAgain=false → requestPermission() silently
  //   no-ops. Show "Open Settings" instead so the user has a path forward,
  //   not a dead button (Apple Review tests this flow).
  if (!permission.granted) {
    const hardDenied = !permission.canAskAgain;
    return (
      <View style={styles.centered}>
        <Icon name="camera-outline" size={64} color={COLORS.textDim} />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          {hardDenied
            ? 'Camera access is turned off for AERIS. Open Settings to re-enable it so you can scan product barcodes.'
            : 'The barcode scanner needs access to your camera to scan product barcodes.'}
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          accessibilityRole="button"
          accessibilityLabel={hardDenied ? 'Open Settings' : 'Grant camera permission'}
          onPress={() => {
            if (hardDenied) {
              Linking.openSettings();
            } else {
              requestPermission();
            }
          }}>
          <Text style={styles.permissionButtonText}>
            {hardDenied ? 'Open Settings' : 'Grant Permission'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Unmount the camera while the result card / not-found card is up.
          The card visually covers the preview anyway and keeping the capture
          pipeline running burns battery + warms the phone for nothing.
          Auto-rearm path: clearing scannedProduct/notFound also re-mounts
          the camera, which is fine — expo-camera's mount time is < 200ms. */}
      {isFocused && !scannedProduct && !notFound ? (
        <CameraView
          style={styles.camera}
          facing="back"
          enableTorch={torchOn}
          autofocus="on"
          barcodeScannerSettings={{
            barcodeTypes: [
              'ean13',
              'ean8',
              'upc_a',
              'upc_e',
              'code128',
              'code39',
            ],
          }}
          onBarcodeScanned={
            scanLock || isLookingUp ? undefined : handleBarcodeScanned
          }
        />
      ) : null}

      {/* Centered viewfinder reticle. Pure visual affordance — barcode
          detection happens across the whole frame, but the box gives the
          operator a clear target to aim at, which is essential when
          scanning a code displayed on another device's screen (no
          natural depth-of-field cue for the camera to lock onto).
          pointerEvents=none so it never swallows torch / manual taps. */}
      {isFocused && !scannedProduct && !notFound && !isLookingUp ? (
        <View style={styles.reticleWrap} pointerEvents="none">
          <View style={styles.reticleBox}>
            <View style={[styles.reticleCorner, styles.reticleCornerTL]} />
            <View style={[styles.reticleCorner, styles.reticleCornerTR]} />
            <View style={[styles.reticleCorner, styles.reticleCornerBL]} />
            <View style={[styles.reticleCorner, styles.reticleCornerBR]} />
          </View>
          <Text style={styles.reticleLegend}>
            Centre the barcode in the box
          </Text>
        </View>
      ) : null}

      {/* Centered busy overlay — pauses scanning visually while a lookup
          is in flight so the user knows fresh scans are ignored. */}
      {isLookingUp ? (
        <View style={styles.busyOverlay} pointerEvents="none">
          <View style={styles.busyCard}>
            <ActivityIndicator size="small" color={COLORS.accent} />
            <Text style={styles.busyText}>Looking up…</Text>
          </View>
        </View>
      ) : null}

      {/* Top overlay */}
      <View style={styles.topOverlay}>
        <Text style={styles.topTitle}>
          {mode === 'capture' ? 'Capture Barcode' : 'Scan Barcode'}
        </Text>
        <TouchableOpacity
          style={styles.torchButton}
          onPress={() => setTorchOn(prev => !prev)}>
          <Icon
            name={torchOn ? 'flash' : 'flash-off'}
            size={22}
            color={COLORS.cream}
          />
        </TouchableOpacity>
      </View>

      {/* Bottom area */}
      <View style={styles.bottomArea}>
        {/* Loading indicator */}
        {isLookingUp ? (
          <View style={styles.resultCard}>
            <ActivityIndicator size="small" color={COLORS.accent} />
            <Text style={styles.lookingUpText}>Looking up product...</Text>
          </View>
        ) : null}

        {/* Product found */}
        {scannedProduct && !isLookingUp ? (
          <View style={styles.resultCard}>
            <Text style={styles.productName}>{scannedProduct.name}</Text>
            <View style={styles.productDetails}>
              <Text style={styles.productPrice}>
                {formatCents(scannedProduct.price_cents)}
              </Text>
              <Text style={styles.productStock}>
                Stock: {scannedProduct.stock_on_hand}
              </Text>
            </View>
            <View style={styles.resultActions}>
              <TouchableOpacity
                style={styles.addToCartButton}
                onPress={handleAddToCart}>
                <Icon name="cart" size={18} color={COLORS.white} />
                <Text style={styles.addToCartText}>Add to Cart</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={handleDismiss}>
                <Text style={styles.dismissText}>Scan Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Not found — auto re-arms after a short delay; the button is a
            shortcut for impatient users. */}
        {notFound && !isLookingUp ? (
          <View style={styles.resultCard}>
            <Text style={styles.notFoundText}>No product matched</Text>
            <TouchableOpacity
              style={styles.dismissButton}
              onPress={handleDismiss}>
              <Text style={styles.dismissText}>Scan Again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Manual entry */}
        <TouchableOpacity
          style={styles.manualToggle}
          onPress={() => setManualEntry(prev => !prev)}>
          <Icon name="keypad-outline" size={16} color={COLORS.cream} />
          <Text style={styles.manualToggleText}>
            {manualEntry ? 'Hide manual entry' : 'Enter barcode manually'}
          </Text>
        </TouchableOpacity>

        {manualEntry ? (
          <View style={styles.manualInputRow}>
            <TextInput
              style={[
                styles.manualInput,
                manualFocused && styles.manualInputFocused,
              ]}
              placeholder="Barcode number"
              placeholderTextColor={COLORS.inputPlaceholder}
              value={manualBarcode}
              onChangeText={setManualBarcode}
              onFocus={() => setManualFocused(true)}
              onBlur={() => setManualFocused(false)}
              keyboardType="default"
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={handleManualSubmit}
            />
            <TouchableOpacity
              style={styles.manualSubmit}
              onPress={handleManualSubmit}>
              <Icon name="search" size={20} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  // Reticle is centered in the entire viewport. The box itself is a
  // transparent-fill cream-outlined rect; the corners are crimson L-shapes
  // pinned at each corner that read as a camera viewfinder.
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  reticleBox: {
    width: 260,
    height: 180,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2,
    borderColor: 'rgba(255, 249, 236, 0.92)', // cream @ ~92%
    backgroundColor: 'transparent',
  },
  reticleCorner: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderColor: COLORS.crimson,
  },
  reticleCornerTL: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: BORDER_RADIUS.lg,
  },
  reticleCornerTR: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: BORDER_RADIUS.lg,
  },
  reticleCornerBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: BORDER_RADIUS.lg,
  },
  reticleCornerBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: BORDER_RADIUS.lg,
  },
  reticleLegend: {
    marginTop: SPACING.md,
    color: COLORS.cream,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    opacity: 0.75,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
  busyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cream,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  busyText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.modalBg, // navy 92%
  },
  // Cream on navy — was COLORS.text (now navy in cream theme), which made
  // the title invisible against the navy modalBg backdrop.
  topTitle: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.medium,
  },
  torchButton: {
    width: 40,
    height: 40,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.toolbarBtn,
    borderWidth: 1,
    borderColor: COLORS.toolbarBtnBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Semi-transparent navy backdrop so any text rendered directly in the
  // bottom area (manual-entry toggle, errors) stays legible against an
  // arbitrary camera scene. The result cards inside still pop forward as
  // bright cream surfaces.
  bottomArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
    backgroundColor: 'rgba(0, 48, 73, 0.85)',
  },
  resultCard: {
    backgroundColor: COLORS.cream,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  lookingUpText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  productName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.xs,
  },
  productDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  productPrice: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
  },
  productStock: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    alignSelf: 'center',
  },
  resultActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  addToCartButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.crimson,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.xs,
  },
  addToCartText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  // Outline-on-cream so the button reads as a button against the cream
  // result card (the previous near-white surfaceHover bg was effectively
  // invisible, ~1.05 contrast on cream).
  dismissButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.text, // navy outline
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  notFoundText: {
    color: COLORS.warning,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
  },
  // Cream on navy backdrop. textMuted (slate-navy) was unreadable here.
  manualToggleText: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.sm,
  },
  manualInputRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  manualInput: {
    flex: 1,
    height: 44,
    backgroundColor: COLORS.inputBg,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
  },
  manualInputFocused: {
    borderColor: COLORS.inputFocusBorder,
    backgroundColor: COLORS.inputFocusBg,
  },
  manualSubmit: {
    width: 44,
    height: 44,
    backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  permissionText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    lineHeight: 22,
  },
  permissionButton: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  permissionButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
});

export default BarcodeScannerScreen;
