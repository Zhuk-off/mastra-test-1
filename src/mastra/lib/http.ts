import { z } from 'zod';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1000;

export interface HttpClientConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
}

export interface RequestConfig {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
}

export class HttpClientError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'HttpClientError';
    this.status = status;
    this.body = body;
  }
}

export class HttpTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'HttpTimeoutError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

export function createHttpClient(config: HttpClientConfig = {}) {
  const {
    baseUrl = '',
    defaultHeaders = {},
    timeoutMs: defaultTimeout = DEFAULT_TIMEOUT_MS,
    maxRetries: defaultMaxRetries = DEFAULT_MAX_RETRIES,
    backoffMs: defaultBackoff = DEFAULT_BACKOFF_MS,
  } = config;

  async function request<T = unknown>(
    reqConfig: RequestConfig,
    outputSchema?: z.ZodType<T>,
  ): Promise<HttpResponse<T>> {
    const {
      path,
      method = 'GET',
      headers = {},
      body,
      timeoutMs = defaultTimeout,
      maxRetries = defaultMaxRetries,
      backoffMs = defaultBackoff,
    } = reqConfig;

    const url = `${baseUrl}${path}`;
    const mergedHeaders = { ...defaultHeaders, ...headers };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const fetchInit: RequestInit = {
          method,
          headers: mergedHeaders,
          signal: controller.signal,
        };

        if (body !== undefined && method !== 'GET') {
          fetchInit.body =
            typeof body === 'string' ? body : JSON.stringify(body);
          if (!mergedHeaders['content-type'] && !mergedHeaders['Content-Type']) {
            mergedHeaders['content-type'] = 'application/json';
          }
        }

        const response = await fetch(url, fetchInit);
        clearTimeout(timeoutId);

        let responseData: unknown;
        const contentType = response.headers.get('content-type') ?? '';

        if (contentType.includes('application/json')) {
          responseData = await response.json();
        } else {
          responseData = await response.text();
        }

        if (response.status === 401) {
          throw new HttpClientError(
            `Authentication failed for ${url}`,
            401,
            responseData,
          );
        }

        if (!response.ok) {
          if (isRetryable(response.status) && attempt < maxRetries) {
            const delay = backoffMs * Math.pow(2, attempt);
            await sleep(delay);
            continue;
          }

          throw new HttpClientError(
            `HTTP ${response.status} from ${url}`,
            response.status,
            responseData,
          );
        }

        let parsedData: T;
        if (outputSchema) {
          parsedData = outputSchema.parse(responseData);
        } else {
          parsedData = responseData as T;
        }

        return {
          status: response.status,
          headers: response.headers,
          data: parsedData,
        };
      } catch (err) {
        if (err instanceof HttpClientError && err.status === 401) {
          throw err;
        }

        if (err instanceof DOMException && err.name === 'AbortError') {
          lastError = new HttpTimeoutError(url, timeoutMs);
        } else if (err instanceof HttpClientError) {
          lastError = err;
        } else if (err instanceof Error) {
          lastError = err;
        } else {
          lastError = new Error(String(err));
        }

        if (attempt < maxRetries) {
          const delay = backoffMs * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
      }
    }

    throw lastError ?? new Error(`Request to ${url} failed after ${maxRetries + 1} attempts`);
  }

  return {
    get<T = unknown>(
      path: string,
      opts?: { headers?: Record<string, string>; timeoutMs?: number; maxRetries?: number; backoffMs?: number },
      outputSchema?: z.ZodType<T>,
    ) {
      return request<T>({ path, method: 'GET', ...opts }, outputSchema);
    },

    post<T = unknown>(
      path: string,
      body?: unknown,
      opts?: { headers?: Record<string, string>; timeoutMs?: number; maxRetries?: number; backoffMs?: number },
      outputSchema?: z.ZodType<T>,
    ) {
      return request<T>({ path, method: 'POST', body, ...opts }, outputSchema);
    },

    put<T = unknown>(
      path: string,
      body?: unknown,
      opts?: { headers?: Record<string, string>; timeoutMs?: number; maxRetries?: number; backoffMs?: number },
      outputSchema?: z.ZodType<T>,
    ) {
      return request<T>({ path, method: 'PUT', body, ...opts }, outputSchema);
    },

    patch<T = unknown>(
      path: string,
      body?: unknown,
      opts?: { headers?: Record<string, string>; timeoutMs?: number; maxRetries?: number; backoffMs?: number },
      outputSchema?: z.ZodType<T>,
    ) {
      return request<T>({ path, method: 'PATCH', body, ...opts }, outputSchema);
    },

    delete<T = unknown>(
      path: string,
      opts?: { headers?: Record<string, string>; timeoutMs?: number; maxRetries?: number; backoffMs?: number },
      outputSchema?: z.ZodType<T>,
    ) {
      return request<T>({ path, method: 'DELETE', ...opts }, outputSchema);
    },
  };
}
