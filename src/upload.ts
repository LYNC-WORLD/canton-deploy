import * as grpc from '@grpc/grpc-js';
import type { ResolvedNetwork } from './types.js';
import { AdminClient } from './grpc/admin.js';
import { LedgerClient } from './grpc/ledger.js';
import { jsonApiUploadDar } from './json-api.js';
import { formatGrpcError } from './grpc/format-error.js';

export type UploadPathLabel = 'Admin API' | 'Ledger API' | 'JSON API';

export interface UploadDarResult {
  packageIds: string[];
  pathLabel: UploadPathLabel;
}

export function isLedgerUploadFallbackError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as grpc.ServiceError).code;
    if (code === grpc.status.UNAVAILABLE || code === grpc.status.UNIMPLEMENTED) {
      return true;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/i.test(msg);
}

export async function uploadDar(
  network: ResolvedNetwork,
  token: string,
  darBuffer: Buffer,
  description: string,
  options: { vetOnUpload: boolean }
): Promise<UploadDarResult> {
  if (network.uploadVia === 'admin') {
    const admin = new AdminClient(network);
    const result = await admin.uploadDar(darBuffer, token, description, {
      vetAllPackages: options.vetOnUpload,
      synchronizeVetting: options.vetOnUpload,
      synchronizerId: network.synchronizerId,
    });
    return { packageIds: result.dar_ids ?? [], pathLabel: 'Admin API' };
  }

  const ledger = new LedgerClient(network);
  try {
    await ledger.uploadDarFile(darBuffer, token, {
      vetOnUpload: options.vetOnUpload,
      synchronizerId: network.synchronizerId,
    });
    return { packageIds: [], pathLabel: 'Ledger API' };
  } catch (err) {
    if (!isLedgerUploadFallbackError(err)) {
      throw err;
    }
    try {
      await jsonApiUploadDar(network, token, darBuffer, {
        vetOnUpload: options.vetOnUpload,
        synchronizerId: network.synchronizerId,
      });
      return { packageIds: [], pathLabel: 'JSON API' };
    } catch (jsonErr) {
      throw new Error(
        `Ledger gRPC upload failed (${formatGrpcError(err)}); JSON fallback failed (${(jsonErr as Error).message})`
      );
    }
  }
}
