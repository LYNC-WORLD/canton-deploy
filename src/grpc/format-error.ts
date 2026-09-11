import * as grpc from '@grpc/grpc-js';

export function formatGrpcError(err: unknown): string {
  const e = err as grpc.ServiceError;
  const msg = e.details || e.message || String(err);
  if (e.code === grpc.status.UNAUTHENTICATED) {
    return `Authentication failed (gRPC). Check your token. ${msg}`;
  }
  if (e.code === grpc.status.DEADLINE_EXCEEDED) {
    return `Request timed out (gRPC). Is the tunnel up? (e.g. ssh -L 127.0.0.1:18080:127.0.0.1:80 …) Or increase CANTON_DEPLOY_GRPC_DEADLINE_MS. ${msg}`;
  }
  return msg;
}
