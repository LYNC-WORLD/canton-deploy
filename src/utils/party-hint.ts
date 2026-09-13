export function displayNameToHint(displayName: string): string {
  return displayName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
}
