import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as fs from 'fs';
import type { ResolvedNetwork } from '../types.js';
import { ledgerProtoPath, getProtoRoot } from '../proto-root.js';
import { grpcDeadline, waitForGrpcReady } from './deadline.js';

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
  GetParticipantId(
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

export interface PartyDetails {
  party: string;
  is_local: boolean;
  local_metadata?: { annotations?: Record<string, string> };
}

export interface LedgerVersion {
  version: string;
  features?: unknown;
}

export interface ListKnownPartiesResult {
  parties: PartyDetails[];
  nextPageToken: string;
  truncated: boolean;
}

export interface ListKnownPartiesOptions {
  filterParty?: string;
  pageToken?: string;
  maxParties?: number;
}

export class LedgerClient {
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

  async listKnownParties(token: string, opts?: ListKnownPartiesOptions): Promise<ListKnownPartiesResult> {
    const meta = buildMetadata(token);
    const all: PartyDetails[] = [];
    let pageToken = opts?.pageToken ?? '';
    const maxParties = opts?.maxParties;
    const client = this.makePartyClient();
    let truncated = false;
    let lastNext = '';

    try {
      await waitForGrpcReady(client);

      for (;;) {
        const req: Record<string, unknown> = { page_size: 500 };
        if (pageToken) req.page_token = pageToken;
        if (opts?.filterParty) req.filter_party = opts.filterParty;

        const { parties, next } = await new Promise<{ parties: PartyDetails[]; next: string }>(
          (resolve, reject) => {
            client.ListKnownParties(
              req,
              meta,
              { deadline: grpcDeadline() },
              (err: grpc.ServiceError | null, response: unknown) => {
                if (err) reject(err);
                else {
                  const res = response as { party_details?: PartyDetails[]; next_page_token?: string };
                  resolve({
                    parties: res.party_details ?? [],
                    next: res.next_page_token ?? '',
                  });
                }
              }
            );
          }
        );

        lastNext = next;

        if (maxParties !== undefined && maxParties > 0) {
          const room = maxParties - all.length;
          if (room <= 0) break;
          if (parties.length > room) {
            all.push(...parties.slice(0, room));
            truncated = Boolean(next);
            break;
          }
        }

        all.push(...parties);

        if (!next) break;
        if (maxParties !== undefined && maxParties > 0 && all.length >= maxParties) {
          truncated = Boolean(next);
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
    };
  }

  async getParties(token: string, partyIds: string[]): Promise<PartyDetails[]> {
    if (partyIds.length === 0) return [];
    const meta = buildMetadata(token);
    const client = this.makePartyClient();

    try {
      await waitForGrpcReady(client);
      return await new Promise((resolve, reject) => {
        client.GetParties(
          { parties: partyIds },
          meta,
          { deadline: grpcDeadline() },
          (err: grpc.ServiceError | null, response: unknown) => {
            if (err) reject(err);
            else {
              const res = response as { party_details?: PartyDetails[] };
              resolve(res.party_details ?? []);
            }
          }
        );
      });
    } finally {
      client.close();
    }
  }

  async allocateParty(hint: string, token: string): Promise<PartyDetails> {
    const client = this.makePartyClient();
    const meta = buildMetadata(token);

    try {
      await waitForGrpcReady(client);
      return await new Promise((resolve, reject) => {
        client.AllocateParty(
          { party_id_hint: hint },
          meta,
          { deadline: grpcDeadline() },
          (err: grpc.ServiceError | null, response: unknown) => {
            if (err) reject(err);
            else {
              const res = response as { party_details?: PartyDetails };
              if (!res.party_details) reject(new Error('No party_details in AllocateParty response'));
              else resolve(res.party_details);
            }
          }
        );
      });
    } finally {
      client.close();
    }
  }

  async getVersion(token: string): Promise<LedgerVersion> {
    const client = this.makeVersionClient();
    const meta = buildMetadata(token);

    try {
      await waitForGrpcReady(client);
      return await new Promise((resolve, reject) => {
        client.GetLedgerApiVersion(
          {},
          meta,
          { deadline: grpcDeadline() },
          (err: grpc.ServiceError | null, response: unknown) => {
            if (err) reject(err);
            else resolve(response as LedgerVersion);
          }
        );
      });
    } finally {
      client.close();
    }
  }

  async ping(): Promise<boolean> {
    return new Promise((resolve) => {
      const ch = new grpc.Channel(this.address, this.creds, {});
      const deadline = new Date(Date.now() + 4000);
      ch.watchConnectivityState(ch.getConnectivityState(true), deadline, (err) => {
        ch.close();
        resolve(!err);
      });
    });
  }
}
