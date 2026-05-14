import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import ItemsScreen from '../screens/ItemsScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import BarcodeScannerScreen from '../screens/BarcodeScannerScreen';
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
    <Stack.Screen
      name="Scanner"
      component={BarcodeScannerScreen}
      initialParams={{mode: 'detail'}}
    />
  </Stack.Navigator>
);

export default ItemsStack;
