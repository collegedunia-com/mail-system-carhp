import { LoggerService } from "../logger/logger.service.js";
import { Module } from "@nestjs/common";
import { getModelToken, SequelizeModule } from "@nestjs/sequelize";
import type { Config } from "../common/config.js";
import { APP_CONFIG, TRACKING_MODULE } from "../common/app.tokens.js";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { EmailMessage } from "../outreach/model/email-message.model.js";
import { EmailTracking } from "./model/email-tracking.model.js";
import { TrackingService } from "./tracking.service.js";
import { serveTracking } from "./tracking.server.js";

@Module({
  imports: [
    DatabaseModule,
    SequelizeModule.forFeature([EmailTracking, EmailMessage]),
  ],
  providers: [
    {
      provide: TrackingService,
      inject: [
        DatabaseService,
        APP_CONFIG,
        getModelToken(EmailTracking),
        getModelToken(EmailMessage),
      ],
      useFactory: (
        db: DatabaseService,
        cfg: Config,
        emailTracking: typeof EmailTracking,
        emailMessage: typeof EmailMessage,
      ) => new TrackingService(db, cfg, emailTracking, emailMessage),
    },
    {
      provide: TRACKING_MODULE,
      inject: [TrackingService, APP_CONFIG, LoggerService],
      useFactory: (
        service: TrackingService,
        cfg: Config,
        logger: LoggerService,
      ) => ({
        service,
        serve: (signal: AbortSignal, onListening?: () => void) =>
          serveTracking(service, cfg, signal, logger, onListening),
      }),
    },
  ],
  exports: [TrackingService, TRACKING_MODULE],
})
export class TrackingModule {}

export interface TrackingModuleFacade {
  service: TrackingService;
  serve(signal: AbortSignal, onListening?: () => void): Promise<void>;
}
