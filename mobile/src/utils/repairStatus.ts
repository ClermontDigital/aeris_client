import type {RepairStatus} from '../types/api.types';
import {COLORS} from '../constants/theme';

// Shared repair-status colour + label helpers. Extracted from
// RepairsListScreen + CustomerDetailScreen so a future RepairStatus enum
// addition (e.g. 'awaiting_approval') only needs one edit. Kept as a pair
// of pure functions rather than a component so both list rows and
// section chips can drive their own JSX. A cross-screen StatusChip
// primitive is a follow-up cleanup candidate.

// Pending / cancelled land on muted greys so they don't compete with the
// actionable "ready" / "in_progress" tones. Palette matches the
// TransactionListScreen mapping for visual consistency.
export function getRepairStatusColor(status: RepairStatus): string {
  switch (status) {
    case 'pending':
      return COLORS.blue; // Dusty Blue - informational intake, distinct from cancelled/gray
    case 'diagnosed':
      return COLORS.blue; // Dusty Blue - informational
    case 'in_progress':
      return COLORS.warning; // amber - work in motion
    case 'waiting_parts':
      return COLORS.danger; // brand crimson - blocking
    case 'ready':
      return COLORS.success; // green - actionable pickup
    case 'completed':
      return COLORS.successDark; // darker green - terminal success
    case 'cancelled':
      return COLORS.textDim; // muted grey - terminal, non-actionable
    default:
      return COLORS.textDim;
  }
}

// Copy for the chip. Underscores in wire enums ('in_progress', 'waiting_parts')
// don't render well; swap to a spaced human form.
export function getRepairStatusLabel(status: RepairStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'waiting_parts':
      return 'Waiting parts';
    default:
      // Capitalise the first letter of the single-word statuses.
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}
