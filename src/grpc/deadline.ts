import * as grpc from '@grpc/grpc-js';

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return !isNaN(n) && n > 0 ? n : fallback;
}

const DEFAULT_MS = envPositiveInt('CANTON_DEPLOY_GRPC_DEADLINE_MS', 60_000);

export function grpcDeadline(): grpc.Deadline {
  return new Date(Date.now() + DEFAULT_MS);
}

export function connectDeadlineMs(): number {
  return envPositiveInt('CANTON_DEPLOY_GRPC_CONNECT_MS', 180_000);
}

export function waitForGrpcReady(client: grpc.Client): Promise<void> {
  const ms = connectDeadlineMs();
  return new Promise((resolve, reject) => {
    client.waitForReady(new Date(Date.now() + ms), (err?: Error) => {
      if (err) {
        reject(
          new Error(
            `gRPC did not become ready in ${ms}ms (${err.message}). Check host, port, and grpcAuthority.`
          )
        );
      } else resolve();
    });
  });
}
