import { LoggerService } from "../logger/logger.service.js";
import { ApiLoggingMiddleware } from "../common/middleware/api-logging.middleware.js";
import { createServer } from "node:http";
import type { Config } from "../common/config.js";
import { safeError } from "../common/errors.js";

interface PixelRecorder {
  record(token: string): Promise<void>;
}
const pixel = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export function createTrackingServer(
  recorder: PixelRecorder,
  baseUrl: string,
  logger: LoggerService,
) {
  const logRequest = ApiLoggingMiddleware(logger);
  const prefix = baseUrl ? new URL(baseUrl).pathname.replace(/\/$/, "") : "";
  return createServer(async (request, response) => {
    logRequest(request, response);
    try {
      const path = new URL(request.url || "/", "http://localhost").pathname;
      if (!["GET", "HEAD"].includes(request.method || "")) {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      if (path === "/healthz" || path === prefix + "/healthz") {
        response
          .writeHead(200, {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store",
          })
          .end(request.method === "HEAD" ? undefined : "ok");
        return;
      }
      const tail = path.startsWith(prefix + "/open/")
        ? path.slice((prefix + "/open/").length)
        : "";
      const match = /^([a-f0-9]{64})\.gif$/.exec(tail);
      if (!match) {
        response.writeHead(404).end();
        return;
      }
      if (request.method === "GET") await recorder.record(match[1]);
      response.writeHead(200, {
        "Content-Type": "image/gif",
        "Content-Length": pixel.length,
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      });
      response.end(request.method === "HEAD" ? undefined : pixel);
    } catch (error) {
      logger.error(
        { event: "tracking_request_failed", error: safeError(error) },
        undefined,
        "Tracking",
      );
      response.writeHead(503, { "Cache-Control": "no-store" }).end();
    }
  });
}

export async function serveTracking(
  recorder: PixelRecorder,
  cfg: Config,
  signal: AbortSignal,
  logger: LoggerService,
  onListening?: () => void,
): Promise<void> {
  if (signal.aborted) return;
  const server = createTrackingServer(recorder, cfg.trackingBaseUrl, logger);
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      server.close();
      server.closeIdleConnections();
    };
    signal.addEventListener("abort", stop, { once: true });
    server.once("close", () => {
      signal.removeEventListener("abort", stop);
      resolve();
    });
    server.once("error", (error) => {
      signal.removeEventListener("abort", stop);
      reject(error);
    });
    server.listen(cfg.trackingPort, cfg.trackingHost, () => {
      logger.log(
        {
          event: "tracking_started",
          host: cfg.trackingHost,
          port: cfg.trackingPort,
        },
        "Tracking",
      );
      onListening?.();
      if (signal.aborted) stop();
    });
  });
}
