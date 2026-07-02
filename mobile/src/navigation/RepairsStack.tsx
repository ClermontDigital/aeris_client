import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import type {RepairsStackParamList} from '../types/navigation.types';
import RepairsListScreen from '../screens/RepairsListScreen';
import RepairDetailScreen from '../screens/RepairDetailScreen';
import RepairStatusChangeSheet from '../screens/RepairStatusChangeSheet';
import RepairEditScreen from '../screens/RepairEditScreen';
import BarcodeScannerScreen from '../screens/BarcodeScannerScreen';
import RepairLabelPrintSheet from '../screens/RepairLabelPrintSheet';
import RepairItemsEditorSheet from '../screens/RepairItemsEditorSheet';

const Stack = createNativeStackNavigator<RepairsStackParamList>();

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
      component={RepairStatusChangeSheet}
      options={{presentation: 'formSheet'}}
    />
    {/* WSA-1 scan-to-open: repair-label camera. Shares the vision-camera
        surface with the Items/QuickSale scanners; mode='repair' is set
        via initialParams so BarcodeScannerScreen enforces the
        REP-YYYYMMDD-NNNNNN pattern and pushes RepairDetail on hit.
        fullScreenModal presentation keeps the scanner visually dedicated
        and ensures swipe-back-cancel doesn't leave a stale Scanner card
        on the RepairsList back stack. */}
    <Stack.Screen
      name="RepairScanner"
      component={BarcodeScannerScreen}
      initialParams={{mode: 'repair'}}
      options={{presentation: 'fullScreenModal'}}
    />
    {/* WSA-2 label print: formSheet over RepairDetail. Same mental model as
        RepairStatusChange — focused sub-task, not a push. Sheet fetches its
        own detail so the caller only supplies the id. */}
    <Stack.Screen
      name="RepairLabelPrint"
      component={RepairLabelPrintSheet}
      options={{presentation: 'formSheet'}}
    />
    {/* WSA-3 items editor: same formSheet presentation as the label sheet.
        Parts + labour rows editable side-by-side, scan-to-add for parts. */}
    <Stack.Screen
      name="RepairItemsEditor"
      component={RepairItemsEditorSheet}
      options={{presentation: 'formSheet'}}
    />
  </Stack.Navigator>
);

export default RepairsStack;
