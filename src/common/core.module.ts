import { DynamicModule, Global, Module } from "@nestjs/common";
import type { Config } from "./config.js";
import type { AppOverrides } from "./app-overrides.js";
import { APP_CONFIG, APP_OVERRIDES } from "./app.tokens.js";

@Global()
@Module({})
export class CoreModule {
  static register(config: Config, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: CoreModule,
      global: true,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_OVERRIDES, useValue: overrides },
      ],
      exports: [APP_CONFIG, APP_OVERRIDES],
    };
  }
}
