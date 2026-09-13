import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as fs from 'fs';
import type { ResolvedNetwork, UserRight } from '../types.js';
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

interface UserManagementServiceClient extends grpc.Client {
  CreateUser(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
  ListUsers(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
  GetUser(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
  GrantUserRights(
    req: unknown,
    meta: grpc.Metadata,
    options: grpc.CallOptions,
    cb: grpc.requestCallback<unknown>
  ): void;
}

export interface LedgerUser {
  id: string;
  primary_party?: string;
  is_deactivated?: boolean;
}

function rightsToProto(rights: UserRight[], partyId: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const r of rights) {
    if (r === 'CanActAs') out.push({ can_act_as: { party: partyId } });
    if (r === 'CanReadAs') out.push({ can_read_as: { party: partyId } });
  }
  return out;
}

export class UserManagementGrpcClient {
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

  private makeClient(): UserManagementServiceClient {
    const pkg = loadLedgerProto(
      'com/daml/ledger/api/v2/admin/user_management_service.proto'
    ) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = (pkg as any).com.daml.ledger.api.v2.admin
      .UserManagementService as grpc.ServiceClientConstructor;
    return new svc(this.address, this.creds, this.channelOptions) as unknown as UserManagementServiceClient;
  }

  async listUsers(token: string): Promise<LedgerUser[]> {
    return withRetry(async () => {
      const client = this.makeClient();
      const meta = buildMetadata(token);
      const all: LedgerUser[] = [];
      let pageToken = '';

      try {
        await waitForGrpcReady(client);
        for (;;) {
          const req: Record<string, unknown> = { page_size: 100 };
          if (pageToken) req.page_token = pageToken;

          const { users, next } = await new Promise<{
            users: LedgerUser[];
            next: string;
          }>((resolve, reject) => {
            client.ListUsers(
              req,
              meta,
              { deadline: grpcDeadline() },
              (err: grpc.ServiceError | null, response: unknown) => {
                if (err) reject(err);
                else {
                  const res = response as { users?: LedgerUser[]; next_page_token?: string };
                  resolve({
                    users: res.users ?? [],
                    next: res.next_page_token ?? '',
                  });
                }
              }
            );
          });

          all.push(...users);
          if (!next) break;
          pageToken = next;
        }
      } finally {
        client.close();
      }

      return all;
    });
  }

  async getUser(token: string, userId: string): Promise<LedgerUser | null> {
    return withRetry(async () => {
      const client = this.makeClient();
      const meta = buildMetadata(token);

      try {
        await waitForGrpcReady(client);
        return await new Promise<LedgerUser | null>((resolve, reject) => {
          client.GetUser(
            { user_id: userId },
            meta,
            { deadline: grpcDeadline() },
            (err: grpc.ServiceError | null, response: unknown) => {
              if (err) {
                if (err.code === grpc.status.NOT_FOUND) resolve(null);
                else reject(err);
              } else {
                const res = response as { user?: LedgerUser };
                resolve(res.user ?? null);
              }
            }
          );
        });
      } finally {
        client.close();
      }
    });
  }

  async createUserWithRights(
    token: string,
    userId: string,
    partyIds: string[],
    rights: UserRight[]
  ): Promise<LedgerUser> {
    const protoRights: Record<string, unknown>[] = [];
    for (const partyId of partyIds) {
      protoRights.push(...rightsToProto(rights, partyId));
    }

    return withRetry(async () => {
      const client = this.makeClient();
      const meta = buildMetadata(token);

      try {
        await waitForGrpcReady(client);
        return await new Promise<LedgerUser>((resolve, reject) => {
          client.CreateUser(
            {
              user: { id: userId },
              rights: protoRights,
            },
            meta,
            { deadline: grpcDeadline() },
            (err: grpc.ServiceError | null, response: unknown) => {
              if (err) reject(err);
              else {
                const res = response as { user?: LedgerUser };
                if (!res.user) reject(new Error('CreateUser returned no user'));
                else resolve(res.user);
              }
            }
          );
        });
      } finally {
        client.close();
      }
    });
  }

  async grantRights(
    token: string,
    userId: string,
    partyIds: string[],
    rights: UserRight[]
  ): Promise<void> {
    const protoRights: Record<string, unknown>[] = [];
    for (const partyId of partyIds) {
      protoRights.push(...rightsToProto(rights, partyId));
    }

    return withRetry(async () => {
      const client = this.makeClient();
      const meta = buildMetadata(token);

      try {
        await waitForGrpcReady(client);
        await new Promise<void>((resolve, reject) => {
          client.GrantUserRights(
            { user_id: userId, rights: protoRights },
            meta,
            { deadline: grpcDeadline() },
            (err: grpc.ServiceError | null) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      } finally {
        client.close();
      }
    });
  }
}
