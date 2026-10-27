import { LoggerService } from "../logger/logger.service.js";
import { Module } from "@nestjs/common";
import { getModelToken, SequelizeModule } from "@nestjs/sequelize";
import type { Credentials } from "google-auth-library";
import type { Config } from "../common/config.js";
import type { Account, GmailPort } from "../common/types.js";
import {
  APP_CONFIG,
  APP_OVERRIDES,
  GMAIL_MODULE,
} from "../common/app.tokens.js";
import type { AppOverrides } from "../common/app-overrides.js";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { decrypt, encrypt } from "../common/security.js";
import { GmailClient } from "./gmail.service.js";
import { connectGmail } from "./oauth.service.js";
import { composeMail } from "./mime.service.js";
import { GmailAccount } from "./model/gmail-account.model.js";

export type GmailFactory = (account: Account) => GmailPort;

export function createGmailFacade(
  cfg: Config,
  db: DatabaseService,
  gmailAccountModel: typeof GmailAccount,
  logger: LoggerService,
  override?: GmailFactory,
) {
  const createClient: GmailFactory =
    override ||
    ((account) =>
      new GmailClient(
        cfg,
        decrypt<Credentials>(account.encrypted_tokens, cfg.encryptionKey),
        async (tokens) => {
          await gmailAccountModel.update(
            { encrypted_tokens: encrypt(tokens, cfg.encryptionKey) },
            { where: { id: account.id } },
          );
        },
      ));
  return {
    createClient,
    connect: () => connectGmail(db, cfg, gmailAccountModel, logger),
    compose: composeMail,
  };
}
export type GmailModuleFacade = ReturnType<typeof createGmailFacade>;

@Module({
  imports: [DatabaseModule, SequelizeModule.forFeature([GmailAccount])],
  providers: [
    {
      provide: GMAIL_MODULE,
      inject: [
        APP_CONFIG,
        DatabaseService,
        getModelToken(GmailAccount),
        APP_OVERRIDES,
        LoggerService,
      ],
      useFactory: (
        cfg: Config,
        db: DatabaseService,
        gmailAccountModel: typeof GmailAccount,
        overrides: AppOverrides,
        logger: LoggerService,
      ) =>
        createGmailFacade(cfg, db, gmailAccountModel, logger, overrides.gmail),
    },
  ],
  exports: [GMAIL_MODULE],
})
export class GmailModule {}
