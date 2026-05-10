import React, {useState, useEffect, useCallback} from 'react';
import {View, Text, StyleSheet, Alert, TouchableOpacity, BackHandler, Platform} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import PinPad from '../components/PinPad';
import {useAppLockStore} from '../stores/appLockStore';
import AppLockService from '../services/AppLockService';
import {useHaptics} from '../hooks/useHaptics';
import {COLORS, SPACING, FONT_SIZE} from '../constants/theme';

type Stage = 'enter' | 'confirm';

interface Props {
  onDone?: () => void;
}

const PinSetupScreen: React.FC<Props> = ({onDone}) => {
  const haptics = useHaptics();
  const setPin = useAppLockStore(s => s.setPin);
  const unlock = useAppLockStore(s => s.unlock);
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
      onDone?.();
      return;
    }
    Alert.alert(
      'Enable biometric unlock?',
      `${biometricLabel} can be used in addition to your PIN.`,
      [
        {
          text: 'Not now',
          style: 'cancel',
          onPress: () => {
            unlock();
            onDone?.();
          },
        },
        {
          text: 'Enable',
          onPress: async () => {
            await setBiometricEnabled(true);
            unlock();
            onDone?.();
          },
        },
      ],
    );
  }, [biometricAvailable, biometricLabel, setBiometricEnabled, unlock, onDone]);

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
        setError("PINs don't match. Try again.");
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

  const title = stage === 'enter' ? 'Set a 4-digit PIN' : 'Confirm your PIN';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.heading}>App lock</Text>
        <Text style={styles.subheading}>
          Your PIN protects customer and business information when the app is
          locked.
        </Text>
      </View>
      <View style={styles.pinWrap}>
        <PinPad title={title} onSubmit={handleSubmit} error={error} />
      </View>
      {stage === 'confirm' && (
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            setStage('enter');
            setFirstPin('');
            setError(undefined);
          }}>
          <Text style={styles.backText}>Start over</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: COLORS.background, alignItems: 'center'},
  header: {paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, alignItems: 'center'},
  heading: {fontSize: FONT_SIZE.title, fontWeight: '700', color: COLORS.navy, marginBottom: SPACING.sm},
  subheading: {fontSize: FONT_SIZE.md, color: COLORS.textMuted, textAlign: 'center', maxWidth: 320},
  pinWrap: {flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%'},
  backBtn: {paddingVertical: SPACING.md, paddingBottom: SPACING.lg},
  backText: {color: COLORS.navy, fontSize: FONT_SIZE.md, textDecorationLine: 'underline'},
});

export default PinSetupScreen;
