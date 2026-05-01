import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
};

export type AppTabParamList = {
  Dashboard: undefined;
  QuickSale: undefined;
  Items: undefined;
  Customers: undefined;
  Transactions: undefined;
  ERP: undefined;
};

export type QuickSaleStackParamList = {
  ProductGrid: undefined;
  Scanner: undefined;
  Cart: undefined;
  Checkout: undefined;
};

export type TransactionsStackParamList = {
  TransactionList: undefined;
  Receipt: {saleId: number};
};

// Screen prop types
export type LoginScreenProps = NativeStackScreenProps<
  AuthStackParamList,
  'Login'
>;
export type DashboardScreenProps = BottomTabScreenProps<
  AppTabParamList,
  'Dashboard'
>;
export type ReceiptScreenProps = NativeStackScreenProps<
  TransactionsStackParamList,
  'Receipt'
>;
