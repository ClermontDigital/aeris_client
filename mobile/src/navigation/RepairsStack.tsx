import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING} from '../constants/theme';
import type {RepairsStackParamList} from '../types/navigation.types';
import RepairsListScreen from '../screens/RepairsListScreen';

const Stack = createNativeStackNavigator<RepairsStackParamList>();

// T4 stubs kept for the screens T6 / T7 will replace. RepairsListScreen
// shipped in T5 and now imports from ../screens/RepairsListScreen.
// Component NAMES on the stub set below must remain stable so the stack
// registration doesn't churn when the real screens land.
const StubScreen: React.FC<{label: string}> = ({label}) => (
  <View style={styles.stub}>
    <Text style={styles.stubTitle}>Repairs</Text>
    <Text style={styles.stubBody}>{label}</Text>
    <Text style={styles.stubHint}>Coming in T6 / T7</Text>
  </View>
);

const RepairDetailScreen: React.FC = () => (
  <StubScreen label="Repair detail" />
);
const RepairEditScreen: React.FC = () => (
  <StubScreen label="Create or edit repair" />
);
const RepairStatusChangeScreen: React.FC = () => (
  <StubScreen label="Change repair status" />
);

const RepairsStack: React.FC = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      // Mirrors the swipe-back configuration used by ItemsStack /
      // CustomersStack / TransactionsStack — swipe-back from anywhere on
      // the screen, not just the left edge, keeps the back gesture
      // native across the whole app shell.
      fullScreenGestureEnabled: true,
      gestureEnabled: true,
    }}>
    <Stack.Screen name="RepairsList" component={RepairsListScreen} />
    <Stack.Screen name="RepairDetail" component={RepairDetailScreen} />
    {/* Single screen handles create + edit; route params switch mode.
        Presented as a card transition (default) so the back gesture
        feels native — write screens never modal-cover the list, matching
        ProductEdit / CustomerEdit. */}
    <Stack.Screen name="RepairEdit" component={RepairEditScreen} />
    {/* Status change is presented as a formSheet so it visually reads as
        a focused sub-task over the RepairDetail context, not as a full
        push. The user's mental model is "quick status flip", not
        "drilled into another screen". */}
    <Stack.Screen
      name="RepairStatusChange"
      component={RepairStatusChangeScreen}
      options={{presentation: 'formSheet'}}
    />
  </Stack.Navigator>
);

const styles = StyleSheet.create({
  stub: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  stubTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xxl,
    fontFamily: FONT_FAMILY.bold,
    marginBottom: SPACING.sm,
  },
  stubBody: {
    color: COLORS.textLight,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.medium,
    marginBottom: SPACING.xs,
  },
  stubHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
  },
});

export default RepairsStack;
