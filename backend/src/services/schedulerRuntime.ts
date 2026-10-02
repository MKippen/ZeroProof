export interface ScheduledJob {
  name: string;
  run: () => Promise<void>;
  intervalMs?: number;
  runOnStart?: boolean;
}

interface RuntimeOptions {
  jobs: ScheduledJob[];
  connect: () => Promise<void>;
  initialize: () => void;
  disconnect: () => Promise<void>;
  exit: (code: number) => void;
  log: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string, error?: unknown) => void;
  };
  drainTimeoutMs?: number;
  disconnectTimeoutMs?: number;
}

async function withinDeadline(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Own timers and in-flight work so slow jobs cannot overlap or block startup. */
export function createSchedulerRuntime(options: RuntimeOptions): {
  start: () => Promise<void>;
  shutdown: (reason: string, exitCode?: number) => Promise<void>;
} {
  const names = new Set<string>();
  for (const job of options.jobs) {
    if (names.has(job.name)) throw new Error(`Duplicate scheduled job ${job.name}`);
    names.add(job.name);
    if (job.intervalMs !== undefined && (!Number.isSafeInteger(job.intervalMs) || job.intervalMs < 1)) {
      throw new Error(`Invalid interval for ${job.name}`);
    }
  }
  const active = new Map<string, Promise<void>>();
  const timers = new Set<ReturnType<typeof setInterval>>();
  let stopping = false;
  let startup: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const launch = (job: ScheduledJob): void => {
    if (stopping || active.has(job.name)) return;
    const pending = Promise.resolve().then(job.run).catch((error: unknown) => {
      options.log.error(`Scheduled job ${job.name} failed`, error);
    }).finally(() => { active.delete(job.name); });
    active.set(job.name, pending);
  };

  const shutdown = (reason: string, exitCode = 0): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    options.log.info(`${reason}: stopping scheduler and draining active work`);
    shutdownPromise = (async () => {
      const drained = await withinDeadline(
        Promise.allSettled([...(startup ? [startup] : []), ...active.values()]),
        options.drainTimeoutMs ?? 20_000
      );
      if (!drained) {
        // Do not disconnect dependencies underneath live work. Process exit
        // closes its resources; expiring DB leases let a replacement recover.
        options.log.warn('Scheduler drain deadline reached; exiting for lease-based recovery');
        options.exit(1);
        return;
      }
      try {
        if (!await withinDeadline(options.disconnect(), options.disconnectTimeoutMs ?? 5_000)) {
          options.log.warn('Scheduler dependency shutdown deadline reached');
          options.exit(1);
          return;
        }
        options.exit(exitCode);
      } catch (error) {
        options.log.error('Scheduler dependency shutdown failed', error);
        options.exit(1);
      }
    })();
    return shutdownPromise;
  };

  const start = async (): Promise<void> => {
    if (startup || stopping) return;
    startup = (async () => {
      await options.connect();
      if (stopping) return;
      options.initialize();
      // Register every timer before admitting any initial network work.
      for (const job of options.jobs) {
        if (job.intervalMs !== undefined) timers.add(setInterval(() => launch(job), job.intervalMs));
      }
      for (const job of options.jobs) if (job.runOnStart) launch(job);
      options.log.info('Scheduler running');
    })();
    try { await startup; }
    catch (error) {
      options.log.error('Scheduler failed to start', error);
      // Do not await shutdown inside startup: shutdown drains startup itself.
      void shutdown('Startup failure', 1);
    }
  };
  return { start, shutdown };
}
