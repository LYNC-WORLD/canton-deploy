import * as grpc from '@grpc/grpc-js';
import { withRetry } from '../utils/retry.js';
import { buildMetadata } from './channel.js';
import { grpcDeadline, waitForGrpcReady } from './deadline.js';

export function unaryCall<C extends grpc.Client, T>(
  makeClient: () => C,
  token: string,
  invoke: (client: C, meta: grpc.Metadata, deadline: grpc.Deadline) => Promise<T>
): Promise<T> {
  return withRetry(async () => {
    const client = makeClient();
    try {
      await waitForGrpcReady(client);
      return await invoke(client, buildMetadata(token), grpcDeadline());
    } finally {
      client.close();
    }
  });
}

export function promisifyUnary<T>(
  run: (cb: grpc.requestCallback<unknown>) => void,
  map: (response: unknown) => T = (r) => r as T
): Promise<T> {
  return new Promise((resolve, reject) => {
    run((err, response) => {
      if (err) reject(err);
      else resolve(map(response));
    });
  });
}
