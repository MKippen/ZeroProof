import prisma from '../../../src/services/database';
import { acquireJobLease, withJobLease, JobLeaseBusyError, JobLeaseLostError } from '../../../src/services/jobLease';

jest.mock('../../../src/services/database', () => ({
  __esModule: true,
  default: { $queryRaw: jest.fn(), $executeRaw: jest.fn(), $transaction: jest.fn() },
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ ownerToken: 'owned' }]);
  (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
  (prisma.$transaction as jest.Mock).mockImplementation((callback) => callback(tx));
  tx.$queryRaw.mockResolvedValue([{ key: 'job' }]);
  tx.$executeRaw.mockResolvedValue(1);
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('does not start or clean up another owner when acquisition is busy', async () => {
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
  const work = jest.fn();
  await expect(withJobLease('job', work)).rejects.toBeInstanceOf(JobLeaseBusyError);
  expect(work).not.toHaveBeenCalled();
  expect(prisma.$executeRaw).not.toHaveBeenCalled();
});

it('requires ownership after the publication row lock before calling the writer', async () => {
  const lease = (await acquireJobLease('job'))!;
  tx.$queryRaw.mockResolvedValueOnce([{ key: 'job' }]).mockResolvedValueOnce([]);
  const write = jest.fn();
  await expect(lease.publish(write)).rejects.toBeInstanceOf(JobLeaseLostError);
  expect(write).not.toHaveBeenCalled();
  expect(lease.signal.aborted).toBe(true);
});

it('an uncertain renewal permanently disables publication', async () => {
  const lease = (await acquireJobLease('job'))!;
  (prisma.$executeRaw as jest.Mock).mockRejectedValueOnce(new Error('network failed'));
  await expect(lease.renew()).rejects.toBeInstanceOf(JobLeaseLostError);
  (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
  await expect(lease.publish(jest.fn())).rejects.toBeInstanceOf(JobLeaseLostError);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('coalesces automatic heartbeat work and stops heartbeats after completion', async () => {
  const workGate = deferred();
  const renewGate = deferred();
  (prisma.$executeRaw as jest.Mock).mockReturnValueOnce(renewGate.promise.then(() => 1));
  const running = withJobLease('job', () => workGate.promise, { ttlMs: 1000, renewIntervalMs: 100 });
  await jest.advanceTimersByTimeAsync(500);
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  renewGate.resolve();
  await jest.advanceTimersByTimeAsync(0);
  workGate.resolve();
  await running;
  const callsAfterCleanup = (prisma.$executeRaw as jest.Mock).mock.calls.length;
  await jest.advanceTimersByTimeAsync(2000);
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(callsAfterCleanup);
});

it('stops failed heartbeat retries and fences the remaining callback', async () => {
  const gate = deferred();
  const finished = withJobLease('job', async (lease) => {
    await gate.promise;
    await expect(lease.publish(jest.fn())).rejects.toBeInstanceOf(JobLeaseLostError);
  }, { ttlMs: 1000, renewIntervalMs: 100 });
  (prisma.$executeRaw as jest.Mock).mockRejectedValueOnce(new Error('database lost'));
  await jest.advanceTimersByTimeAsync(500);
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  gate.resolve();
  await finished;
});

it('keeps a committed outcome when lease cleanup fails', async () => {
  (prisma.$executeRaw as jest.Mock).mockRejectedValueOnce(new Error('release failed'));
  await expect(withJobLease('job', async (lease) => lease.publish(async () => 'committed'))).resolves.toBe('committed');
});

it('preserves the original work error and releases once', async () => {
  const failure = new Error('analysis failed');
  await expect(withJobLease('job', async () => { throw failure; })).rejects.toBe(failure);
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
});

it('does not permit a released handle to write and releases idempotently', async () => {
  const lease = (await acquireJobLease('job'))!;
  await lease.release();
  await lease.release();
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  await expect(lease.publish(jest.fn())).rejects.toBeInstanceOf(JobLeaseLostError);
});

it('revokes immediately and returns committed success within five seconds when a renewal never finishes', async () => {
  const workGate = deferred();
  const renewalGate = deferred();
  let handle!: NonNullable<Awaited<ReturnType<typeof acquireJobLease>>>;
  (prisma.$executeRaw as jest.Mock).mockReturnValueOnce(renewalGate.promise.then(() => 1));
  const running = withJobLease('job', async (lease) => {
    handle = lease;
    const result = await lease.publish(async () => 'committed');
    await workGate.promise;
    return result;
  }, { ttlMs: 1000, renewIntervalMs: 100 });
  await jest.advanceTimersByTimeAsync(100);
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  workGate.resolve();
  await jest.advanceTimersByTimeAsync(0);
  expect(handle.signal.aborted).toBe(true);
  await expect(handle.publish(jest.fn())).rejects.toBeInstanceOf(JobLeaseLostError);
  // Owner-qualified release starts without waiting for the stuck renewal.
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  let finished = false;
  void running.then(() => { finished = true; });
  await jest.advanceTimersByTimeAsync(4999);
  expect(finished).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await expect(running).resolves.toBe('committed');
  expect(jest.getTimerCount()).toBe(0);
});

it('preserves the original work error within five seconds when release never finishes', async () => {
  const failure = new Error('Original analysis failure');
  let handle!: NonNullable<Awaited<ReturnType<typeof acquireJobLease>>>;
  (prisma.$executeRaw as jest.Mock).mockReturnValueOnce(deferred().promise);
  const running = withJobLease('job', async (lease) => { handle = lease; throw failure; });
  const rejected = expect(running).rejects.toBe(failure);
  await jest.advanceTimersByTimeAsync(0);
  expect(handle.signal.aborted).toBe(true);
  await expect(handle.publish(jest.fn())).rejects.toBeInstanceOf(JobLeaseLostError);
  await jest.advanceTimersByTimeAsync(5000);
  await rejected;
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('absorbs late renewal and release rejections after the total deadline without changing the committed result', async () => {
  const workGate = deferred();
  const renewalGate = deferred();
  const releaseGate = deferred();
  (prisma.$executeRaw as jest.Mock)
    .mockReturnValueOnce(renewalGate.promise)
    .mockReturnValueOnce(releaseGate.promise);
  const running = withJobLease('job', async (lease) => {
    const result = await lease.publish(async () => 'committed');
    await workGate.promise;
    return result;
  }, { ttlMs: 1000, renewIntervalMs: 100 });
  await jest.advanceTimersByTimeAsync(100);
  workGate.resolve();
  await jest.advanceTimersByTimeAsync(5000);
  await expect(running).resolves.toBe('committed');
  renewalGate.reject(new Error('Delayed renewal failure'));
  releaseGate.reject(new Error('Delayed release failure'));
  await jest.advanceTimersByTimeAsync(1000);
  await expect(running).resolves.toBe('committed');
  expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});
