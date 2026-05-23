import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Alert,
  TouchableOpacity,
  BackHandler,
  Platform,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import PinPad from '../components/PinPad';
import EyebrowLabel from '../components/EyebrowLabel';
import {useAppLockStore} from '../stores/appLockStore';
import {useAuthStore} from '../stores/authStore';
import AppLockService from '../services/AppLockService';
import {useHaptics} from '../hooks/useHaptics';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  LETTER_SPACING,
} from '../constants/theme';

type Stage = 'enter' | 'confirm';

// Lock chrome mirrors AppLockScreen: navy backdrop, brand block at top,
// PinPad in the middle, sign-out escape hatch top-right. Same visual
// language as the unlock screen so a user moving between "set" and
// "unlock" sees one continuous PIN surface.
const PinSetupScreen: React.FC = () => {
  const haptics = useHaptics();
  const setPin = useAppLockStore(s => s.setPin);
  const unlock = useAppLockStore(s => s.unlock);
  const resetAppLock = useAppLockStore(s => s.reset);
  const setBiometricEnabled = useAppLockStore(s => s.setBiometricEnabled);

  const [stage, setStage] = useState<Stage>('enter');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Use Biometrics');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await AppLockService.isBiometricAvailable();
      if (cancelled) return;
      setBiometricAvailable(ok);
      if (ok) setBiometricLabel(await AppLockService.getBiometricLabel());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Block Android hardware back while PIN setup is mounted — the overlay
  // sits on top of the navigator and the back button must not let the user
  // skip past it into protected screens.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const promptBiometricThenFinish = useCallback(() => {
    if (!biometricAvailable) {
      unlock();
      return;
    }
    Alert.alert(
      'Enable biometric unlock?',
      `${biometricLabel} can be used in addition to your PIN. You can change this later in Settings.`,
      [
        {
          text: 'Not now',
          style: 'cancel',
          onPress: () => {
            unlock();
          },
        },
        {
          text: 'Enable',
          onPress: async () => {
            await setBiometricEnabled(true);
            unlock();
          },
        },
      ],
    );
  }, [biometricAvailable, biometricLabel, setBiometricEnabled, unlock]);

  const handleSubmit = useCallback(
    async (pin: string) => {
      setError(undefined);
      if (stage === 'enter') {
        haptics.selection();
        setFirstPin(pin);
        setStage('confirm');
        return;
      }
      if (pin !== firstPin) {
        haptics.error();
        setError("PINs didn't match. Try again from the start.");
        setFirstPin('');
        setStage('enter');
        return;
      }
      try {
        await setPin(pin);
        haptics.success();
        promptBiometricThenFinish();
      } catch (e) {
        haptics.error();
        setError(e instanceof Error ? e.message : 'Failed to set PIN');
        setFirstPin('');
        setStage('enter');
      }
    },
    [stage, firstPin, haptics, setPin, promptBiometricThenFinish],
  );

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign out',
      'You can finish setting up your PIN after you sign back in.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await resetAppLock();
            await useAuthStore.getState().logout();
          },
        },
      ],
    );
  }, [resetAppLock]);

  const padTitle = stage === 'enter' ? 'Choose a PIN' : 'Re-enter to confirm';
  const stepLabel = stage === 'enter' ? 'Step 1 of 2' : 'Step 2 of 2';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TouchableOpacity
        style={styles.signOutBtn}
        onPress={handleSignOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out and finish setup later">
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      <View style={styles.brand}>
        <Image
          source={require('../../assets/images/app-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text
          style={styles.heading}
          accessibilityRole="header">
          Create your app PIN
        </Text>
        <Text style={styles.subheading}>
          A 4-digit PIN locks the app between sessions so customer and
          business info stays protected.
        </Text>
      </View>

      <View style={styles.pinWrap}>
        {/* Step indicator as eyebrow per Brand Guidelines §06 — short tag
            that signals where the user is in the setup flow. Rendered in
            Clermont Cream on the navy backdrop (`tone="dark"`). */}
        <EyebrowLabel
          tone="dark"
          style={styles.stepEyebrow}
          textStyle={styles.stepEyebrowText}>
          {stepLabel}
        </EyebrowLabel>
        <PinPad title={padTitle} onSubmit={handleSubmit} error={error} />
      </View>

      {stage === 'confirm' ? (
        <TouchableOpacity
          style={styles.startOverBtn}
          onPress={() => {
            haptics.light();
            setStage('enter');
            setFirstPin('');
            setError(undefined);
          }}
          accessibilityRole="button"
          accessibilityLabel="Start over">
          <Text style={styles.startOverText}>Start over</Text>
        </TouchableOpacity>
      ) : (
        // Reserve the same vertical space when on stage 'enter' so the
        // layout doesn't jump when the user advances to confirm.
        <View style={styles.startOverPlaceholder} />
      )}
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
  signOutText: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    opacity: 0.85,
  },
  brand: {
    alignItems: 'center',
    marginTop: SPACING.xl + SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  logo: {
    width: 64,
    height: 64,
    marginBottom: SPACING.md,
  },
  heading: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.displayLg,
    fontFamily: FONT_FAMILY.medium,
    letterSpacing: LETTER_SPACING.tightLg,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  subheading: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    textAlign: 'center',
    maxWidth: 320,
    opacity: 0.8,
    lineHeight: 20,
  },
  pinWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepEyebrow: {
    marginBottom: SPACING.md,
    alignItems: 'center',
  },
  stepEyebrowText: {
    textAlign: 'center',
  },
  startOverBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.lg,
  },
  startOverText: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    opacity: 0.85,
    textDecorationLine: 'underline',
  },
  startOverPlaceholder: {
    height: SPACING.md * 2 + 20,
    marginBottom: SPACING.lg,
  },
});

export default PinSetupScreen;
