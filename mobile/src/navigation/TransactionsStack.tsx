import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import TransactionListScreen from '../screens/TransactionListScreen';
import ReceiptViewerScreen from '../screens/ReceiptViewerScreen';
import type {TransactionsStackParamList} from '../types/navigation.types';

const Stack = createNativeStackNavigator<TransactionsStackParamList>();

const TransactionsStack: React.FC = () => (
  <Stack.Navigator screenOptions={{headerShown: false}}>
    <Stack.Screen name="TransactionList" component={TransactionListScreen} />
    <Stack.Screen name="Receipt" component={ReceiptViewerScreen} />
  </Stack.Navigator>
);

export default TransactionsStack;
