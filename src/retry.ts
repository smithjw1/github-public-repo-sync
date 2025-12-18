/**
 * Retry configuration options
 */
export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Checks if an error is retryable (transient errors)
 */
function isRetryableError(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTP status codes that are retryable
  if (error.status) {
    const status = error.status;
    // 429 Too Many Requests, 403 Forbidden (rate limit), 500-599 Server Errors
    if (status === 429 || status === 403 || (status >= 500 && status < 600)) {
      return true;
    }
  }

  // GitHub/Linear API specific errors
  if (error.message) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('rate limit') ||
      msg.includes('timeout') ||
      msg.includes('temporarily unavailable') ||
      msg.includes('service unavailable')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts Retry-After value from error response
 * Returns delay in milliseconds, or null if not found
 */
function getRetryAfterMs(error: any): number | null {
  // Check for Retry-After header in various possible locations
  const retryAfter =
    error.response?.headers?.['retry-after'] ||
    error.headers?.['retry-after'] ||
    error.response?.headers?.['Retry-After'] ||
    error.headers?.['Retry-After'];

  if (!retryAfter) {
    return null;
  }

  // Retry-After can be either a number (seconds) or an HTTP date
  const parsed = parseInt(retryAfter, 10);
  if (!isNaN(parsed)) {
    return parsed * 1000; // Convert seconds to milliseconds
  }

  // Try parsing as date
  const retryDate = new Date(retryAfter);
  if (!isNaN(retryDate.getTime())) {
    return Math.max(0, retryDate.getTime() - Date.now());
  }

  return null;
}

/**
 * Delays execution for the specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries an async operation with exponential backoff
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry if it's not a retryable error
      if (!isRetryableError(error)) {
        throw error;
      }

      // Don't retry if this was the last attempt
      if (attempt === config.maxAttempts) {
        throw error;
      }

      // Check for Retry-After header (rate limiting)
      const retryAfterMs = getRetryAfterMs(error);
      let delayMs: number;

      if (retryAfterMs !== null) {
        // Respect Retry-After header, but cap at maxDelayMs
        delayMs = Math.min(retryAfterMs, config.maxDelayMs);
        console.warn(
          `Rate limited (attempt ${attempt}/${config.maxAttempts}). Waiting ${delayMs}ms as requested by server...`
        );
      } else {
        // Use exponential backoff
        delayMs = Math.min(
          config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
          config.maxDelayMs
        );
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(
          `API call failed (attempt ${attempt}/${config.maxAttempts}), retrying in ${delayMs}ms...`,
          errorMessage
        );
      }

      await delay(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}
