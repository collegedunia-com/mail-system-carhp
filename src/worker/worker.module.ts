import { LoggerService } from "../logger/logger.service.js";
import { Module } from "@nestjs/common";
import type { Config } from "../common/config.js";
import { APP_CONFIG, SHEETS_MODULE } from "../common/app.tokens.js";
import {
  SheetsModule as SheetFeatureModule,
  type SheetsModuleFacade as SheetsFacade,
} from "../sheets/sheets.module.js";
import { FollowupsModule } from "../followups/followups.module.js";
import { FollowupService } from "../followups/followups.service.js";
import { WorkerService } from "./worker.service.js";

@Module({
  imports: [SheetFeatureModule, FollowupsModule],
  providers: [
    {
      provide: WorkerService,
      inject: [APP_CONFIG, SHEETS_MODULE, FollowupService, LoggerService],
      useFactory: (
        cfg: Config,
        sheets: SheetsFacade,
        followups: FollowupService,
        logger: LoggerService,
      ) => new WorkerService(sheets, followups, cfg.pollMs, logger),
    },
  ],
  exports: [WorkerService],
})
export class WorkerModule {}
