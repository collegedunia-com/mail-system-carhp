import { Module } from "@nestjs/common";
import type { CloudAttachment } from "../common/types.js";
import type { Config } from "../common/config.js";
import {
  APP_CONFIG,
  APP_OVERRIDES,
  ATTACHMENT_LOADER,
} from "../common/app.tokens.js";
import type { AppOverrides } from "../common/app-overrides.js";
import { GoogleModule } from "../google/google.module.js";
import { GoogleService } from "../google/google.service.js";
import { CloudAttachments } from "./attachments.service.js";

export interface AttachmentLoader {
  load(refs: string[]): Promise<CloudAttachment[]>;
}

@Module({
  imports: [GoogleModule],
  providers: [
    {
      provide: ATTACHMENT_LOADER,
      inject: [APP_CONFIG, APP_OVERRIDES, GoogleService],
      useFactory: (
        cfg: Config,
        overrides: AppOverrides,
        google: GoogleService
      ): AttachmentLoader =>
        overrides.attachments ||
        new CloudAttachments(google, cfg.attachmentHosts),
    },
  ],
  exports: [ATTACHMENT_LOADER],
})
export class AttachmentsModule {}
