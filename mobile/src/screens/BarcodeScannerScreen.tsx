import React, {useState, useCallback, useEffect, useMemo, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Linking,
  type GestureResponderEvent,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useCodeScanner,
  type Code,
  type CodeType,
} from 'react-native-vision-camera';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from '../components/Icon';
import {useProductCacheStore} from '../stores/productCacheStore';
import {useCartStore} from '../stores/cartStore';
import {useScannerVisibilityStore} from '../stores/scannerVisibilityStore';
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
  const {hasPermission, requestPermission} = useCameraPermission();
  // Back-camera device. vision-camera v4 returns `undefined` while the
  // platform enumerates devices (one-frame splash). The `isActive` gate
  // on <Camera> handles that — we just render the centered spinner.
  // TODO(stocktake): swap to `useCameraDevice('back', {physicalDevices:
  // Request a VIRTUAL multi-lens back device. On iPhone Pro models (and
  // iPhone 13+ with dual cameras) this hands us a device that iOS
  // automatically switches between based on focus distance — when the
  // user holds the phone close to a barcode (< ~10 cm), the system
  // transparently swaps to the ultra-wide lens, which can focus down
  // to ~2 cm. The wide lens alone is mechanically limited to ~10 cm
  // minimum focus distance and produces the "barcode is blurry up
  // close" effect.
  //
  // physicalDevices is a *preference*. vision-camera matches the
  // closest available device; on a single-lens iPhone (SE, base iPhone)
  // we fall back to plain 'wide-angle-camera' transparently, so this
  // is safe to apply unconditionally.
  //
  // The lens priority `['ultra-wide-angle-camera', 'wide-angle-camera',
  // 'telephoto-camera']` requests "give me everything you have"; iOS
  // exposes the combined virtual device (e.g. `back-dual-wide-camera`,
  // `back-triple-camera`) and handles the lens switching internally.
  const defaultDevice = useCameraDevice('back', {
    physicalDevices: [
      'ultra-wide-angle-camera',
      'wide-angle-camera',
      'telephoto-camera',
    ],
  });
  // Macro-only device for the explicit "Macro" toggle below. On phones
  // without an ultra-wide lens this falls back to whatever 'back' picks
  // — which is the same as defaultDevice, so the toggle is a no-op for
  // those users. We only show the toggle button when defaultDevice
  // actually exposes the ultra-wide lens.
  const macroDevice = useCameraDevice('back', {
    physicalDevices: ['ultra-wide-angle-camera'],
  });
  const [isMacroMode, setIsMacroMode] = useState(false);
  const device = isMacroMode ? macroDevice ?? defaultDevice : defaultDevice;
  // Show the macro toggle only on devices that actually have an
  // ultra-wide lens. defaultDevice.physicalDevices lists the lens
  // identifiers the virtual device combines; ultra-wide presence ⇒
  // toggle is meaningful.
  const hasMacroLens =
    defaultDevice?.physicalDevices?.includes('ultra-wide-angle-camera') ??
    false;
  // Pick a format with phase-detection AF. Without this, vision-camera
  // selects a default format and on some devices that format has
  // `autoFocusSystem: 'none'` — so tap-to-focus is a silent no-op and
  // continuous AF never kicks in. Sorted by priority: AF first, then a
  // sane video resolution. Format is undefined while the device hook
  // is still resolving.
  const format = useCameraFormat(device, [
    {autoFocusSystem: 'phase-detection'},
    {videoResolution: {width: 1920, height: 1080}},
  ]);
  const cameraRef = useRef<Camera>(null);
  const [torchOn, setTorchOn] = useState(false);
  // Zoom maps to the device's native range. vision-camera exposes
  // `minZoom`/`maxZoom`/`neutralZoom` per-device; we clamp to a usable
  // range (1x .. 3x equivalent) to keep digital crop sane.
  const ZOOM_STEP = 0.25;
  const [zoom, setZoom] = useState(1);
  const zoomMax = useMemo(() => {
    if (!device) return 3;
    // Cap at min(device.maxZoom, 3x neutralZoom) — beyond that on most
    // phones the wide lens is just upscaled pixels and decode rate
    // tanks.
    return Math.min(device.maxZoom ?? 3, (device.neutralZoom ?? 1) * 3);
  }, [device]);
  const zoomMin = device?.minZoom ?? 1;
  // Transient on-screen reticle at the user's tap point. Driven separately
  // from the actual `camera.focus({x,y})` call so we can show the bubble
  // even on devices where the imperative focus is a no-op.
  const [focusAt, setFocusAt] = useState<{x: number; y: number} | null>(null);
  const focusReticleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scannedProduct, setScannedProduct] = useState<
    Product | ProductDetail | null
  >(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [scanLock, setScanLock] = useState(false);
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

  // "Add to Cart" — adds the scanned product and exits the scanner back
  // to whatever sent us here (typically QuickSale / POS). One-and-done
  // flow for users who want to finish the sale after a single scan.
  const handleAddToCart = useCallback(() => {
    if (!scannedProduct) return;
    addItem(scannedProduct as Product);
    haptics.success();
    navigation.goBack();
  }, [scannedProduct, addItem, haptics, navigation]);

  // "Add to Cart and Scan Again" — adds the scanned product and clears
  // the result state so the camera is ready for the next scan. Stays on
  // the scanner. Continuous-scanning flow for multi-item carts / stocktake.
  const handleAddAndScanAgain = useCallback(() => {
    if (!scannedProduct) return;
    addItem(scannedProduct as Product);
    haptics.success();
    setScannedProduct(null);
    setScanLock(false);
    scanLockRef.current = false;
  }, [scannedProduct, addItem, haptics]);

  // "Scan Again" — discard the current scan without adding to the cart,
  // re-arm for the next scan. Also reused by the not-found card where
  // there's nothing to add anyway.
  const handleDismiss = useCallback(() => {
    setScannedProduct(null);
    setNotFound(false);
    setScanLock(false);
    scanLockRef.current = false;
  }, []);

  // Tap-to-focus. Gates on `device.supportsFocus` to avoid the silent
  // catch hiding "this device doesn't support focus at all" from us in
  // logs. The reticle still shows on tap regardless so the user gets
  // visual feedback that the tap was registered.
  const handleFocusTap = useCallback(
    async (e: GestureResponderEvent) => {
      const {locationX, locationY} = e.nativeEvent;
      setFocusAt({x: locationX, y: locationY});
      if (focusReticleTimer.current) clearTimeout(focusReticleTimer.current);
      focusReticleTimer.current = setTimeout(() => setFocusAt(null), 700);
      if (!device?.supportsFocus) {
        // Skip the imperative call; continuous AF (selected via format
        // above) is doing what it can.
        return;
      }
      try {
        await cameraRef.current?.focus({x: locationX, y: locationY});
      } catch {
        // Focus is busy or interrupted — next tap retries. Continuous AF
        // is still running underneath.
      }
    },
    [device],
  );

  const handleZoomIn = useCallback(() => {
    haptics.light();
    setZoom(z => Math.min(zoomMax, +(z + ZOOM_STEP).toFixed(2)));
  }, [haptics, zoomMax]);

  const handleZoomOut = useCallback(() => {
    haptics.light();
    setZoom(z => Math.max(zoomMin, +(z - ZOOM_STEP).toFixed(2)));
  }, [haptics, zoomMin]);

  // Clean up focus timer on unmount.
  useEffect(() => {
    return () => {
      if (focusReticleTimer.current) clearTimeout(focusReticleTimer.current);
    };
  }, []);

  // Tell AppTabsInner to hide the pendant + gear while the camera is up.
  // The chrome reads `useScannerVisibilityStore.isScannerVisible`; we
  // flip it on focus and back on blur (useFocusEffect's cleanup fires
  // on blur AND unmount, so navigating away via swipe-back or tab tap
  // both restore the header).
  const setScannerVisible = useScannerVisibilityStore(s => s.setScannerVisible);
  useFocusEffect(
    useCallback(() => {
      setScannerVisible(true);
      return () => setScannerVisible(false);
    }, [setScannerVisible]),
  );

  const handleCancel = useCallback(() => {
    haptics.light();
    navigation.goBack();
  }, [navigation, haptics]);

  // vision-camera's useCodeScanner runs detection on the UI thread and
  // dispatches `onCodeScanned` with an array of Code objects per frame.
  // We take the first valid value and feed it into our existing lookup
  // pipeline. `codeTypes` maps 1:1 to our previous expo-camera types
  // (hyphenated naming in vision-camera).
  const CODE_TYPES: CodeType[] = useMemo(
    () => ['ean-13', 'ean-8', 'upc-a', 'upc-e', 'code-128', 'code-39'],
    [],
  );
  const handleCodesScanned = useCallback(
    (codes: Code[]) => {
      if (scanLockRef.current || isLookingUp || scanLock) return;
      const value = codes.find(c => typeof c.value === 'string')?.value;
      if (!value) return;
      lookupBarcode(value);
    },
    [isLookingUp, scanLock, lookupBarcode],
  );
  const codeScanner = useCodeScanner({
    codeTypes: CODE_TYPES,
    onCodeScanned: handleCodesScanned,
  });

  // Permission gate. vision-camera v4's hook returns a stable
  // `hasPermission` boolean once the platform has answered. We render
  // a spinner while undefined-equivalent (false on first paint) and
  // route into Grant / Open-Settings paths once we know the state.
  // The "open Settings" fallback is essential for hard-deny — calling
  // requestPermission() on a previously-denied state silently no-ops
  // and the user would otherwise be staring at a dead button (Apple
  // Review specifically tests this flow).
  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Icon name="camera-outline" size={64} color={COLORS.textDim} />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          The barcode scanner needs access to your camera to scan product
          barcodes. If you previously denied access, open Settings to enable
          it.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          accessibilityRole="button"
          accessibilityLabel="Grant camera permission"
          onPress={async () => {
            const granted = await requestPermission();
            if (!granted) Linking.openSettings();
          }}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Device enumeration is async on first paint. Show a spinner while
  // we wait — typically resolves within one frame.
  if (!device) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* vision-camera's `isActive` pauses capture WITHOUT unmounting.
          Replaces the expo-camera mount-gate that caused the preview
          blink on every result-card show/hide cycle. Pressable wraps
          the camera surface for tap-to-focus; the actual focus call
          is imperative via cameraRef (no remount, no blink). */}
      <Pressable
        style={styles.camera}
        onPress={handleFocusTap}
        accessibilityRole="button"
        accessibilityLabel="Tap on the barcode to focus the camera">
        <Camera
          ref={cameraRef}
          style={styles.camera}
          device={device}
          format={format}
          isActive={isFocused && !scannedProduct && !notFound}
          torch={torchOn ? 'on' : 'off'}
          zoom={zoom}
          enableZoomGesture
          codeScanner={codeScanner}
        />
      </Pressable>

      {/* Transient tap-to-focus reticle — small circle that fades the user's
          tap into a visual confirmation that focus is being re-acquired.
          Sits above the camera but below the topOverlay; pointerEvents=none
          so it never blocks subsequent taps on the same area. */}
      {focusAt ? (
        <View
          style={[
            styles.focusReticle,
            {left: focusAt.x - 28, top: focusAt.y - 28},
          ]}
          pointerEvents="none"
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
            Centre the barcode in the box · Tap to refocus
          </Text>
          <Text style={styles.reticleHint}>
            Move closer for macro focus · pinch zoom to frame
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

      {/* Top overlay — Cancel left, title centre, torch right. The user
          needs a clear exit affordance from the scanner if nothing scans;
          previously the only way back was the system-level swipe gesture,
          which is invisible to a first-time operator. */}
      <View style={styles.topOverlay}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel and go back"
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>
          {mode === 'capture' ? 'Capture Barcode' : 'Scan Barcode'}
        </Text>
        <View style={styles.topOverlayRight}>
          {hasMacroLens ? (
            <TouchableOpacity
              style={[
                styles.macroButton,
                isMacroMode && styles.macroButtonActive,
              ]}
              onPress={() => {
                haptics.selection();
                setIsMacroMode(prev => !prev);
              }}
              accessibilityRole="button"
              accessibilityState={{selected: isMacroMode}}
              accessibilityLabel={
                isMacroMode
                  ? 'Disable macro lens (return to auto)'
                  : 'Enable macro lens for close-up scanning'
              }>
              <Text
                style={[
                  styles.macroButtonText,
                  isMacroMode && styles.macroButtonTextActive,
                ]}>
                Macro
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.torchButton}
            onPress={() => setTorchOn(prev => !prev)}
            accessibilityRole="button"
            accessibilityLabel={torchOn ? 'Turn torch off' : 'Turn torch on'}>
            <Icon
              name={torchOn ? 'flash' : 'flash-off'}
              size={22}
              color={COLORS.cream}
            />
          </TouchableOpacity>
        </View>
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
                style={styles.secondaryActionButton}
                onPress={handleAddAndScanAgain}>
                <Text style={styles.dismissText}>Add to Cart and Scan Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryActionButton}
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

        {/* Zoom controls. The only reliable lever expo-camera v55 gives us
            for framing a small/distant barcode without physically moving
            the phone. Hidden while a result card is up (where it'd just
            be noise) and during lookup. */}
        {!scannedProduct && !notFound && !isLookingUp ? (
          <View style={styles.zoomRow}>
            <TouchableOpacity
              style={[
                styles.zoomButton,
                zoom <= zoomMin && styles.zoomButtonDisabled,
              ]}
              onPress={handleZoomOut}
              disabled={zoom <= zoomMin}
              accessibilityRole="button"
              accessibilityLabel="Zoom out"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <Text style={styles.zoomButtonText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.zoomButton,
                zoom >= zoomMax && styles.zoomButtonDisabled,
              ]}
              onPress={handleZoomIn}
              disabled={zoom >= zoomMax}
              accessibilityRole="button"
              accessibilityLabel="Zoom in"
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <Text style={styles.zoomButtonText}>+</Text>
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
  reticleHint: {
    marginTop: 4,
    color: COLORS.cream,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.regular,
    opacity: 0.55,
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
  topOverlayRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
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
  macroButton: {
    height: 40,
    paddingHorizontal: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.toolbarBtn,
    borderWidth: 1,
    borderColor: COLORS.toolbarBtnBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  macroButtonActive: {
    backgroundColor: COLORS.cream,
    borderColor: COLORS.cream,
  },
  macroButtonText: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  macroButtonTextActive: {
    color: COLORS.navy,
  },
  cancelButton: {
    minWidth: 64,
    height: 40,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  // Transient tap-to-focus indicator. 56×56 cream-bordered circle that
  // fades after ~700ms (handled in JS via the focusReticleTimer).
  focusReticle: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255, 247, 230, 0.95)',
    zIndex: 3,
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
  // Three actions on the found-product card stack vertically:
  // (1) Add to Cart — primary red, goes back to POS
  // (2) Add to Cart and Scan Again — secondary outline, stays on scanner
  // (3) Scan Again — secondary outline, discards scan without adding
  // The middle label is too long to share a row, so column it is.
  resultActions: {
    flexDirection: 'column',
    gap: SPACING.sm,
  },
  addToCartButton: {
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
  secondaryActionButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.text, // navy outline
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Kept for the not-found card which still uses the original ref.
  dismissButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.text,
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
  // Zoom controls sit above the manual-entry toggle. Pill-shaped row so
  // the buttons read as a single grouped control rather than free-floating.
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.toolbarBtn,
    borderWidth: 1,
    borderColor: COLORS.toolbarBtnBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButtonDisabled: {
    opacity: 0.35,
  },
  zoomButtonText: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.medium,
    lineHeight: FONT_SIZE.xl + 4,
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
