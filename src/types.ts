export type UserRight = 'CanActAs' | 'CanReadAs';

export interface ConfigUser {
  userId: string;
  parties: string[];
  rights: UserRight[];
}

export type UploadVia = 'admin' | 'ledger';

export interface OAuth2Config {
  tokenUrl: string;
  clientId: string;
  clientSecretEnv: string;
  audience: string;
  scope?: string;
}

export interface SshForward {
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

export interface SshTunnelConfig {
  host: string;
  user: string;
  port?: number;
  identityFile?: string;
  forwards: SshForward[];
}

export interface TunnelConfig {
  ssh?: SshTunnelConfig;
}

export interface ResolvedNetwork {
  name: string;
  uploadVia: UploadVia;
  host: string;
  adminPort: number;
  ledgerPort: number;
  httpPort: number;
  httpHost?: string;
  grpcAuthority?: string;
  adminGrpcAuthority?: string;
  httpUseTls: boolean;
  token?: string;
  oauth2?: OAuth2Config;
  tokenFile?: string;
  tokenCommand?: string;
  tunnel?: TunnelConfig;
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
  uploadVia?: string;
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
