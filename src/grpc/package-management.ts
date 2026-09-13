import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as fs from 'fs';
import type { ResolvedNetwork } from '../types.js';
import { ledgerProtoPath, getProtoRoot } from '../proto-root.js';
import { grpcDeadline, waitForGrpcReady } from './deadline.js';
import { withRetry } from '../utils/retry.js';

function loadLedgerProto(protoFile: string) {
  const protoPath = ledgerProtoPath(protoFile);
  const pkgDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [
      path.join(getProtoRoot(), 'ledger-api'),
      path.join(getProtoRoot(), 'admin-api'),
    ],
  });
  return grpc.loadPackageDefinition(pkgDef);
}

function buildCredentials(network: ResolvedNetwork): grpc.ChannelCredentials {
  if (!network.tls) return grpc.credentials.createInsecure();
  if (network.tlsCertFile) {
    const cert = fs.readFileSync(network.tlsCertFile);
    return grpc.credentials.createSsl(cert);
  }
  return grpc.credentials.createSsl();
}

function buildMetadata(token: string): grpc.Metadata {
  const meta = new grpc.Metadata();
  meta.set('authorization', `Bearer ${token}`);
  return meta;
}

interface PackageManagementClient extends grpc.Client {
  ListKnownPackages(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
}

export interface KnownPackageDetails {
  package_id: string;
  package_size: string | number;
  known_since?: unknown;
  name?: string;
  version?: string;
}

export class PackageManagementGrpcClient {
  private readonly address: string;
  private readonly creds: grpc.ChannelCredentials;
  private readonly channelOptions: grpc.ChannelOptions;

  constructor(network: ResolvedNetwork) {
    this.address = `${network.host}:${network.ledgerPort}`;
    this.creds = buildCredentials(network);
    const opts: grpc.ChannelOptions = {
      'grpc.keepalive_time_ms': 10_000,
      'grpc.keepalive_timeout_ms': 5_000,
    };
    if (network.grpcAuthority) {
      (opts as Record<string, unknown>)['grpc.default_authority'] = network.grpcAuthority;
    }
    this.channelOptions = opts;
  }

  private makeClient(): PackageManagementClient {
    const pkg = loadLedgerProto(
      'com/daml/ledger/api/v2/admin/package_management_service.proto'
    ) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (pkg as any).com.daml.ledger.api.v2.admin
      .PackageManagementService as grpc.ServiceClientConstructor;
    return new svc(this.address, this.creds, this.channelOptions) as unknown as PackageManagementClient;
  }

  async listKnownPackages(token: string): Promise<KnownPackageDetails[]> {
    return withRetry(async () => {
      const client = this.makeClient();
      const meta = buildMetadata(token);

      try {
        await waitForGrpcReady(client);
        return await new Promise<KnownPackageDetails[]>((resolve, reject) => {
          client.ListKnownPackages(
            {},
            meta,
            { deadline: grpcDeadline() },
            (err: grpc.ServiceError | null, response: unknown) => {
              if (err) reject(err);
              else {
                const res = response as { package_details?: KnownPackageDetails[] };
                resolve(res.package_details ?? []);
              }
            }
          );
        });
      } finally {
        client.close();
      }
    });
  }
}
