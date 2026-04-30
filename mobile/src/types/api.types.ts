export type ConnectionMode = 'direct' | 'relay';

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: User;
}

export interface RelayEnvelope<T = unknown> {
  correlation_id: string;
  action: string;
  status: 'ok' | 'success' | 'error' | 'timeout';
  data?: T;
  error?: { code: string; message: string };
  duration_ms?: number;
}

export interface BiometricCredential {
  device_id: string;
  challenge: string;
  signature: string;
}

export interface StockSnapshot {
  product_id: number;
  on_hand: number;
  committed: number;
  available: number;
  levels: StockLevel[];
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  location_id: number | null;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  barcode: string | null;
  price_cents: number;
  tax_rate: number;
  stock_on_hand: number;
  category_id: number | null;
  category_name: string | null;
  image_url: string | null;
  is_active: boolean;
}

export interface ProductDetail extends Product {
  description: string | null;
  cost_cents: number | null;
  stock_levels: StockLevel[];
  variants: ProductVariant[];
}

export interface StockLevel {
  location_id: number;
  location_name: string;
  on_hand: number;
  committed: number;
  available: number;
}

export interface ProductVariant {
  id: number;
  name: string;
  sku: string;
  price_cents: number;
  stock_on_hand: number;
}

export interface Category {
  id: number;
  name: string;
}

export interface Sale {
  id: number;
  sale_number: string;
  total_cents: number;
  tax_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  status: 'completed' | 'refunded' | 'voided';
  items_count: number;
  customer_name: string | null;
  created_at: string;
}

export interface SaleDetail extends Sale {
  items: SaleItem[];
  payments: SalePayment[];
  customer: Customer | null;
}

export interface SaleItem {
  product_id: number;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  discount_cents: number;
}

export interface SalePayment {
  method: string;
  amount_cents: number;
  reference: string | null;
}

export interface Customer {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  account_balance_cents: number;
}

export interface DailySummary {
  date: string;
  sales_count: number;
  revenue_cents: number;
  items_sold: number;
  average_sale_cents: number;
  top_products: Array<{
    id: number;
    name: string;
    quantity: number;
    revenue_cents: number;
  }>;
}

export interface PaymentMethod {
  code: string;
  name: string;
  requires_reference: boolean;
}

export interface ReceiptData {
  sale_number: string;
  business_name: string;
  business_address: string;
  items: Array<{
    name: string;
    quantity: number;
    unit_price: string;
    line_total: string;
  }>;
  subtotal: string;
  tax: string;
  total: string;
  payments: Array<{ method: string; amount: string }>;
  date: string;
  served_by: string | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}
