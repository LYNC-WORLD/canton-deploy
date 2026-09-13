import { cosmiconfig } from 'cosmiconfig';
import { z } from 'zod';
import * as fs from 'fs';
import chalk from 'chalk';
import type { CliFlags, ConfigUser, ResolvedConfig, ResolvedNetwork } from './types.js';

const UserSchema = z.object({
  userId: z.string(),
  parties: z.array(z.string()).default([]),
  rights: z.array(z.enum(['CanActAs', 'CanReadAs'])).default(['CanActAs', 'CanReadAs']),
});

const NetworkSchema = z.object({
  host: z.string(),
  adminPort: z.number().int().positive().optional(),
  ledgerPort: z.number().int().positive().optional(),
  httpPort: z.number().int().positive().optional(),
  grpcAuthority: z.string().optional(),
  httpHost: z.string().optional(),
  httpUseTls: z.boolean().default(false),
  adminGrpcAuthority: z.string().optional(),
  token: z.string().optional(),
  tokenFile: z.string().optional(),
  tokenCommand: z.string().optional(),
  tls: z.boolean().default(false),
  tlsCertFile: z.string().optional(),
  synchronizerId: z.string().optional(),
  jwtUserId: z.string().optional(),
  jwtAudience: z.string().optional(),
  scriptUserId: z.string().optional(),
  vetOnUpload: z.boolean().optional(),
  additionalDars: z.array(z.string()).default([]),
  includePackages: z.array(z.string()).default([]),
  excludePackages: z.array(z.string()).default([]),
  parties: z.array(z.string()).default([]),
  users: z.array(UserSchema).default([]),
});

const ConfigSchema = z.object({
  defaultNetwork: z.string().default('localnet'),
  networks: z.record(NetworkSchema),
});

type RawConfig = z.infer<typeof ConfigSchema>;
type RawNetwork = z.infer<typeof NetworkSchema>;

function resolvePortMultiEnv(
  cliValue: number | undefined,
  envVarNames: string[],
  configValue: number | undefined,
  cantonDefault: number
): number {
  if (cliValue !== undefined) return cliValue;
  for (const name of envVarNames) {
    const envVal = process.env[name];
    if (!envVal) continue;
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
    console.warn(chalk.yellow(`  Warning: env ${name}="${envVal}" is not a valid port — ignoring.`));
  }
  if (configValue !== undefined) return configValue;
  return cantonDefault;
}

function defaultVetOnUpload(networkName: string, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  return networkName === 'localnet';
}

const LOCALNET_FALLBACK: RawNetwork = {
  host: 'localhost',
  tls: false,
  httpUseTls: false,
  vetOnUpload: true,
  additionalDars: [],
  includePackages: [],
  excludePackages: [],
  parties: [],
  users: [],
};

export function resolveVetOnUpload(
  network: ResolvedNetwork,
  flags: CliFlags
): boolean {
  if (flags.vet) return true;
  if (flags.noVet) return false;
  return network.vetOnUpload;
}

export async function loadConfig(flags: CliFlags): Promise<ResolvedConfig> {
  const explorer = cosmiconfig('canton-deploy');
  const result = await explorer.search();

  let raw: RawConfig = {
    defaultNetwork: 'localnet',
    networks: { localnet: LOCALNET_FALLBACK },
  };

  if (result?.config) {
    const parsed = ConfigSchema.safeParse(result.config);
    if (!parsed.success) {
      console.error(chalk.red('canton-deploy.config.js is invalid:'));
      const flat = parsed.error.flatten();
      for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
        console.error(chalk.red(`  ${field}: ${(msgs as string[]).join(', ')}`));
      }
      process.exit(1);
    }
    raw = parsed.data;
  }

  const networkName =
    flags.network ?? process.env.CANTON_DEPLOY_NETWORK ?? raw.defaultNetwork;
  const networkConfig = raw.networks[networkName];

  if (!networkConfig) {
    console.error(chalk.red(`Network "${networkName}" not found in canton-deploy.config.js`));
    console.error(chalk.gray(`  Available: ${Object.keys(raw.networks).join(', ')}`));
    process.exit(1);
  }

  const resolvedHost =
    flags.host ?? process.env.CANTON_DEPLOY_HOST ?? networkConfig.host;

  const httpTlsEnv = process.env.CANTON_DEPLOY_HTTP_USE_TLS?.toLowerCase();
  let httpUseTls = networkConfig.httpUseTls ?? false;
  if (httpTlsEnv === '1' || httpTlsEnv === 'true') httpUseTls = true;
  if (httpTlsEnv === '0' || httpTlsEnv === 'false') httpUseTls = false;

  const resolved: ResolvedNetwork = {
    name: networkName,
    host: resolvedHost,
    adminPort: resolvePortMultiEnv(
      flags.adminPort,
      ['CANTON_DEPLOY_ADMIN_PORT'],
      networkConfig.adminPort,
      5002
    ),
    ledgerPort: resolvePortMultiEnv(
      flags.ledgerPort,
      ['CANTON_DEPLOY_LEDGER_PORT'],
      networkConfig.ledgerPort,
      5001
    ),
    httpPort: resolvePortMultiEnv(
      flags.httpPort,
      ['CANTON_DEPLOY_HTTP_PORT'],
      networkConfig.httpPort,
      7575
    ),
    httpHost: flags.httpHost ?? process.env.CANTON_DEPLOY_HTTP_HOST ?? networkConfig.httpHost,
    grpcAuthority:
      flags.grpcAuthority ??
      process.env.CANTON_DEPLOY_GRPC_AUTHORITY ??
      networkConfig.grpcAuthority,
    adminGrpcAuthority:
      process.env.CANTON_DEPLOY_ADMIN_GRPC_AUTHORITY ?? networkConfig.adminGrpcAuthority,
    httpUseTls,
    token: flags.token ?? process.env.CANTON_DEPLOY_TOKEN ?? networkConfig.token,
    tokenFile: networkConfig.tokenFile,
    tokenCommand: networkConfig.tokenCommand,
    tls: networkConfig.tls,
    tlsCertFile: networkConfig.tlsCertFile,
    synchronizerId: networkConfig.synchronizerId,
    jwtUserId: networkConfig.jwtUserId,
    jwtAudience: networkConfig.jwtAudience,
    scriptUserId:
      process.env.CANTON_DEPLOY_SCRIPT_USER_ID?.trim() || networkConfig.scriptUserId,
    vetOnUpload: defaultVetOnUpload(networkName, networkConfig.vetOnUpload),
    additionalDars: [...networkConfig.additionalDars],
    includePackages: [...networkConfig.includePackages],
    excludePackages: [...networkConfig.excludePackages],
    parties: [...networkConfig.parties],
    users: networkConfig.users as ConfigUser[],
  };

  if (!resolved.token && resolved.tokenFile) {
    try {
      resolved.token = fs.readFileSync(resolved.tokenFile, 'utf8').trim();
    } catch {
      console.error(chalk.red(`Cannot read tokenFile: ${resolved.tokenFile}`));
      process.exit(1);
    }
  }

  return { network: resolved };
}
