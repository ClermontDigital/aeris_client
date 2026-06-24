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
  const featuredImage =
    typeof raw.featured_image === 'string' ? raw.featured_image : null;
  const galleryImages = Array.isArray(raw.gallery_images)
    ? (raw.gallery_images as unknown[]).filter(
        (v): v is string => typeof v === 'string',
      )
    : [];
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
    image_url: typeof raw.image_url === 'string' ? raw.image_url : null,
    featured_image: featuredImage,
    gallery_images: galleryImages,
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
  return {
    ...base,
    description: typeof raw.description === 'string' ? raw.description : null,
    cost_cents: pickCentsOrNull(raw, 'cost_cents', 'cost_price'),
    stock_levels: stockLevels,
    variants,
  };
}
