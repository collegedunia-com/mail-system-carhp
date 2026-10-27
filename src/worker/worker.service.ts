import { LoggerService } from "../logger/logger.service.js";
import { setTimeout as delay } from "node:timers/promises";
import { safeError } from "../common/errors.js";

interface SheetSyncPort {
  sync(): Promise<unknown>;
}
interface FollowupPort {
  tick(): Promise<unknown>;
}

export class WorkerService {
  constructor(
    private sheets: SheetSyncPort,
    private followups: FollowupPort,
    private pollMs: number,
    private logger: LoggerService,
  ) {}

  async runOnce(): Promise<void> {
    await this.sheets.sync(); // Input sync must succeed before sending.
    await this.followups.tick();
    await this.sheets.sync(); // Publish SQL results back to the sheet.
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error(
          { event: "worker_pass_failed", error: safeError(error) },
          undefined,
          "Worker",
        );
      }
      await delay(this.pollMs, undefined, { signal }).catch((error) => {
        if (!signal.aborted) throw error;
      });
    }
  }
}
