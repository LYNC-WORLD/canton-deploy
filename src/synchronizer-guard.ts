import chalk from 'chalk';
import type { ResolvedNetwork } from './types.js';
import { AdminClient } from './grpc/admin.js';
import { jsonApiGetConnectedSynchronizers } from './json-api.js';
import {
  connectedIdsFromAdminStatus,
  multiSyncMissingId,
} from './utils/synchronizer-id.js';

async function connectedSynchronizerIds(
  network: ResolvedNetwork,
  token: string
): Promise<string[]> {
  let ids: string[] = [];
  try {
    const syncs = await jsonApiGetConnectedSynchronizers(network, token);
    ids = syncs.map((sync) => sync.synchronizerId);
  } catch {
  }
  if (ids.filter((id) => id.trim()).length > 1) return ids;

  try {
    const status = await new AdminClient(network).getStatus(token);
    const adminIds = connectedIdsFromAdminStatus(status);
    if (adminIds.length > ids.length) return adminIds;
  } catch {
  }
  return ids;
}

export async function refuseUnsetSynchronizer(
  network: ResolvedNetwork,
  token: string
): Promise<void> {
  const ids = await connectedSynchronizerIds(network, token);
  if (!multiSyncMissingId(ids, network.synchronizerId)) return;

  console.error(
    chalk.red(
      `\n  This participant is connected to ${ids.filter((id) => id.trim()).length} synchronizers.\n` +
        '  Set synchronizerId in this network to one logical id from `canton-deploy status`\n' +
        '  (namespace::fingerprint, without a trailing ::NN-N).\n' +
        '  Upload, vet, and party allocation fail on Canton if it is omitted.\n'
    )
  );
  process.exit(1);
}
