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
}

export interface ResolvedConfig {
  network: ResolvedNetwork;
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
  dar?: string;
  dryRun?: boolean;
  show?: boolean;
  decode?: boolean;
  noSync?: boolean;
}
