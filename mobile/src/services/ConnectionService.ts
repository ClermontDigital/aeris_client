import NetInfo, {NetInfoState} from '@react-native-community/netinfo';

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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(this.serverUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this._isServerReachable = resp.ok || resp.status < 500;
    } catch {
      this._isServerReachable = false;
    }
    this.notify();
    return this._isServerReachable;
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
