import React from 'react';
import { EmptyState } from '../components/EmptyState';

export function TransactionListScreen(): React.ReactElement {
  return (
    <EmptyState
      title="Transactions"
      description="Phase 3 will build me — paginated transaction list with filters and detail view."
    />
  );
}
