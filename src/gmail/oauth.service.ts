import { LoggerService } from "../logger/logger.service.js";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import type { DatabaseService } from "../database/database.service.js";
import type { GmailAccount } from "./model/gmail-account.model.js";
import { type Config, required } from "../common/config.js";
import { encrypt } from "../common/security.js";
import { GmailClient } from "./gmail.service.js";
import { emailAddress } from "../templates/templates.service.js";

export async function connectGmail(
  db: DatabaseService,
  cfg: Config,
  gmailAccountModel: typeof GmailAccount,
  logger: LoggerService,
): Promise<void> {
  required(cfg.encryptionKey, "TOKEN_ENCRYPTION_KEY");
  const callback = new URL(cfg.redirectUri);
  if (
    callback.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(callback.hostname) ||
    !callback.port
  ) {
    throw new Error(
      "Use a loopback redirect URI such as http://127.0.0.1:3000/oauth/callback",
    );
  }
  const auth = new OAuth2Client(
    required(cfg.googleClientId, "GOOGLE_CLIENT_ID"),
    required(cfg.googleClientSecret, "GOOGLE_CLIENT_SECRET"),
    cfg.redirectUri,
  );
  const state = randomBytes(32).toString("hex");
  const verifier = await auth.generateCodeVerifierAsync();
  const scopes = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
  ];
  const url = auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state,
    code_challenge: verifier.codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const incoming = new URL(request.url || "/", cfg.redirectUri);
      if (incoming.pathname !== callback.pathname) {
        response.writeHead(404).end();
        return;
      }
      if (incoming.searchParams.get("state") !== state) {
        response.writeHead(400).end("Invalid OAuth state.");
        return;
      }
      const code = incoming.searchParams.get("code");
      if (!code) {
        response.writeHead(400).end("Authorisation was not completed.");
        finish(new Error("Gmail consent was not completed"));
        return;
      }
      try {
        const { tokens } = await auth.getToken({
          code,
          codeVerifier: verifier.codeVerifier,
        });
        if (!tokens.refresh_token)
          throw new Error(
            "No refresh token returned; reconnect and grant offline access",
          );
        auth.setCredentials(tokens);
        const info = await auth.getTokenInfo(tokens.access_token!);
        if (scopes.some((scope) => !info.scopes.includes(scope)))
          throw new Error("Both send and read permissions must be granted");
        const profile = await new GmailClient(cfg, tokens).profile();
        const email = emailAddress(profile.emailAddress);
        await db.transaction(async (transaction) => {
          const [account] = await gmailAccountModel.findOrCreate({
            where: { email },
            defaults: {
              id: randomUUID(),
              email,
              encrypted_tokens: encrypt(tokens, cfg.encryptionKey),
              history_id: profile.historyId,
            },
            transaction,
          });
          await account.update(
            {
              encrypted_tokens: encrypt(tokens, cfg.encryptionKey),
              status: "connected",
            },
            { transaction },
          );
        });
        response
          .writeHead(200, {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store",
          })
          .end("Gmail connected. You can close this tab.");
        logger.log(`Connected ${email}`, "GmailOAuth");
        finish();
      } catch (error) {
        response.writeHead(500).end("Connection failed. Check the terminal.");
        finish(
          error instanceof Error && !("response" in error)
            ? error
            : new Error("Gmail authorisation failed"),
        );
      }
    });
    const timer = setTimeout(
      () => finish(new Error("Gmail connection timed out after 5 minutes")),
      300_000,
    );
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      server.close();
      error ? reject(error) : resolve();
    };
    server.once("error", finish);
    server.listen(Number(callback.port), callback.hostname, () =>
      console.log(`Open this URL to connect Gmail:\n${url}`),
    );
  });
}
