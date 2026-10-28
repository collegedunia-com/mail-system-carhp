import { OAuth2Client, type Credentials } from "google-auth-library";
import type { Config } from "../common/config.js";
import type { GmailMessage, GmailPort } from "../common/types.js";

export class GmailError extends Error {
  constructor(
    message: string,
    public uncertain = false,
    public httpStatus?: number,
    public retryable = false,
  ) {
    super(message);
  }
}

export class GmailClient implements GmailPort {
  private auth: OAuth2Client;
  private changed = false;

  constructor(
    cfg: Config,
    tokens: Credentials,
    private saveTokens?: (tokens: Credentials) => Promise<void>,
  ) {
    this.auth = new OAuth2Client(
      cfg.googleClientId,
      cfg.googleClientSecret,
      cfg.redirectUri,
    );
    this.auth.setCredentials(tokens);
    this.auth.on("tokens", () => {
      this.changed = true;
    });
  }

  private async token(): Promise<string> {
    try {
      const result = await this.auth.getAccessToken();
      if (!result.token) throw new Error("No access token");
      if (this.changed && this.saveTokens) {
        await this.saveTokens(this.auth.credentials);
        this.changed = false;
      }
      return result.token;
    } catch {
      throw new GmailError(
        "Gmail authorisation failed; reconnect the account",
        false,
        401,
      );
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
      {
        headers: { Authorization: `Bearer ${await this.token()}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new GmailError(
        `Gmail read failed (${response.status})`,
        false,
        response.status,
      );
    return (await response.json()) as T;
  }

  async sendAs(): Promise<
    Array<{ sendAsEmail: string; verificationStatus?: string }>
  > {
    const result = await this.get<{
      sendAs?: Array<{ sendAsEmail: string; verificationStatus?: string }>;
    }>("settings/sendAs");
    return result.sendAs || [];
  }

  profile() {
    return this.get<{ emailAddress: string; historyId: string }>("profile");
  }
  message(id: string) {
    return this.get<GmailMessage>(
      `messages/${encodeURIComponent(id)}?format=full`,
    );
  }
  async thread(id: string): Promise<GmailMessage[]> {
    return (
      (
        await this.get<{ messages?: GmailMessage[] }>(
          `threads/${encodeURIComponent(id)}?format=full`,
        )
      ).messages || []
    );
  }

  async send(
    raw: Buffer,
    threadId?: string,
  ): Promise<{ id: string; threadId: string }> {
    const token = await this.token();
    let response: Response;
    try {
      response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            raw: raw.toString("base64url"),
            ...(threadId ? { threadId } : {}),
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new GmailError(
        "Gmail send result is uncertain; reconcile Sent mail before retrying",
        true,
      );
    }
    if (!response.ok) {
      throw new GmailError(
        `Gmail send failed (${response.status})`,
        response.status >= 500,
        response.status,
        response.status === 429,
      );
    }
    let result: { id?: string; threadId?: string };
    try {
      result = (await response.json()) as typeof result;
    } catch {
      throw new GmailError(
        "Gmail returned an unreadable success response",
        true,
      );
    }
    if (!result.id || !result.threadId)
      throw new GmailError(
        "Gmail success response is missing identifiers",
        true,
      );
    return { id: result.id, threadId: result.threadId };
  }

  async findSent(rfcId: string): Promise<GmailMessage[]> {
    const query = new URLSearchParams({
      q: `in:sent rfc822msgid:${rfcId.replace(/[<>]/g, "")}`,
      maxResults: "10",
    });
    const result = await this.get<{ messages?: Array<{ id: string }> }>(
      `messages?${query}`,
    );
    const messages: GmailMessage[] = [];
    for (const message of result.messages || [])
      messages.push(await this.message(message.id));
    return messages;
  }

  async changes(
    historyId: string | null,
  ): Promise<{ messages: GmailMessage[]; historyId: string }> {
    const ids = new Set<string>();
    let cursor = historyId;
    if (cursor) {
      try {
        let pageToken: string | undefined;
        do {
          const query = new URLSearchParams({
            startHistoryId: historyId!,
            historyTypes: "messageAdded",
            maxResults: "500",
          });
          if (pageToken) query.set("pageToken", pageToken);
          const page = await this.get<{
            history?: Array<{
              messagesAdded?: Array<{ message: { id: string } }>;
            }>;
            historyId: string;
            nextPageToken?: string;
          }>(`history?${query}`);
          for (const event of page.history || [])
            for (const added of event.messagesAdded || [])
              ids.add(added.message.id);
          cursor = page.historyId;
          pageToken = page.nextPageToken;
        } while (pageToken);
      } catch (error) {
        if (!(error instanceof GmailError) || error.httpStatus !== 404)
          throw error;
        cursor = null;
      }
    }
    if (!cursor) {
      cursor = (await this.profile()).historyId;
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({
          q: "newer_than:7d",
          maxResults: "100",
          includeSpamTrash: "true",
        });
        if (pageToken) query.set("pageToken", pageToken);
        const page = await this.get<{
          messages?: Array<{ id: string }>;
          nextPageToken?: string;
        }>(`messages?${query}`);
        for (const message of page.messages || []) ids.add(message.id);
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    const messages: GmailMessage[] = [];
    for (const id of ids) {
      try {
        messages.push(await this.message(id));
      } catch (error) {
        if (!(error instanceof GmailError) || error.httpStatus !== 404)
          throw error;
      }
    }
    return { messages, historyId: cursor };
  }
}
