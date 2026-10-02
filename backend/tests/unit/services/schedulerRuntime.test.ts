import { createSchedulerRuntime } from '../../../src/services/schedulerRuntime';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function dependencies() {
  return {
    connect: jest.fn().mockResolvedValue(undefined), initialize: jest.fn(),
    disconnect: jest.fn().mockResolvedValue(undefined), exit: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    drainTimeoutMs: 1000, disconnectTimeoutMs: 500,
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('a slow initial sync never blocks heartbeat or detectors and never overlaps itself', async () => {
  const gate = deferred();
  const slow = jest.fn().mockReturnValue(gate.promise);
  const heartbeat = jest.fn().mockResolvedValue(undefined);
  const detector = jest.fn().mockResolvedValue(undefined);
  const runtime = createSchedulerRuntime({ ...dependencies(), jobs: [
    { name: 'sync', intervalMs: 100, runOnStart: true, run: slow },
    { name: 'heartbeat', intervalMs: 100, runOnStart: true, run: heartbeat },
    { name: 'detector', intervalMs: 200, run: detector },
  ] });
  await runtime.start();
  await jest.advanceTimersByTimeAsync(500);
  expect(slow).toHaveBeenCalledTimes(1);
  expect(heartbeat).toHaveBeenCalledTimes(6);
  expect(detector).toHaveBeenCalledTimes(2);
  gate.resolve();
  await jest.advanceTimersByTimeAsync(100);
  expect(slow).toHaveBeenCalledTimes(2);
  await runtime.shutdown('test');
});

it('catches rejected initial database queries and permits the next scheduled attempt', async () => {
  const deps = dependencies();
  const failure = new Error('database unavailable');
  const poll = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  const runtime = createSchedulerRuntime({ ...deps, jobs: [{ name: 'dns', intervalMs: 100, runOnStart: true, run: poll }] });
  await runtime.start();
  await jest.advanceTimersByTimeAsync(100);
  expect(deps.log.error).toHaveBeenCalledWith('Scheduled job dns failed', failure);
  expect(poll).toHaveBeenCalledTimes(2);
  await runtime.shutdown('test');
});

it('handles a synchronous callback exception without leaving the job stuck', async () => {
  const run = jest.fn().mockImplementationOnce(() => { throw new Error('synchronous'); }).mockResolvedValue(undefined);
  const runtime = createSchedulerRuntime({ ...dependencies(), jobs: [{ name: 'job', intervalMs: 100, runOnStart: true, run }] });
  await runtime.start();
  await jest.advanceTimersByTimeAsync(100);
  expect(run).toHaveBeenCalledTimes(2);
  await runtime.shutdown('test');
});

it('stops admission immediately and drains owned work before disconnecting dependencies', async () => {
  const deps = dependencies();
  const gate = deferred();
  const run = jest.fn().mockReturnValue(gate.promise);
  const runtime = createSchedulerRuntime({ ...deps, jobs: [{ name: 'job', intervalMs: 100, runOnStart: true, run }] });
  await runtime.start();
  const stopping = runtime.shutdown('SIGTERM');
  expect(runtime.shutdown('SIGINT')).toBe(stopping);
  await jest.advanceTimersByTimeAsync(400);
  expect(run).toHaveBeenCalledTimes(1);
  expect(deps.disconnect).not.toHaveBeenCalled();
  gate.resolve();
  await stopping;
  expect(deps.disconnect).toHaveBeenCalledTimes(1);
  expect(deps.exit).toHaveBeenCalledWith(0);
  await runtime.start();
  await jest.advanceTimersByTimeAsync(200);
  expect(run).toHaveBeenCalledTimes(1);
});

it('forces bounded recovery rather than closing dependencies beneath a hung job', async () => {
  const deps = dependencies();
  const runtime = createSchedulerRuntime({ ...deps, jobs: [{ name: 'hung', runOnStart: true, run: () => deferred().promise }] });
  await runtime.start();
  const stopping = runtime.shutdown('SIGTERM');
  await jest.advanceTimersByTimeAsync(1000);
  await stopping;
  expect(deps.disconnect).not.toHaveBeenCalled();
  expect(deps.exit).toHaveBeenCalledWith(1);
});

it('does not launch jobs when shutdown arrives during database startup', async () => {
  const deps = dependencies();
  const gate = deferred();
  deps.connect.mockReturnValue(gate.promise);
  const run = jest.fn().mockResolvedValue(undefined);
  const runtime = createSchedulerRuntime({ ...deps, jobs: [{ name: 'job', runOnStart: true, intervalMs: 100, run }] });
  const starting = runtime.start();
  const stopping = runtime.shutdown('SIGTERM');
  expect(deps.disconnect).not.toHaveBeenCalled();
  gate.resolve();
  await Promise.all([starting, stopping]);
  expect(deps.initialize).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(deps.disconnect).toHaveBeenCalledTimes(1);
});

it('bounds shutdown even when the initial database connection is hung', async () => {
  const deps = dependencies();
  deps.connect.mockReturnValue(deferred().promise);
  const runtime = createSchedulerRuntime({ ...deps, jobs: [] });
  void runtime.start();
  const stopping = runtime.shutdown('SIGTERM');
  await jest.advanceTimersByTimeAsync(1000);
  await stopping;
  expect(deps.exit).toHaveBeenCalledWith(1);
  expect(deps.disconnect).not.toHaveBeenCalled();
});

it.each(['connect', 'initialize'] as const)('reports startup %s failure and shuts down once', async (stage) => {
  const deps = dependencies();
  if (stage === 'connect') deps.connect.mockRejectedValue(new Error('failed'));
  else deps.initialize.mockImplementation(() => { throw new Error('failed'); });
  const runtime = createSchedulerRuntime({ ...deps, jobs: [] });
  await runtime.start();
  await jest.advanceTimersByTimeAsync(0);
  expect(deps.exit).toHaveBeenCalledWith(1);
  expect(deps.disconnect).toHaveBeenCalledTimes(1);
});

it('bounds dependency teardown and reports failure', async () => {
  const deps = dependencies();
  deps.disconnect.mockReturnValue(deferred().promise);
  const runtime = createSchedulerRuntime({ ...deps, jobs: [] });
  await runtime.start();
  const stopping = runtime.shutdown('SIGTERM');
  await jest.advanceTimersByTimeAsync(500);
  await stopping;
  expect(deps.exit).toHaveBeenCalledWith(1);
});

it('reports a rejected disconnect without an unhandled shutdown rejection', async () => {
  const deps = dependencies();
  deps.disconnect.mockRejectedValue(new Error('failed'));
  const runtime = createSchedulerRuntime({ ...deps, jobs: [] });
  await runtime.start();
  await runtime.shutdown('SIGTERM');
  expect(deps.exit).toHaveBeenCalledWith(1);
});

it('registers jobs only once if start is called repeatedly', async () => {
  const deps = dependencies();
  const run = jest.fn().mockResolvedValue(undefined);
  const runtime = createSchedulerRuntime({ ...deps, jobs: [{ name: 'job', runOnStart: true, intervalMs: 100, run }] });
  await Promise.all([runtime.start(), runtime.start()]);
  await jest.advanceTimersByTimeAsync(100);
  expect(deps.connect).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledTimes(2);
  await runtime.shutdown('test');
});
