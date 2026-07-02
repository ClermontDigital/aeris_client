import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {NavigatorScreenParams} from '@react-navigation/native';
import type {ProductDetail} from '@aeris/shared';

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
};

// App-level native stack — wraps the bottom-tab navigator so non-tab
// screens (Settings) can be pushed over the whole app shell. The tab
// navigator lives under the `Tabs` route; `Settings` is a sibling that
// slides in with the native push transition. `AppTabs.tsx` exports this
// stack as its default; `Tabs` mounts the actual bottom-tab navigator.
export type AppStackParamList = {
  Tabs: NavigatorScreenParams<AppTabParamList> | undefined;
  Settings: undefined;
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
  // Repairs is a conditional tab — surfaced only when the workspace's
  // `repairs_enabled` feature flag is on (see useWorkspaceFeaturesStore).
  // The inner stack is always registered on the AppTab param list so
  // deep-link resolution and cross-tab navigation still typecheck even
  // when the tab itself is hidden — an admin who toggles the flag
  // mid-session gets a live tab without needing a nav rebuild.
  Repairs: NavigatorScreenParams<RepairsStackParamList> | undefined;
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
  // productId filters the list to transactions that touched a given
  // product. Optional so existing call sites (no params) still compile;
  // the screen treats `undefined` / missing param as "no filter".
  TransactionList: {productId?: number} | undefined;
  SaleDetail: {saleId: number};
  Receipt: {saleId: number};
};

export type ItemsStackParamList = {
  ItemsList: undefined;
  // `product` is an optional pre-fetched payload from a barcode-scan caller;
  // when present, ProductDetail hydrates initial state from it (no spinner
  // flash on scan) and skips the on-mount fetch. The focus-effect re-fetch
  // still runs, so edits made elsewhere are reflected on return.
  ProductDetail: {productId: number; product?: ProductDetail};
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
  // Transaction screens duplicated into the Items stack so the
  // ProductDetail → "View all transactions" hand-off stays within the
  // Items tab (back-gesture returns to the product). Shapes mirror
  // TransactionsStackParamList — productId pre-filters the list.
  TransactionList: {productId?: number} | undefined;
  SaleDetail: {saleId: number};
  Receipt: {saleId: number};
};

export type CustomersStackParamList = {
  CustomersList: undefined;
  CustomerDetail: {customerId: number};
  // customerId absent → create mode. customerId set → edit mode.
  CustomerEdit: {customerId?: number} | undefined;
};

export type RepairsStackParamList = {
  // customer_id pre-filters the list to repairs opened for a given
  // customer (used from CustomerDetail → "View repairs"). Optional so
  // the tab-root call site (no params) still typechecks.
  RepairsList: {customer_id?: number} | undefined;
  RepairDetail: {id: number};
  // id absent → create mode. id set → edit mode. Mirrors the shape of
  // ProductEdit / CustomerEdit so the create+edit screen is a single
  // component switched by route params.
  RepairEdit: {id?: number} | undefined;
  // Sheet-presented status change screen: opens over the detail with a
  // formSheet transition (see RepairsStack.tsx). Requires the target
  // repair id — no "pick from list" affordance here.
  RepairStatusChange: {id: number};
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
