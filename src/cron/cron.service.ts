import { LoggerService } from "../logger/logger.service.js";
import { setTimeout as delay } from "node:timers/promises";
import { required, type Config } from "../common/config.js";
import type { DatabaseService } from "../database/database.service.js";
import type {
  TickOptions,
  TickSummary,
} from "../followups/followups.service.js";

interface SheetSyncPort {
  sync(): Promise<unknown>;
}
interface BatchPort {
  tick(now: Date, options: TickOptions): Promise<TickSummary>;
}
interface Runtime {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<unknown>;
  log(event: Record<string, unknown>): void;
}
export interface CronSummary {
  status: "complete" | "skipped" | "cancelled" | "time_limit" | "batch_limit";
  attempts: number;
  accepted: number;
  passes: number;
}

export class CronService {
  constructor(
    private cfg: Config,
    private db: Pick<DatabaseService, "withLock">,
    private sheets: SheetSyncPort,
    private followups: BatchPort,
    private logger: LoggerService,
    private runtime: Runtime = {
      now: () => new Date(),
      sleep: (ms, signal) => delay(ms, undefined, { signal }),
      log: (event) =>
        event.error
          ? logger.error(event, undefined, "Cron")
          : logger.log(event, "Cron"),
    },
  ) {}

  async run(signal?: AbortSignal): Promise<CronSummary> {
    const scope = {
      spreadsheet_id: required(this.cfg.spreadsheetId, "SPREADSHEET_ID"),
      sheet_name: this.cfg.sheetName,
    };
    const result = await this.db.withLock("cron", async () => {
      const summary: CronSummary = {
        status: "complete",
        attempts: 0,
        accepted: 0,
        passes: 0,
      };
      const deadline = new Date(
        this.runtime.now().getTime() + this.cfg.cronMaxRuntimeMs,
      );
      while (true) {
        if (signal?.aborted) {
          summary.status = "cancelled";
          break;
        }
        if (this.runtime.now() >= deadline) {
          summary.status = "time_limit";
          break;
        }
        await this.sheets.sync();
        const pass = await this.followups.tick(this.runtime.now(), {
          scope,
          maxAttempts: this.cfg.cronMaxMessages - summary.attempts,
          deadline,
          signal,
        });
        summary.passes++;
        summary.attempts += pass.attempts;
        summary.accepted += pass.accepted;
        await this.sheets.sync();
        this.runtime.log({ event: "cron_pass", ...summary });
        if (pass.accountErrors)
          throw new Error(
            "Cron encountered " +
              pass.accountErrors +
              " mailbox error(s); inspect the account_tick_failed log entries",
          );
        if (signal?.aborted) {
          summary.status = "cancelled";
          break;
        }
        if (this.runtime.now() >= deadline) {
          summary.status = "time_limit";
          break;
        }
        if (summary.attempts >= this.cfg.cronMaxMessages) {
          summary.status = "batch_limit";
          break;
        }
        if (!pass.nextAttemptAt) break;
        const wait = Math.max(
          1,
          pass.nextAttemptAt.getTime() - this.runtime.now().getTime(),
        );
        if (this.runtime.now().getTime() + wait >= deadline.getTime()) {
          summary.status = "time_limit";
          break;
        }
        this.runtime.log({
          event: "cron_waiting",
          seconds: Math.ceil(wait / 1000),
        });
        try {
          await this.runtime.sleep(wait, signal);
        } catch (error) {
          if (!signal?.aborted) throw error;
        }
      }
      return summary;
    });
    return result || { status: "skipped", attempts: 0, accepted: 0, passes: 0 };
  }
}
