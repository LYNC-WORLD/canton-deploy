import * as http from 'http';
import * as https from 'https';
import type { ResolvedNetwork } from './types.js';

export function jsonApiBaseUrl(network: ResolvedNetwork): string {
  const scheme = network.httpUseTls ? 'https' : 'http';
  return `${scheme}://${network.host}:${network.httpPort}`;
}

export function jsonApiDisplayUrl(network: ResolvedNetwork): string {
  const base = jsonApiBaseUrl(network);
  if (network.httpHost && network.httpHost !== network.host) {
    return `${base} (Host: ${network.httpHost})`;
  }
  return base;
}

export type JsonApiHeaders = Record<string, string>;

export function jsonApiHeaders(
  network: ResolvedNetwork,
  extra: JsonApiHeaders = {}
): JsonApiHeaders {
  const headers: JsonApiHeaders = { ...extra };
  if (network.httpHost) {
    headers.Host = network.httpHost;
  }
  return headers;
}

export async function jsonApiFetch(
  network: ResolvedNetwork,
  path: string,
  init: {
    method?: string;
    headers?: JsonApiHeaders;
    body?: string;
  } = {}
): Promise<{ ok: boolean; status: number; statusText: string; text: () => Promise<string>; json: () => Promise<unknown> }> {
  const base = jsonApiBaseUrl(network);
  const url = new URL(path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`);
  const isHttps = url.protocol === 'https:';
  const headers = jsonApiHeaders(network, init.headers ?? {});
  const body = init.body;

  const result = await new Promise<{ status: number; statusText: string; body: string }>(
    (resolve, reject) => {
      const req = (isHttps ? https : http).request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? (body ? 'POST' : 'GET'),
          headers: {
            ...headers,
            ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? '',
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    }
  );

  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    statusText: result.statusText,
    text: async () => result.body,
    json: async () => JSON.parse(result.body) as unknown,
  };
}
