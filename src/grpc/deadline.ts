import * as grpc from '@grpc/grpc-js';

const DEFAULT_MS = (() => {
  const raw = process.env.CANTON_DEPLOY_GRPC_DEADLINE_MS;
  if (!raw) return 60_000;
  const n = parseInt(raw, 10);
  return !isNaN(n) && n > 0 ? n : 60_000;
})();

export function grpcDeadline(): grpc.Deadline {
  return new Date(Date.now() + DEFAULT_MS);
}

export function connectDeadlineMs(): number {
  const raw = process.env.CANTON_DEPLOY_GRPC_CONNECT_MS;
  if (!raw) return 180_000;
  const n = parseInt(raw, 10);
  return !isNaN(n) && n > 0 ? n : 180_000;
}

export function waitForGrpcReady(client: grpc.Client): Promise<void> {
  const ms = connectDeadlineMs();
  return new Promise((resolve, reject) => {
    client.waitForReady(new Date(Date.now() + ms), (err?: Error) => {
      if (err) {
        reject(
          new Error(
            `Ledger gRPC did not become ready in ${ms}ms (${err.message}). Check SSH tunnel, host/port, and grpcAuthority.`
          )
        );
      } else resolve();
    });
  });
}
