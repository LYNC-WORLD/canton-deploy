import * as grpc from '@grpc/grpc-js';
import type { ResolvedNetwork, UserRight } from '../types.js';
import { loadLedgerProto } from './proto-load.js';
import { grpcDeadline, waitForGrpcReady } from './deadline.js';
import { buildCredentials, buildMetadata, ledgerChannelOptions } from './channel.js';
import { unaryCall, promisifyUnary } from './unary.js';
import { withRetry } from '../utils/retry.js';

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

function buildProtoRights(partyIds: string[], rights: UserRight[]): Record<string, unknown>[] {
  return partyIds.flatMap((id) => rightsToProto(rights, id));
}

export class UserManagementGrpcClient {
  private readonly address: string;
  private readonly creds: grpc.ChannelCredentials;
  private readonly channelOptions: grpc.ChannelOptions;

  constructor(network: ResolvedNetwork) {
    this.address = `${network.host}:${network.ledgerPort}`;
    this.creds = buildCredentials(network);
    this.channelOptions = ledgerChannelOptions(network);
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

          const { users, next } = await promisifyUnary<{ users: LedgerUser[]; next: string }>(
            (cb) => client.ListUsers(req, meta, { deadline: grpcDeadline() }, cb),
            (response) => {
              const res = response as { users?: LedgerUser[]; next_page_token?: string };
              return { users: res.users ?? [], next: res.next_page_token ?? '' };
            }
          );

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
    return unaryCall(this.makeClient.bind(this), token, (client, meta, deadline) =>
      new Promise<LedgerUser | null>((resolve, reject) => {
        client.GetUser({ user_id: userId }, meta, { deadline }, (err, response) => {
          if (err) {
            if (err.code === grpc.status.NOT_FOUND) resolve(null);
            else reject(err);
          } else {
            resolve((response as { user?: LedgerUser }).user ?? null);
          }
        });
      })
    );
  }

  async createUserWithRights(
    token: string,
    userId: string,
    partyIds: string[],
    rights: UserRight[]
  ): Promise<LedgerUser> {
    const protoRights = buildProtoRights(partyIds, rights);
    return unaryCall(this.makeClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary(
        (cb) =>
          client.CreateUser({ user: { id: userId }, rights: protoRights }, meta, { deadline }, cb),
        (r) => {
          const user = (r as { user?: LedgerUser }).user;
          if (!user) throw new Error('CreateUser returned no user');
          return user;
        }
      )
    );
  }

  async grantRights(
    token: string,
    userId: string,
    partyIds: string[],
    rights: UserRight[]
  ): Promise<void> {
    const protoRights = buildProtoRights(partyIds, rights);
    return unaryCall(this.makeClient.bind(this), token, (client, meta, deadline) =>
      promisifyUnary(
        (cb) => client.GrantUserRights({ user_id: userId, rights: protoRights }, meta, { deadline }, cb),
        () => undefined
      )
    );
  }

  async ensureUserWithRights(
    token: string,
    userId: string,
    partyIds: string[],
    rights: UserRight[]
  ): Promise<'created' | 'granted'> {
    const existing = await this.getUser(token, userId);
    if (existing) {
      await this.grantRights(token, userId, partyIds, rights);
      return 'granted';
    }
    await this.createUserWithRights(token, userId, partyIds, rights);
    return 'created';
  }
}
