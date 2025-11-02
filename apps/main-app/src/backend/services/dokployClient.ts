import type { DeployAuthMethod, DeployConfig } from "../../shared/dokploy";

type DokployRequestInit = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

const normalizeBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (trimmed.length === 0) {
    throw new Error("Dokploy base URL is not configured.");
  }
  return trimmed;
};

const buildUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string => {
  const sanitizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${sanitizedPath}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
};

export type DokployClient = {
  request: <T = unknown>(options: DokployRequestInit) => Promise<T>;
};

const buildHeaders = (
  authMethod: DeployAuthMethod,
  apiKey: string,
  hasBody: boolean,
): Record<string, string> => {
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  if (authMethod === "authorization") {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers["x-api-key"] = apiKey;
  }
  return headers;
};

export const createDokployClient = (
  config: DeployConfig,
  apiKey: string | null,
): DokployClient => {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("Dokploy API key is not configured.");
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const trimmedKey = apiKey.trim();

  return {
    async request<T>({ method = "GET", path, query, body, signal }: DokployRequestInit): Promise<T> {
      const url = buildUrl(baseUrl, path, query);
      const hasBody = body !== undefined && body !== null;
      const response = await fetch(url, {
        method,
        headers: buildHeaders(config.authMethod, trimmedKey, hasBody),
        body: hasBody ? JSON.stringify(body) : undefined,
        signal,
      });

      if (!response.ok) {
        // Read body ONCE as text, then try to parse JSON. Avoid double-read errors.
        let details: unknown = null;
        try {
          const raw = await response.text();
          if (raw && raw.length > 0) {
            try {
              details = JSON.parse(raw);
            } catch {
              details = raw;
            }
          }
        } catch {
          details = null;
        }

        console.error('[DOKPLOY] Request failed:', {
          status: response.status,
          statusText: response.statusText,
          details: JSON.stringify(details, null, 2)
        });

        const error = new Error(
          `Dokploy request failed with status ${response.status}: ${response.statusText}`,
        );
        (error as Error & { details?: unknown }).details = details;
        throw error;
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        const text = await response.text();
        if (text.trim() === "") {
          return undefined as T;
        }
        return JSON.parse(text) as T;
      }

      return (await response.text()) as unknown as T;
    },
  };
};
