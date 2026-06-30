import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import Modal from 'react-native-modal';
import * as ImagePicker from 'expo-image-picker';
import {
  manipulateAsync,
  SaveFormat,
} from 'expo-image-manipulator';
import Icon from './Icon';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
} from '../constants/theme';
import {useHaptics} from '../hooks/useHaptics';
import ApiClient from '../services/ApiClient';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import {ProductImageUploadError} from '../services/ProductImageClient';
import type {Product, ProductImageType} from '../types/api.types';

interface Props {
  productId: number;
  type?: ProductImageType;
  currentImageUrl?: string | null;
  onUploaded: (product: Product) => void;
}

// Resize the longest edge to <=1280 and re-encode JPEG at 0.7 quality on-device
// before upload (plan §3 + flow). HEIC captures become JPEG via SaveFormat.JPEG.
// manipulateAsync does NOT return a byte size — the upload transport derives
// byte_length + sha256 from a single read of the produced file.
async function normalizeForUpload(uri: string): Promise<string> {
  const result = await manipulateAsync(uri, [{resize: {width: 1280}}], {
    compress: 0.7,
    format: SaveFormat.JPEG,
  });
  return result.uri;
}

const ProductImagePicker: React.FC<Props> = ({
  productId,
  type = 'featured',
  currentImageUrl,
  onUploaded,
}) => {
  const haptics = useHaptics();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once a deployment reports it doesn't support the actions we permanently
  // hide the affordance for this session rather than re-offering a doomed flow.
  const [unsupported, setUnsupported] = useState(false);
  // Local preview of the just-uploaded image so the card updates immediately,
  // independent of the parent re-fetch. Falls back to currentImageUrl.
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  // Guards (M1/M3): the upload is a multi-step async chain (normalize ->
  // request-upload -> R2 PUT -> confirm). mountedRef stops setState after the
  // screen is popped mid-upload; uploadingRef is a synchronous re-entrancy
  // lock so a fast double-tap can't start two uploads before `uploading`
  // state has flushed (same pattern as submitLockRef in ProductEditScreen).
  const mountedRef = useRef(true);
  const uploadingRef = useRef(false);
  // Which sheet action to run once the modal has FULLY dismissed. A ref (not
  // state) so onModalHide reads the latest value without a stale closure.
  const pendingActionRef = useRef<null | 'camera' | 'library'>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Treat empty string the same as null — `??` only falls through on
  // null/undefined, so a stray "" from either layer would otherwise render
  // an empty <Image>. Belt-and-braces with the normalizer's "" → null fix.
  const safeLocal = localUrl && localUrl !== '' ? localUrl : null;
  const safeCurrent =
    currentImageUrl && currentImageUrl !== '' ? currentImageUrl : null;
  const baseUrl = safeLocal ?? safeCurrent ?? null;
  // Cache-bust when localUrl is set (i.e. we just uploaded). RN's native
  // image cache can latch onto a previously-failed fetch verdict for a URL —
  // appending a per-localUrl query suffix forces a fresh fetch so a single
  // momentary 4xx from R2 can't poison subsequent renders of the same URL.
  const shownUrl =
    baseUrl == null
      ? null
      : safeLocal != null
        ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${safeLocal.length}`
        : baseUrl;

  const doUpload = useCallback(
    async (fileUri: string) => {
      if (uploadingRef.current) return; // re-entrancy lock (M3)
      uploadingRef.current = true;
      setUploading(true);
      setError(null);
      // DR M3-A mid-tx parity: an image upload is an in-flight catalog write —
      // flag it so an auto-failover defers the endpoint swap until it finishes
      // (cleared in the finally). Inert until auto-failover is enabled + verified.
      useTransactionActivityStore.getState().setSettlementOrPrintInFlight(true);
      try {
        const normalizedUri = await normalizeForUpload(fileUri);
        const product = await ApiClient.uploadProductImage(
          productId,
          normalizedUri,
          type,
        );
        if (!mountedRef.current) return; // unmounted mid-upload (M1)
        haptics.success();
        // Prefer the server-resolved URL; fall back to the resolved primary.
        setLocalUrl(product.featured_image ?? product.image_url ?? null);
        onUploaded(product);
      } catch (e) {
        if (!mountedRef.current) return;
        haptics.error();
        if (e instanceof ProductImageUploadError) {
          if (e.kind === 'unsupported' || e.kind === 'no-workspace') {
            // Permanently hide the affordance for this case.
            setUnsupported(true);
            return;
          }
          setError(e.message);
        } else {
          setError(
            e instanceof Error ? e.message : 'Could not upload the photo.',
          );
        }
      } finally {
        uploadingRef.current = false;
        if (mountedRef.current) setUploading(false);
        useTransactionActivityStore.getState().setSettlementOrPrintInFlight(false);
      }
    },
    [productId, type, haptics, onUploaded],
  );

  // Apple Guideline 5.1.1(iv) permission flow, mirrored from
  // BarcodeScannerScreen: not-determined -> request (system dialog);
  // denied/restricted -> openSettings (system dialog is suppressed). We branch
  // on the current status BEFORE requesting so a denied user is routed to
  // Settings rather than silently no-op'd.
  const ensureCameraPermission = useCallback(async (): Promise<boolean> => {
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain) {
      const next = await ImagePicker.requestCameraPermissionsAsync();
      return next.granted;
    }
    Alert.alert(
      'Camera access is off',
      'AERIS uses the camera to photograph products. Turn on camera access for AERIS in device Settings.',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Open Settings', onPress: () => Linking.openSettings()},
      ],
    );
    return false;
  }, []);

  const ensureLibraryPermission = useCallback(async (): Promise<boolean> => {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain) {
      const next = await ImagePicker.requestMediaLibraryPermissionsAsync();
      return next.granted;
    }
    Alert.alert(
      'Photo access is off',
      'AERIS needs access to your photos to add a product image. Turn on photo access for AERIS in device Settings.',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Open Settings', onPress: () => Linking.openSettings()},
      ],
    );
    return false;
  }, []);

  // The actual native-picker launchers. These run from onModalHide AFTER the
  // bottom sheet's dismiss animation completes — presenting the camera/library
  // UIViewController while react-native-modal is still mid-dismiss wedges
  // UIKit's presenter (the "opens then freezes" bug). allowsEditing is
  // intentionally OFF (its legacy UIKit cropper is a second present step and a
  // known crash source); quality 0.7 keeps peak capture memory down since
  // normalizeForUpload re-encodes anyway.
  const launchCamera = useCallback(async () => {
    const ok = await ensureCameraPermission();
    if (!ok) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    void doUpload(result.assets[0].uri);
  }, [ensureCameraPermission, doUpload]);

  const launchLibrary = useCallback(async () => {
    const ok = await ensureLibraryPermission();
    if (!ok) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    void doUpload(result.assets[0].uri);
  }, [ensureLibraryPermission, doUpload]);

  // Sheet rows only record intent + close the sheet. The launch is deferred to
  // onModalHide. Backdrop/back/Cancel dismissals leave pendingActionRef null,
  // so nothing launches on those paths.
  const handleTakePhoto = useCallback(() => {
    pendingActionRef.current = 'camera';
    setSheetOpen(false);
  }, []);

  const handleChooseLibrary = useCallback(() => {
    pendingActionRef.current = 'library';
    setSheetOpen(false);
  }, []);

  const handleModalHide = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action === 'camera') void launchCamera();
    else if (action === 'library') void launchLibrary();
  }, [launchCamera, launchLibrary]);

  const openSheet = useCallback(() => {
    if (uploadingRef.current) return; // don't re-open while a photo is uploading
    haptics.light();
    setError(null);
    setSheetOpen(true);
  }, [haptics]);

  // Feature gate (after all hooks, per rules-of-hooks): hide entirely when
  // there's no connected workspace to mint an upload grant against, or once
  // the deployment has reported it doesn't support the actions.
  if (!ApiClient.canUploadProductImages() || unsupported) {
    return null;
  }

  return (
    <View>
      {shownUrl ? (
        // Whole image is the tap target — opens the action sheet.
        <TouchableOpacity
          style={styles.card}
          onPress={openSheet}
          disabled={uploading}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Change product photo">
          <Image
            source={{uri: shownUrl}}
            style={styles.preview}
            resizeMode="cover"
            accessibilityLabel="Current product photo"
          />
          {/* Always-visible scrim affordance so it's obvious the photo is
              editable. Decorative — hidden from VoiceOver (the wrapping
              touchable already announces "Change product photo"). */}
          <View
            style={styles.scrim}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            <Icon name="camera" size={16} color={COLORS.white} />
            <Text style={styles.scrimText}>Tap to change photo</Text>
          </View>
          {uploading ? (
            <View
              style={styles.busyOverlay}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <ActivityIndicator color={COLORS.white} size="large" />
            </View>
          ) : null}
        </TouchableOpacity>
      ) : (
        // No photo yet — same size/shape so the layout doesn't shift on upload.
        <TouchableOpacity
          style={[styles.card, styles.addCard]}
          onPress={openSheet}
          disabled={uploading}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Add a product photo">
          {uploading ? (
            <ActivityIndicator color={COLORS.accent} size="large" />
          ) : (
            <>
              <View style={styles.addIconCircle}>
                <Icon name="camera" size={26} color={COLORS.accent} />
              </View>
              <Text style={styles.addCardTitle}>Add photo</Text>
              <Text style={styles.addCardHint}>
                Tap to take a photo or choose one from your library.
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal
        isVisible={sheetOpen}
        onModalHide={handleModalHide}
        onBackdropPress={() => setSheetOpen(false)}
        onBackButtonPress={() => setSheetOpen(false)}
        style={styles.modal}
        useNativeDriver
        useNativeDriverForBackdrop>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Product photo</Text>
          <TouchableOpacity
            style={styles.sheetRow}
            onPress={handleTakePhoto}
            accessibilityRole="button"
            accessibilityLabel="Take photo with camera">
            <Icon name="camera" size={20} color={COLORS.text} />
            <Text style={styles.sheetRowText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetRow}
            onPress={handleChooseLibrary}
            accessibilityRole="button"
            accessibilityLabel="Choose photo from library">
            <Icon name="image" size={20} color={COLORS.text} />
            <Text style={styles.sheetRowText}>Choose from Library</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sheetRow, styles.sheetCancelRow]}
            onPress={() => setSheetOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Cancel">
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  // Shared frame for both states so swapping empty<->filled never shifts layout.
  card: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  // Full-width bottom strip — the persistent "editable" affordance.
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    // Navy @ 78% — matches the app's existing scrims; no gradient dep needed.
    backgroundColor: 'rgba(0, 48, 73, 0.78)',
  },
  scrimText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 48, 73, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Empty state — same `card` frame + dashed border + centred prompt.
  addCard: {
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  addIconCircle: {
    width: 56,
    height: 56,
    borderRadius: BORDER_RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(193, 18, 31, 0.08)', // accent (crimson) @ 8%
    marginBottom: SPACING.xs,
  },
  addCardTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  addCardHint: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    textAlign: 'center',
    maxWidth: '80%',
  },
  errorText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.xs,
  },
  modal: {
    justifyContent: 'flex-end',
    margin: 0,
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  sheetTitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: 52,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  sheetRowText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
  sheetCancelRow: {
    justifyContent: 'center',
    marginTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder,
  },
  sheetCancelText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
});

export default ProductImagePicker;
