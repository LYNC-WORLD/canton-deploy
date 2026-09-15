import * as grpc from '@grpc/grpc-js';

function detailHints(err: grpc.ServiceError): string {
  const md = err.metadata;
  if (!md) return '';
  const reason = md.get('reason')?.[0] ?? md.get('grpc-message')?.[0];
  if (!reason) return '';
  return ` (${String(reason)})`;
}

export function formatGrpcError(err: unknown): string {
  const e = err as grpc.ServiceError;
  const msg = e.details || e.message || String(err);
  const hint = detailHints(e);

  if (e.code === grpc.status.UNAUTHENTICATED) {
    return `Authentication failed (gRPC). Check your token. ${msg}${hint}`;
  }
  if (e.code === grpc.status.DEADLINE_EXCEEDED) {
    return `Request timed out (gRPC). Check host/port reachability, or increase CANTON_DEPLOY_GRPC_DEADLINE_MS. ${msg}${hint}`;
  }
  if (/PROTO_DESERIALIZATION_FAILURE/i.test(msg) && /synchronizer/i.test(String(e.metadata))) {
    return `${msg}${hint}. Tip: use logical synchronizerId (ns::fingerprint), not physical (…::35-3).`;
  }
  if (/PROTO_DESERIALIZATION_FAILURE/i.test(msg)) {
    return (
      `${msg}${hint}. ` +
      'Often an invalid synchronizerId — use logical id from status (drop trailing ::NN-N), or omit it on single-synchronizer nodes.'
    );
  }
  return `${msg}${hint}`;
}
