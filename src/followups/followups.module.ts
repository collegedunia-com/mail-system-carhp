import { LoggerService } from "../logger/logger.service.js";
import { Module } from "@nestjs/common";
import { getModelToken, SequelizeModule } from "@nestjs/sequelize";
import type { Config } from "../common/config.js";
import {
  APP_CONFIG,
  ATTACHMENT_LOADER,
  GMAIL_MODULE,
} from "../common/app.tokens.js";
import {
  AttachmentsModule,
  type AttachmentLoader,
} from "../attachments/attachments.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { GmailModule, type GmailModuleFacade } from "../gmail/gmail.module.js";
import { GmailAccount } from "../gmail/model/gmail-account.model.js";
import { EmailMessage } from "../outreach/model/email-message.model.js";
import { Outreach } from "../outreach/model/outreach.model.js";
import { RepliesModule } from "../replies/replies.module.js";
import { ReplyMonitor } from "../replies/replies.service.js";
import { SuppressedRecipient } from "../replies/model/suppressed-recipient.model.js";
import { TrackingModule } from "../tracking/tracking.module.js";
import { TrackingService } from "../tracking/tracking.service.js";
import { SendAttempt } from "./model/send-attempt.model.js";
import { FollowupService } from "./followups.service.js";

@Module({
  imports: [
    DatabaseModule,
    SequelizeModule.forFeature([
      GmailAccount,
      Outreach,
      EmailMessage,
      SendAttempt,
      SuppressedRecipient,
    ]),
    AttachmentsModule,
    GmailModule,
    RepliesModule,
    TrackingModule,
  ],
  providers: [
    {
      provide: FollowupService,
      inject: [
        APP_CONFIG,
        DatabaseService,
        ATTACHMENT_LOADER,
        GMAIL_MODULE,
        ReplyMonitor,
        TrackingService,
        getModelToken(GmailAccount),
        getModelToken(Outreach),
        getModelToken(EmailMessage),
        getModelToken(SendAttempt),
        getModelToken(SuppressedRecipient),
        LoggerService,
      ],
      useFactory: (
        cfg: Config,
        db: DatabaseService,
        attachments: AttachmentLoader,
        gmail: GmailModuleFacade,
        replies: ReplyMonitor,
        tracking: TrackingService,
        gmailAccount: typeof GmailAccount,
        outreach: typeof Outreach,
        emailMessage: typeof EmailMessage,
        sendAttempt: typeof SendAttempt,
        suppressedRecipient: typeof SuppressedRecipient,
        logger: LoggerService,
      ) =>
        new FollowupService(
          db,
          cfg,
          attachments,
          gmail.createClient,
          replies,
          tracking,
          {
            GmailAccount: gmailAccount,
            Outreach: outreach,
            EmailMessage: emailMessage,
            SendAttempt: sendAttempt,
            SuppressedRecipient: suppressedRecipient,
          },
          logger,
        ),
    },
  ],
  exports: [FollowupService],
})
export class FollowupsModule {}
