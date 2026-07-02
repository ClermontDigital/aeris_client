import type {
  PendingRepair,
  Repair,
  RepairDetail,
  RepairItem,
  RepairItemStatus,
  RepairItemType,
  RepairPriority,
  RepairStatus,
  RepairStatusHistory,
} from '../types/api.types';
import {asNumber, asString, pickStringOrNull} from './shared';

// Closed set for value-checking incoming status strings. Any unknown value
// falls back to 'pending' so a future server-side addition doesn't crash the
// UI — screens render the raw string in the chip and the pill just says
// "pending" in the meantime. Same reasoning drives the priority fallback.
const REPAIR_STATUSES: readonly RepairStatus[] = [
  'pending',
  'diagnosed',
  'in_progress',
  'waiting_parts',
  'ready',
  'completed',
  'cancelled',
];

function coerceRepairStatus(v: unknown): RepairStatus {
  if (typeof v === 'string' && (REPAIR_STATUSES as readonly string[]).includes(v)) {
    return v as RepairStatus;
  }
  return 'pending';
}

function coerceRepairStatusOrNull(v: unknown): RepairStatus | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && (REPAIR_STATUSES as readonly string[]).includes(v)) {
    return v as RepairStatus;
  }
  return null;
}

// Priority stays open (server may extend the enum); coerce non-strings to
// the documented default 'normal' so consumers can always render something.
function coerceRepairPriority(v: unknown): RepairPriority {
  return typeof v === 'string' && v !== '' ? v : 'normal';
}

const ITEM_TYPES: readonly RepairItemType[] = ['part', 'labor'];
function coerceItemType(v: unknown): RepairItemType {
  return typeof v === 'string' && (ITEM_TYPES as readonly string[]).includes(v)
    ? (v as RepairItemType)
    : 'part';
}

const ITEM_STATUSES: readonly RepairItemStatus[] = ['reserved', 'installed', 'returned'];
function coerceItemStatus(v: unknown): RepairItemStatus {
  return typeof v === 'string' && (ITEM_STATUSES as readonly string[]).includes(v)
    ? (v as RepairItemStatus)
    : 'reserved';
}

// asNumberOrNull — dollar money fields (estimated_cost / final_cost) may be
// null server-side when unset. Distinguish "0 (explicitly free)" from "null
// (not yet quoted)" — pickCents defaults 0, this returns null on absent.
function asNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeRepair(input: unknown): Repair {
  const raw = (input || {}) as Record<string, unknown>;
  // Customer nested vs flat. RepairResource emits `customer` as a subset
  // ({id,name,email,phone}) only on the detail endpoint via whenLoaded; the
  // list endpoint gives us `customer_id` flat.
  const customer =
    raw.customer && typeof raw.customer === 'object' && !Array.isArray(raw.customer)
      ? (raw.customer as Record<string, unknown>)
      : null;
  const customerId =
    raw.customer_id !== undefined && raw.customer_id !== null
      ? asNumber(raw.customer_id)
      : customer && customer.id !== undefined && customer.id !== null
        ? asNumber(customer.id)
        : null;
  // Flat customer_name wins over nested customer.name — mirrors the
  // customer_id priority (top-level fields authoritative when present).
  const customerName =
    typeof raw.customer_name === 'string' && raw.customer_name !== ''
      ? raw.customer_name
      : customer && typeof customer.name === 'string' && customer.name !== ''
        ? customer.name
        : null;
  // assignedTo comes through as `assignedTo: {id, name}` (camel) per the
  // RepairResource `whenLoaded('assignedTo', …)` block; the flat FK
  // `assigned_to` (snake) is always present. Guard against arrays too so
  // an accidental server-side collection doesn't get misread as a record.
  const assignedTo =
    raw.assignedTo && typeof raw.assignedTo === 'object' && !Array.isArray(raw.assignedTo)
      ? (raw.assignedTo as Record<string, unknown>)
      : null;
  const assignedToName =
    assignedTo && typeof assignedTo.name === 'string' && assignedTo.name !== ''
      ? assignedTo.name
      : null;
  // issue_description is the current wire field. Older Aeris2 versions used
  // `reported_issue` for the same data — fall back so an older deployment
  // still renders. asString defaults to '' which is safe for the list chip.
  const issueDescription =
    typeof raw.issue_description === 'string' && raw.issue_description !== ''
      ? raw.issue_description
      : typeof raw.reported_issue === 'string'
        ? raw.reported_issue
        : '';
  return {
    id: asNumber(raw.id),
    repair_number: asString(raw.repair_number),
    customer_id: customerId,
    customer_name: customerName,
    location_id:
      raw.location_id !== undefined && raw.location_id !== null
        ? asNumber(raw.location_id)
        : null,
    sale_id:
      raw.sale_id !== undefined && raw.sale_id !== null ? asNumber(raw.sale_id) : null,
    created_by:
      raw.created_by !== undefined && raw.created_by !== null
        ? asNumber(raw.created_by)
        : null,
    assigned_to:
      raw.assigned_to !== undefined && raw.assigned_to !== null
        ? asNumber(raw.assigned_to)
        : null,
    assigned_to_name: assignedToName,
    device_type: pickStringOrNull(raw, 'device_type'),
    brand: pickStringOrNull(raw, 'brand'),
    model: pickStringOrNull(raw, 'model'),
    serial_number: pickStringOrNull(raw, 'serial_number'),
    issue_description: issueDescription,
    diagnosis: pickStringOrNull(raw, 'diagnosis'),
    notes: pickStringOrNull(raw, 'notes'),
    estimated_cost: asNumberOrNull(raw.estimated_cost),
    final_cost: asNumberOrNull(raw.final_cost),
    status: coerceRepairStatus(raw.status),
    priority: coerceRepairPriority(raw.priority),
    received_at: pickStringOrNull(raw, 'received_at'),
    estimated_completion: pickStringOrNull(raw, 'estimated_completion'),
    completed_at: pickStringOrNull(raw, 'completed_at'),
    picked_up_at: pickStringOrNull(raw, 'picked_up_at'),
    created_at: asString(raw.created_at),
    updated_at: asString(raw.updated_at),
  };
}

export function normalizeRepairItem(input: unknown): RepairItem {
  const raw = (input || {}) as Record<string, unknown>;
  return {
    id: asNumber(raw.id),
    repair_id: asNumber(raw.repair_id),
    product_id:
      raw.product_id !== undefined && raw.product_id !== null
        ? asNumber(raw.product_id)
        : null,
    item_name: asString(raw.item_name),
    item_sku: pickStringOrNull(raw, 'item_sku'),
    item_type: coerceItemType(raw.item_type),
    quantity: asNumber(raw.quantity, 1),
    unit_price: asNumber(raw.unit_price, 0),
    line_total: asNumber(raw.line_total, 0),
    notes: pickStringOrNull(raw, 'notes'),
    status: coerceItemStatus(raw.status),
    created_at: asString(raw.created_at),
    updated_at: asString(raw.updated_at),
  };
}

// Null-safe user embed. RepairResource DOES NOT null-safe `user` — if the
// FK ever nulls (shouldn't, but the deployment team flagged an edge case in
// this release), the wire has `user: null` or a partial object. Fall back
// to a placeholder so the timeline row still renders.
function normalizeStatusHistoryUser(input: unknown): {id: number; name: string} {
  if (!input || typeof input !== 'object') {
    return {id: 0, name: 'Unknown user'};
  }
  const raw = input as Record<string, unknown>;
  const id = raw.id !== undefined && raw.id !== null ? asNumber(raw.id) : 0;
  const name =
    typeof raw.name === 'string' && raw.name !== '' ? raw.name : 'Unknown user';
  return {id, name};
}

export function normalizeRepairStatusHistory(input: unknown): RepairStatusHistory {
  const raw = (input || {}) as Record<string, unknown>;
  return {
    id: asNumber(raw.id),
    from_status: coerceRepairStatusOrNull(raw.from_status),
    to_status: coerceRepairStatus(raw.to_status),
    notes: pickStringOrNull(raw, 'notes'),
    changed_at: pickStringOrNull(raw, 'changed_at'),
    user: normalizeStatusHistoryUser(raw.user),
  };
}

export function normalizeRepairDetail(input: unknown): RepairDetail {
  const base = normalizeRepair(input);
  const raw = (input || {}) as Record<string, unknown>;
  const items = Array.isArray(raw.items)
    ? (raw.items as unknown[]).map(normalizeRepairItem)
    : [];
  // RepairResource emits `statusHistory` (camel) via whenLoaded; support both
  // that and a hypothetical `status_history` (snake) so a future rename or a
  // direct-mode variant that mirrors client naming doesn't drop the timeline.
  const historyRaw =
    (Array.isArray(raw.statusHistory) && (raw.statusHistory as unknown[])) ||
    (Array.isArray(raw.status_history) && (raw.status_history as unknown[])) ||
    [];
  const status_history = historyRaw.map(normalizeRepairStatusHistory);
  // Nested customer subset. Only present on detail; keep null when absent.
  const customerRaw =
    raw.customer && typeof raw.customer === 'object' && !Array.isArray(raw.customer)
      ? (raw.customer as Record<string, unknown>)
      : null;
  const customer = customerRaw
    ? {
        id: asNumber(customerRaw.id),
        name: asString(customerRaw.name),
        email: pickStringOrNull(customerRaw, 'email'),
        phone: pickStringOrNull(customerRaw, 'phone'),
      }
    : null;
  return {
    ...base,
    items,
    status_history,
    customer,
  };
}

// POS-scoped /api/v1/pos/customers/{id}/pending-repairs response shape is
// lighter than RepairResource — different keys, no relationships. Server
// response is `{success, repairs: [...], count}` per the sitrep; this
// normalizer handles a single row from that array.
export function normalizePendingRepair(input: unknown): PendingRepair {
  const raw = (input || {}) as Record<string, unknown>;
  const issueDescription =
    typeof raw.issue_description === 'string' && raw.issue_description !== ''
      ? raw.issue_description
      : typeof raw.reported_issue === 'string'
        ? raw.reported_issue
        : '';
  return {
    id: asNumber(raw.id),
    repair_number: asString(raw.repair_number),
    issue_description: issueDescription,
    device_type: pickStringOrNull(raw, 'device_type'),
    brand: pickStringOrNull(raw, 'brand'),
    model: pickStringOrNull(raw, 'model'),
    estimated_cost: asNumberOrNull(raw.estimated_cost),
    final_cost: asNumberOrNull(raw.final_cost),
    received_at: pickStringOrNull(raw, 'received_at'),
  };
}
