import {useState, useEffect} from 'react';
import ConnectionService, {ConnectionStatus} from '../services/ConnectionService';

export function useNetworkStatus(serverUrl: string) {
  const [status, setStatus] = useState<ConnectionStatus>({
    isConnected: true,
    isServerReachable: false,
  });

  useEffect(() => {
    ConnectionService.start(serverUrl);
    const unsub = ConnectionService.subscribe(setStatus);
    ConnectionService.checkServer();

    return () => {
      unsub();
      ConnectionService.stop();
    };
  }, [serverUrl]);

  return status;
}
