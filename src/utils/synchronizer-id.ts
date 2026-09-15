export function toLogicalSynchronizerId(id: string): string {
  const trimmed = id.trim();
  return trimmed.replace(/::\d+-\d+$/, '');
}
