// Same-origin WebSocket link to the relay in server/server.js. Reconnects when the link
// goes quiet (the server pings every 20 s) and closes while the app is hidden.

export type RelayMessage = {t: string; [key: string]: unknown};
export type RelayStatus = 'connecting' | 'open' | 'closed';

const QUIET_MS = 45_000;
const WATCHDOG_MS = 5_000;

export function connectRelay(
  room: string,
  onMessage: (message: RelayMessage) => void,
  onStatus: (status: RelayStatus) => void,
) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${encodeURIComponent(room)}`;
  let ws: WebSocket | null = null;
  let last = Date.now();

  const open = () => {
    const socket = new WebSocket(url);
    ws = socket;
    onStatus('connecting');
    socket.onopen = () => {
      last = Date.now();
      onStatus('open');
    };
    socket.onmessage = event => {
      last = Date.now();
      let message: RelayMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.t !== 'ping') onMessage(message);
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      onStatus('closed');
    };
  };

  const watchdog = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (!ws || Date.now() - last > QUIET_MS) {
      ws?.close();
      last = Date.now();
      open();
    }
  }, WATCHDOG_MS);

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') ws?.close();
  };
  document.addEventListener('visibilitychange', onVisibility);
  open();

  return {
    send(message: RelayMessage) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    stop() {
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisibility);
      const socket = ws;
      ws = null;
      socket?.close();
    },
  };
}
