import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as fs from 'fs';
import type { ResolvedNetwork } from '../types.js';
import { adminProtoPath, getProtoRoot } from '../proto-root.js';
import { withRetry } from '../utils/retry.js';

function loadAdminProto(protoFile: string) {
  const protoPath = adminProtoPath(protoFile);
  const pkgDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [
      path.join(getProtoRoot(), 'admin-api'),
      path.join(getProtoRoot(), 'ledger-api'),
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

interface PackageServiceClient extends grpc.Client {
  UploadDar(req: unknown, meta: grpc.Metadata, cb: grpc.requestCallback<unknown>): void;
  ListDars(req: unknown, meta: grpc.Metadata, cb: grpc.requestCallback<unknown>): void;
  VetDar(req: unknown, meta: grpc.Metadata, cb: grpc.requestCallback<unknown>): void;
}

interface ParticipantStatusClient extends grpc.Client {
  ParticipantStatus(req: unknown, meta: grpc.Metadata, cb: grpc.requestCallback<unknown>): void;
}

export interface DarInfo {
  main: string;
  name: string;
  version: string;
  description: string;
}

export interface UploadDarResult {
  dar_ids: string[];
}

export interface UploadDarOptions {
  vetAllPackages: boolean;
  synchronizeVetting: boolean;
  synchronizerId?: string;
}

export class AdminClient {
  private readonly address: string;
  private readonly creds: grpc.ChannelCredentials;
  private readonly channelOptions: grpc.ChannelOptions | undefined;

  constructor(network: ResolvedNetwork) {
    this.address = `${network.host}:${network.adminPort}`;
    this.creds = buildCredentials(network);
    this.channelOptions = network.adminGrpcAuthority
      ? ({ 'grpc.default_authority': network.adminGrpcAuthority } as grpc.ChannelOptions)
      : undefined;
  }

  private makePackageClient(): PackageServiceClient {
    const pkg = loadAdminProto(
      'com/digitalasset/canton/admin/participant/v30/package_service.proto'
    ) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (pkg as any).com.digitalasset.canton.admin.participant.v30
      .PackageService as grpc.ServiceClientConstructor;
    return new svc(this.address, this.creds, this.channelOptions) as unknown as PackageServiceClient;
  }

  private makeStatusClient(): ParticipantStatusClient {
    const pkg = loadAdminProto(
      'com/digitalasset/canton/admin/participant/v30/participant_status_service.proto'
    ) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (pkg as any).com.digitalasset.canton.admin.participant.v30
      .ParticipantStatusService as grpc.ServiceClientConstructor;
    return new svc(this.address, this.creds, this.channelOptions) as unknown as ParticipantStatusClient;
  }

  async uploadDar(
    darBuffer: Buffer,
    token: string,
    description?: string,
    options?: UploadDarOptions
  ): Promise<UploadDarResult> {
    const vetAll = options?.vetAllPackages ?? true;
    const syncVet = options?.synchronizeVetting ?? vetAll;

    return withRetry(async () => {
      const client = this.makePackageClient();
      const meta = buildMetadata(token);

      const request: Record<string, unknown> = {
        dars: [{ bytes: darBuffer, description: description ?? '' }],
        vet_all_packages: vetAll,
        synchronize_vetting: syncVet,
      };
      if (options?.synchronizerId) request.synchronizer_id = options.synchronizerId;

      return new Promise<UploadDarResult>((resolve, reject) => {
        client.UploadDar(request, meta, (err: grpc.ServiceError | null, response: unknown) => {
          client.close();
          if (err) reject(err);
          else resolve(response as UploadDarResult);
        });
      });
    });
  }

  async vetDar(
    mainPackageId: string,
    token: string,
    options?: { synchronize?: boolean; synchronizerId?: string }
  ): Promise<void> {
    return withRetry(async () => {
      const client = this.makePackageClient();
      const meta = buildMetadata(token);
      const request: Record<string, unknown> = {
        main_package_id: mainPackageId,
        synchronize: options?.synchronize ?? true,
      };
      if (options?.synchronizerId) request.synchronizer_id = options.synchronizerId;

      return new Promise<void>((resolve, reject) => {
        client.VetDar(request, meta, (err: grpc.ServiceError | null) => {
          client.close();
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  async listDars(token: string): Promise<DarInfo[]> {
    return withRetry(async () => {
      const client = this.makePackageClient();
      const meta = buildMetadata(token);

      return new Promise<DarInfo[]>((resolve, reject) => {
        client.ListDars({}, meta, (err: grpc.ServiceError | null, response: unknown) => {
          client.close();
          if (err) reject(err);
          else {
            const res = response as { dars?: DarInfo[] };
            resolve(res.dars ?? []);
          }
        });
      });
    });
  }

  async getStatus(token: string): Promise<unknown> {
    return withRetry(async () => {
      const client = this.makeStatusClient();
      const meta = buildMetadata(token);

      return new Promise<unknown>((resolve, reject) => {
        client.ParticipantStatus({}, meta, (err: grpc.ServiceError | null, response: unknown) => {
          client.close();
          if (err) reject(err);
          else resolve(response);
        });
      });
    });
  }
}
