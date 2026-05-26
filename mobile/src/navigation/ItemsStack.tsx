import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import ItemsScreen from '../screens/ItemsScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import ProductEditScreen from '../screens/ProductEditScreen';
import BarcodeScannerScreen from '../screens/BarcodeScannerScreen';
import TransactionListScreen from '../screens/TransactionListScreen';
import SaleDetailScreen from '../screens/SaleDetailScreen';
import ReceiptViewerScreen from '../screens/ReceiptViewerScreen';
import type {ItemsStackParamList} from '../types/navigation.types';

const Stack = createNativeStackNavigator<ItemsStackParamList>();

const ItemsStack: React.FC = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      // Swipe-back from anywhere on the screen, not just the left edge.
      // iOS uses the native gesture; Android polyfills via pan responder.
      fullScreenGestureEnabled: true,
      gestureEnabled: true,
    }}>
    <Stack.Screen name="ItemsList" component={ItemsScreen} />
    <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
    {/* Single screen handles create + edit; route params switch mode.
        Presented as a card transition (default) so the back gesture
        feels native — write screens never modal-cover the list. */}
    <Stack.Screen name="ProductEdit" component={ProductEditScreen} />
    <Stack.Screen
      name="Scanner"
      component={BarcodeScannerScreen}
      initialParams={{mode: 'detail'}}
    />
    {/* Transaction screens are duplicated from TransactionsStack so the
        "View all transactions" hand-off from ProductDetail can stay
        inside the Items tab — swipe-back returns to the product page
        rather than dead-ending in a sibling tab. Same component imports
        as TransactionsStack; the param shapes are mirrored too. */}
    <Stack.Screen name="TransactionList" component={TransactionListScreen} />
    <Stack.Screen name="SaleDetail" component={SaleDetailScreen} />
    <Stack.Screen name="Receipt" component={ReceiptViewerScreen} />
  </Stack.Navigator>
);

export default ItemsStack;
