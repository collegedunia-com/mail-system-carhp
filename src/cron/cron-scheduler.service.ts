import { LoggerService } from "../logger/logger.service.js";
import { DateTime } from "luxon";
import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "../common/config.js";
import { safeError } from "../common/errors.js";
import type { CronSummary } from "./cron.service.js";

type Schedule = Pick<Config, "cronTimezone" | "cronHours">;
interface BatchPort {
  run(signal?: AbortSignal): Promise<CronSummary>;
}
interface Runtime {
  now(): Date;
  sleep(ms: number, signal: AbortSignal): Promise<unknown>;
  log(event: Record<string, unknown>): void;
}

export function nextCronRun(now: Date, schedule: Schedule): Date {
  const local = DateTime.fromJSDate(now, { zone: schedule.cronTimezone });
  for (let days = 0; days <= 1; days++) {
    const day = local.plus({ days }).startOf("day");
    for (const hour of [...schedule.cronHours].sort((a, b) => a - b)) {
      const slot = day.set({ hour, minute: 0, second: 0, millisecond: 0 });
      if (slot.toMillis() > now.getTime()) return slot.toJSDate();
    }
  }
  throw new Error("Unable to calculate the next cron run");
}

export class CronSchedulerService {
  constructor(
    private schedule: Schedule,
    private batch: BatchPort,
    private logger: LoggerService,
    private runtime: Runtime = {
      now: () => new Date(),
      sleep: (ms, signal) => delay(ms, undefined, { signal }),
      log: (event) =>
        event.error
          ? logger.error(event, undefined, "CronScheduler")
          : logger.log(event, "CronScheduler"),
    },
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const due = nextCronRun(this.runtime.now(), this.schedule);
      this.runtime.log({
        event: "cron_scheduled",
        at: due.toISOString(),
        timezone: this.schedule.cronTimezone,
      });
      while (!signal.aborted && this.runtime.now() < due) {
        try {
          await this.runtime.sleep(
            Math.min(60_000, due.getTime() - this.runtime.now().getTime()),
            signal,
          );
        } catch (error) {
          if (!signal.aborted) throw error;
        }
      }
      if (signal.aborted) break;
      if (this.runtime.now().getTime() - due.getTime() >= 60_000) {
        this.runtime.log({
          event: "cron_schedule_missed",
          at: due.toISOString(),
        });
        continue;
      }
      try {
        this.runtime.log({
          event: "cron_started",
          scheduled_at: due.toISOString(),
        });
        const result = await this.batch.run(signal);
        this.runtime.log({ event: "cron_finished", ...result });
      } catch (error) {
        this.runtime.log({ event: "cron_failed", error: safeError(error) });
      }
    }
  }
}
