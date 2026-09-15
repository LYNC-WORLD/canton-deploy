import * as grpc from '@grpc/grpc-js';
import type { ResolvedNetwork } from '../types.js';
import { loadAdminProto } from './proto-load.js';
import { buildCredentials } from './channel.js';
import { unaryCall, promisifyUnary } from './unary.js';
import { toLogicalSynchronizerId } from '../utils/synchronizer-id.js';

interface PackageServiceClient extends grpc.Client {
  UploadDar(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
  ListDars(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
  VetDar(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
}

interface ParticipantStatusClient extends grpc.Client {
  ParticipantStatus(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
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
    const request: Record<string, unknown> = {
      dars: [{ bytes: darBuffer, description: description ?? '' }],
      vet_all_packages: vetAll,
      synchronize_vetting: syncVet,
    };
    if (options?.synchronizerId) {
      request.synchronizer_id = toLogicalSynchronizerId(options.synchronizerId);
    }

    return unaryCall(this.makePackageClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary((cb) => client.UploadDar(request, meta, { deadline }, cb), (r) => r as UploadDarResult)
    );
  }

  async vetDar(
    mainPackageId: string,
    token: string,
    options?: { synchronize?: boolean; synchronizerId?: string }
  ): Promise<void> {
    const request: Record<string, unknown> = {
      main_package_id: mainPackageId,
      synchronize: options?.synchronize ?? true,
    };
    if (options?.synchronizerId) {
      request.synchronizer_id = toLogicalSynchronizerId(options.synchronizerId);
    }

    return unaryCall(this.makePackageClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary((cb) => client.VetDar(request, meta, { deadline }, cb), () => undefined)
    );
  }

  async listDars(token: string): Promise<DarInfo[]> {
    return unaryCall(this.makePackageClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary(
        (cb) => client.ListDars({}, meta, { deadline }, cb),
        (r) => (r as { dars?: DarInfo[] }).dars ?? []
      )
    );
  }

  async getStatus(token: string): Promise<unknown> {
    return unaryCall(this.makeStatusClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary((cb) => client.ParticipantStatus({}, meta, { deadline }, cb))
    );
  }
}
