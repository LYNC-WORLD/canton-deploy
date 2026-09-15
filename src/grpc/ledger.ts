import * as grpc from '@grpc/grpc-js';
import type { ResolvedNetwork } from '../types.js';
import { loadLedgerProto } from './proto-load.js';
import { buildCredentials, buildMetadata, ledgerChannelOptions } from './channel.js';
import { grpcDeadline, waitForGrpcReady } from './deadline.js';
import { unaryCall, promisifyUnary } from './unary.js';
import { withRetry } from '../utils/retry.js';

interface PartyManagementClient extends grpc.Client {
  ListKnownParties(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
  GetParties(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
  AllocateParty(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
}

interface VersionServiceClient extends grpc.Client {
  GetLedgerApiVersion(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
}

interface PackageManagementClient extends grpc.Client {
  ListKnownPackages(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
}

export interface PartyDetails {
  party: string;
  is_local: boolean;
  local_metadata?: { annotations?: Record<string, string> };
}

export interface LedgerVersion {
  version: string;
  features?: unknown;
}

export interface KnownPackageDetails {
  package_id: string;
  package_size: string | number;
  known_since?: unknown;
  name?: string;
  version?: string;
}

export interface ListKnownPartiesResult {
  parties: PartyDetails[];
  nextPageToken: string;
  truncated: boolean;
  examined?: number;
}

export interface ListKnownPartiesOptions {
  filterParty?: string;
  pageToken?: string;
  maxParties?: number;
  localOnly?: boolean;
}

export class LedgerClient {
  private readonly address: string;
  private readonly creds: grpc.ChannelCredentials;
  private readonly channelOptions: grpc.ChannelOptions;

  constructor(network: ResolvedNetwork) {
    this.address = `${network.host}:${network.ledgerPort}`;
    this.creds = buildCredentials(network);
    this.channelOptions = ledgerChannelOptions(network);
  }

  private makePartyClient(): PartyManagementClient {
    const pkg = loadLedgerProto(
      'com/daml/ledger/api/v2/admin/party_management_service.proto'
    ) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (pkg as any).com.daml.ledger.api.v2.admin.PartyManagementService as grpc.ServiceClientConstructor;
    return new svc(this.address, this.creds, this.channelOptions) as unknown as PartyManagementClient;
  }

  private makeVersionClient(): VersionServiceClient {
    const pkg = loadLedgerProto('com/daml/ledger/api/v2/version_service.proto') as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (pkg as any).com.daml.ledger.api.v2.VersionService as grpc.ServiceClientConstructor;
    return new svc(this.address, this.creds, this.channelOptions) as unknown as VersionServiceClient;
  }

  private makePackageClient(): PackageManagementClient {
    const pkg = loadLedgerProto(
      'com/daml/ledger/api/v2/admin/package_management_service.proto'
    ) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (pkg as any).com.daml.ledger.api.v2.admin
      .PackageManagementService as grpc.ServiceClientConstructor;
    return new svc(this.address, this.creds, this.channelOptions) as unknown as PackageManagementClient;
  }

  async listKnownParties(token: string, opts?: ListKnownPartiesOptions): Promise<ListKnownPartiesResult> {
    return withRetry(async () => {
      const meta = buildMetadata(token);
      const all: PartyDetails[] = [];
      let pageToken = opts?.pageToken ?? '';
      const maxParties = opts?.maxParties;
      const client = this.makePartyClient();
      let truncated = false;
      let lastNext = '';
      let examined = 0;
      const scanCap = opts?.localOnly ? 1000 : Number.POSITIVE_INFINITY;

      try {
        await waitForGrpcReady(client);

        for (;;) {
          const req: Record<string, unknown> = { page_size: 500 };
          if (pageToken) req.page_token = pageToken;
          if (opts?.filterParty) req.filter_party = opts.filterParty;

          const { parties, next } = await promisifyUnary<{ parties: PartyDetails[]; next: string }>(
            (cb) => client.ListKnownParties(req, meta, { deadline: grpcDeadline() }, cb),
            (response) => {
              const res = response as { party_details?: PartyDetails[]; next_page_token?: string };
              return { parties: res.party_details ?? [], next: res.next_page_token ?? '' };
            }
          );

          lastNext = next;
          examined += parties.length;

          const batch = opts?.localOnly ? parties.filter((p) => p.is_local) : parties;

          if (maxParties !== undefined && maxParties > 0) {
            const room = maxParties - all.length;
            if (room <= 0) break;
            if (batch.length > room) {
              all.push(...batch.slice(0, room));
              truncated = Boolean(next) || batch.length > room;
              break;
            }
          }

          all.push(...batch);

          if (!next) break;
          if (maxParties !== undefined && maxParties > 0 && all.length >= maxParties) {
            truncated = Boolean(next);
            break;
          }
          if (examined >= scanCap) {
            truncated = true;
            break;
          }
          pageToken = next;
        }
      } finally {
        client.close();
      }

      return {
        parties: all,
        nextPageToken: truncated ? lastNext : '',
        truncated,
        examined,
      };
    });
  }

  async getParties(token: string, partyIds: string[]): Promise<PartyDetails[]> {
    if (partyIds.length === 0) return [];
    return unaryCall(this.makePartyClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary(
        (cb) => client.GetParties({ parties: partyIds }, meta, { deadline }, cb),
        (r) => (r as { party_details?: PartyDetails[] }).party_details ?? []
      )
    );
  }

  async allocateParty(hint: string, token: string): Promise<PartyDetails> {
    return unaryCall(this.makePartyClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary(
        (cb) => client.AllocateParty({ party_id_hint: hint }, meta, { deadline }, cb),
        (r) => {
          const details = (r as { party_details?: PartyDetails }).party_details;
          if (!details) throw new Error('No party_details in AllocateParty response');
          return details;
        }
      )
    );
  }

  async getVersion(token: string): Promise<LedgerVersion> {
    return unaryCall(this.makeVersionClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary(
        (cb) => client.GetLedgerApiVersion({}, meta, { deadline }, cb),
        (r) => r as LedgerVersion
      )
    );
  }

  async listKnownPackages(token: string): Promise<KnownPackageDetails[]> {
    return unaryCall(this.makePackageClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary(
        (cb) => client.ListKnownPackages({}, meta, { deadline }, cb),
        (r) => (r as { package_details?: KnownPackageDetails[] }).package_details ?? []
      )
    );
  }
}
