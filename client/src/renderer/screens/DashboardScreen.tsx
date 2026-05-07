import React from 'react';
import { EmptyState } from '../components/EmptyState';

export function DashboardScreen(): React.ReactElement {
  return (
    <EmptyState
      title="Dashboard"
      description="Phase 3 will build me — daily summary, recent transactions, quick actions."
    />
  );
}
