import * as http from 'http';
import * as https from 'https';
import type { ResolvedNetwork } from './types.js';
import { toLogicalSynchronizerId } from './utils/synchronizer-id.js';

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
    body?: string | Buffer;
  } = {}
): Promise<{ ok: boolean; status: number; statusText: string; text: () => Promise<string>; json: () => Promise<unknown> }> {
  const base = jsonApiBaseUrl(network);
  const url = new URL(path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`);
  const isHttps = url.protocol === 'https:';
  const headers = jsonApiHeaders(network, init.headers ?? {});
  const body = init.body;
  const bodyLen = body === undefined ? 0 : Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);

  const result = await new Promise<{ status: number; statusText: string; body: string }>(
    (resolve, reject) => {
      const reqHeaders: Record<string, string | number> = { ...headers };
      if (body !== undefined) {
        reqHeaders['Content-Length'] = bodyLen;
        if (Buffer.isBuffer(body) && !reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/octet-stream';
        }
      }

      const req = (isHttps ? https : http).request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? (body !== undefined ? 'POST' : 'GET'),
          headers: reqHeaders,
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
      if (body !== undefined) req.write(body);
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

export interface ConnectedSynchronizerInfo {
  synchronizerId: string;
  synchronizerAlias?: string;
  permission?: string;
}

export async function jsonApiGetConnectedSynchronizers(
  network: ResolvedNetwork,
  token: string
): Promise<ConnectedSynchronizerInfo[]> {
  const res = await jsonApiFetch(network, '/v2/state/connected-synchronizers', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    connectedSynchronizers?: Array<{
      synchronizerId?: string;
      synchronizerAlias?: string;
      permission?: string;
    }>;
  };
  return (data.connectedSynchronizers ?? [])
    .filter((s) => s.synchronizerId)
    .map((s) => ({
      synchronizerId: s.synchronizerId!,
      synchronizerAlias: s.synchronizerAlias,
      permission: s.permission,
    }));
}

export async function jsonApiUploadDar(
  network: ResolvedNetwork,
  token: string,
  darBuffer: Buffer,
  options: { vetOnUpload: boolean; synchronizerId?: string }
): Promise<void> {
  const params = new URLSearchParams();
  params.set('vetAllPackages', String(options.vetOnUpload));
  if (options.synchronizerId) {
    params.set('synchronizerId', toLogicalSynchronizerId(options.synchronizerId));
  }
  const res = await jsonApiFetch(network, `/v2/dars?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: darBuffer,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
}
