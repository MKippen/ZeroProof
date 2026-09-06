import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebSocketStore } from '@/stores/websocketStore';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.serverClose(1000));

  constructor(public url: string) { MockWebSocket.instances.push(this); }
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  serverClose(code = 1006) { this.readyState = MockWebSocket.CLOSED; this.onclose?.({ code }); }
}

describe('WebSocket store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
    MockWebSocket.instances = [];
    useWebSocketStore.getState().disconnect();
  });

  afterEach(() => {
    useWebSocketStore.getState().disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not duplicate a connecting or open socket', () => {
    const { connect } = useWebSocketStore.getState();
    connect(); connect();
    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0].open();
    connect();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(useWebSocketStore.getState().isConnected).toBe(true);
  });

  it('reconnects even if the first connection never opened', () => {
    useWebSocketStore.getState().connect();
    MockWebSocket.instances[0].serverClose();
    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('stops pings and reconnects when the layout disconnects', () => {
    useWebSocketStore.getState().connect();
    const socket = MockWebSocket.instances[0];
    socket.open();
    vi.advanceTimersByTime(30000);
    expect(socket.send).toHaveBeenCalledTimes(1);
    useWebSocketStore.getState().disconnect();
    vi.advanceTimersByTime(60000);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending reconnects on disconnect', () => {
    useWebSocketStore.getState().connect();
    MockWebSocket.instances[0].serverClose();
    useWebSocketStore.getState().disconnect();
    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('does not reconnect after a policy rejection', () => {
    useWebSocketStore.getState().connect();
    MockWebSocket.instances[0].serverClose(1008);
    vi.advanceTimersByTime(60000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores late events from an old connection after a remount', () => {
    useWebSocketStore.getState().connect();
    const oldSocket = MockWebSocket.instances[0];
    useWebSocketStore.getState().disconnect();
    useWebSocketStore.getState().connect();
    const current = MockWebSocket.instances[1];
    current.open();
    oldSocket.onopen?.();
    oldSocket.onmessage?.({ data: '{"type":"stale"}' });
    oldSocket.onclose?.({ code: 1006 });
    expect(useWebSocketStore.getState().socket).toBe(current);
    expect(useWebSocketStore.getState().isConnected).toBe(true);
    expect(useWebSocketStore.getState().lastMessage).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('ignores malformed messages without breaking live updates', () => {
    useWebSocketStore.getState().connect();
    const socket = MockWebSocket.instances[0];
    for (const data of ['bad json', 'null', '[]', '{}', '{"type":1}']) {
      socket.onmessage?.({ data });
    }
    expect(useWebSocketStore.getState().lastMessage).toBeNull();
    socket.onmessage?.({ data: '{"type":"notification","count":1}' });
    expect(useWebSocketStore.getState().lastMessage).toEqual({ type: 'notification', count: 1 });
    useWebSocketStore.getState().disconnect();
    expect(useWebSocketStore.getState().lastMessage).toBeNull();
  });
});
