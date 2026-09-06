import { create } from 'zustand';

interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

interface WebSocketState {
  socket: WebSocket | null;
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  connect: () => void;
  disconnect: () => void;
  send: (message: object) => void;
}

export const useWebSocketStore = create<WebSocketState>((set, get) => {
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectEnabled = false;

  const clearTimers = () => {
    if (pingInterval !== null) clearInterval(pingInterval);
    if (reconnectTimeout !== null) clearTimeout(reconnectTimeout);
    pingInterval = null;
    reconnectTimeout = null;
  };

  return {
    socket: null,
    isConnected: false,
    lastMessage: null,

    connect: () => {
      reconnectEnabled = true;
      const { socket } = get();
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      clearTimers();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      set({ socket: ws, isConnected: false });

      ws.onopen = () => {
        if (get().socket !== ws) return;
        set({ isConnected: true });
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      // Install before onopen: failed handshakes never reach the open event.
      ws.onclose = (event) => {
        if (get().socket !== ws) return;
        clearTimers();
        set({ isConnected: false, socket: null });
        // Authentication/policy failures require a new session, not a loop.
        if (reconnectEnabled && event.code !== 1008) {
          reconnectTimeout = setTimeout(() => get().connect(), 5000);
        }
      };

      ws.onmessage = (event) => {
        if (get().socket !== ws) return;
        try {
          const message: unknown = JSON.parse(event.data);
          if (message && typeof message === 'object' && 'type' in message && typeof message.type === 'string') {
            set({ lastMessage: message as WebSocketMessage });
          }
        } catch {
          // Ignore invalid messages.
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    },

    disconnect: () => {
      reconnectEnabled = false;
      clearTimers();
      const { socket } = get();
      // Detach state before close: queued events from this socket must not
      // reconnect or overwrite a newer connection (including StrictMode).
      set({ socket: null, isConnected: false, lastMessage: null });
      socket?.close();
    },

    send: (message) => {
      const { socket } = get();
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
  };
});
