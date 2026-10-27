import { LoggerModule } from "./logger/logger.module.js";
import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "./common/config.js";
import { config } from "./common/config.js";
import type { AppOverrides } from "./common/app-overrides.js";
import { CoreModule } from "./common/core.module.js";
import { AttachmentsModule } from "./attachments/attachments.module.js";
import { CronModule } from "./cron/cron.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { FollowupsModule } from "./followups/followups.module.js";
import { GmailModule } from "./gmail/gmail.module.js";
import { GoogleModule } from "./google/google.module.js";
import { OutreachModule } from "./outreach/outreach.module.js";
import { RepliesModule } from "./replies/replies.module.js";
import { SheetsModule } from "./sheets/sheets.module.js";
import { TemplatesModule } from "./templates/templates.module.js";
import { TrackingModule } from "./tracking/tracking.module.js";
import { WorkerModule } from "./worker/worker.module.js";

@Module({})
export class AppModule {
  static register(
    cfg: Config = config(),
    overrides: AppOverrides = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.register(cfg, overrides),
        LoggerModule,
        DatabaseModule,
        GoogleModule,
        TemplatesModule,
        AttachmentsModule,
        GmailModule,
        SheetsModule,
        RepliesModule,
        FollowupsModule,
        OutreachModule,
        WorkerModule,
        CronModule,
        TrackingModule,
      ],
    };
  }
}

export type { AppOverrides };
