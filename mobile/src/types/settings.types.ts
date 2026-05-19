import type {ConnectionMode} from './api.types';

// Which secondary widget the Dashboard shows by default. The user can flip
// it in-place via a small toggle on the widget header; this is just the
// initial selection on cold start.
export type DashboardSecondaryWidget = 'top_products' | 'recent_customers';

export const DASHBOARD_SECONDARY_WIDGETS: readonly DashboardSecondaryWidget[] = [
  'top_products',
  'recent_customers',
];

export interface Settings {
  baseUrl: string;
  sessionTimeout: number;
  enableSessionManagement: boolean;
  autoStart?: boolean;
  relayUrl?: string;
  connectionMode?: ConnectionMode;
  workspaceCode?: string;
  hapticsEnabled?: boolean;
  dashboardSecondaryWidget?: DashboardSecondaryWidget;
}
