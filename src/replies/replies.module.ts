import { LoggerService } from "../logger/logger.service.js";
import { Module } from "@nestjs/common";
import { getModelToken, SequelizeModule } from "@nestjs/sequelize";
import { APP_OVERRIDES } from "../common/app.tokens.js";
import type { AppOverrides } from "../common/app-overrides.js";
import { DatabaseModule } from "../database/database.module.js";
import { GmailAccount } from "../gmail/model/gmail-account.model.js";
import { EmailMessage } from "../outreach/model/email-message.model.js";
import { Outreach } from "../outreach/model/outreach.model.js";
import { SuppressedRecipient } from "./model/suppressed-recipient.model.js";
import { ReplyMonitor } from "./replies.service.js";

@Module({
  imports: [
    DatabaseModule,
    SequelizeModule.forFeature([
      GmailAccount,
      Outreach,
      EmailMessage,
      SuppressedRecipient,
    ]),
  ],
  providers: [
    {
      provide: ReplyMonitor,
      inject: [
        APP_OVERRIDES,
        getModelToken(GmailAccount),
        getModelToken(Outreach),
        getModelToken(EmailMessage),
        getModelToken(SuppressedRecipient),
        LoggerService,
      ],
      useFactory: (
        overrides: AppOverrides,
        gmailAccount: typeof GmailAccount,
        outreach: typeof Outreach,
        emailMessage: typeof EmailMessage,
        suppressedRecipient: typeof SuppressedRecipient,
        logger: LoggerService,
      ) =>
        overrides.replies ||
        new ReplyMonitor(
          {
            GmailAccount: gmailAccount,
            Outreach: outreach,
            EmailMessage: emailMessage,
            SuppressedRecipient: suppressedRecipient,
          },
          logger,
        ),
    },
  ],
  exports: [ReplyMonitor],
})
export class RepliesModule {}
