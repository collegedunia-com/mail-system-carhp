import { LoggerService } from "../logger/logger.service.js";
import { Module } from "@nestjs/common";
import type { Config } from "../common/config.js";
import {
  APP_CONFIG,
  CRON_MODULE,
  SHEETS_MODULE,
} from "../common/app.tokens.js";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import {
  SheetsModule as SheetFeatureModule,
  type SheetsModuleFacade as SheetsFacade,
} from "../sheets/sheets.module.js";
import { FollowupsModule } from "../followups/followups.module.js";
import { FollowupService } from "../followups/followups.service.js";
import { CronService } from "./cron.service.js";
import { CronSchedulerService } from "./cron-scheduler.service.js";

export function createCronFacade(
  cfg: Config,
  db: DatabaseService,
  sheets: SheetsFacade,
  followups: FollowupService,
  logger: LoggerService,
) {
  const service = new CronService(cfg, db, sheets, followups, logger);
  return { service, scheduler: new CronSchedulerService(cfg, service, logger) };
}
export type CronModuleFacade = ReturnType<typeof createCronFacade>;

@Module({
  imports: [DatabaseModule, SheetFeatureModule, FollowupsModule],
  providers: [
    {
      provide: CRON_MODULE,
      inject: [
        APP_CONFIG,
        DatabaseService,
        SHEETS_MODULE,
        FollowupService,
        LoggerService,
      ],
      useFactory: (
        cfg: Config,
        db: DatabaseService,
        sheets: SheetsFacade,
        followups: FollowupService,
        logger: LoggerService,
      ) => createCronFacade(cfg, db, sheets, followups, logger),
    },
  ],
  exports: [CRON_MODULE],
})
export class CronModule {}
