import "reflect-metadata";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { NestFactory } from "@nestjs/core";
import { config, required } from "./common/config.js";
import { safeError } from "./common/errors.js";
import { LoggerService } from "./logger/logger.service.js";
import { cronTrackerOption } from "./common/cli-options.js";
import { runCronWithTracker } from "./cron/cron-tracker.js";
import { AppModule } from "./app.module.js";
import {
  CRON_MODULE,
  DATABASE_MODULE,
  GMAIL_MODULE,
  SHEETS_MODULE,
  TRACKING_MODULE,
} from "./common/app.tokens.js";
import type { DatabaseModuleFacade as DatabaseFacade } from "./database/database.module.js";
import type { GmailModuleFacade as GmailFacade } from "./gmail/gmail.module.js";
import type { SheetsModuleFacade as SheetsFacade } from "./sheets/sheets.module.js";
import type { CronModuleFacade as CronFacade } from "./cron/cron.module.js";
import type { TrackingModuleFacade as TrackingFacade } from "./tracking/tracking.module.js";
import { DatabaseService } from "./database/database.service.js";
import { TemplatesService } from "./templates/templates.service.js";
import { GoogleTemplateLibrary } from "./templates/template-library.service.js";
import { GoogleService } from "./google/google.service.js";
import { FollowupService } from "./followups/followups.service.js";
import { OutreachService } from "./outreach/outreach.service.js";
import { WorkerService } from "./worker/worker.service.js";
import { parseRow } from "./sheets/sheets.service.js";

export async function runCli(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const [command = "help", argument] = args;
  const tracker =
    command === "cron" ? cronTrackerOption(args.slice(1)) : undefined;
  const cfg = config(
    tracker === undefined
      ? process.env
      : { ...process.env, TRACKING_ENABLED: String(tracker) },
  );
  if (command === "help") {
    console.log(
      `Sheet Gmail Mailer\n\nCommands:\n  migrate                       Apply SQL migrations\n  connect                       Connect a Gmail account using OAuth\n  init-sheet                    Initialise headers in an empty existing sheet tab\n  preview <row.json>             Render cloud templates without SQL or sending\n  sync                          Import ready rows and write statuses to the sheet\n  tick                          Run one inbox/send/follow-up pass\n  worker                        Continuously sync the sheet and process accounts\n  cron [--tracker=true|false]    Run a batch; --tracker=true runs the scheduler + tracker\n  tracker                       Run the tracking-pixel HTTP endpoint\n  list                          List outreach IDs and execution states\n  retry <outreach-id>            Retry a definitely failed/pre-send blocked operation\n\nSEND_ENABLED=false by default. The ready checkbox authorises the entire sequence.`,
    );
    return;
  }
  if (command === "preview") {
    const row = JSON.parse(
      await readFile(required(argument || "", "row JSON path"), "utf8"),
    ) as Record<string, string>;
    const parsed = parseRow(row, cfg);
    const templates = new TemplatesService(
      cfg,
      new GoogleTemplateLibrary(
        required(cfg.spreadsheetId, "SPREADSHEET_ID"),
        cfg.templateSheetName,
        new GoogleService(),
      ),
    );
    const sequence = await templates.render(
      parsed.templateKey,
      parsed.mergeData,
    );
    console.log(
      JSON.stringify(
        {
          mode: "preview_only",
          from: parsed.from,
          to: parsed.to,
          attachment_count: parsed.attachments.length,
          steps: sequence,
        },
        null,
        2,
      ),
    );
    return;
  }
  const app = await NestFactory.createApplicationContext(
    AppModule.register(cfg),
    { bufferLogs: true, abortOnError: false },
  );
  const logger = app.get(LoggerService);
  app.useLogger(logger);
  const database = app.get<DatabaseFacade>(DATABASE_MODULE);
  const gmail = app.get<GmailFacade>(GMAIL_MODULE);
  const sheets = app.get<SheetsFacade>(SHEETS_MODULE);
  const cronModule = app.get<CronFacade>(CRON_MODULE);
  const tracking = app.get<TrackingFacade>(TRACKING_MODULE);
  const outreach = app.get(OutreachService);
  const followups = app.get(FollowupService);
  const worker = app.get(WorkerService);
  const sequelize = app.get(DatabaseService).sequelize;
  try {
    switch (command) {
      case "migrate":
        await database.migrate();
        break;
      case "connect":
        await gmail.connect();
        break;
      case "init-sheet":
        await sheets.init();
        logger.log("Sheet headers created", "Sheets");
        break;
      case "list":
        console.table(await outreach.list());
        break;
      case "retry":
        await outreach.retry(required(argument || "", "outreach ID"));
        logger.log(
          "Retry scheduled using the existing message snapshot",
          "Outreach",
        );
        break;
      case "sync":
        logger.log(await sheets.sync(), "Sheets");
        break;
      case "tick":
        required(cfg.encryptionKey, "TOKEN_ENCRYPTION_KEY");
        await followups.tick();
        break;
      case "worker": {
        required(cfg.encryptionKey, "TOKEN_ENCRYPTION_KEY");
        const controller = new AbortController();
        const stop = () => controller.abort();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        logger.log(
          { event: "worker_started", sending_enabled: cfg.sendEnabled },
          "Worker",
        );
        try {
          await worker.run(controller.signal);
        } finally {
          process.removeListener("SIGINT", stop);
          process.removeListener("SIGTERM", stop);
        }
        break;
      }
      case "cron":
      case "tracker": {
        if (command === "cron")
          required(cfg.encryptionKey, "TOKEN_ENCRYPTION_KEY");
        const controller = new AbortController();
        const stop = () => controller.abort();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        try {
          if (command === "cron") {
            if (tracker === true) {
              await sequelize.authenticate();
              logger.log(
                {
                  event: "scheduler_started",
                  hours: cfg.cronHours,
                  timezone: cfg.cronTimezone,
                  sending_enabled: cfg.sendEnabled,
                  tracking_enabled: cfg.trackingEnabled,
                },
                "CronScheduler",
              );
              await runCronWithTracker(
                {
                  run: (signal) => cronModule.scheduler.run(signal),
                  serve: (signal, ready) => tracking.serve(signal, ready),
                },
                controller.signal,
                (event) => logger.log(event, "CronScheduler"),
              );
            } else {
              logger.log(
                {
                  event: "cron_started",
                  sending_enabled: cfg.sendEnabled,
                  tracking_enabled: cfg.trackingEnabled,
                },
                "Cron",
              );
              logger.log(
                {
                  event: "cron_finished",
                  ...(await cronModule.service.run(controller.signal)),
                },
                "Cron",
              );
            }
          } else {
            await sequelize.authenticate();
            await tracking.serve(controller.signal);
          }
        } finally {
          process.removeListener("SIGINT", stop);
          process.removeListener("SIGTERM", stop);
        }
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    try {
      await database.close();
    } finally {
      await app.close();
    }
  }
}

// Also handles configuration failures that happen before the Nest context exists.
export async function runCommand(args?: string[]): Promise<void> {
  try {
    await runCli(args);
  } catch (error) {
    const logger = new LoggerService();
    try {
      logger.error(safeError(error), undefined, "Bootstrap");
    } finally {
      await logger.onApplicationShutdown();
    }
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCommand();
}
