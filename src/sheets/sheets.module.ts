import { LoggerService } from "../logger/logger.service.js";
import { Module } from "@nestjs/common";
import { getModelToken, SequelizeModule } from "@nestjs/sequelize";
import type { Config } from "../common/config.js";
import {
  APP_CONFIG,
  APP_OVERRIDES,
  SHEETS_MODULE,
} from "../common/app.tokens.js";
import type { AppOverrides } from "../common/app-overrides.js";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { GoogleModule } from "../google/google.module.js";
import { GoogleService } from "../google/google.service.js";
import { TemplatesModule } from "../templates/templates.module.js";
import { TemplatesService } from "../templates/templates.service.js";
import {
  GoogleSheet,
  SheetSync,
  type SheetModels,
  type SheetPort,
} from "./sheets.service.js";
import { TrackingModule } from "../tracking/tracking.module.js";
import { TrackingService } from "../tracking/tracking.service.js";
import { Outreach } from "../outreach/model/outreach.model.js";
import { EmailMessage } from "../outreach/model/email-message.model.js";
import { GmailAccount } from "../gmail/model/gmail-account.model.js";
import { SuppressedRecipient } from "../replies/model/suppressed-recipient.model.js";

export function createSheetsFacade(
  cfg: Config,
  db: DatabaseService,
  google: GoogleService,
  templates: TemplatesService,
  override: SheetPort | undefined,
  models: SheetModels,
  tracking: TrackingService,
  logger: LoggerService,
) {
  let sheet = override;
  let sync: SheetSync | undefined;
  const getSheet = () => (sheet ||= new GoogleSheet(cfg, google));
  const getSync = () =>
    (sync ||= new SheetSync(
      db,
      cfg,
      getSheet(),
      templates,
      models,
      tracking,
      logger,
    ));
  return {
    get service() {
      return getSheet();
    },
    sync: () => getSync().run(),
    init: async () => {
      const service = getSheet();
      if (!(service instanceof GoogleSheet))
        throw new Error(
          "Sheet initialisation requires the Google Sheets adapter",
        );
      await service.init();
    },
  };
}
export type SheetsModuleFacade = ReturnType<typeof createSheetsFacade>;

@Module({
  imports: [
    DatabaseModule,
    GoogleModule,
    TemplatesModule,
    TrackingModule,
    SequelizeModule.forFeature([
      Outreach,
      EmailMessage,
      GmailAccount,
      SuppressedRecipient,
    ]),
  ],
  providers: [
    {
      provide: SHEETS_MODULE,
      inject: [
        APP_CONFIG,
        DatabaseService,
        GoogleService,
        TemplatesService,
        APP_OVERRIDES,
        getModelToken(Outreach),
        getModelToken(EmailMessage),
        getModelToken(GmailAccount),
        getModelToken(SuppressedRecipient),
        TrackingService,
        LoggerService,
      ],
      useFactory: (
        cfg: Config,
        db: DatabaseService,
        google: GoogleService,
        templates: TemplatesService,
        overrides: AppOverrides,
        outreach: typeof Outreach,
        emailMessage: typeof EmailMessage,
        gmailAccount: typeof GmailAccount,
        suppressedRecipient: typeof SuppressedRecipient,
        tracking: TrackingService,
        logger: LoggerService,
      ) =>
        createSheetsFacade(
          cfg,
          db,
          google,
          templates,
          overrides.sheet,
          {
            Outreach: outreach,
            EmailMessage: emailMessage,
            GmailAccount: gmailAccount,
            SuppressedRecipient: suppressedRecipient,
          },
          tracking,
          logger,
        ),
    },
  ],
  exports: [SHEETS_MODULE],
})
export class SheetsModule {}
