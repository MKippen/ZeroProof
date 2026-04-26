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

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  lastMessage: null,

  connect: () => {
    const { socket } = get();
    if (socket?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ isConnected: true });
      // Start ping interval
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);

      ws.onclose = () => {
        clearInterval(pingInterval);
        set({ isConnected: false, socket: null });
        // Reconnect after delay
        setTimeout(() => get().connect(), 5000);
      };
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        set({ lastMessage: message });
      } catch {
        // Ignore invalid messages
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    set({ socket: ws });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.close();
      set({ socket: null, isConnected: false });
    }
  },

  send: (message) => {
    const { socket } = get();
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  },
}));
