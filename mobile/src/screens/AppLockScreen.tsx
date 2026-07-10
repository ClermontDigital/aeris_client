import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Alert,
  BackHandler,
  Platform,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Icon from '../components/Icon';
import PinPad from '../components/PinPad';
import {useAppLockStore} from '../stores/appLockStore';
import {useAuthStore} from '../stores/authStore';
import AppLockService from '../services/AppLockService';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {
  barTotalHeight,
  buttonCenterFromBottom,
  BTN,
} from '../components/nav/navGeometry';
import {COLORS, SPACING, FONT_SIZE, FONT_FAMILY, BORDER_RADIUS} from '../constants/theme';

const MAX_ATTEMPTS = 5;
const WORDMARK = require('../../assets/images/aeris-wordmark.png');
const A_LOGO = require('../../assets/images/aeris-a.png');

// Vault-door unlock. While locked, two navy panels are sealed shut over the
// app (top + bottom halves meeting just below centre), with the AERIS wordmark
// on the top door and the Aeris "A" chevron on the bottom door. On a correct
// PIN / biometric the doors part — the top slides up to the header, the bottom
// slides down to the nav bar, carrying the wordmark + A to where they live in
// the app — then the whole overlay cross-fades out onto the real chrome behind
// (which already sits in those positions), so the hand-off is seamless.
const AppLockScreen: React.FC = () => {
  const haptics = useHaptics();
  const verifyPin = useAppLockStore(s => s.verifyPin);
  const unlock = useAppLockStore(s => s.unlock);
  const recordFailedAttempt = useAppLockStore(s => s.recordFailedAttempt);
  const biometricEnabled = useAppLockStore(s => s.biometricEnabled);
  const failedAttempts = useAppLockStore(s => s.failedAttempts);
  const reset = useAppLockStore(s => s.reset);

  const insets = useSafeAreaInsets();
  const {width, height: viewportHeight} = useWindowDimensions();
  const {isTablet} = useResponsiveLayout();

  const [error, setError] = useState<string | undefined>(undefined);
  const [biometricLabel, setBiometricLabel] = useState('Use Biometrics');
  const [attempting, setAttempting] = useState(false);

  // ---- Vault-door geometry (JS constants captured by the worklets) ----
  const HEADER_H = insets.top + 82; // navy header zone (band + tongue tip)
  const NAV_H = barTotalHeight(insets.bottom); // thin navy nav strip
  const seamY = Math.round(viewportHeight * 0.54); // doors meet just below centre
  const topTravel = seamY - HEADER_H; // top door slides up this far
  const botTravel = viewportHeight - seamY - NAV_H; // bottom door slides down
  // Wordmark: sealed just under the header → open at the header wordmark spot.
  const wmSealedTop = insets.top + 132;
  const wmOpenTop = insets.top + 18;
  // A chevron: sealed in the lower door → open at the nav A centre.
  const aOpenCenter = viewportHeight - buttonCenterFromBottom(insets.bottom);
  const aSealedCenter = viewportHeight - insets.bottom - 188;

  // door: 0 = sealed, 1 = open. Guard so a double tap / biometric race can't
  // fire the exit twice.
  const door = useSharedValue(0);
  const unlockingRef = useRef(false);

  const finishUnlock = useCallback(() => unlock(), [unlock]);
  const beginUnlock = useCallback(() => {
    if (unlockingRef.current) return;
    unlockingRef.current = true;
    haptics.success();
    door.value = withTiming(
      1,
      {duration: 780, easing: Easing.out(Easing.cubic)},
      finished => {
        'worklet';
        if (finished) runOnJS(finishUnlock)();
      },
    );
  }, [door, haptics, finishUnlock]);

  // Brand-mark shake on a wrong PIN.
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{translateX: shakeX.value}],
  }));

  // ---- Animated styles ----
  const rootStyle = useAnimatedStyle(() => ({
    // Final cross-fade onto the real chrome once the doors are ~open.
    opacity: interpolate(door.value, [0, 0.9, 1], [1, 1, 0], Extrapolation.CLAMP),
  }));
  const topDoorStyle = useAnimatedStyle(() => ({
    transform: [
      {translateY: interpolate(door.value, [0, 1], [0, -topTravel], Extrapolation.CLAMP)},
    ],
  }));
  const botDoorStyle = useAnimatedStyle(() => ({
    transform: [
      {translateY: interpolate(door.value, [0, 1], [0, botTravel], Extrapolation.CLAMP)},
    ],
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: interpolate(door.value, [0, 0.82, 1], [1, 1, 0], Extrapolation.CLAMP),
    transform: [
      {translateY: interpolate(door.value, [0, 1], [0, wmOpenTop - wmSealedTop], Extrapolation.CLAMP)},
    ],
  }));
  const aStyle = useAnimatedStyle(() => ({
    opacity: interpolate(door.value, [0, 0.82, 1], [1, 1, 0], Extrapolation.CLAMP),
    transform: [
      {translateY: interpolate(door.value, [0, 1], [0, aOpenCenter - aSealedCenter], Extrapolation.CLAMP)},
    ],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    // The PIN pad + controls fade out early as the seam starts to open.
    opacity: interpolate(door.value, [0, 0.34], [1, 0], Extrapolation.CLAMP),
  }));

  useEffect(() => {
    if (biometricEnabled) {
      AppLockService.getBiometricLabel().then(setBiometricLabel);
    }
  }, [biometricEnabled]);

  const tryBiometric = useCallback(async () => {
    if (attempting || unlockingRef.current) return;
    setAttempting(true);
    const ok = await AppLockService.authenticateWithBiometrics();
    setAttempting(false);
    if (ok) {
      beginUnlock();
    }
  }, [attempting, beginUnlock]);

  // Auto-prompt biometric on mount when enabled.
  useEffect(() => {
    if (biometricEnabled) {
      tryBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Block Android hardware back while the lock overlay is mounted.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const handleSubmit = useCallback(
    async (pin: string) => {
      if (unlockingRef.current) return;
      setError(undefined);
      const ok = await verifyPin(pin);
      if (ok) {
        beginUnlock();
        return;
      }
      haptics.error();
      shakeX.value = withSequence(
        withTiming(-10, {duration: 50}),
        withTiming(10, {duration: 60}),
        withTiming(-6, {duration: 50}),
        withTiming(0, {duration: 60}),
      );
      const attempts = recordFailedAttempt();
      const remaining = MAX_ATTEMPTS - attempts;
      if (attempts >= MAX_ATTEMPTS) {
        Alert.alert(
          'Too many attempts',
          'You have been signed out for security.',
          [
            {
              text: 'OK',
              onPress: async () => {
                await reset();
                await useAuthStore.getState().logout();
              },
            },
          ],
        );
        return;
      }
      setError(
        remaining === 1
          ? 'Wrong PIN. 1 attempt remaining.'
          : `Wrong PIN. ${remaining} attempts remaining.`,
      );
    },
    [verifyPin, haptics, beginUnlock, recordFailedAttempt, reset, shakeX],
  );

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await reset();
          await useAuthStore.getState().logout();
        },
      },
    ]);
  }, [reset]);

  const remainingAttempts =
    failedAttempts > 0 ? MAX_ATTEMPTS - failedAttempts : 0;

  return (
    <Animated.View style={[styles.root, rootStyle]}>
      {/* ---- The two navy doors ---- */}
      <Animated.View
        pointerEvents="none"
        style={[styles.topDoor, {height: seamY}, topDoorStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.botDoor,
          {height: viewportHeight - seamY},
          botDoorStyle,
        ]}
      />

      {/* ---- Brand marks that ride the doors to their app positions ---- */}
      <Animated.Image
        source={WORDMARK}
        resizeMode="contain"
        style={[
          styles.wordmark,
          {top: wmSealedTop, left: width / 2 - 65},
          wordmarkStyle,
        ]}
      />
      <Animated.Image
        source={A_LOGO}
        resizeMode="contain"
        style={[
          styles.aMark,
          {top: aSealedCenter - BTN / 2, left: width / 2 - BTN / 2},
          aStyle,
        ]}
      />

      {/* ---- PIN entry + controls (fade out as the seam opens) ---- */}
      <Animated.View style={[styles.content, contentStyle]} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.signOutBtn, {top: insets.top + SPACING.sm}]}
          onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <Animated.View
          style={[
            styles.pinWrap,
            isTablet ? styles.pinWrapTablet : null,
            shakeStyle,
          ]}>
          <PinPad title="Enter PIN" onSubmit={handleSubmit} error={error} />

          {biometricEnabled && (
            <TouchableOpacity
              style={styles.bioBtn}
              onPress={tryBiometric}
              disabled={attempting}>
              <Icon
                name="finger-print"
                size={20}
                color={COLORS.cream}
                style={styles.bioIcon}
              />
              <Text style={styles.bioText}>{biometricLabel}</Text>
            </TouchableOpacity>
          )}

          {remainingAttempts > 0 && (
            <Text style={styles.attemptsHint}>
              {`${remainingAttempts} attempts remaining`}
            </Text>
          )}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  // Transparent root — the navy comes from the two door panels, so the app
  // shows through the opening seam.
  root: {...StyleSheet.absoluteFillObject},
  topDoor: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.navy,
  },
  botDoor: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.navy,
  },
  wordmark: {position: 'absolute', width: 130, height: 38, pointerEvents: 'none'},
  aMark: {position: 'absolute', width: BTN, height: BTN, pointerEvents: 'none'},
  content: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center'},
  signOutBtn: {
    position: 'absolute',
    right: SPACING.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    zIndex: 10,
  },
  signOutText: {color: COLORS.cream, fontSize: FONT_SIZE.md, opacity: 0.85},
  pinWrap: {alignItems: 'center', justifyContent: 'center'},
  pinWrapTablet: {gap: SPACING.lg},
  bioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginTop: SPACING.lg,
  },
  bioIcon: {marginRight: SPACING.sm},
  bioText: {color: COLORS.cream, fontSize: FONT_SIZE.lg, fontFamily: FONT_FAMILY.medium},
  attemptsHint: {
    color: COLORS.cream,
    opacity: 0.6,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.md,
  },
});

export default AppLockScreen;
