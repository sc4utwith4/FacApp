/**
 * Logger utility for the application
 * 
 * Provides logging functionality that:
 * - Disables logs in production
 * - Maintains logs in development
 * - Supports different log levels (debug, info, warn, error)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isDevelopment = import.meta.env.DEV;
const isProduction = import.meta.env.PROD;

/**
 * Logger class that conditionally logs based on environment
 */
class Logger {
  private shouldLog(level: LogLevel): boolean {
    // Always log errors, even in production
    if (level === 'error') {
      return true;
    }
    
    // Only log debug/info/warn in development
    return isDevelopment;
  }

  /**
   * Log debug messages (only in development)
   */
  debug(...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug('[DEBUG]', ...args);
    }
  }

  /**
   * Log info messages (only in development)
   */
  info(...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info('[INFO]', ...args);
    }
  }

  /**
   * Log warning messages (only in development)
   */
  warn(...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn('[WARN]', ...args);
    }
  }

  /**
   * Log error messages (always, including production)
   */
  error(...args: unknown[]): void {
    // Errors are always logged, even in production
    console.error('[ERROR]', ...args);
    
    // In production, you might want to send errors to an error tracking service
    if (isProduction) {
      // TODO: Integrate with error tracking service (e.g., Sentry, LogRocket)
      // Example: errorTrackingService.captureException(new Error(args.join(' ')));
    }
  }

  /**
   * Log messages with a custom prefix
   */
  log(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(`[${prefix}]`, ...args);
    }
  }
}

// Export singleton instance
export const logger = new Logger();

// Export Logger class for custom instances if needed
export { Logger };

// Export default logger
export default logger;

