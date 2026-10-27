import { GoogleAuth } from "google-auth-library";

export class GoogleService {
  private auth = new GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });

  async token(): Promise<string> {
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token)
      throw new Error("Google service account did not return an access token");
    return token.token;
  }

  async json<T>(url: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      type Reason = { reason?: unknown } | null;
      const payload = (await response.json().catch(() => null)) as {
        error?: { status?: unknown; details?: Reason[]; errors?: Reason[] };
      } | null;
      const error = payload?.error;
      const reasons = [
        ...(Array.isArray(error?.details) ? error.details : []),
        ...(Array.isArray(error?.errors) ? error.errors : []),
      ].map((entry) => entry?.reason);
      reasons.push(error?.status);
      const reason = reasons.find(
        (value): value is string =>
          typeof value === "string" &&
          /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value),
      );
      const host = new URL(url).hostname;
      const api =
        host === "sheets.googleapis.com"
          ? "Google Sheets API"
          : host === "www.googleapis.com" &&
              new URL(url).pathname.startsWith("/drive/")
            ? "Google Drive API"
            : "Google API";
      let hint = "";
      if (reason === "SERVICE_DISABLED" || reason === "accessNotConfigured")
        hint = `Enable ${api} in the Google Cloud project used by your credentials.`;
      else if (
        reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" ||
        reason === "insufficientPermissions"
      )
        hint =
          "The access token lacks required scopes; check the configured Google credentials and scopes.";
      else if (
        reason &&
        /^(rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded|RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED)$/.test(
          reason,
        )
      )
        hint =
          "Google API quota or rate limit reached; wait before retrying and check the project quotas.";
      else if (response.status === 403)
        hint =
          host === "sheets.googleapis.com"
            ? "Check that Sheets API is enabled and share the spreadsheet with the service-account email as Editor. Verify SPREADSHEET_ID."
            : "Check that the API is enabled and the configured Google identity has access to this resource.";
      throw new Error(
        `${api} request failed (${response.status}${reason ? `, ${reason}` : ""})${hint ? `. ${hint}` : ""}`,
      );
    }
    return (await response.json()) as T;
  }
}
