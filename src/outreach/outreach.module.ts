import { Module } from "@nestjs/common";
import { getModelToken, SequelizeModule } from "@nestjs/sequelize";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { SuppressedRecipient } from "../replies/model/suppressed-recipient.model.js";
import { EmailMessage } from "./model/email-message.model.js";
import { Outreach } from "./model/outreach.model.js";
import { OutreachService } from "./outreach.service.js";

@Module({
  imports: [
    DatabaseModule,
    SequelizeModule.forFeature([Outreach, EmailMessage, SuppressedRecipient]),
  ],
  providers: [
    {
      provide: OutreachService,
      inject: [
        DatabaseService,
        getModelToken(Outreach),
        getModelToken(EmailMessage),
        getModelToken(SuppressedRecipient),
      ],
      useFactory: (
        db: DatabaseService,
        outreach: typeof Outreach,
        emailMessage: typeof EmailMessage,
        suppressedRecipient: typeof SuppressedRecipient,
      ) => new OutreachService(db, outreach, emailMessage, suppressedRecipient),
    },
  ],
  exports: [OutreachService],
})
export class OutreachModule {}
