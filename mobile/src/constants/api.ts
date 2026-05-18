export {RELAY_ACTIONS} from '@aeris/shared';

export const API_ENDPOINTS = {
  AUTH_LOGIN: '/api/v1/auth/login',
  AUTH_LOGOUT: '/api/v1/auth/logout',
  AUTH_USER: '/api/v1/auth/user',
  POS_PRODUCTS: '/api/v1/pos/products',
  POS_DAILY_SUMMARY: '/api/v1/pos/daily-summary',
  POS_PAYMENT_METHODS: '/api/v1/pos/payment-methods',
  POS_SALES: '/api/v1/pos/sales',
  PRODUCTS_SEARCH: '/api/v1/products/search',
  PRODUCTS_BARCODE: '/api/v1/products/barcode',
  PRODUCTS_CATEGORIES: '/api/v1/products/categories',
  SALES_LIST: '/api/v1/sales',
  CUSTOMERS_LIST: '/api/v1/customers',
  CUSTOMERS_SEARCH: '/api/v1/customers/search',
} as const;
