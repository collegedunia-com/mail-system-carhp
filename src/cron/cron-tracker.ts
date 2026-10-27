interface CronTrackerPorts {
  run(signal: AbortSignal): Promise<void>;
  serve(signal: AbortSignal, onListening: () => void): Promise<void>;
}

export async function runCronWithTracker(
  ports: CronTrackerPorts,
  signal: AbortSignal,
  log: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (signal.aborted) return;
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  let ready!: () => void;
  const listening = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let trackerFailed = false;
  let trackerError: unknown;
  const trackerDone = (async () => {
    try {
      await ports.serve(controller.signal, ready);
      if (!controller.signal.aborted)
        throw new Error("Tracker stopped unexpectedly");
    } catch (error) {
      trackerFailed = true;
      trackerError = error;
    } finally {
      ready();
      controller.abort();
    }
  })();
  try {
    await listening;
    if (!controller.signal.aborted) {
      log({ event: "cron_tracker_ready" });
      await ports.run(controller.signal);
      if (!controller.signal.aborted)
        throw new Error("Cron scheduler stopped unexpectedly");
    }
    await trackerDone;
    if (trackerFailed) throw trackerError;
  } finally {
    controller.abort();
    await trackerDone;
    signal.removeEventListener("abort", stop);
  }
}
