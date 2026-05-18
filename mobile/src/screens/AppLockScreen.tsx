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
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import PinPad from '../components/PinPad';
import {useAppLockStore} from '../stores/appLockStore';
import {useAuthStore} from '../stores/authStore';
import AppLockService from '../services/AppLockService';
import {useHaptics} from '../hooks/useHaptics';
import {COLORS, SPACING, FONT_SIZE, BORDER_RADIUS} from '../constants/theme';

const MAX_ATTEMPTS = 5;

const AppLockScreen: React.FC = () => {
  const haptics = useHaptics();
  const verifyPin = useAppLockStore(s => s.verifyPin);
  const unlock = useAppLockStore(s => s.unlock);
  const recordFailedAttempt = useAppLockStore(s => s.recordFailedAttempt);
  const biometricEnabled = useAppLockStore(s => s.biometricEnabled);
  const failedAttempts = useAppLockStore(s => s.failedAttempts);
  const reset = useAppLockStore(s => s.reset);

  const [error, setError] = useState<string | undefined>(undefined);
  const [biometricLabel, setBiometricLabel] = useState('Use Biometrics');
  const [attempting, setAttempting] = useState(false);

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
    [verifyPin, haptics, unlock, recordFailedAttempt, reset],
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      <View style={styles.brand}>
        <Image
          source={require('../../assets/images/app-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.appName}>Aeris</Text>
        <Text style={styles.tagline}>Locked</Text>
      </View>

      <View style={styles.pinWrap}>
        <PinPad title="Enter PIN" onSubmit={handleSubmit} error={error} />
      </View>

      {biometricEnabled && (
        <TouchableOpacity
          style={styles.bioBtn}
          onPress={tryBiometric}
          disabled={attempting}>
          <Ionicons
            name="finger-print"
            size={20}
            color={COLORS.cream}
            style={styles.bioIcon}
          />
          <Text style={styles.bioText}>{biometricLabel}</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.attemptsHint}>
        {failedAttempts > 0 ? `${MAX_ATTEMPTS - failedAttempts} attempts remaining` : ''}
      </Text>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'space-between',
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
  logo: {width: 72, height: 72, marginBottom: SPACING.sm},
  appName: {color: COLORS.cream, fontSize: FONT_SIZE.title, fontWeight: '700'},
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
  bioText: {color: COLORS.cream, fontSize: FONT_SIZE.lg, fontWeight: '600'},
  attemptsHint: {
    color: COLORS.cream,
    opacity: 0.6,
    fontSize: FONT_SIZE.sm,
    marginBottom: SPACING.lg,
    height: FONT_SIZE.sm + 4,
  },
});

export default AppLockScreen;
