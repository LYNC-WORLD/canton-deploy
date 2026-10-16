export function toLogicalSynchronizerId(id: string): string {
  const trimmed = id.trim();
  return trimmed.replace(/::\d+-\d+$/, '');
}

export function logicalSynchronizerId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  if (!trimmed) return undefined;
  return toLogicalSynchronizerId(trimmed);
}

export function multiSyncMissingId(
  connectedIds: readonly string[],
  configured?: string
): boolean {
  const connected = connectedIds.filter((id) => id.trim()).length;
  return connected > 1 && !configured?.trim();
}

export function connectedIdsFromAdminStatus(status: unknown): string[] {
  const list =
    (
      status as {
        status?: { connected_synchronizers?: Array<{ physical_synchronizer_id?: string }> };
      }
    )?.status?.connected_synchronizers ?? [];
  return list
    .map((sync) => sync.physical_synchronizer_id)
    .filter((id): id is string => Boolean(id?.trim()));
}
