import type { DatabaseService } from "../database/database.service.js";
import type { GoogleService } from "../google/google.service.js";
import type { GmailFactory } from "../gmail/gmail.module.js";
import type { SheetPort } from "../sheets/sheets.service.js";
import type { AttachmentLoader } from "../attachments/attachments.module.js";
import type { ReplyMonitor } from "../replies/replies.service.js";

export interface AppOverrides {
  database?: DatabaseService;
  google?: GoogleService;
  gmail?: GmailFactory;
  sheet?: SheetPort;
  attachments?: AttachmentLoader;
  replies?: ReplyMonitor;
}
