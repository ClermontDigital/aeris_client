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

// Cross-tab navigation (e.g. `getParent()?.navigate('Items', {screen:
// 'ProductDetail', params: {productId}})`) requires each tab whose
// inner stack screens can be addressed from outside to be typed as
// `NavigatorScreenParams<...>` (or that | undefined). If a tab is
// typed just `undefined`, React Navigation silently fails to route
// the nested `screen` param at runtime — the tab activates but
// `route.params` on the destination is undefined, which renders as
// "undefined" or crashes screens that destructure required params.
export type AppTabParamList = {
  Dashboard: undefined;
  QuickSale: NavigatorScreenParams<QuickSaleStackParamList> | undefined;
  Items: NavigatorScreenParams<ItemsStackParamList> | undefined;
  Customers: NavigatorScreenParams<CustomersStackParamList> | undefined;
  Transactions: NavigatorScreenParams<TransactionsStackParamList> | undefined;
  ERP: undefined;
};

export type QuickSaleStackParamList = {
  ProductGrid: undefined;
  // mode = 'cart' (default): show found-product card with Add-to-Cart button.
  Scanner: {mode?: 'cart'} | undefined;
  Cart: undefined;
  Checkout: undefined;
  CustomerPicker: undefined;
  // returnTo: 'CustomerPicker' lets the create flow drop back into the
  // picker with the freshly-created customer selected on the cart, so a
  // cashier creating a customer mid-sale never loses context.
  CustomerEdit: {customerId?: number; returnTo?: 'CustomerPicker'} | undefined;
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
  // mode = 'capture': on first successful scan, pop back with the raw
  // barcode value merged onto the previous screen's params (used by
  // ProductEdit's "Scan" affordance to pre-fill the barcode field).
  Scanner: {mode: 'detail' | 'capture'};
  // productId absent → create mode; present → edit mode. The screen fetches
  // the product on mount and pre-populates the form when in edit mode.
  // scannedBarcode is set by the Scanner in 'capture' mode when it pops
  // back; ProductEdit picks it up, hydrates the field, and clears the
  // param so a re-render doesn't keep re-applying it.
  ProductEdit: {productId?: number; scannedBarcode?: string} | undefined;
};

export type CustomersStackParamList = {
  CustomersList: undefined;
  CustomerDetail: {customerId: number};
  // customerId absent → create mode. customerId set → edit mode.
  CustomerEdit: {customerId?: number} | undefined;
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
