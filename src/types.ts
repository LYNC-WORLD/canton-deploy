export type UserRight = 'CanActAs' | 'CanReadAs';

export interface ConfigUser {
  userId: string;
  parties: string[];
  rights: UserRight[];
}

export interface ResolvedNetwork {
  name: string;
  host: string;
  adminPort: number;
  ledgerPort: number;
  httpPort: number;
  httpHost?: string;
  grpcAuthority?: string;
  adminGrpcAuthority?: string;
  httpUseTls: boolean;
  token?: string;
  tokenFile?: string;
  tokenCommand?: string;
  tls: boolean;
  tlsCertFile?: string;
  synchronizerId?: string;
  jwtUserId?: string;
  jwtAudience?: string;
  scriptUserId?: string;
  vetOnUpload: boolean;
  additionalDars: string[];
  includePackages: string[];
  excludePackages: string[];
  parties: string[];
  users: ConfigUser[];
}

export interface ResolvedConfig {
  network: ResolvedNetwork;
}

export interface DarEntry {
  path: string;
  label: string;
  packageRoot?: string;
}

export interface CliFlags {
  host?: string;
  adminPort?: number;
  ledgerPort?: number;
  httpPort?: number;
  httpHost?: string;
  grpcAuthority?: string;
  token?: string;
  network?: string;
  dar?: string | string[];
  dryRun?: boolean;
  skipBuild?: boolean;
  vet?: boolean;
  noVet?: boolean;
  script?: string;
  logFile?: string;
  show?: boolean;
  decode?: boolean;
  template?: string;
  party?: string;
  scriptName?: string;
  scriptInputFile?: string;
  partiesFilterPrefix?: string;
  partiesLimit?: number;
  partiesPageToken?: string;
  partiesLookup?: string;
  partiesLocalOnly?: boolean;
  userId?: string;
  noSync?: boolean;
}
