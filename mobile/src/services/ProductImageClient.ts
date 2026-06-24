import * as Crypto from 'expo-crypto';
import {File} from 'expo-file-system';
// uploadAsync + the BINARY_CONTENT upload type moved to the /legacy entrypoint
// in Expo SDK 54+. The new top-level expo-file-system module no longer exports
// them — importing from /legacy is the documented SDK-55 path for a binary PUT.
import {
  uploadAsync,
  FileSystemUploadType,
} from 'expo-file-system/legacy';
import type {
  Product,
  ProductImageType,
  ProductImageUploadGrant,
  ProductImageUploadErrorShape,
} from '@aeris/shared';
import {
  normalizeProduct,
  unwrapResource,
  PRODUCT_IMAGE_UNSUPPORTED_CODE,
} from '@aeris/shared';

// Client-side guard. The gateway enforces PRODUCT_IMAGE_MAX_BYTES (8 MiB) but
// we reject early so the user gets immediate feedback instead of a wasted PUT
// + a 4xx at confirm. Kept a touch under 8 MiB to leave headroom.
export const PRODUCT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

// Typed error the picker UI branches on. `unsupported` permanently hides the
// affordance for this deployment; the rest are normal retriable failures.
export class ProductImageUploadError
  extends Error
  implements ProductImageUploadErrorShape
{
  kind: ProductImageUploadErrorShape['kind'];
  constructor(message: string, kind: ProductImageUploadErrorShape['kind']) {
    super(message);
    this.name = 'ProductImageUploadError';
    this.kind = kind;
  }
}

// Accessors the orchestrator needs from the active facade. The image upload
// path ALWAYS targets the marketplace/relay base (R2 is marketplace-owned),
// uses the user's bearer, and scopes to the workspace — even when the app is
// in 'direct' (LAN) mode, where there is no relay RPC channel but the
// dedicated /api/v1/products/image/* HTTPS routes are still reachable.
export interface ProductImageTransportConfig {
  relayUrl: string;
  authToken: string | null;
  workspaceCode: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function buildHeaders(cfg: ProductImageTransportConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (cfg.authToken) {
    headers.Authorization = `Bearer ${cfg.authToken}`;
  }
  if (cfg.workspaceCode) {
    headers['X-Aeris-Workspace'] = cfg.workspaceCode;
  }
  return headers;
}

// Read the produced JPEG bytes ONCE and derive BOTH the sha256 (over the raw
// bytes, not base64 — see plan §3) and the byte length from that single read.
// manipulateAsync does not return a size, and expo-crypto only hashes strings,
// so we hash the bytes ourselves via the new File API's byte accessor.
async function readBytesAndDigest(
  fileUri: string,
): Promise<{byteLength: number; sha256: string}> {
  const file = new File(fileUri);
  // bytes() resolves to the raw file content as a Uint8Array (SDK-55 File API —
  // it is ASYNC and MUST be awaited). We read ONCE to derive both byte_length
  // and the sha256 over the actual JPEG bytes (NOT base64 — see plan §3). The
  // subsequent PUT streams the same file from disk by URI, so the bytes hashed
  // here are the bytes uploaded.
  const bytes = await file.bytes();
  const byteLength = bytes.byteLength;
  // digest() hashes a raw byte array (TypedArray) and returns an ArrayBuffer;
  // we hex-encode it ourselves so the wire value matches the gateway's
  // lower-hex 64-char expectation.
  const digestBytes = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes,
  );
  const sha256 = toHex(new Uint8Array(digestBytes));
  return {byteLength, sha256};
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function postJson<T>(
  url: string,
  cfg: ProductImageTransportConfig,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  const headers = buildHeaders(cfg);
  // Distinct Idempotency-Key per call (request-upload and confirm each get
  // their own UUID — see plan: "a DISTINCT Idempotency-Key per call").
  headers['Idempotency-Key'] = idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON body — leave parsed null; handled below.
      }
    }

    if (!response.ok) {
      // Map the deployment-unsupported signal to the typed kind so the UI can
      // hide the affordance. The gateway surfaces it either as an `error.code`
      // or a top-level `code` depending on the failure layer; check both.
      const code = extractCode(parsed);
      if (code === PRODUCT_IMAGE_UNSUPPORTED_CODE) {
        throw new ProductImageUploadError(
          'Photos are not available for this workspace yet.',
          'unsupported',
        );
      }
      const msg = extractMessage(parsed) || `Upload failed (${response.status})`;
      throw new ProductImageUploadError(msg, 'failed');
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

function extractCode(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.code === 'string') return o.code;
  const err = o.error;
  if (err && typeof err === 'object') {
    const ec = (err as Record<string, unknown>).code;
    if (typeof ec === 'string') return ec;
  }
  return null;
}

function extractMessage(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.message === 'string') return o.message;
  const err = o.error;
  if (err && typeof err === 'object') {
    const em = (err as Record<string, unknown>).message;
    if (typeof em === 'string') return em;
  }
  return null;
}

// Orchestrate the full grant-bound upload. Three legs (plan §3 transport):
//   1. POST /request-upload  {product_id, content_type, byte_length, sha256, type}
//   2. PUT  bytes -> upload_url with the pinned required_headers (DIRECT to R2)
//   3. POST /confirm {grant_id} -> returns the updated ProductResource
// Always against the relay/marketplace base. Returns the normalized Product.
export async function uploadProductImage(
  cfg: ProductImageTransportConfig,
  productId: number,
  fileUri: string,
  type: ProductImageType = 'featured',
): Promise<Product> {
  // Feature gate: no workspace code means there's no marketplace channel to
  // mint a grant against (direct-only/unpaired setups). Surface a typed error
  // so the UI hides the button rather than failing mid-flow.
  if (!cfg.workspaceCode) {
    throw new ProductImageUploadError(
      'Photos require a connected workspace.',
      'no-workspace',
    );
  }

  const {byteLength, sha256} = await readBytesAndDigest(fileUri);

  if (byteLength <= 0) {
    throw new ProductImageUploadError('That photo is empty.', 'failed');
  }
  if (byteLength > PRODUCT_IMAGE_MAX_BYTES) {
    throw new ProductImageUploadError(
      'That photo is too large. Try a smaller one.',
      'too-large',
    );
  }

  const base = cfg.relayUrl.replace(/\/+$/, '');

  // Leg 1 — mint the grant + presigned PUT target.
  const grant = await postJson<ProductImageUploadGrant>(
    `${base}/api/v1/products/image/request-upload`,
    cfg,
    {
      product_id: productId,
      content_type: 'image/jpeg',
      byte_length: byteLength,
      sha256,
      type,
    },
    Crypto.randomUUID(),
  );

  if (!grant?.upload_url || !grant.grant_id) {
    throw new ProductImageUploadError(
      'Could not start the upload. Please try again.',
      'failed',
    );
  }

  // Leg 2 — PUT the exact bytes straight to R2 with the gateway-pinned
  // headers (Content-Length + Content-Type). uploadAsync streams the file
  // body directly; no relay, no body cap. The required_headers from the grant
  // are sent verbatim — the presign enforces them.
  const putResult = await uploadAsync(grant.upload_url, fileUri, {
    httpMethod: 'PUT',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: grant.required_headers ?? {},
  });

  // R2 returns 200/201 on a successful PUT. Anything else means the bytes did
  // not land (size/content-type mismatch, expired presign, network) — bail
  // before confirm so we don't redeem a grant whose object isn't there.
  if (putResult.status < 200 || putResult.status >= 300) {
    throw new ProductImageUploadError(
      'Uploading the photo failed. Please try again.',
      'failed',
    );
  }

  // Leg 3 — confirm. The gateway redeems the grant, sanitizes + commits the
  // object, dispatches set-image to the deployment, and returns the updated
  // ProductResource (relay envelope or bare resource depending on layer).
  const confirmRaw = await postJson<unknown>(
    `${base}/api/v1/products/image/confirm`,
    cfg,
    {grant_id: grant.grant_id},
    Crypto.randomUUID(),
  );

  return normalizeProduct(unwrapResource(confirmRaw));
}
