import * as grpc from '@grpc/grpc-js';
import * as fs from 'fs';
import type { ResolvedNetwork } from '../types.js';

export function buildCredentials(network: ResolvedNetwork): grpc.ChannelCredentials {
  if (!network.tls) return grpc.credentials.createInsecure();
  if (network.tlsCertFile) {
    return grpc.credentials.createSsl(fs.readFileSync(network.tlsCertFile));
  }
  return grpc.credentials.createSsl();
}

export function buildMetadata(token: string): grpc.Metadata {
  const meta = new grpc.Metadata();
  meta.set('authorization', `Bearer ${token}`);
  return meta;
}

export function ledgerChannelOptions(network: ResolvedNetwork): grpc.ChannelOptions {
  const opts: grpc.ChannelOptions = {
    'grpc.keepalive_time_ms': 10_000,
    'grpc.keepalive_timeout_ms': 5_000,
  };
  if (network.grpcAuthority) {
    (opts as Record<string, unknown>)['grpc.default_authority'] = network.grpcAuthority;
  }
  return opts;
}
