type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

interface LoggerOptions {
  context?: string;
  useStderr?: boolean; // For MCP mode where stdout is used for protocol
}

class Logger {
  private level: LogLevel;
  private context?: string;
  private useStderr: boolean;

  constructor(options?: string | LoggerOptions) {
    if (typeof options === "string") {
      this.context = options;
      this.useStderr = false;
    } else {
      this.context = options?.context;
      this.useStderr = options?.useStderr ?? false;
    }
    this.level = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || "info";
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: string, message: string, data?: Record<string, any>): string {
    const timestamp = new Date().toISOString();
    const ctx = this.context ? `[${this.context}]` : "";
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    return `${timestamp} ${level.toUpperCase().padEnd(5)} ${ctx} ${message}${dataStr}`;
  }

  private output(method: "log" | "warn" | "error", message: string): void {
    if (this.useStderr) {
      console.error(message);
    } else {
      console[method](message);
    }
  }

  debug(message: string, data?: Record<string, any>): void {
    if (this.shouldLog("debug")) {
      this.output("log", this.formatMessage("debug", message, data));
    }
  }

  info(message: string, data?: Record<string, any>): void {
    if (this.shouldLog("info")) {
      this.output("log", this.formatMessage("info", message, data));
    }
  }

  warn(message: string, data?: Record<string, any>): void {
    if (this.shouldLog("warn")) {
      this.output("warn", this.formatMessage("warn", message, data));
    }
  }

  error(message: string, data?: Record<string, any>): void {
    if (this.shouldLog("error")) {
      this.output("error", this.formatMessage("error", message, data));
    }
  }

  child(context: string): Logger {
    const childLogger = new Logger({
      context: this.context ? `${this.context}:${context}` : context,
      useStderr: this.useStderr,
    });
    childLogger.level = this.level;
    return childLogger;
  }
}

export const logger = new Logger();
export const createLogger = (context: string) => new Logger(context);
export const createStderrLogger = (context: string) => new Logger({ context, useStderr: true });
