import React, {useCallback, useState} from 'react';
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
import {
  ProductImageUploadError,
  PRODUCT_IMAGE_MAX_BYTES,
} from '../services/ProductImageClient';
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

  const shownUrl = localUrl ?? currentImageUrl ?? null;

  const doUpload = useCallback(
    async (fileUri: string) => {
      setUploading(true);
      setError(null);
      try {
        const normalizedUri = await normalizeForUpload(fileUri);
        const product = await ApiClient.uploadProductImage(
          productId,
          normalizedUri,
          type,
        );
        haptics.success();
        // Prefer the server-resolved URL; fall back to the resolved primary.
        setLocalUrl(
          product.featured_image ?? product.image_url ?? null,
        );
        onUploaded(product);
      } catch (e) {
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
        setUploading(false);
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
      'AERIS uses the camera to photograph products. Turn on camera access for AERIS in iOS Settings.',
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
      'AERIS needs access to your photos to add a product image. Turn on photo access for AERIS in iOS Settings.',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Open Settings', onPress: () => Linking.openSettings()},
      ],
    );
    return false;
  }, []);

  const handleTakePhoto = useCallback(async () => {
    setSheetOpen(false);
    const ok = await ensureCameraPermission();
    if (!ok) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    // Early client size guard on the original capture; the post-resize file is
    // re-checked in the transport against PRODUCT_IMAGE_MAX_BYTES.
    const asset = result.assets[0];
    if (
      typeof asset.fileSize === 'number' &&
      asset.fileSize > PRODUCT_IMAGE_MAX_BYTES * 4
    ) {
      setError('That photo is very large; trying to compress it.');
    }
    void doUpload(asset.uri);
  }, [ensureCameraPermission, doUpload]);

  const handleChooseLibrary = useCallback(async () => {
    setSheetOpen(false);
    const ok = await ensureLibraryPermission();
    if (!ok) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    void doUpload(result.assets[0].uri);
  }, [ensureLibraryPermission, doUpload]);

  const openSheet = useCallback(() => {
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
        // Current photo with a Change affordance overlaid.
        <View style={styles.previewWrap}>
          <Image
            source={{uri: shownUrl}}
            style={styles.preview}
            resizeMode="cover"
            accessibilityLabel="Current product photo"
          />
          {uploading ? (
            <View style={styles.previewBusyOverlay}>
              <ActivityIndicator color={COLORS.white} size="large" />
            </View>
          ) : (
            <TouchableOpacity
              style={styles.changeBadge}
              onPress={openSheet}
              accessibilityRole="button"
              accessibilityLabel="Change product photo">
              <Icon name="refresh-cw" size={14} color={COLORS.white} />
              <Text style={styles.changeBadgeText}>Change</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        // No photo yet — the Add affordance.
        <TouchableOpacity
          style={styles.addCard}
          onPress={openSheet}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Add a product photo">
          {uploading ? (
            <ActivityIndicator color={COLORS.accent} size="large" />
          ) : (
            <>
              <Icon name="image" size={32} color={COLORS.textMuted} />
              <Text style={styles.addCardTitle}>Add photo</Text>
              <Text style={styles.addCardHint}>
                Take a photo or choose one from your library.
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal
        isVisible={sheetOpen}
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
  previewWrap: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  previewBusyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 48, 73, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeBadge: {
    position: 'absolute',
    right: SPACING.sm,
    bottom: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: 'rgba(0, 48, 73, 0.85)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: BORDER_RADIUS.full,
  },
  changeBadgeText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  addCard: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  addCardTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginTop: SPACING.xs,
  },
  addCardHint: {
    color: COLORS.textDim,
    fontSize: FONT_SIZE.xs,
    textAlign: 'center',
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
