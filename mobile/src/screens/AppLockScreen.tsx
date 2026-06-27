import React, {useCallback, useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Alert,
  BackHandler,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
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
import {COLORS, SPACING, FONT_SIZE, FONT_FAMILY, BORDER_RADIUS} from '../constants/theme';

const MAX_ATTEMPTS = 5;

const AppLockScreen: React.FC = () => {
  const haptics = useHaptics();
  const verifyPin = useAppLockStore(s => s.verifyPin);
  const unlock = useAppLockStore(s => s.unlock);
  const recordFailedAttempt = useAppLockStore(s => s.recordFailedAttempt);
  const biometricEnabled = useAppLockStore(s => s.biometricEnabled);
  const failedAttempts = useAppLockStore(s => s.failedAttempts);
  const reset = useAppLockStore(s => s.reset);
  // Compact = iPhone SE 3rd gen / 13 mini class viewport. The keypad
  // shrinks via PinPad's own breakpoint; here we tighten the brand
  // margin so the lock layout still reads as space-between on tall
  // phones without forcing the keypad / sign-out off the safe area.
  const {height: viewportHeight} = useWindowDimensions();
  const compact = viewportHeight < 700;

  const [error, setError] = useState<string | undefined>(undefined);
  const [biometricLabel, setBiometricLabel] = useState('Use Biometrics');
  const [attempting, setAttempting] = useState(false);

  // Brand-mark shake when the PIN is wrong — reinforces the haptic.error()
  // with a visual cue tied to the lock itself, not the input. Driven on the
  // UI thread so it lands even when the verifyPin promise + alert work is
  // queued on JS.
  const shakeX = useSharedValue(0);
  const brandStyle = useAnimatedStyle(() => ({
    transform: [{translateX: shakeX.value}],
  }));

  useEffect(() => {
    if (biometricEnabled) {
      AppLockService.getBiometricLabel().then(setBiometricLabel);
    }
  }, [biometricEnabled]);

  const tryBiometric = useCallback(async () => {
    if (attempting) return;
    setAttempting(true);
    const ok = await AppLockService.authenticateWithBiometrics();
    setAttempting(false);
    if (ok) {
      haptics.success();
      unlock();
    }
  }, [attempting, haptics, unlock]);

  // Auto-prompt biometric on mount when enabled — saves a tap on the
  // common "I just put my phone down for a sec" path.
  useEffect(() => {
    if (biometricEnabled) {
      tryBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Block Android hardware back while the lock overlay is mounted — without
  // this the back button propagates to the navigator below and pops/exits
  // the app while still locked.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const handleSubmit = useCallback(
    async (pin: string) => {
      setError(undefined);
      const ok = await verifyPin(pin);
      if (ok) {
        haptics.success();
        unlock();
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
    [verifyPin, haptics, unlock, recordFailedAttempt, reset, shakeX],
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      {/* ScrollView is the safety net for short viewports — on a tall
          phone it doesn't scroll because contentContainerStyle's flexGrow:1
          + space-between keeps everything centered. On SE-class it lets
          the keypad and sign-out cleanly absorb without clipping. */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Animated.View
          entering={FadeIn.duration(220)}
          style={[
            styles.brand,
            compact && styles.brandCompact,
            brandStyle,
          ]}>
          <Image
            source={require('../../assets/images/app-icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.appName}>Aeris</Text>
          <Text style={styles.tagline}>Locked</Text>
        </Animated.View>

        <View style={styles.pinWrap}>
          <PinPad title="Enter PIN" onSubmit={handleSubmit} error={error} />
        </View>

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
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.navy,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: SPACING.lg,
  },
  signOutBtn: {
    position: 'absolute',
    top: SPACING.lg,
    right: SPACING.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    zIndex: 10,
  },
  signOutText: {color: COLORS.cream, fontSize: FONT_SIZE.md, opacity: 0.85},
  brand: {alignItems: 'center', marginTop: SPACING.xl + SPACING.lg},
  brandCompact: {marginTop: SPACING.lg},
  logo: {width: 72, height: 72, marginBottom: SPACING.sm},
  appName: {color: COLORS.cream, fontSize: FONT_SIZE.title, fontFamily: FONT_FAMILY.bold},
  tagline: {color: COLORS.cream, fontSize: FONT_SIZE.md, opacity: 0.7, marginTop: 2},
  pinWrap: {alignItems: 'center', justifyContent: 'center'},
  bioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginTop: SPACING.md,
  },
  bioIcon: {marginRight: SPACING.sm},
  bioText: {color: COLORS.cream, fontSize: FONT_SIZE.lg, fontFamily: FONT_FAMILY.medium},
  attemptsHint: {
    color: COLORS.cream,
    opacity: 0.6,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.sm,
  },
});

export default AppLockScreen;
