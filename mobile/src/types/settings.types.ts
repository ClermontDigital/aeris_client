import type {ConnectionMode} from './api.types';

export interface Settings {
  baseUrl: string;
  sessionTimeout: number;
  enableSessionManagement: boolean;
  autoStart?: boolean;
  relayUrl?: string;
  connectionMode?: ConnectionMode;
  workspaceCode?: string;
}
