import { LoggerService } from "../logger/logger.service.js";
import { Global, Module } from "@nestjs/common";
import { getConnectionToken } from "@nestjs/sequelize";
import type { Config } from "../common/config.js";
import {
  APP_CONFIG,
  APP_OVERRIDES,
  DATABASE_MODULE,
} from "../common/app.tokens.js";
import type { AppOverrides } from "../common/app-overrides.js";
import { DatabaseService } from "./database.service.js";
import { migrate } from "./migration.service.js";

@Global()
@Module({
  providers: [
    {
      provide: DatabaseService,
      inject: [APP_CONFIG, APP_OVERRIDES],
      useFactory: (cfg: Config, overrides: AppOverrides) =>
        overrides.database || new DatabaseService(cfg),
    },
    {
      provide: getConnectionToken(),
      inject: [DatabaseService],
      useFactory: (service: DatabaseService) => service.sequelize,
    },
    {
      provide: DATABASE_MODULE,
      inject: [DatabaseService, APP_OVERRIDES, LoggerService],
      useFactory: (
        service: DatabaseService,
        overrides: AppOverrides,
        logger: LoggerService,
      ): DatabaseModuleFacade => ({
        service,
        sequelize: service.sequelize,
        migrate: () => migrate(service, logger),
        close: () => (overrides.database ? Promise.resolve() : service.close()),
      }),
    },
  ],
  exports: [DatabaseService, DATABASE_MODULE, getConnectionToken()],
})
export class DatabaseModule {}

export interface DatabaseModuleFacade {
  service: DatabaseService;
  sequelize: DatabaseService["sequelize"];
  migrate(): Promise<void>;
  close(): Promise<void>;
}
