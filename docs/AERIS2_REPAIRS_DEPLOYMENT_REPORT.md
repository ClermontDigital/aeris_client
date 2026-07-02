# Aeris2 Backend Audit — Mobile Repairs Feature Deployment Report

**Prepared for:** Aeris2 deployment / build team
**Revision:** v3 — reflects deployment-team confirmation of contracts (T8 stock, 6 new RPCs, bulk-status shape) and moves resolved items to the shipped column.
**Client status:** Mobile Repairs feature ships DARK. `workspace.features.repairs_enabled` defaults `false`. Client is safe to merge and ship independently. Nothing below blocks the mobile release. The list below is what the server must ship before any workspace can flip the flag `true`.

---

## PROGRESS SUMMARY

### ✅ Landed by deployment team (through this sprint)

| Item | Notes |
|---|---|
| **B4 — Abilities** | `repairs:read/write/delete` granted per role (cashier read-only per review). No further action required. |
| **L1 — Workspace features envelope** | `login` + `refresh` responses now surface `workspace.features.repairs_enabled`. Client hydrates it into `workspaceFeaturesStore` correctly. Verified. |
| **C1 — `repair_id` handling on `Api\POSController::processSale`** | SHIPPED. Server flips a `READY` repair to `COMPLETED` + writes `status_history` + sets `sale_id`/`completed_at` inside the `sale.create` transaction. |
| **C2 — Reservation release + `stock_reserved` decrement on repair checkout** | SHIPPED, with **stock contract option (b)** as the confirmed contract: mobile MUST restate every reserved part in `repair.items[]` as a real product-line item on `sale.create`. Server dedupes against `repair_id` so `stock_quantity` decrements once and `stock_reserved` is released cleanly. Synthetic negative product ids are rejected by `Product::findOrFail`. Mobile T8 wiring updated to match (see §T8 below). |
| **C3 — Multi-location scoping on `RepairController`** | SHIPPED. Every relay-reachable repair endpoint is location-scoped to the signed-in user; `super_admin`/`admin` see all. Cross-site data leak closed. |
| **C4-tail — `updateItem` field persistence** | SHIPPED. Now accepts `unit_price` + `notes` in addition to `quantity`, recomputes `line_total`, adjusts `stock_reserved` on quantity delta, and is blocked once the repair is checked out. |
| **C5 — `bulkUpdateStatus` response shape + safety cap** | SHIPPED. New shape: `{updated_count, succeeded: [ids], skipped: [{id, reason}], failed: [{id, reason}]}`. Endpoint capped at 50 ids. Mobile `bulkUpdateRepairStatus` + `reconcileBulkStatusResult` consume the reason strings for the operator toast (`3 skipped: 2 already completed, 1 invalid transition`). Legacy shapes retained for backward compat during rollout. |
| **B1 tail + B2 tail + B3 + L2 + L3 tail** | All action mappings + dispatcher aliases + `status-history` route + `pending-for-customer` mapping + `PendingRepair.estimated_cost`/`received_at` fields SHIPPED. |
| **WSB series (workshop workflow)** | 6 new RPCs SHIPPED, all ability-gated + location-scoped: `repairs.status-history`, `repairs.add-note`, `repairs.technicians`, `repairs.by-barcode`, `repairs.pending-for-customer`, `repairs.delete`. Path-placeholder aliases: `{repair}←repair_id\|id`, `{item}←item_id`, `{customer}←customer_id\|id`, `{repairNumber}←repair_number\|code`. Notes: **`repairs.technicians` lives at `/api/v1/repairs/technicians` (not `/users/list-technicians`)** — mobile constant + relay method aligned. |

### 🟨 Remaining / open

| Item | Notes |
|---|---|
| **C6 — ProcessSaleRequest GST reconciliation** | Deferred pending staging repro. Deployment-team-flagged concern (worth verifying before restructuring) — a canary $50-GST-applicable relay sale in staging is the fastest way to confirm whether the drift is real. Mobile has already shipped the per-line `gst_applicable` split at `RelayClient.createSale` so a mixed repair-parts + retail cart passes the current server invariant, but the underlying schema question is unchanged. |
| **Marketplace-messaging whitelist for repair `contextType`** | Server side is ready (`contextType='repair'`, template `repair_status`). Marketplace-gateway whitelist confirmation still pending on the deployment team; mobile "Notify customer" flow stays behind that toggle. |
| **Repair labour handling on checkout** | UNRESOLVED. Deployment team confirming the surface (accept as notes line, mint a synth catalog product on-server, or route through a dedicated action). Mobile **provisionally blocks** the hand-off when a repair has any labour lines, with an Alert: *"This repair has labour lines. Handle this checkout at the till desktop until labour surface is confirmed."* Once confirmed, we unblock. |

### ⏳ In flight from client team

Mobile T8-remediation, workshop-workflow WSA-1 through WSA-5 (scanner branch, print label, notes editor, technician picker, my-queue filter) all in-flight this branch (`feat/mobile-repairs`).

---

## T8 — Stock contract remediation shipped

Mobile now matches the confirmed contract (option b): every reserved part in `repair.items[]` with a `product_id` lands on `sale.create` as a real product-line item using the REAL `product_id` (was previously a synthetic `-ri.id` PK, which would have failed `Product::findOrFail`). Two call sites fixed:

- [CartScreen.tsx](../mobile/src/screens/CartScreen.tsx) `handlePickRepair` — line synth uses `id: ri.product_id`.
- [RepairDetailScreen.tsx](../mobile/src/screens/RepairDetailScreen.tsx) `handleRepairCheckout` Confirm branch — same fix, same wire shape.

Labour lines (`ri.item_type === 'labor'` OR `ri.product_id == null`) trigger the provisional block Alert described above; cart + customer + repair-link stay untouched so the cashier can take the checkout to the till desktop. Both screens have unit-test coverage for the parts-only success path AND the labour-present block path.

---

## ENDORSED SEQUENCING (historical — items marked ✅ are shipped)

Original v2 sequencing preserved for continuity. Post-v3 the only outstanding waves are C6 (deferred pending staging repro) + labour-handling confirmation + marketplace-messaging whitelist.

1. ✅ **C1 + C2 + C3 + C4-tail + C5** — SHIPPED (see PROGRESS SUMMARY).
2. ✅ **B1 tail + B2 tail + B3 + L2 + L3 tail** — SHIPPED.
3. ✅ **6 new WSB RPCs** — SHIPPED (`repairs.status-history`, `repairs.add-note`, `repairs.technicians`, `repairs.by-barcode`, `repairs.pending-for-customer`, `repairs.delete`).
4. 🟨 **C6** — deferred pending staging repro.
5. 🟨 **Marketplace-messaging whitelist for `contextType=repair`** — pending deployment-team confirmation.
6. 🟨 **Labour-line handling at checkout** — pending deployment-team confirmation (mobile provisional block in place).

---

## OPEN ITEMS FROM DEPLOYMENT TEAM

Awaiting confirmation from the deployment team before the corresponding mobile surfaces can unblock:

1. **Labour handling on `sale.create`.** Provisional mobile policy: any repair with `item_type === 'labor'` OR `product_id == null` blocks the hand-off with a "till desktop" Alert. Cart / customer / repair-link stay untouched. Once the surface is confirmed (candidates: notes-line, dedicated action, server-side synth catalog product) mobile unblocks in the same release.
2. **Marketplace-messaging whitelist for repair `contextType`.** Server side confirmed ready (`contextType='repair'`, template `repair_status`). Marketplace gateway whitelist toggle is the last piece before WSA-4 "Notify customer" can leave stub mode.
3. **C6 GST reconciliation.** Requires a canary $50-GST-applicable relay sale in staging to determine whether the drift is real. Owner: joint 15-minute reproduction session as originally proposed in v2 §C6.

---

## STILL TO BUILD

### ✅ C1. `Api\POSController::processSale` handles `repair_id` on checkout — SHIPPED

**Blocks:** T8 mobile repair-at-till checkout correctness. **CRITICAL** — this is the one that stops repairs actually working via mobile even after everything else is wired.

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/POSController.php` (add block around line 190, before `DB::commit()`)

**What:** Mirror the Frontend controller's repair-completion block (`Frontend/POSController.php:470-508`) into the Api handler:
- On `repair_id` present + status `READY`: flip repair to `COMPLETED`, set `sale_id` + `completed_at`, write `status_history` row.
- On non-`READY`: fail loud (see F3 in the original follow-ups — currently the Frontend controller silent-no-ops, and the mobile client pre-flight-guards to compensate, but the server should still fail loud for defence in depth).
- Also delete linked `StockReservation` rows and decrement `stock_reserved` for repair-part items (this is C2, coupled).

**Why this is critical:** Route `/api/v1/pos/sales` resolves to `Api\POSController::processSale` (routes/api.php:293-294) via relay `sale.create` (marketplace_rpc.php:144). Grep of the Api controller for `repair_id`/`Repair`/`RepairStatus` returns ZERO matches. Result: every mobile relay sale-with-repair_id succeeds as a plain sale, ProcessSaleRequest accepts `repair_id` as `nullable|exists`, the handler ignores it, the repair never flips to COMPLETED, and it stays in the pending-repairs picker forever.

**Client dependency:** [CheckoutScreen.tsx](../mobile/src/screens/CheckoutScreen.tsx) threads `repair_id` at top level of the `sale.create` payload after the T8 pre-flight guard clears.

**Complexity:** M (mirror ~40 lines from Frontend controller; needs test coverage for READY-status guard).

---

### ✅ C2. Release `StockReservation` rows + decrement `stock_reserved` on repair checkout — SHIPPED

**Blocks:** stock accuracy across the store within days of enabling repairs.

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/POSController.php` (inside the new C1 block)
**Also:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Frontend/POSController.php:470-508` (web POS parity — currently also missing per my earlier audit)

**What:** For every repair-part `RepairItem` with a `product_id`:
```php
StockReservation::where('repair_item_id', $item->id)->delete();
$product->decrement('stock_reserved', $item->quantity);
```
Mirror of the existing `processRepairPayment` block (`Frontend/POSController.php:1557-1560`).

**Dedupe requirement:** if the cart already contains repair-item product_ids (mobile sends them as sale lines — synthesised from `repair.items[]` at [CartScreen.tsx](../mobile/src/screens/CartScreen.tsx) `handlePickRepair` and [RepairDetailScreen.tsx](../mobile/src/screens/RepairDetailScreen.tsx) `handleRepairCheckout`), do NOT double-decrement `stock_quantity`. Either dedupe by product_id in the handler or make the contract "sales with repair_id must NOT restate repair items in `items[]`" and return 422 on overlap. Whichever contract you choose, tell the mobile team so we can adjust the cart synthesis in the same release.

**Why:** Both `processSale` handlers decrement `stock_quantity` for whatever cart lines the client sends, but neither clears the reservation rows or drops `stock_reserved`. Result: on every repair checkout, `stock_reserved` climbs unboundedly. `getProductAvailability` (`Frontend/POSController.php:900`) under-reports "available for sale" (`stock_quantity - stock_reserved`) permanently — products silently become "out of stock" from the till's perspective.

**Complexity:** M. Depends on C1 (same touch site).

---

### ✅ C3. Multi-location scoping across `RepairController` — SHIPPED

**Blocks:** any multi-location workspace enabling Repairs safely. Cross-site data leak.

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/RepairController.php` (all methods)

**What:** Add `hasLocationAccess()` guards:
- `index()`: scope query to caller's `location_id` (except `super_admin`/`admin`).
- `show`, `update`, `updateStatus`, `destroy`, `addItem`, `updateItem`, `removeItem`: `abort(403)` if `!$user->hasLocationAccess((int)$repair->location_id)`.
- `store()`: reject `location_id` the caller cannot access.
- `bulkUpdateStatus()`: gate per-ID inside the loop, record skipped in response.

**Why:** Zero calls to `hasLocationAccess()` in `RepairController.php` or `RepairService.php` (verified by grep). Contrast with `InvoiceController.php:279`, `InventoryController.php:72`, `SalesAPIController.php:588` which all gate. A cashier at Site A can currently list, edit, complete, and delete every repair at every other site.

**Client dependency:** none — mobile client sources `location_id` from `authStore.user.location_id` and sends it on `createRepair`. Server enforces the boundary.

**Complexity:** M (7 methods). Consider a `RepairPolicy` (see F1) that absorbs this cleanly.

---

### ✅ C5. `bulkUpdateStatus` — proper partial-success reporting + safety cap — SHIPPED

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/RepairController.php:345-387`

**What:**
- Return `{ message, updated_count, succeeded: [ids], skipped: [{id, reason}], failed: [{id, reason}] }`.
- Wrap each iteration in its own nested transaction/savepoint OR track success/failure per iteration and reflect in response before the catch.
- Add a `repair_ids` cap (e.g. `max:50`).
- Location-gate each ID (per C3), record rejected ones in `skipped`.
- Extract to a `BulkUpdateRepairStatusRequest` FormRequest using `RepairStatus::values()`.

**Why:** Today the loop is `DB::transaction`-wrapped; a mid-loop throw rolls back all writes but `updated_count` retains partial pre-throw values, and the catch at `RepairController.php:377` returns HTTP 500 without the count. Client sees "all failed" for what may be partial success.

**Client dependency:** [RelayClient.bulkUpdateRepairStatus](../shared/src/relay/RelayClient.ts) already tolerates several response shapes and diffs on the client side, but the diff can't reconstruct which specific IDs failed if the server 500s. The `{updated_count, succeeded: [ids], skipped: [{id, reason}], failed: [{id, reason}]}` shape is the definitive one — client now consumes it via `reconcileBulkStatusResult` which produces a "3 skipped: 2 already completed, 1 invalid transition" style operator toast. Legacy shapes retained for backward compat during rollout; can be retired once every deployment is on the rich shape.

**Complexity:** M.

---

### 🔴 C6. ProcessSaleRequest GST reconciliation — **validate before restructuring**

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Requests/ProcessSaleRequest.php:102-137`

**Deployment team flagged (correctly):** "worth confirming whether the relay POS path is actually exercised in prod, because if so it'd already be 422-ing every GST sale over ~$0.30."

**Recommend: reproduce first, restructure second.** Suggested reproduction:
1. In staging, put a $50 GST-applicable item in the mobile cart.
2. Complete a `sale.create` via the relay (not the direct/LAN path — the drift is on the relay handler's expectation of ex-GST vs the client's inc-GST inputs).
3. Observe whether the response is 200 or 422 with a subtotal-mismatch message.

If it's **200** — my earlier reading missed a client-side conversion; ping me with the trace and I'll re-audit before you touch anything.

If it's **422** — the drift is real and the fix is one of:
- **(a)** Server accepts `items.*.unit_price_ex_gst` and `items.*.discount_ex_gst` directly, matching the T8 client spec.
- **(b)** Publish "server divides inc-GST inputs by 1.10" as a hard versioned contract and adjust the mobile normalizer/wire converter to send inc-GST for GST-applicable lines.

Also drop the dead validation rules at `:53-54` (`items.*.price`, `items.*.total`) — never consumed either way.

**Why this matters beyond repairs:** if the drift is real, it's not repair-specific — it breaks every GST-applicable sale via the relay ≥ ~$0.30. Repair spare parts are almost always GST-applicable so it becomes the trigger, but a canary repair-checkout sale in staging tells you whether every non-repair relay sale is also affected today.

**Complexity:** M (server-side reconciliation change) or L (wire schema change with client-side re-audit).

---

### ✅ Finish B1 — Two remaining action mappings — SHIPPED

**File:** `/Users/developersteve/devfiles/Aeris2/config/marketplace_rpc.php`

Add:
- `repairs.status-history` → depends on **B3** (HTTP route below).
- `repairs.pending-for-customer` → depends on **L2** (mapping resolution below).

**Complexity:** S (two array entries once B3 + L2 are in place).

---

### ✅ Finish B2 — Customer alias in RpcDispatcher — SHIPPED

**File:** `/Users/developersteve/devfiles/Aeris2/app/Services/Marketplace/RpcDispatcher.php:199-203`

Add the `customer` alias entry so `repairs.pending-for-customer` and any future customer-scoped repair action fills correctly:
```php
'customer' => ['customer_id', 'id'],
```

**Why:** Mobile sends `customer_id` on `repairs.pending-for-customer` (RelayClient.ts:1381). Without the alias the dispatcher logs "unfilled path placeholder" and 404s.

**Complexity:** S (one line).

---

### ✅ B3. `statusHistory` HTTP route + controller method — SHIPPED

**File 1:** `/Users/developersteve/devfiles/Aeris2/routes/api.php` (inside the `repairs` prefix group at line 337-355)
```php
Route::get('/{repair}/status-history', [RepairController::class, 'statusHistory'])
    ->name('repairs.status-history');
```

**File 2:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/RepairController.php` — add method returning the eager-loaded `statusHistory` relation, gated by `ability:repairs:read`.

**Why:** Client calls this at [RelayClient.ts:1077-1095](../shared/src/relay/RelayClient.ts) as a standalone action. No HTTP route exists today. The relation currently only surfaces via `show()`; folding into detail is possible but the payload can grow large for long-lived repairs, so the dedicated endpoint is worth keeping.

**Complexity:** S (route + ~5-line method).

---

### ✅ L2. `repairs.pending-for-customer` wired — SHIPPED

**File:** `/Users/developersteve/devfiles/Aeris2/config/marketplace_rpc.php`

**What:** Mapping entry:
```php
'repairs.pending-for-customer' => ['GET', '/api/v1/pos/accounts/{customer}/pending-repairs'],
```

Note: the URL prefix is `/api/v1/pos/accounts/` (existing route at `api.php:321`), NOT `/customers/`. Client mobile constant `POS_PENDING_REPAIRS_BY_CUSTOMER` at [mobile/src/constants/api.ts](../mobile/src/constants/api.ts) currently points at `/customers/{id}/pending-repairs` — if the server-side route stays under `/accounts/`, I need to update the client constant. Please confirm which path the server exposes and I'll align.

**Why:** T8's repair picker at the till fires this. Without the mapping the picker shows empty for every customer.

**Complexity:** S (single line, plus the client alignment mentioned above).

---

### ✅ Finish L3 — PendingRepair fields — SHIPPED

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Frontend/POSController.php:1447-1483`

**What:** Extend the mapped row with:
```php
'estimated_cost' => $repair->estimated_cost,
'received_at'    => optional($repair->received_at)->toIso8601String(),
```

(`issue_description` is already sourced per the deployment team's earlier fix — thank you.)

**Why:** Client `PendingRepair` type at [shared/src/types/api.types.ts:696-706](../shared/src/types/api.types.ts) declares these. Without them, the picker rows render blank cost + blank intake date — cashiers can't reconcile which repair to pick.

**Complexity:** S (two added fields).

---

### ✅ Finish C4 — updateItem field persistence — SHIPPED

**File:** `/Users/developersteve/devfiles/Aeris2/app/Http/Controllers/Api/RepairController.php:244-293` (the ownership guard the deployment team added is preserved — this is the remaining work)

**What:**
- Promote to a `UpdateRepairItemRequest` FormRequest accepting `quantity`, `unit_price`, `notes` (permit `item_name`/`item_sku` only when `item_type === 'labor'`).
- Recompute `line_total = quantity * unit_price` on save.
- On quantity delta, adjust `Product::stock_reserved` via `increment`/`decrement`.
- Wrap the whole method in `DB::transaction`.

**Why:** Current validation is `$request->validate(['quantity' => 'required|integer|min:1'])` and persistence is `$item->update(['quantity' => $request->quantity])`. Everything else the mobile edit-line UI sends is silently dropped. `line_total` stays stale; `Product::stock_reserved` aggregate is not adjusted for quantity changes (only the `StockReservation` row is) — same class of leak as C2.

**Complexity:** M (new FormRequest + transaction + reservation math).

---

## FOLLOW-UP (unchanged from v1, deployment team's call on ordering)

These are hygiene items that can bundle after the above lands:

- **F1** — `RepairPolicy` consolidation (absorbs C3 cleanly)
- **F2** — Codify `RepairStatus` state machine (block invalid transitions like `completed → pending`)
- **F3** — Non-READY repair on `processSale` should fail loud (defence in depth on top of client guards)
- **F4** — Cross-field validation on `repair_id` in ProcessSaleRequest (`exists:repairs,id,sale_id,NULL`)
- **F5** — Route consistency: `pending-repairs` resolves to `Frontend\POSController` — comment or move
- **F6** — Extract shared `SaleProcessor` service (would have prevented C1's Api vs Frontend divergence)
- **F7** — Publish full `SystemSetting::getGroup('features')` in auth response (future-proof for equipment_hire, etc.)

---

## Cross-reference by client file (updated for post-C128473 mobile state)

| Client file | Line | Server dependency |
|---|---|---|
| `shared/src/constants/actions.ts` | REPAIRS_STATUS_HISTORY, REPAIRS_PENDING_FOR_CUSTOMER | B3, L2 |
| `shared/src/relay/RelayClient.ts` | listRepairs / getRepairDetail / etc. | B1 (9 of 12 done), B2 (customer alias pending) |
| `shared/src/relay/RelayClient.ts` | getRepairStatusHistory | B3 |
| `shared/src/relay/RelayClient.ts` | getPendingRepairsForCustomer | L2 |
| `shared/src/relay/RelayClient.ts` | createSale (with repair_id) | **C1** |
| `mobile/src/screens/CheckoutScreen.tsx` | pre-flight repair status check | client-side today; C1 makes it authoritative |
| `mobile/src/screens/CartScreen.tsx` | pending-repairs picker | L2 + L3 completion |
| `mobile/src/screens/RepairDetailScreen.tsx` | Checkout button hand-off | **C1** + C2 |
| `mobile/src/stores/workspaceFeaturesStore.ts` | flag hydration | L1 ✅ |
| `mobile/src/types/RepairCreateInput` | `location_id` required | C3 gate on server |
| `mobile/src/utils/repairsBulkStatus.ts` | reconcile helper | C5 |

---

## Server files summary (post-progress)

| File | Remaining touches |
|---|---|
| `config/marketplace_rpc.php` | Two mappings (B1 finish + L2) |
| `app/Services/Marketplace/RpcDispatcher.php` | Customer alias (B2 finish) |
| `routes/api.php` | Status-history route (B3), F5 route consistency |
| `app/Http/Controllers/Api/RepairController.php` | statusHistory method (B3), hasLocationAccess (C3), updateItem finish (C4), bulkUpdateStatus shape (C5) |
| `app/Http/Controllers/Api/POSController.php` | **repair_id handling (C1)**, reservation release (C2) |
| `app/Http/Controllers/Frontend/POSController.php` | PendingRepair fields (L3 finish), reservation release parity (C2), fail-loud on non-READY (F3) |
| `app/Http/Requests/ProcessSaleRequest.php` | GST reconciliation after canary validation (C6) |

---

## Workshop-workflow appendix — **in flight**

A mobile-team scoping workflow is currently mapping the Aeris2 web repair workflow (Filament + Inertia + `Components/Repairs/*`) so the mobile app matches it for workshop technicians. Expected additions to this document:

- **New RPC action(s)** — `repairs.by-barcode` for scanner lookup, or an extension of `repairs.list?search=...` if that path already indexes `repair_number`.
- **Label PDF signed-URL flow** — likely `repairs.label-pdf-url` mirroring the existing `sales.invoice-pdf-url` pattern. Includes a Blade template for the barcode label layout.
- **Technician assignment** — probably reuses `repairs.update` with `assigned_to`; possibly a dedicated `repairs.assign` action.
- **Notify customer** — the T7 stub currently Alerts "ships in a later release"; a `repairs.notify` action wrapping the existing SMS/email service unblocks it.
- **Photo attachment** — pending confirmation of whether the web has this today.

I'll append these to this document as a Section II when the audit lands.

---

## Contact / questions

- Client-side changes for any of the above ship in the same mobile branch (`feat/mobile-repairs`); happy to align in lockstep.
- If you'd rather I take the frontend contract updates first (client wire alignment) so the server work can proceed independently, say the word.
- For C6 in particular: recommend a joint 15-minute reproduction session in staging before scoping the change.

---

# Section II — Workshop-workflow amendments (mobile) + server dependencies

**Purpose:** Bring mobile to workflow-parity with the Aeris2 web repair pages (`Pages/Repairs/Show.tsx`, `Components/Repairs/*`, Filament `RepairsTable`). Targets workshop technicians on iPad/Android, not just cashiers at the till.

Deployment-team asks in this section are **NOT blocking the cashier surface** already covered by Section I. They enable the workshop personas (tech doing intake + parts + diagnosis + labelling + status updates on-device).

---

## Mobile amendment plan (client-side waves)

| Wave | Scope | Server dependency |
|---|---|---|
| **WSA-1** | Scan a printed repair label to open detail. Adds `mode: 'repair'` branch to existing `BarcodeScannerScreen`. Reuses `ApiClient.listRepairs(1, 1, {search: value})` LIKE fallback. Scanner entry on `RepairsList` header. | **Client-only** (falls back gracefully once **WSB-1** ships) |
| **WSA-2** | Print a CODE128 repair label from `RepairDetail` (89×38 mm Dymo, matching web `RepairBarcodeModal.tsx`, 1–20 pieces stepper). Uses existing `PrintService.printHtml()` → expo-print → AirPrint / share-to-PDF. Adds `jsbarcode` dep. Also adds "Save & print" variant to `RepairEdit` success path. | **Client-only** |
| **WSA-3** | Full items editor (add / edit / remove parts + labour) wiring the three unwired RPCs `addRepairItem` / `updateRepairItem` / `removeRepairItem`. Product-barcode scanner card inside the editor. Free-text notes textarea on `RepairDetail`. | Client-only for items (RPCs already shipped in T3). Notes need **WSB-2**. |
| **WSA-4** | Real "Notify customer" flow (template picker, confirm, send). Swap LIKE-search fallback for exact-match `getRepairByBarcode` RPC. Priority chips + Overdue toggle on `RepairsList`. | **WSB-1** + **WSB-4** |
| **WSA-5** | Technician assignment picker on `RepairEdit`. "My queue" preset filter on `RepairsList`. Optional bulk-status selection mode (`bulkUpdateRepairStatus` already in T3, unwired). | **WSB-3** |

**Feature-flag posture:** every workshop surface stays under the same `workspace.features.repairs_enabled` gate. No new flag needed.

---

## Deployment-team asks for workshop parity (WSB series)

Complexity conventions match Section I: **S** = single file / small; **M** = new form request / handler; **L** = new subsystem.

### ✅ WSB-1. Exact-match repair-by-barcode endpoint + RPC mapping — SHIPPED

**Blocks:** WSA-4 exact-match scan (WSA-1 works today on LIKE-search fallback, but every scan does an N+1 LIKE across `repair_number` — fine for pilot, not for a busy workshop).

**Files:**
- **New route** in `/Users/developersteve/devfiles/Aeris2/routes/api.php` inside the `repairs` prefix group:
  ```php
  Route::get('/by-barcode/{repairNumber}', [RepairController::class, 'byBarcode'])
      ->name('repairs.by-barcode');
  ```
- **New method** on `RepairController` — `Repair::where('repair_number', $repairNumber)->firstOrFail()` with `repairs:read` ability + `hasLocationAccess` guard (per **C3**).
- **New dispatcher mapping** in `config/marketplace_rpc.php`:
  ```php
  'repairs.by-barcode' => ['GET', '/api/v1/repairs/by-barcode/{repairNumber}'],
  ```

**Client:** new `RelayClient.getRepairByBarcode(repairNumber)` + `REPAIRS_BY_BARCODE = 'repairs.by-barcode'` action constant. Falls back to existing `listRepairs({search})` when action returns NOT_FOUND, so we can ship WSA-1 immediately without waiting.

**Complexity:** S (route + 5-line method + 1 mapping).

---

### ✅ WSB-2. `repairs.add-note` dispatcher mapping — SHIPPED

**Blocks:** WSA-3 notes textarea on `RepairDetail`.

**File:** `/Users/developersteve/devfiles/Aeris2/config/marketplace_rpc.php`

**What:** Verify whether the web route `POST /repairs/{id}/notes` (used at `resources/js/Pages/Repairs/Show.tsx:395-457`) has an `/api/v1` equivalent and dispatcher mapping. If not, add:
- Route (if missing): `Route::post('/{repair}/notes', [RepairController::class, 'addNote'])->name('repairs.add-note');`
- Dispatcher mapping: `'repairs.add-note' => ['POST', '/api/v1/repairs/{repair}/notes']`
- Controller method that appends a `RepairStatusHistory` row with `to_status === from_status` (no status change) and the note body — matches the web timeline sort model.

**Complexity:** S (verification + potentially route + mapping).

---

### ✅ WSB-3. Technician-list RPC — SHIPPED (at `/api/v1/repairs/technicians`)

**Blocks:** WSA-5 assignment picker.

**File:** `/Users/developersteve/devfiles/Aeris2/routes/api.php` — SHIPPED at `GET /api/v1/repairs/technicians` (inside the `repairs` prefix group, `repairs:read` ability + location-scoped, super_admin/admin see all).

**Not `/users/list-technicians`** — mobile constant + relay method aligned to the shipped path. Response shape: `[{id, name}]`, defensive shape check on every row so a schema drift doesn't crash the picker; NOT_FOUND downgrades to `[]` so the picker degrades to "self-assign only" until dispatcher wiring rolls out to every deployment.

---

### 🟨 WSB-4. Messaging surface for repair notifications — awaiting marketplace-gateway whitelist

**Blocks:** WSA-4 real "Notify customer" flow (currently a stub Alert on mobile per T7).

**Status:** Server side confirmed ready by deployment team — `contextType: 'repair'` + template `repair_status` are live. **Marketplace-gateway whitelist confirmation is the remaining piece** (deployment-team-owned, not on the mobile side). Once the whitelist ships, mobile's Notify-customer surface swaps the stub Alert for the real send flow in the same release.

**Complexity:** S (whitelist toggle).

---

### 🟢 WSB-5 (follow-up). Repair notes may or may not need photo attachments

Web notes are text-only today. iPad camera makes photo-at-intake cheap, and mobile already has `ProductImagePicker` we could reuse. If the deployment team plans to add photo support to `RepairStatusHistory` (or a new `RepairAttachment` table), mobile can wire the same picker.

**Complexity:** L (new table + storage + resource + client picker) — defer unless product prioritises.

---

## Open questions (product / workshop lead)

Before we finalise wave scope, need answers on the following. These change what ships in WSA-1 to WSA-5:

1. **Physical label at intake, or on-screen barcode?** Determines whether Print goes on `RepairEdit` save-and-return OR is `RepairDetail`-only.
2. **Printer surface** — Dymo LabelWriter via AirPrint (assumed), OR Bluetooth thermal (Zebra / Brother)? Second option adds a new integration.
3. **Labels per intake** — one, or one per piece (bag, charger, case)? Web supports 1-20. Mobile default?
4. **Scan-to-open scope** — Repairs tab scanner only, OR also on the QuickSale (till) scanner? Latter enables "walk-in returning labelled device to pay" but the scanner needs to disambiguate repair vs product barcodes.
5. **Notify Customer templates in v1** — just `repair_status`, or also `quote_ready` + `parts_arrived`?
6. **Self-assign vs lead-assigned** — do techs pick their own repairs (picker on `RepairEdit`), or does a lead dispatch (lead-only field)?
7. **Overdue metric** — real workshop KPI, or theatre? Determines whether we port the Filament past-due-red styling.
8. **`repairs.by-barcode` timing** — deployment team bandwidth for WSB-1 in this sprint, or should mobile ship long-term on LIKE-search?
9. **Photo attachments on notes** — v1 requirement, or defer?
10. **Cart merge policy on till scan** — when a walk-in scans their ticket at the till, replace cart / merge / block if items?

---

## Cross-reference index — WSB items

| Client wave needing it | WSB item | Server file |
|---|---|---|
| WSA-4 (exact-match scan) | WSB-1 | `routes/api.php`, `RepairController.php`, `marketplace_rpc.php` |
| WSA-3 (notes textarea) | WSB-2 | `marketplace_rpc.php` (+ route if missing) |
| WSA-5 (assign picker) | WSB-3 | new RPC action, `UserController` / `TechnicianController` |
| WSA-4 (real notify) | WSB-4 | verification only, or shared messaging RPC touch |
| Later | WSB-5 | new `RepairAttachment` table (deferred) |

