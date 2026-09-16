export function displayNameToHint(displayName: string): string {
  return displayName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
}
