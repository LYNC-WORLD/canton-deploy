import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags, ResolvedNetwork } from '../types.js';
import { withNetworkSession } from '../network-session.js';
import { resolveToken } from '../auth/resolve.js';
import { UserManagementGrpcClient } from '../grpc/user-management.js';
import { ensureParties } from '../onboarding.js';
import { failSpinner } from '../utils/cli.js';

async function executeUsers(network: ResolvedNetwork): Promise<void> {
  const token = await resolveToken(network);
  const client = new UserManagementGrpcClient(network);

  console.log(chalk.bold('\n  canton-deploy users'));
  console.log(chalk.gray(`  Ledger API: ${network.host}:${network.ledgerPort}\n`));

  const spinner = ora('Listing users...').start();
  try {
    const users = await client.listUsers(token);
    spinner.succeed(`Found ${users.length} user(s)`);

    if (users.length === 0) {
      console.log(chalk.gray('\n  No users found.\n'));
      return;
    }

    const col1 = Math.max(8, ...users.map((u) => u.id.length)) + 2;
    console.log('\n  ' + chalk.bold('USER ID'.padEnd(col1) + 'PRIMARY PARTY'));
    console.log('  ' + chalk.gray('─'.repeat(col1 + 40)));
    for (const u of users) {
      const deactivated = u.is_deactivated ? chalk.red(' (deactivated)') : '';
      console.log(
        `  ${chalk.cyan(u.id.padEnd(col1))}${u.primary_party ?? chalk.gray('—')}${deactivated}`
      );
    }
    console.log();
  } catch (err) {
    failSpinner(spinner, 'Failed to list users', err);
  }
}

async function executeCreateUser(network: ResolvedNetwork, flags: CliFlags): Promise<void> {
  const token = await resolveToken(network);

  const userId = flags.userId;
  if (!userId) {
    console.error(chalk.red('\n  --user-id is required for create-user.\n'));
    process.exit(1);
  }

  const spec = network.users.find((u) => u.userId === userId);
  if (!spec) {
    console.error(
      chalk.red(`\n  User "${userId}" not found in canton-deploy.config.js for network "${network.name}".\n`)
    );
    console.error(chalk.gray('  Add a users: [{ userId, parties, rights }] entry to the network config.'));
    process.exit(1);
  }

  console.log(chalk.bold('\n  canton-deploy create-user'));
  console.log(chalk.gray(`  User: ${userId}\n`));

  const partyMap = await ensureParties(network, token, spec.parties);
  const partyIds = spec.parties.map((p) => partyMap.get(p) ?? p);

  const client = new UserManagementGrpcClient(network);
  const spinner = ora(`Creating user ${userId}...`).start();

  try {
    const action = await client.ensureUserWithRights(token, userId, partyIds, spec.rights);
    spinner.succeed(chalk.green(action === 'created' ? 'User created' : 'User exists; rights granted'));
    console.log();
  } catch (err) {
    failSpinner(spinner, 'create-user failed', err);
  }
}

export async function runUsers(flags: CliFlags): Promise<void> {
  return withNetworkSession(flags, executeUsers);
}

export async function runCreateUser(flags: CliFlags): Promise<void> {
  return withNetworkSession(flags, (network) => executeCreateUser(network, flags));
}
