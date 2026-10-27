import { Module } from "@nestjs/common";
import type { Config } from "../common/config.js";
import { APP_CONFIG } from "../common/app.tokens.js";
import { GoogleModule } from "../google/google.module.js";
import { GoogleService } from "../google/google.service.js";
import { GoogleTemplateLibrary } from "./template-library.service.js";
import { TemplatesService } from "./templates.service.js";

@Module({
  imports: [GoogleModule],
  providers: [
    {
      provide: TemplatesService,
      inject: [APP_CONFIG, GoogleService],
      useFactory: (cfg: Config, google: GoogleService) => {
        const catalog = new GoogleTemplateLibrary(
          cfg.spreadsheetId,
          cfg.templateSheetName,
          google,
        );
        return new TemplatesService(cfg, catalog);
      },
    },
  ],
  exports: [TemplatesService],
})
export class TemplatesModule {}
