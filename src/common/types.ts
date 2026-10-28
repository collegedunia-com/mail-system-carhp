export interface Account {
  id: string;
  email: string;
  encrypted_tokens: string;
  status: "connected" | "disconnected" | "paused";
  history_id: string | null;
}
export interface RenderedEmail {
  subject: string;
  text: string;
}
export interface Outreach {
  id: string;
  spreadsheet_id: string;
  sheet_name: string;
  sheet_row_id: string;
  account_id: string;
  to_email: string;
  template_key: string;
  merge_data: Record<string, unknown>;
  template_snapshot: RenderedEmail[];
  attachment_refs: string[];
  status: string;
  thread_id: string | null;
  initial_sent_at: Date | null;
  last_reply_at: Date | null;
  followup_count: number;
  next_followup_at: Date | null;
  error: string | null;
}
export interface Message {
  id: string;
  outreach_id: string;
  account_id: string;
  direction: "out" | "in";
  step: number;
  subject: string;
  body_text: string;
  gmail_message_id: string | null;
  rfc_message_id: string;
  send_state: string;
  accepted_at: Date | null;
  created_at: Date;
  retry_at: Date | null;
  reconcile_checks: number;
  last_reconciled_at: Date | null;
}
export interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}
export interface GmailPort {
  sendAs(): Promise<
    Array<{ sendAsEmail: string; verificationStatus?: string }>
  >;
  profile(): Promise<{ emailAddress: string; historyId: string }>;
  send(
    raw: Buffer,
    threadId?: string,
  ): Promise<{ id: string; threadId: string }>;
  thread(id: string): Promise<GmailMessage[]>;
  message(id: string): Promise<GmailMessage>;
  findSent(rfcId: string): Promise<GmailMessage[]>;
  changes(
    historyId: string | null,
  ): Promise<{ messages: GmailMessage[]; historyId: string }>;
}
export interface CloudAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}
