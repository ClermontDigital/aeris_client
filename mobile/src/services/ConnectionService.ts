import NetInfo, {NetInfoState} from '@react-native-community/netinfo';
import {resolveFetchUrl} from '../constants/config';

export interface ConnectionStatus {
  isConnected: boolean;
  isServerReachable: boolean;
}

class ConnectionService {
  private listeners: Array<(status: ConnectionStatus) => void> = [];
  private unsubscribeNetInfo: (() => void) | null = null;
  private serverUrl: string = '';
  private _isConnected: boolean = false;
  private _isServerReachable: boolean = false;

  start(serverUrl: string): void {
    this.stop();
    this.serverUrl = serverUrl;
    this.unsubscribeNetInfo = NetInfo.addEventListener(
      (state: NetInfoState) => {
        this._isConnected = state.isConnected ?? false;
        if (this._isConnected) {
          this.checkServer();
        } else {
          this._isServerReachable = false;
          this.notify();
        }
      },
    );
  }

  stop(): void {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
  }

  async checkServer(): Promise<boolean> {
    try {
      // Validate URL scheme before connecting
      const parsed = new URL(this.serverUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        this._isServerReachable = false;
        this.notify();
        return false;
      }
      const fetchUrl = resolveFetchUrl(this.serverUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch(fetchUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // If fetch completes without throwing, server is reachable
      this._isServerReachable = true;
    } catch {
      this._isServerReachable = false;
    }
    this.notify();
    return this._isServerReachable;
  }

  setReachable(reachable: boolean): void {
    this._isServerReachable = reachable;
    this.notify();
  }

  getStatus(): ConnectionStatus {
    return {
      isConnected: this._isConnected,
      isServerReachable: this._isServerReachable,
    };
  }

  subscribe(cb: (status: ConnectionStatus) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  private notify(): void {
    const status = this.getStatus();
    this.listeners.forEach(cb => cb(status));
  }
}

export default new ConnectionService();
