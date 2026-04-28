import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Ionicons} from '@expo/vector-icons';
import DashboardScreen from '../screens/DashboardScreen';
import QuickSaleStack from './QuickSaleStack';
import BarcodeScannerScreen from '../screens/BarcodeScannerScreen';
import TransactionsStack from './TransactionsStack';
import ERPScreen from '../screens/ERPScreen';
import {COLORS} from '../constants/theme';
import type {AppTabParamList} from '../types/navigation.types';

const Tab = createBottomTabNavigator<AppTabParamList>();

const AppTabs: React.FC = () => (
  <Tab.Navigator
    initialRouteName="Dashboard"
    screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: COLORS.primary,
        borderTopColor: COLORS.border,
      },
      tabBarActiveTintColor: COLORS.accent,
      tabBarInactiveTintColor: COLORS.textDim,
    }}>
    <Tab.Screen
      name="Dashboard"
      component={DashboardScreen}
      options={{
        tabBarIcon: ({color, size}) => (
          <Ionicons name="stats-chart" size={size} color={color} />
        ),
      }}
    />
    <Tab.Screen
      name="QuickSale"
      component={QuickSaleStack}
      options={{
        tabBarLabel: 'Sale',
        tabBarIcon: ({color, size}) => (
          <Ionicons name="cart" size={size} color={color} />
        ),
      }}
    />
    <Tab.Screen
      name="Scanner"
      component={BarcodeScannerScreen}
      options={{
        tabBarIcon: ({color, size}) => (
          <Ionicons name="barcode" size={size} color={color} />
        ),
      }}
    />
    <Tab.Screen
      name="Transactions"
      component={TransactionsStack}
      options={{
        tabBarIcon: ({color, size}) => (
          <Ionicons name="receipt" size={size} color={color} />
        ),
      }}
    />
    <Tab.Screen
      name="ERP"
      component={ERPScreen}
      options={{
        tabBarIcon: ({color, size}) => (
          <Ionicons name="globe" size={size} color={color} />
        ),
      }}
    />
  </Tab.Navigator>
);

export default AppTabs;
