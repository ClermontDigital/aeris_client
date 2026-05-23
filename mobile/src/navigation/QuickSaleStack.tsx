import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import QuickSaleScreen from '../screens/QuickSaleScreen';
import BarcodeScannerScreen from '../screens/BarcodeScannerScreen';
import CartScreen from '../screens/CartScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import CustomerPickerScreen from '../screens/CustomerPickerScreen';
import CustomerEditScreen from '../screens/CustomerEditScreen';
import type {QuickSaleStackParamList} from '../types/navigation.types';

const Stack = createNativeStackNavigator<QuickSaleStackParamList>();

const QuickSaleStack: React.FC = () => (
  <Stack.Navigator screenOptions={{
      headerShown: false,
      fullScreenGestureEnabled: true,
      gestureEnabled: true,
    }}>
    <Stack.Screen name="ProductGrid" component={QuickSaleScreen} />
    <Stack.Screen name="Scanner" component={BarcodeScannerScreen} />
    <Stack.Screen name="Cart" component={CartScreen} />
    <Stack.Screen name="Checkout" component={CheckoutScreen} />
    <Stack.Screen name="CustomerPicker" component={CustomerPickerScreen} />
    {/* CustomerEdit lives in both CustomersStack (post-sale management) and
        QuickSaleStack (create-on-the-fly during a sale). Each tab keeps its
        own stack history, so a cashier in the middle of a sale never lands
        back in the Customers tab on Save. */}
    <Stack.Screen name="CustomerEdit" component={CustomerEditScreen} />
  </Stack.Navigator>
);

export default QuickSaleStack;
