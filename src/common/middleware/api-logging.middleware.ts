import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoggerService } from "../../logger/logger.service.js";

// The tracker uses Node HTTP directly, so this attaches to its response lifecycle.
export function ApiLoggingMiddleware(logger: LoggerService) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const start = performance.now();
    response.once("finish", () => {
      // Never persist raw URLs: pixel tokens and query strings identify recipients.
      const path = (request.url || "/").split("?")[0];
      const route = /\/open\/[^/]+$/.test(path)
        ? "/open/[redacted].gif"
        : /(?:^|\/)healthz$/.test(path)
          ? "/healthz"
          : "unmatched";
      logger.logApiRequest(
        {
          method: request.method,
          route,
          statusCode: response.statusCode,
          responseTimeMs: Math.round(performance.now() - start),
        },
        "TrackingAPI",
      );
    });
  };
}
