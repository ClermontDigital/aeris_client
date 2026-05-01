import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import QuickSaleScreen from '../screens/QuickSaleScreen';
import BarcodeScannerScreen from '../screens/BarcodeScannerScreen';
import CartScreen from '../screens/CartScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import type {QuickSaleStackParamList} from '../types/navigation.types';

const Stack = createNativeStackNavigator<QuickSaleStackParamList>();

const QuickSaleStack: React.FC = () => (
  <Stack.Navigator screenOptions={{headerShown: false}}>
    <Stack.Screen name="ProductGrid" component={QuickSaleScreen} />
    <Stack.Screen name="Scanner" component={BarcodeScannerScreen} />
    <Stack.Screen name="Cart" component={CartScreen} />
    <Stack.Screen name="Checkout" component={CheckoutScreen} />
  </Stack.Navigator>
);

export default QuickSaleStack;
