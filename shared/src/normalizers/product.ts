import type {Product, ProductDetail, ProductVariant} from '../types/api.types';
import {asNumber, asString, pickCents, pickCentsOrNull} from './shared';

export function normalizeProductVariant(input: unknown): ProductVariant {
  const raw = (input || {}) as Record<string, unknown>;
  return {
    id: asNumber(raw.id),
    name: asString(raw.name),
    sku: asString(raw.sku),
    price_cents: pickCents(raw, 'price_cents', 'price'),
    stock_on_hand: asNumber(raw.stock_on_hand ?? raw.stock_quantity, 0),
  };
}

export function normalizeProduct(input: unknown): Product {
  const raw = (input || {}) as Record<string, unknown>;
  const category = (raw.category && typeof raw.category === 'object'
    ? (raw.category as Record<string, unknown>)
    : null);
  const categoryId =
    raw.category_id !== undefined && raw.category_id !== null
      ? asNumber(raw.category_id)
      : category && category.id !== undefined && category.id !== null
      ? asNumber(category.id)
      : null;
  const categoryName =
    typeof raw.category_name === 'string'
      ? raw.category_name
      : category && typeof category.name === 'string'
      ? (category.name as string)
      : null;
  // is_active defaults to true so unknown-shape items remain sellable.
  const isActive =
    raw.is_active === undefined ? true : Boolean(raw.is_active);
  // Raw image columns from ProductResource. featured_image is a string URL
  // (or null); gallery_images is an ordered array of URL strings. Both are
  // optional on the wire — coerce defensively and only include when present
  // so screens can prefer image_url but fall back / show a gallery later.
  //
  // Treat an empty string as absent. Consumers use the nullish-coalescing
  // operator (`featured_image ?? image_url`) which only falls through on
  // null/undefined — an empty-string column would short-circuit to "" and
  // render an empty <Image>. Normalising "" to null here closes that trap
  // at the boundary so every read site is safe.
  const featuredImage =
    typeof raw.featured_image === 'string' && raw.featured_image !== ''
      ? raw.featured_image
      : null;
  const galleryImages = Array.isArray(raw.gallery_images)
    ? (raw.gallery_images as unknown[]).filter(
        (v): v is string => typeof v === 'string' && v !== '',
      )
    : [];
  // Supplier is optional on the wire. ProductResource may surface it as a
  // flat `supplier_id`, or nested under `supplier: {id, ...}` when the
  // relation is loaded — read both. Falls to undefined when neither is
  // present so the ProductEdit picker treats it as "unspecified".
  const supplierRaw = raw.supplier as Record<string, unknown> | null | undefined;
  const supplierId =
    raw.supplier_id !== undefined && raw.supplier_id !== null
      ? asNumber(raw.supplier_id)
      : supplierRaw && supplierRaw.id !== undefined && supplierRaw.id !== null
        ? asNumber(supplierRaw.id)
        : undefined;
  return {
    id: asNumber(raw.id),
    name: asString(raw.name),
    sku: asString(raw.sku),
    barcode: typeof raw.barcode === 'string' ? raw.barcode : null,
    price_cents: pickCents(raw, 'price_cents', 'price'),
    // Default missing tax_rate to 10 to match Aeris2's StoreProductRequest
    // server default; an explicit 0 (GST-free) is preserved by asNumber.
    tax_rate: asNumber(raw.tax_rate, 10),
    stock_on_hand: asNumber(raw.stock_on_hand ?? raw.stock_quantity, 0),
    category_id: categoryId,
    category_name: categoryName,
    image_url:
      typeof raw.image_url === 'string' && raw.image_url !== ''
        ? raw.image_url
        : null,
    featured_image: featuredImage,
    gallery_images: galleryImages,
    ...(supplierId !== undefined ? {supplier_id: supplierId} : {}),
    is_active: isActive,
  };
}

export function normalizeProductDetail(input: unknown): ProductDetail {
  const base = normalizeProduct(input);
  const raw = (input || {}) as Record<string, unknown>;
  const variants = Array.isArray(raw.variants)
    ? (raw.variants as unknown[]).map(normalizeProductVariant)
    : [];
  // Pass stock_levels through when the deployment provides them.
  // Dropping to [] silently broke multi-location stock UI that surfaces
  // this field on ProductDetail.
  const stockLevels = Array.isArray(raw.stock_levels)
    ? (raw.stock_levels as ProductDetail['stock_levels'])
    : [];
  // Pull the "does this item track inventory?" flag from the wire.
  //
  // Aeris2's Product model has BOTH a `track_stock` and a `track_inventory`
  // column (Product.php:39,40,116,117); the ProductResource sometimes
  // exposes one, the other, both, or (worst case) neither. When neither is
  // present the caller must NOT infer `false` from a stock heuristic —
  // sold-out-but-tracked is a real state and the heuristic was flipping
  // that toggle off incorrectly. Server model default is `true`
  // (Product.php:90); leave undefined here and let ProductEdit fall back
  // to `true` explicitly rather than the stock-derived heuristic.
  const rawTrack = raw.track_stock ?? raw.track_inventory;
  const trackStock =
    typeof rawTrack === 'boolean'
      ? rawTrack
      : typeof rawTrack === 'number'
        ? Boolean(rawTrack)
        : undefined;
  return {
    ...base,
    description: typeof raw.description === 'string' ? raw.description : null,
    cost_cents: pickCentsOrNull(raw, 'cost_cents', 'cost_price'),
    stock_levels: stockLevels,
    variants,
    ...(trackStock !== undefined ? {track_stock: trackStock} : {}),
  };
}
