# Marketplace API Changes Required for AERIS Mobile

**To:** Aeris Marketplace Team
**From:** Aeris Mobile Team
**Status:** Required for mobile app to function in relay mode

## Background

The AERIS mobile app (iOS/Android) needs to securely reach on-prem AERIS ERP deployments through the existing marketplace relay infrastructure (`api.aeris.team`). The current relay system is **fire-and-forget events only** — the mobile app needs **request/response (RPC)** through the same relay so on-prem ERPs never need to be exposed to the internet.

## Architecture

```
Mobile App  --POST /api/relay/rpc--> Marketplace (holds connection, Redis pub/sub wait)
                                            |
                                     Redis pub/sub channel
                                            |
On-Prem ERP <--GET /api/relay/events (polls every 2s for `pos` service)
On-Prem ERP --POST /api/relay/events/{id}/respond--> Marketplace
                                            |
                                     Redis publish wakes goroutine
                                            |
Mobile App  <--200 OK with response data
```

**Target latency:** p50 ~1.5s with 2s ERP poll interval, p99 <5s, max timeout 30s.

## Changes Required

### 1. Database Migration

`migrations/009_relay_rpc.up.sql`

Extend `relay_events` table:
```sql
ALTER TABLE relay_events
  ADD COLUMN correlation_id CHAR(36) NULL DEFAULT NULL,
  ADD COLUMN event_category ENUM('event','rpc_request','rpc_response') NOT NULL DEFAULT 'event',
  ADD COLUMN response_payload JSON NULL,
  ADD COLUMN responded_at TIMESTAMP NULL;

CREATE INDEX idx_correlation ON relay_events(correlation_id);
```

New table for mobile sessions:
```sql
CREATE TABLE IF NOT EXISTS relay_mobile_sessions (
  id CHAR(36) PRIMARY KEY,
  deployment_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  user_identifier VARCHAR(255) NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token_hash (token_hash),
  INDEX idx_expiry (expires_at),
  CONSTRAINT fk_mobile_session_deployment
    FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2. New Endpoints

#### `POST /api/relay/rpc` — Mobile → Marketplace

**Auth:** `Authorization: Bearer ms_*` (mobile session token) OR `Authorization: Bearer mp_live_*` + `X-Deployment-ID` header (tenant API key, for `auth.login` only)

**Request:**
```yaml
RelayRPCRequest:
  required: [action]
  properties:
    action:
      type: string
      enum:
        - auth.login
        - auth.biometric
        - auth.logout
        - dashboard.summary
        - products.search
        - products.barcode
        - products.detail
        - sale.create
        - transactions.list
        - transactions.detail
        - transactions.receipt
        - customers.search
        - inventory.stock
    params:
      type: object        # action-specific (encrypted blob in production)
    timeout:
      type: integer
      default: 10
      maximum: 30
```

**Response:**
```yaml
RelayRPCResponse:
  properties:
    correlation_id: { type: string, format: uuid }
    action: { type: string }
    status: { type: string, enum: [success, error, timeout] }
    data: { type: object }
    error:
      properties:
        code: { type: string }
        message: { type: string }
    duration_ms: { type: integer }
```

**Status codes:**
- `200` — RPC completed (check `status` field for success/error)
- `401` — Invalid/missing auth
- `422` — Invalid action or params
- `429` — Rate limit exceeded
- `504` — ERP did not respond within timeout

**Implementation notes:**
- Generate `correlation_id` (UUID v4) on receipt
- Insert relay event with `event_category='rpc_request'`, `service_name='pos'`, `event_type=action`, `correlation_id`, `payload=params`
- Subscribe to Redis channel `relay:rpc:{deployment_id}:{correlation_id}`
- Block (long-poll) until message received OR context deadline
- On wake, read response from Redis key `relay:rpc:resp:{correlation_id}` and return
- Server `WriteTimeout` must be increased from 15s → 35s to accommodate 30s max RPC timeout

#### `POST /api/relay/events/{eventID}/respond` — ERP → Marketplace

**Auth:** `Authorization: Bearer {relay_identifier}` (existing relay auth — same as `/ack`)

**Request:**
```yaml
RelayRespondRequest:
  required: [correlation_id, status]
  properties:
    correlation_id: { type: string, format: uuid }
    status: { type: string, enum: [success, error] }
    data: { type: object }
    error:
      properties:
        code: { type: string }
        message: { type: string }
```

**Response:**
```yaml
{ message: string }
```

**Status codes:**
- `200` — Response submitted
- `400` — Missing/invalid correlation_id
- `403` — Event does not belong to this deployment (CRITICAL: validate this)
- `404` — Event not found or already responded
- `410` — Response window expired (mobile already timed out)

**Implementation notes:**
- **Security critical:** Validate that the `relay_identifier` belongs to the deployment that owns the `eventID`. Reject with 403 otherwise.
- Validate `correlation_id` matches the event's `correlation_id`
- Update `relay_events`: `status='delivered'`, `delivered_at=NOW()`, `response_payload=data`, `responded_at=NOW()`
- Write response to Redis key `relay:rpc:resp:{correlation_id}` with 60s TTL
- PUBLISH to Redis channel `relay:rpc:{deployment_id}:{correlation_id}` to wake the waiting goroutine
- This endpoint **implicitly acknowledges** the event (ERP doesn't call `/ack` separately)

### 3. Extend Existing `RelayEventResponse`

When the ERP polls `GET /api/relay/events`, the response shape needs new fields so the ERP can distinguish RPC requests from regular events:

```yaml
RelayEventResponse:
  properties:
    id: { type: integer, format: int64 }
    service_name: { type: string }
    event_type: { type: string }
    event_category: { type: string, enum: [event, rpc_request] }  # NEW
    correlation_id: { type: string, format: uuid, nullable: true }  # NEW
    payload: { type: string }
    created_at: { type: string, format: date-time }
```

### 4. New Auth Middleware

`internal/middleware/auth_mobile_session.go` (new)

Accept either:
- **`ms_*` token** — look up in `relay_mobile_sessions` table (with Redis cache), extract `deployment_id` and `tenant_id`, store in request context
- **`mp_live_*` / `mp_test_*` token** — falls through to existing tenant API key auth, requires `X-Deployment-ID` header (only allowed for `auth.login` action)

**Special flow for `auth.login`:**
1. Mobile sends `POST /api/relay/rpc` with `Authorization: Bearer mp_live_*`, `X-Deployment-ID: {id}`, action `auth.login`
2. ERP processes login, returns JWT-style token in response
3. Marketplace extracts the session token from the response, creates a `relay_mobile_sessions` record (token hashed), returns full response to mobile
4. Mobile stores `ms_*` token, uses it for all subsequent requests

### 5. Rate Limiting

- New limiter: `RelayRPCRateLimit` — 60 req/min per `deployment_id`
- Per-action limits recommended: `sale.create` 10/min, `products.search` 30/min
- Existing relay poll limit (120/min per `relay_identifier`) remains unchanged

### 6. Server Configuration

`cmd/api/main.go`:
- Change `WriteTimeout: 15 * time.Second` → `WriteTimeout: 35 * time.Second`
- Add config `RelayRPCMaxTimeout` (default 30s) in `internal/config/config.go`

### 7. Prometheus Metrics

`internal/services/relay/metrics.go` — add:
```go
RelayRPCRequests = promauto.NewCounterVec(...)    // labels: action, status
RelayRPCDuration = promauto.NewHistogramVec(...)   // labels: action
RelayRPCTimeouts = promauto.NewCounterVec(...)     // labels: action
```

### 8. Redis Configuration

- Require Redis 6+ with **ACL and TLS** enabled
- Namespace pub/sub channels per deployment: `relay:rpc:{deployment_id}:{correlation_id}` (prevents cross-deployment subscription)
- Response TTL: 60s on `relay:rpc:resp:{correlation_id}` keys
- Restrict Redis network access to marketplace API processes only

### 9. Data Retention

`relay_events.payload` and `relay_events.response_payload` columns contain financial transaction data and customer PII. Add automatic purge after successful delivery:
- Default retention: **24 hours after `delivered_at`**
- Configurable via env var
- The relay event row stays (for audit/replay), only the payloads are nulled

### 10. New OpenAPI Tags

```yaml
- name: Relay RPC
  description: Request/response relay for mobile POS operations
- name: Relay RPC Auth
  description: Mobile session authentication via relay
```

### 11. New Security Scheme

```yaml
mobileSessionToken:
  type: http
  scheme: bearer
  description: Mobile POS session token (ms_*)
```

## POS Action Schemas (Reference)

The mobile app will send these actions through the RPC. The ERP-side handler routes them to existing service methods.

### `auth.login`
```yaml
params: { email: string, password: string, device_name?: string }
response: { token: string, user: {...}, expires_at: datetime }
```

### `dashboard.summary`
```yaml
params: { date?: date, location_id?: integer }
response: { sales_count, revenue_cents, items_sold, average_sale_cents, top_products: [...] }
```

### `products.search`
```yaml
params: { query: string (min 2 chars), page, per_page (max 50), category_id? }
response: { products: [...], meta: pagination }
```

### `products.barcode`
```yaml
params: { barcode: string, location_id? }
response: ProductDetail
```

### `products.detail`
```yaml
params: { product_id: integer, location_id? }
response: ProductDetail with stock_levels[] and variants[]
```

### `sale.create`
```yaml
params:
  customer_id?: integer
  location_id: integer
  items: [{ product_id, quantity, unit_price_cents, discount_cents? }]
  payments: [{ method: enum[cash,card,account,other], amount_cents, reference? }]
  discount_cents?: integer
  notes?: string
response: { sale_id, sale_number, total_cents, tax_cents, status, created_at }
```

⚠️ **PCI compliance:** `payments[]` MUST NEVER contain card numbers, CVVs, or cardholder data. Only references to externally-processed payments.

### `transactions.list`
```yaml
params: { page, per_page (max 50), date_from?, date_to?, status? }
response: { transactions: [...], meta: pagination }
```

### `transactions.detail`
```yaml
params: { sale_id: integer }
response: full sale with items[] and payments[]
```

### `transactions.receipt`
```yaml
params: { sale_id: integer, format?: json | html }
response: receipt layout (sale_number, items, totals, payments, business info)
```

### `customers.search`
```yaml
params: { query: string (min 2 chars), page }
response: { customers: [...] with id, name, email, phone, account_balance_cents }
```

### `inventory.stock`
```yaml
params: { product_ids: [integer] (max 50), location_id? }
response: { stock: [...] with on_hand, committed, available per location }
```

## Security Requirements

The mobile app handles **financial transactions, customer PII, and authentication credentials**. The marketplace acts as a man-in-the-middle by design (relay), so these mitigations are required:

1. **End-to-end encryption** of `params` and `data` fields (Diffie-Hellman key exchange between mobile app and on-prem ERP during initial setup; AES-256-GCM for payloads)
2. **Mobile session token (`ms_*`) validation:**
   - 256-bit CSPRNG generation
   - 24-hour expiry, refresh via `auth.login`
   - Bound to specific `deployment_id` (reject cross-deployment use)
   - Server invalidates on password change
3. **Correlation ID validation:** Marketplace MUST verify that the responding deployment owns the event being responded to
4. **Audit logging:** Log all RPC submissions (action, deployment_id, correlation_id, status, duration) for compliance
5. **No card data in payloads:** Enforce server-side validation that `payments[]` never contains PAN/CVV
6. **Australian Privacy Act compliance:** Marketplace processes customer PII — Data Processing Agreement should be in place

## ERP-Side Changes (Laravel)

For coordination — the on-prem ERP also needs:

| Change | Purpose |
|---|---|
| New `App\Services\Marketplace\RPCHandler` | Routes RPC actions to existing service methods (Product::search, Sale::create, etc.) |
| Extend `App\Services\Marketplace\RelayClient` | Add `respondToEvent(int $eventId, string $correlationId, string $status, array $data)` method |
| Extend `App\Jobs\Marketplace\PollRelayEvents` | When `event_category === 'rpc_request'`, dispatch to RPCHandler and call `respondToEvent` instead of `acknowledgeEvent` |
| Update `config/marketplace.php` | Add `pos` to `relay_services` config |
| Set ERP's `pos` service poll interval to 2s | (vs 30s for `platform`) — keeps p50 latency <2s |

## Implementation Order

1. Database migration (009_relay_rpc.up.sql)
2. Models (extend `internal/models/relay.go`)
3. Relay service RPC methods (new file `internal/services/relay/rpc.go`)
4. Respond handler (extend `internal/handlers/relay/handler.go`)
5. Mobile session middleware
6. RPC handler (new file `internal/handlers/relay/rpc.go`)
7. Route registration in `cmd/api/main.go`
8. Server WriteTimeout change
9. Rate limiter addition
10. Metrics
11. OpenAPI spec updates
12. ERP-side changes (in parallel with above)

## Testing Checklist

- [ ] `POST /api/relay/rpc` with `auth.login` returns mobile session token within 5s
- [ ] Subsequent calls with `ms_*` token work without `X-Deployment-ID` header
- [ ] Cross-deployment `ms_*` token use returns 401
- [ ] ERP responding with mismatched `relay_identifier` returns 403
- [ ] Mobile timeout (>30s ERP delay) returns 504 with `status: timeout`
- [ ] Rate limit: 61st request in a minute returns 429
- [ ] Redis pub/sub works across multiple marketplace API pods (verify with load balancer)
- [ ] `relay_events.payload` is purged after retention window
- [ ] Concurrent RPC requests for same deployment don't cross-contaminate responses

## Contact

For questions on the mobile app's expected behavior or schema clarifications, contact the mobile team.
