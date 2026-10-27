import { Module } from "@nestjs/common";
import { APP_OVERRIDES } from "../common/app.tokens.js";
import type { AppOverrides } from "../common/app-overrides.js";
import { GoogleService } from "./google.service.js";

@Module({
  providers: [
    {
      provide: GoogleService,
      inject: [APP_OVERRIDES],
      useFactory: (overrides: AppOverrides) =>
        overrides.google || new GoogleService(),
    },
  ],
  exports: [GoogleService],
})
export class GoogleModule {}
