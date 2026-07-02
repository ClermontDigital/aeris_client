# Aeris2 Backend Audit — Mobile Repairs Feature Deployment Report

**Prepared for:** Aeris2 deployment/build team
**Client status:** Mobile Repairs feature ships DARK. `workspace.features.repairs_enabled` defaults `false` (server-side seed already correct). Client is safe to merge; nothing below blocks the mobile release. The list below is what the server must ship before any workspace can flip the flag `true`.

---

## TL;DR

- **4 BLOCKING** — without these, every mobile Repairs call fails at the wire even for `super_admin`. Mobile UI will show empty lists and error toasts.
- **3 REQUIRED FOR LAUNCH** — non-`super_admin` roles get 403; auth-response is missing the feature envelope; PendingRepairs mapping is absent.
- **6 REQUIRED FOR CORRECTNESS** — will pass smoke tests but silently corrupt stock, leak reservations, ignore cross-site scoping, or mis-reconcile GST. Any workspace enabling repairs will regret this within days.
- **7 FOLLOW-UP** — latent bugs and hygiene items the team can bundle later.

Total: **20 items**. All file references are absolute.

---

## BLOCKING (4)

### B1. Add 12 `repairs.*` action mappings to the marketplace dispatcher

**File:** `/Users/developersteve/devfiles/Aeris2/config/marketplace_rpc.php`
**What:** Insert a `repairs.*` block (see full diff in Section 1 of the routes/dispatcher audit above). All 12 mobile actions currently resolve to `RpcActionNotFoundException` because zero repair mappings exist (grep of the config file for `repair` returns zero matches).

Actions to add: `repairs.list`, `repairs.detail`, `repairs.create`, `repairs.update`, `repairs.update-status`, `repairs.add-item`, `repairs.update-item`, `repairs.remove-item`, `repairs.bulk-status`, `repairs.delete`, `repairs.pending-for-customer`, `repairs.status-history` (last one depends on B3).

**Why:** Client dispatches these action names from `/Users/developersteve/devfiles/aeris_client/shared/src/constants/actions.ts:69-80` and calls them from `/Users/developersteve/devfiles/aeris_client/shared/src/RelayClient.ts:1067,1084,1104,1160,1178,1209,1261,1280,1381`. Without the mappings, every mobile Repairs screen returns empty + error toast.

**Complexity:** S (single file, ~15 lines).
**Blocks:** everything else in this document that touches Repairs.

---

### B2. Extend `RpcDispatcher::$aliases` to fill `{repair}`, `{item}`, `{customer}` placeholders

**File:** `/Users/developersteve/devfiles/Aeris2/app/Services/Marketplace/RpcDispatcher.php:199-203`
**What:** Add alias entries so route placeholders match the params the client sends:

```php
static $aliases = [
    'id'       => ['sale_id', 'product_id', 'customer_id', 'repair_id'],
    'code'     => ['barcode'],
    'term'     => ['query', 'search', 'q'],
    'repair'   => ['repair_id', 'id'],
    'item'     => ['item_id'],
    'customer' => ['customer_id', 'id'],
];
```

**Why:** The routes at `/Users/developersteve/devfiles/Aeris2/routes/api.php:338-355` use `{repair}` and `{item}` placeholders. Mobile RelayClient sends `repair_id` and `item_id` (e.g. RelayClient.ts:1084, 1178, 1261, 1280). Without alias entries the dispatcher logs `unfilled path placeholder` and returns 404 on every non-list Repairs call.

**Complexity:** S.
**Blocks:** all B1 mappings except `repairs.list` and `repairs.create` (which don't need placeholder fill).

---

### B3. Add `statusHistory` HTTP route + controller method

**File 1:** `/Users/developersteve/devfiles/Aeris2/routes/api.php` (inside the `repairs` prefix group at line 337-355)
```php
Route::get('/{repair}/status-history', [RepairController::class, 'statusHistory'])
    ->name('repairs.status-history');
```
**File 2:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/RepairController.php` — add method returning the eager-loaded `statusHistory` relation, gated by `ability:repairs:read`.

**Why:** Client calls this at `/Users/developersteve/devfiles/aeris_client/shared/src/RelayClient.ts:1077-1095` as a standalone action. No HTTP route exists today (grep confirmed) — the relation only surfaces via `show()`. Without this, the mobile status-history tab errors on every open.

**Alternative:** Delete the standalone client method and fold history into detail. Not recommended — payload can grow large.

**Complexity:** S (route + 5-line method).
**Blocks:** `repairs.status-history` entry in B1.

---

### B4. Grant `repairs:*` abilities to non-`super_admin` roles

**File:** `/Users/developersteve/devfiles/Aeris2/app/Support/AuthAbilities.php:22-73`
**What:** Add `repairs:read`, `repairs:write`, `repairs:delete` to `admin` + `manager`; `repairs:read` + `repairs:write` to `cashier`; `repairs:read` only to `sales_rep`. Full diff in Section 3 of the routes/dispatcher audit above.

**Why:** `RepairController.php:26-28` declares `ability:repairs:read/write/delete` middleware. `AuthAbilities::ROLE_ABILITIES` does not grant these to any role. Result: every non-`super_admin` bearer gets 403 on every Repairs call, even after B1/B2 land. Verified: grep of AuthAbilities.php for `repairs:` returns zero hits.

**Complexity:** S (single file, per-role additions).
**Blocks:** any non-`super_admin` cashier/manager/admin from using Repairs at all.

---

## REQUIRED FOR LAUNCH (3)

### L1. Emit `workspace.features` sub-envelope on login + refresh

**File 1:** `/Users/developersteve/devfiles/Aeris2/app/Services/Marketplace/Rpc/AuthRpcHandler.php:194-204` (login success return)
**File 2:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/AuthController.php:99-106` (refresh return)

**What:** Add one key to both responses:
```php
'workspace' => [
    'features' => [
        'repairs_enabled' => (bool) \App\Models\SystemSetting::get('features.repairs_enabled', false),
    ],
],
```

**Why:** Client at `/Users/developersteve/devfiles/aeris_client/mobile/src/stores/workspaceFeaturesStore.ts:43-53` reads `raw.workspace.features.repairs_enabled` on every login AND refresh. Missing key → `false` → feature stays dark. This is the switch each workspace uses to enable Repairs in the mobile UI.

**Note:** `features.repairs_enabled` is already seeded in `SystemSettingsSeeder.php:16-25` (default `false`, `is_public=true`). No migration or new setting row needed — purely surfacing the existing value.

**Recommended follow-up:** extract to `WorkspaceContextBuilder::forUser($user): array` so login + refresh share one call site. Consider surfacing the whole `features` group (`SystemSetting::getGroup('features')`) so future flags (equipment_hire, etc.) are a client-side type extension only.

**Complexity:** S (two 3-line insertions) / M (with helper extraction).
**Blocks:** enabling the feature per-workspace. Without this, the flag is unreachable.

---

### L2. Wire `repairs.pending-for-customer` correctly to `/api/v1/pos/accounts/{customer}/pending-repairs`

**File:** `/Users/developersteve/devfiles/Aeris2/config/marketplace_rpc.php` (part of B1)
**What:** Ensure the mapping is:
```php
'repairs.pending-for-customer' => ['GET', '/api/v1/pos/accounts/{customer}/pending-repairs'],
```
(NOT `/api/v1/pos/customers/{id}/pending-repairs` — the URL prefix the client comment hints at doesn't exist. The route is under `Route::prefix('accounts')` at api.php:300.)

**Why:** Client action name is `repairs.pending-for-customer` (shared/src/constants/actions.ts:79) and RelayClient calls it at `RelayClient.ts:1381`. Without the mapping, T8's repair-picker at the till returns `action_not_found`, which `RelayClient.getPendingRepairsForCustomer()` swallows silently — the picker shows empty for every customer. The response shape `{success, repairs, count}` at Frontend/POSController.php:1485-1489 already matches the client's normalizer expectation.

**Complexity:** S (single line, part of B1).
**Blocks:** T8 repair-at-till checkout flow.

---

### L3. Include missing PendingRepair fields in server response

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Frontend/POSController.php:1447-1483`
**What:** Extend the mapped row with:
```php
'issue_description' => $repair->issue_description ?? $repair->reported_issue,
'estimated_cost'    => $repair->estimated_cost,
'received_at'       => optional($repair->received_at)->toIso8601String(),
```
Keep `reported_issue` for backwards compat.

**Why:** Client type at `/Users/developersteve/devfiles/aeris_client/shared/src/types/api.types.ts:696-706` declares `issue_description`, `estimated_cost`, `received_at`. Normalizer at `/Users/developersteve/devfiles/aeris_client/shared/src/normalizers/repair.ts:247-266` already falls back to `reported_issue` (safe), but `estimated_cost` and `received_at` come through `null`. The Ready-for-pickup picker at the till renders blank cost and blank intake date on every row, which cashiers cannot use to reconcile.

**Complexity:** S (three added fields).
**Blocks:** usable T8 repair-picker UX.

---

## REQUIRED FOR CORRECTNESS (6)

### C1. `Api\POSController::processSale` must handle `repair_id` on checkout

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/POSController.php` (add block around line 190, before `DB::commit()`)

**What:** Mirror the Frontend controller's repair-completion block (Frontend/POSController.php:470-508) into the Api handler. On `repair_id` present + status READY, flip repair to COMPLETED, set `sale_id` + `completed_at`, write status_history row. Also delete linked `StockReservation` rows and decrement `stock_reserved` for repair-part items (see C2).

**Why:** BLOCKING WIRE BUG. Route `/api/v1/pos/sales` resolves to `App\Http\Controllers\Api\POSController::processSale` (routes/api.php:293-294) via relay `sale.create` (marketplace_rpc.php:144). Grep of the Api controller for `repair_id`/`Repair`/`RepairStatus` returns ZERO matches. The Frontend controller has the completion logic; the Api handler does not. Result: every mobile relay sale-with-repair_id succeeds as a plain sale, ProcessSaleRequest accepts `repair_id` as `nullable|exists`, the handler ignores it, the repair never flips to COMPLETED, and it stays in the pending-repairs picker forever.

**Complexity:** M (mirror ~40 lines from Frontend controller; needs test coverage for READY-status guard).
**Blocks:** T8 repair-at-till checkout correctness. Without this, cashiers cannot complete a repair through the mobile POS.

---

### C2. Release `StockReservation` rows + decrement `stock_reserved` on repair checkout

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/POSController.php` (inside the new C1 block)
**Also:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Frontend/POSController.php:470-508` (web POS parity)

**What:** For every repair-part `RepairItem` with a `product_id`:
```php
StockReservation::where('repair_item_id', $item->id)->delete();
$product->decrement('stock_reserved', $item->quantity);
```
Mirror of the existing `processRepairPayment` block (Frontend/POSController.php:1557-1560).

**Why:** Both `processSale` handlers decrement `stock_quantity` for whatever cart lines the client sends, but neither clears the reservation rows or drops `stock_reserved`. Result: on every repair checkout, `stock_reserved` climbs unboundedly. `getProductAvailability` (Frontend/POSController.php:900) under-reports "available for sale" (`stock_quantity - stock_reserved`) permanently — products silently become "out of stock" from the till's perspective.

**Dedupe:** if the cart already contains repair-item product_ids (mobile sends them as sale lines), do NOT double-decrement `stock_quantity`. Either dedupe by product_id or make the contract "sales with repair_id must NOT restate repair items in `items[]`" and return 422 on overlap.

**Complexity:** M.
**Blocks:** stock accuracy across the store within days of enabling repairs.

---

### C3. Multi-location scoping is missing across `RepairController`

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/RepairController.php` (all methods)

**What:** Add `hasLocationAccess()` guards:
- `index()`: scope query to caller's `location_id` (except `super_admin`/`admin`)
- `show`, `update`, `updateStatus`, `destroy`, `addItem`, `updateItem`, `removeItem`: `abort(403)` if `!$user->hasLocationAccess((int)$repair->location_id)`
- `store()`: reject `location_id` the caller cannot access
- `bulkUpdateStatus()`: gate per-ID inside the loop, record skipped in response

**Why:** Zero calls to `hasLocationAccess()` in RepairController.php or RepairService.php (verified by grep). Contrast with `InvoiceController.php:279`, `InventoryController.php:72`, `SalesAPIController.php:588`, `MessagingRelayController.php:308` which all gate. Result: a cashier at Site A can list, edit, complete, and delete every repair at every other site. This is a data-leak + integrity issue for multi-location workspaces.

**Complexity:** M (7 methods; consider a `RepairPolicy` — see F1).
**Blocks:** any multi-location workspace enabling Repairs safely.

---

### C4. `updateItem` only persists `quantity`; drops `unit_price`, `notes`, others; skips `line_total` recompute

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/RepairController.php:244-293`

**What:**
- Promote to a `UpdateRepairItemRequest` FormRequest accepting `quantity`, `unit_price`, `notes` (permit `item_name`/`item_sku` only when `item_type === 'labor'`).
- Recompute `line_total = quantity * unit_price` on save.
- On quantity delta, adjust `Product::stock_reserved` via `increment`/`decrement` (same pattern as `addItemToRepair` / `removeItem`).
- Wrap the whole method in `DB::transaction`.

**Why:** Current validation is `$request->validate(['quantity' => 'required|integer|min:1'])` (RepairController.php:246-248) and persistence is `$item->update(['quantity' => $request->quantity])` (line 269). Everything else the mobile edit-line UI sends is silently dropped. `line_total` stays stale, and `Product::stock_reserved` aggregate is not adjusted for quantity changes (only the `StockReservation` row is at :272-275) — leaks reservation stock the same way C2 does.

**Complexity:** M (new FormRequest + transaction + reservation math).
**Blocks:** any pricing/discount edit workflow on repair line items.

---

### C5. `bulkUpdateStatus` partial-success reporting + safety cap

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/RepairController.php:345-387`

**What:**
- Return `{ message, updated_count, skipped: [{id, reason}], failed: [{id, reason}] }`.
- Wrap each iteration in its own nested transaction/savepoint OR track success/failure per iteration and reflect in response before the catch.
- Add `repair_ids` cap (e.g. `max:50`).
- Location-gate each ID (per C3), record rejected ones in `skipped`.
- Extract to a `BulkUpdateRepairStatusRequest` FormRequest using `RepairStatus::values()` (currently the enum list is duplicated inline vs. `UpdateRepairStatusRequest.php:23-27`).

**Why:** Today the loop is `DB::transaction`-wrapped; a mid-loop throw rolls back all writes but `updated_count` retains partial pre-throw values, and the catch at `RepairController.php:377` returns HTTP 500 without the count. Client sees "all failed" for what may be partial success. Client at `/Users/developersteve/devfiles/aeris_client/shared/src/RelayClient.ts:1295+` has no way to reconcile.

**Complexity:** M.
**Blocks:** bulk operations from being trustworthy on the client.

---

### C6. ProcessSaleRequest subtotal reconciliation uses inc-GST inputs; client sends ex-GST

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Requests/ProcessSaleRequest.php:102-137`

**What:** Either
- **(a)** Accept `items.*.unit_price_ex_gst` and `items.*.discount_ex_gst` and reconcile against those directly (matches T8 spec on the client side), OR
- **(b)** Publish the "server divides inc-GST inputs by 1.10" assumption as a hard versioned contract and adjust the mobile normalizer/wire converter to send inc-GST for GST-applicable lines.

Also drop dead validation rules at `:53-54` (`items.*.price`, `items.*.total`) — never consumed.

**Why:** T8/client contract has `unit_price_cents` / `discount_cents` semantically ex-GST. Server does `$unitPriceExGst = $gstApplicable ? round($unitPrice / 1.10, 2) : $unitPrice` at `:113`. If the mobile client sends true-ex-GST with `gst_applicable=true`, the server divides by 1.10 AGAIN → subtotal ~9% lower than the client → trips the 0.02 tolerance for anything over ~$0.30. Real correctness bug for repair checkouts (and every GST-applicable line).

**Complexity:** M (contract decision + implementation) / L (if wire schema change).
**Blocks:** any GST-applicable sale via the relay, not just repairs. High priority given repair spare parts are almost always GST-applicable.

---

## FOLLOW-UP (7)

### F1. Introduce `RepairPolicy` and consolidate ability + location gates

**File:** `/Users/developersteve/devfiles/Aeris2/app/Policies/RepairPolicy.php` (new)
**What:** Standard Laravel policy with `view`, `create`, `update`, `updateStatus`, `delete`, `manageItems` combining `ability` + `hasLocationAccess` checks. Wire via `RepairController` `$this->authorize('view', $repair)` calls.
**Why:** Matches `SalesAPIController` pattern. Cleaner than the current controller-constructor `middleware()` + missing location guards. Absorbs C3's changes into one class.
**Complexity:** M.
**Depends on:** C3.

---

### F2. Codify the `RepairStatus` state machine

**File:** `/Users/developersteve/devfiles/Aeris2/app/Enums/RepairStatus.php`
**What:** Add `canTransitionTo(RepairStatus $to): bool` (deny e.g. `COMPLETED → PENDING`, `COMPLETED → *` except no-op, `CANCELLED → *`). Enforce in `RepairService::updateRepairStatus()` and `UpdateRepairStatusRequest`.
**Why:** Today, `pending → completed` skipping `ready` is allowed, and `completed → pending` regression is possible. Neither the FormRequest nor `RepairService.php:151-196` blocks it.
**Complexity:** S–M.

---

### F3. Non-READY repair on `processSale` should fail loud, not silent

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Frontend/POSController.php:486` + Api mirror from C1.
**What:** Change `if ($repair && $repair->status === RepairStatus::READY)` to fail hard (`throw new \Exception('Repair not ready for checkout')`), matching `processRepairPayment` at :1517-1522.
**Why:** Silent no-op today means a mis-clicked cashier can process the sale with `repair_id` set but leave the repair in status `in_progress` — client cannot reconcile.
**Complexity:** S.
**Depends on:** C1.

---

### F4. Cross-field validation on `repair_id` in ProcessSaleRequest

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Requests/ProcessSaleRequest.php:73`
**What:**
```php
'repair_id' => 'nullable|integer|exists:repairs,id,sale_id,NULL',
```
Optionally: `prohibited_with:hire_deposit_id,hire_return_id,backorder_id,backorder_fulfil_id` (single flow discriminator). Optionally: `required_with:customer_id`.
**Why:** Prevents double-checkout of a repair already tied to a completed sale. Matches the `required_with:` idiom used for `hire_deposit_id`/`backorder_id` at `:74,77`. Currently only `repair_id` lacks a companion rule.
**Complexity:** S.

---

### F5. Confirm `pending-repairs` route resolves to `Frontend\POSController` intentionally

**File:** `/Users/developersteve/devfiles/Aeris2/routes/api.php:321`
**What:** Verify this is the only `Api\`-namespace API route resolving to a `Frontend\` controller. Either move `getPendingRepairs` into `Api\POSController` for consistency, or add a code comment explaining the exception so a future refactor doesn't "clean it up".
**Why:** Every other `/api/v1/pos/*` handler uses the `Api\POSController` alias. This one is a legacy carry-over; risk of accidental deletion in refactor.
**Complexity:** S (comment) / M (relocation).

---

### F6. Consolidate `processSale` implementations behind a `SaleProcessor` service

**File:** Extract to `/Users/developersteve/devfiles/Aeris2/app/Services/SaleProcessor.php` (new)
**What:** Extract the shared sale-creation logic from `Api\POSController::processSale` and `Frontend\POSController::processSale`. Both controllers thin-delegate.
**Why:** Two divergent copies of "single-step POS sale" is the exact reason T8 got missed on the Api handler (see C1). Any future flow (repair, hire, backorder) is implemented twice.
**Complexity:** L.
**Depends on:** C1, C2 (get correctness right before refactoring).

---

### F7. Publish full `features` group in auth response

**File:** `/Users/developersteve/devfiles/Aeris2/app/Services/Marketplace/Rpc/AuthRpcHandler.php` + `AuthController.php` (extends L1)
**What:** Surface the whole `SystemSetting::getGroup('features')` (already cache-backed at `SystemSetting.php:91-98`).
**Why:** Adding `features.equipment_hire_enabled`, etc., becomes a client-side type extension only. Avoids re-touching the auth path for every new module.
**Complexity:** S.
**Depends on:** L1.

---

## Cross-reference by client file

| Client file | Line | Server dependency |
|---|---|---|
| `/Users/developersteve/devfiles/aeris_client/shared/src/constants/actions.ts` | 69-80 | B1 |
| `/Users/developersteve/devfiles/aeris_client/shared/src/RelayClient.ts` | 1067, 1084, 1104, 1160, 1178, 1209, 1261, 1280, 1381 | B1, B2 |
| `/Users/developersteve/devfiles/aeris_client/shared/src/RelayClient.ts` | 1077-1095 | B3 |
| `/Users/developersteve/devfiles/aeris_client/mobile/src/stores/workspaceFeaturesStore.ts` | 43-53 | L1 |
| `/Users/developersteve/devfiles/aeris_client/shared/src/types/api.types.ts` | 12-24 | L1 |
| `/Users/developersteve/devfiles/aeris_client/shared/src/types/api.types.ts` | 696-706 | L3 |
| `/Users/developersteve/devfiles/aeris_client/shared/src/normalizers/repair.ts` | 247-266 | L3 |

## Server files touched, summary

- `/Users/developersteve/devfiles/Aeris2/config/marketplace_rpc.php` — B1, L2
- `/Users/developersteve/devfiles/Aeris2/app/Services/Marketplace/RpcDispatcher.php` — B2
- `/Users/developersteve/devfiles/Aeris2/routes/api.php` — B3, F5
- `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/RepairController.php` — B3, C3, C4, C5, F1
- `/Users/developersteve/devfiles/Aeris2/app/Support/AuthAbilities.php` — B4
- `/Users/developersteve/devfiles/Aeris2/app/Services/Marketplace/Rpc/AuthRpcHandler.php` — L1, F7
- `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/AuthController.php` — L1, F7
- `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Frontend/POSController.php` — L3, C2, F3, F5
- `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/POSController.php` — C1, C2
- `/Users/developersteve/devfiles/Aeris2/app/Http/Requests/ProcessSaleRequest.php` — C6, F4
- `/Users/developersteve/devfiles/Aeris2/app/Enums/RepairStatus.php` — F2
- `/Users/developersteve/devfiles/Aeris2/app/Policies/RepairPolicy.php` (new) — F1
- `/Users/developersteve/devfiles/Aeris2/app/Services/SaleProcessor.php` (new) — F6

## Recommended order of execution

1. **Sprint 1 (unblock the wire):** B1 + B2 + B3 + B4 → mobile Repairs calls stop failing at the dispatcher/permission layer.
2. **Sprint 1 (enable the flag):** L1 → workspaces can flip `repairs_enabled=true`.
3. **Sprint 1 (T8 correctness):** C1 + C2 + L2 + L3 + F3 → mobile can actually check out a repair without corrupting stock.
4. **Sprint 2 (data integrity):** C3 + C4 + C5 + C6 → multi-location, item edits, bulk ops, GST reconciliation.
5. **Sprint 3 (hygiene):** F1 + F2 + F4 + F5 + F6 + F7.

No item outside BLOCKING/REQUIRED FOR LAUNCH holds up a workspace pilot — but any FOLLOW-UP left undone will bite within the first few weeks of production use.