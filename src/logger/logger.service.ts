import {
  Injectable,
  type LoggerService as NestLoggerService,
  type OnApplicationShutdown,
} from "@nestjs/common";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { safeError } from "../common/errors.js";

@Injectable()
export class LoggerService implements NestLoggerService, OnApplicationShutdown {
  private readonly logger: winston.Logger;
  private readonly apiLogger: winston.Logger;
  private closing?: Promise<void>;

  constructor() {
    const logFormat = winston.format.printf(
      ({ timestamp, level, message, context }) =>
        `${timestamp} | ${level} | ${context || "APP"} | ${message}`,
    );
    const format = winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ssZ" }),
      logFormat,
    );
    const consoleTransport = () =>
      new winston.transports.Console({
        level: "debug",
        format: winston.format.combine(
          ...(process.stdout.isTTY
            ? [winston.format.colorize({ all: true })]
            : []),
          winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ssZ" }),
          logFormat,
        ),
      });
    const rotate = (filename: string, level = "info") =>
      new DailyRotateFile({
        filename,
        level,
        datePattern: "YYYY-MM-DD",
        zippedArchive: true,
        maxSize: "20m",
        maxFiles: "3d",
      });
    this.logger = winston.createLogger({
      level: "info",
      format,
      transports: [
        consoleTransport(),
        rotate("logs/info-%DATE%.log"),
        rotate("logs/error-%DATE%.log", "error"),
      ],
    });
    this.apiLogger = winston.createLogger({
      level: "info",
      format,
      transports: [consoleTransport(), rotate("logs/api/%DATE%-api.log")],
    });
    for (const logger of [this.logger, this.apiLogger]) {
      logger.on("error", () => {
        process.stderr.write(
          "Logger could not write output; check the logs directory and disk space.\n",
        );
      });
    }
  }

  log(message: unknown, context?: string): void {
    this.logger.info(this.message(message), { context });
  }

  error(message: unknown, trace?: string, context?: string): void {
    const fullMessage = trace
      ? `${this.message(message)} | Trace: ${trace}`
      : message;
    this.logger.error(this.message(fullMessage), { context });
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn(this.message(message), { context });
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug(this.message(message), { context });
  }

  logApiRequest(message: unknown, context = "API"): void {
    this.apiLogger.info(this.message(message), { context });
  }

  onApplicationShutdown(): Promise<void> {
    return (this.closing ||= Promise.all(
      [this.logger, this.apiLogger].map(
        (logger) =>
          new Promise<void>((resolve) => {
            logger.once("finish", () => {
              logger.close();
              resolve();
            });
            logger.end();
          }),
      ),
    ).then(() => undefined));
  }

  private message(value: unknown): string {
    const text =
      value instanceof Error
        ? safeError(value)
        : typeof value === "string"
          ? value
          : (JSON.stringify(value) ?? String(value));
    return text
      .replace(/(Bearer\s+)[^\s"',]+/gi, "$1[redacted]")
      .replace(
        /((?:access_token|refresh_token|client_secret|authorization|DB_PASS|TOKEN_ENCRYPTION_KEY)["']?\s*[:=]\s*["']?)[^"'\s,}&]+/gi,
        "$1[redacted]",
      )
      .replace(/\/open\/[a-f0-9]{64}\.gif/gi, "/open/[redacted].gif")
      .replace(/[\r\n]+/g, " ");
  }
}
