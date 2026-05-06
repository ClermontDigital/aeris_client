import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {NavigatorScreenParams} from '@react-navigation/native';

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
  Transactions: NavigatorScreenParams<TransactionsStackParamList> | undefined;
  ERP: undefined;
};

export type QuickSaleStackParamList = {
  ProductGrid: undefined;
  // mode = 'cart' (default): show found-product card with Add-to-Cart button.
  Scanner: {mode?: 'cart'} | undefined;
  Cart: undefined;
  Checkout: undefined;
};

export type TransactionsStackParamList = {
  TransactionList: undefined;
  SaleDetail: {saleId: number};
  Receipt: {saleId: number};
};

export type ItemsStackParamList = {
  ItemsList: undefined;
  ProductDetail: {productId: number};
  // mode = 'detail': on found product, replace Scanner with ProductDetail.
  Scanner: {mode: 'detail'};
};

export type CustomersStackParamList = {
  CustomersList: undefined;
  CustomerDetail: {customerId: number};
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
