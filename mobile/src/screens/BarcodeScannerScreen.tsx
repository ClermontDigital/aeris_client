import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import {CameraView, useCameraPermissions} from 'expo-camera';
import {useIsFocused} from '@react-navigation/native';
import {Ionicons} from '@expo/vector-icons';
import {useProductCacheStore} from '../stores/productCacheStore';
import {useCartStore} from '../stores/cartStore';
import ApiClient from '../services/ApiClient';
import type {Product, ProductDetail} from '../types/api.types';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';

const formatCents = (cents: number): string => '$' + (cents / 100).toFixed(2);

const BarcodeScannerScreen: React.FC = () => {
  const isFocused = useIsFocused();
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

  const getByBarcode = useProductCacheStore(s => s.getByBarcode);
  const addItem = useCartStore(s => s.addItem);

  const lookupBarcode = useCallback(
    async (barcode: string) => {
      if (isLookingUp || scanLock) return;
      setScanLock(true);
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

      // Try local cache first
      const cached = getByBarcode(barcode);
      if (cached) {
        setScannedProduct(cached);
        setIsLookingUp(false);
        refreshStock(cached.id);
        return;
      }

      // Fallback to API
      try {
        const product = await ApiClient.getProductByBarcode(barcode);
        if (product) {
          setScannedProduct(product);
          refreshStock(product.id);
        } else {
          setNotFound(true);
        }
      } catch {
        setNotFound(true);
      } finally {
        setIsLookingUp(false);
      }
    },
    [getByBarcode, isLookingUp, scanLock],
  );

  const handleBarcodeScanned = useCallback(
    (result: {data: string}) => {
      if (scanLock) return;
      lookupBarcode(result.data);
    },
    [lookupBarcode, scanLock],
  );

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
  }, [scannedProduct, addItem]);

  const handleDismiss = useCallback(() => {
    setScannedProduct(null);
    setNotFound(false);
    setScanLock(false);
  }, []);

  // Permission not yet determined
  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={64} color={COLORS.textDim} />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          The barcode scanner needs access to your camera to scan product
          barcodes.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isFocused ? (
        <CameraView
          style={styles.camera}
          facing="back"
          enableTorch={torchOn}
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
          onBarcodeScanned={scanLock ? undefined : handleBarcodeScanned}
        />
      ) : null}

      {/* Top overlay */}
      <View style={styles.topOverlay}>
        <Text style={styles.topTitle}>Scan Barcode</Text>
        <TouchableOpacity
          style={styles.torchButton}
          onPress={() => setTorchOn(prev => !prev)}>
          <Ionicons
            name={torchOn ? 'flash' : 'flash-off'}
            size={22}
            color={COLORS.textLight}
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
                <Ionicons name="cart" size={18} color={COLORS.white} />
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

        {/* Not found */}
        {notFound && !isLookingUp ? (
          <View style={styles.resultCard}>
            <Text style={styles.notFoundText}>Product not found</Text>
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
          <Ionicons name="keypad-outline" size={16} color={COLORS.textMuted} />
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
              <Ionicons name="search" size={20} color={COLORS.white} />
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
    backgroundColor: COLORS.modalBg,
  },
  topTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontWeight: '600',
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
  bottomArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  resultCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
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
    fontWeight: '600',
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
    fontWeight: '700',
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
    fontWeight: '600',
  },
  dismissButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
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
  manualToggleText: {
    color: COLORS.textMuted,
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
    fontWeight: '600',
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
    fontWeight: '600',
  },
});

export default BarcodeScannerScreen;
