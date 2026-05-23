import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import CustomersScreen from '../screens/CustomersScreen';
import CustomerDetailScreen from '../screens/CustomerDetailScreen';
import CustomerEditScreen from '../screens/CustomerEditScreen';
import type {CustomersStackParamList} from '../types/navigation.types';

const Stack = createNativeStackNavigator<CustomersStackParamList>();

const CustomersStack: React.FC = () => (
  <Stack.Navigator screenOptions={{
      headerShown: false,
      fullScreenGestureEnabled: true,
      gestureEnabled: true,
    }}>
    <Stack.Screen name="CustomersList" component={CustomersScreen} />
    <Stack.Screen name="CustomerDetail" component={CustomerDetailScreen} />
    <Stack.Screen name="CustomerEdit" component={CustomerEditScreen} />
  </Stack.Navigator>
);

export default CustomersStack;
