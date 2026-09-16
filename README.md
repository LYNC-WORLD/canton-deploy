# canton-deploy

Deploy Daml packages to a Canton validator from your project: build, upload, vet, allocate parties, onboard users, run scripts, and inspect what is on the ledger.

You invoke it as **`dpm canton-deploy`**.

## Requirements

- [DPM](https://docs.canton.network/sdks-tools/cli-tools/dpm) 1.0.14 or later (bundled with Daml SDK 3.5+)
- Node.js 18 or later
- `damlc` and `daml-script` (installed with your SDK via DPM)
- A running Canton participant with Admin, Ledger, and JSON APIs reachable from your machine

## Install

Work from your Daml project root (the directory that contains `daml.yaml`, or the `multi-package.yaml` root).

Add the component to that file. DPM does not allow `sdk-version` and `components:` in the same file; use `components:` and list `damlc` / `daml-script` next to this component if you need to pin them.

```yaml
components:
  - damlc:3.5.2
  - daml-script:3.5.2
  - canton-deploy:0.1.0
```

If you install from an OCI registry, use the image reference you were given:

```yaml
components:
  - damlc:3.5.2
  - daml-script:3.5.2
  - oci://<registry>/canton-deploy:0.1.0
```

Then install everything the project declares:

```bash
dpm install package
```

`dpm install` in the same directory also installs listed components.

You can add and pin the component in one step (DPM 1.0.20+ / SDK 3.5.2+):

```bash
dpm add component canton-deploy:0.1.0
dpm install package
```

Confirm it is on the CLI:

```bash
dpm canton-deploy --help
```

## Quick start

1. Start your participant (LocalNet defaults: Admin `5002`, Ledger `5001`, JSON API `7575`).
2. From the project root:

```bash
dpm canton-deploy init
dpm canton-deploy status --network localnet
dpm canton-deploy deploy --network localnet
```

On LocalNet, canton-deploy can mint a development HMAC JWT (`unsafe` secret, user `ledger-api-user`). Other networks need an explicit JWT.

## Configuration

Settings live in `canton-deploy.config.js` at the project root (or a parent directory). Select a named network with `--network`. Run `init` or copy [canton-deploy.config.example.js](./canton-deploy.config.example.js).

If the nearest `package.json` has `"type": "module"`, name the file `canton-deploy.config.cjs` instead.

```js
module.exports = {
  defaultNetwork: 'localnet',
  networks: {
    localnet: {
      host: 'localhost',
      adminPort: 5002,
      ledgerPort: 5001,
      httpPort: 7575,
      vetOnUpload: true,
      excludePackages: ['./tests', 'my-app-tests'],
      additionalDars: [],
      parties: ['Alice', 'Bob'],
      users: [{
        userId: 'ledger-api-user',
        parties: ['Alice', 'Bob'],
        rights: ['CanActAs', 'CanReadAs'],
      }],
    },
    devnet: {
      host: 'validator.example.com',
      adminPort: 5002,
      ledgerPort: 5011,
      httpPort: 8080,
      token: process.env.DEVNET_JWT_TOKEN,
      vetOnUpload: true,
      parties: ['Operator'],
      users: [{
        userId: 'app-operator',
        parties: ['Operator'],
        rights: ['CanActAs', 'CanReadAs'],
      }],
    },
  },
};
```

CLI flags override environment variables, which override the config file.

| Key | What it controls |
|---|---|
| `host` | Validator host or IP |
| `adminPort` | Admin gRPC port (default `5002`) |
| `ledgerPort` | Ledger gRPC port (default `5001`) |
| `httpPort` | HTTP JSON API port (default `7575`) |
| `grpcAuthority` | gRPC `:authority` for the Ledger API when a proxy routes on name |
| `adminGrpcAuthority` | Same for the Admin API |
| `httpHost` | HTTP `Host` header for the JSON API |
| `httpUseTls` | Use `https` for JSON API calls |
| `token` / `tokenFile` / `tokenCommand` | JWT source |
| `tls` / `tlsCertFile` | TLS for gRPC; optional CA file |
| `synchronizerId` | Logical synchronizer id (`namespace::fingerprint`). Required when the participant has more than one synchronizer. Use the logical id from `status`, not a trailing `::NN-N` suffix. |
| `vetOnUpload` | Vet during upload. Defaults **on** for `localnet`, **off** otherwise. Override with `--vet` / `--no-vet`. |
| `additionalDars` | Extra DAR paths uploaded before project DARs |
| `includePackages` / `excludePackages` | Filter packages from `daml.yaml` / `multi-package.yaml` |
| `parties` | Display names allocated on `deploy` (skipped if they already exist) |
| `users` | Users created on `deploy` with `CanActAs` / `CanReadAs` for their parties |
| `scriptUserId` | `--user-id` passed to `dpm script` (otherwise JWT `sub`) |

Vendored DARs go in `additionalDars` or `--dar`. `data-dependencies` are not uploaded on their own.

DAR upload uses the **Admin API**, so `adminPort` must be reachable.

## Authentication

Resolved in this order: `--token` → `CANTON_DEPLOY_TOKEN` → config `token` → `tokenCommand` → `tokenFile` → LocalNet HMAC (network name `localnet` only).

```bash
dpm canton-deploy token --decode --network localnet
dpm canton-deploy token --show --network devnet
```

## Commands

Shared flags: `--network`, `--host`, `--admin-port`, `--ledger-port`, `--http-port`, `--grpc-authority`, `--http-host`, `--token`, `--log-file`.

Exit code `0` is success. `--log-file` appends output for CI.

| Command | What it does |
|---|---|
| `deploy` | Build (unless `--skip-build`), upload DARs, optionally vet, onboard parties/users, optional `--script` |
| `vet` | Vet the same DAR set `deploy` would upload |
| `vet-dar <mainPackageId>` | Vet one DAR by main package id |
| `dars` | List uploaded DARs (Admin API) |
| `packages` | List known packages (Ledger API) |
| `status` | Check Admin, Ledger, and JSON API connectivity |
| `parties` | List known parties |
| `allocate-party <name>` | Allocate a party by display name if it does not already exist |
| `users` | List participant users |
| `create-user --user-id` | Create a user from config `users[]` and grant rights |
| `run <Module:fn>` | Run a Daml Script (`dpm script`) |
| `contracts` | List active contracts (JSON API) |
| `token` | Show or decode the resolved JWT |
| `init` | Write `canton-deploy.config.js` |

### deploy

```bash
dpm canton-deploy deploy --network localnet
dpm canton-deploy deploy --network localnet --dar ./vendor/token-standard.dar
dpm canton-deploy deploy --network localnet --script My.Module:setup
dpm canton-deploy deploy --network devnet --skip-build --dry-run
dpm canton-deploy deploy --network localnet --no-vet
```

| Flag | Meaning |
|---|---|
| `--dar <path>` | Extra DAR (repeatable) |
| `--skip-build` | Use existing `.daml/dist` or `.dpm/dist` artifacts |
| `--vet` / `--no-vet` | Override `vetOnUpload` |
| `--dry-run` | Print the DAR set; do not upload |
| `--script <Module:fn>` | Run a Daml Script after upload |

Upload does not create contracts. Use `--script` or `run` to seed the ledger.

### vet / vet-dar

```bash
dpm canton-deploy vet --network localnet
dpm canton-deploy vet --network localnet --skip-build
dpm canton-deploy vet-dar <mainPackageId> --network localnet
```

`--no-sync` does not wait for vetting to be observed on the synchronizer.

### dars / packages

```bash
dpm canton-deploy dars --network localnet
dpm canton-deploy packages --network localnet
```

### status

```bash
dpm canton-deploy status --network localnet
```

### parties / allocate-party

```bash
dpm canton-deploy parties --network localnet
dpm canton-deploy parties --network localnet --local
dpm canton-deploy allocate-party Alice --network localnet
```

| Flag | Meaning |
|---|---|
| `--local` | Only parties hosted on this participant |
| `--filter-party <prefix>` | Prefix filter |
| `--party <ids>` | Comma-separated party ids to look up |
| `--limit <n>` / `--page-token` | Pagination |

Config `parties` are display names (for example `Alice`). An existing party with that hint is reused.

### users / create-user

```bash
dpm canton-deploy users --network localnet
dpm canton-deploy create-user --network localnet --user-id ledger-api-user
```

`--user-id` must match a `users[]` entry on that network.

### run

```bash
dpm canton-deploy run My.Module:setup --network localnet
dpm canton-deploy run Setup:seed --network devnet --dar .daml/dist/my-app-0.1.0.dar --input-file seed.json
```

`dpm script` uses `--ledger-host` for both TCP and gRPC `:authority`. If `grpcAuthority` differs from `host`, that name must resolve and accept connections on `ledgerPort`.

### contracts

```bash
dpm canton-deploy contracts --network localnet
dpm canton-deploy contracts --network localnet --party 'Alice::1220...'
dpm canton-deploy contracts --network localnet --party 'Alice::1220...' --template '#my-package:Module:Template'
```

`--template` is `#<package-name>:Module:Template` from `daml.yaml`, not the hex package id from `deploy`. The JWT user needs `CanReadAs` for `--party`.

### token

```bash
dpm canton-deploy token --network localnet
dpm canton-deploy token --decode --network localnet
dpm canton-deploy token --show --network devnet
```

### init

```bash
dpm canton-deploy init
```

Writes `canton-deploy.config.js` after prompting for host, ports, TLS, and token source.

## Examples

**LocalNet**

```bash
dpm canton-deploy init
dpm canton-deploy status --network localnet
dpm canton-deploy deploy --network localnet
dpm canton-deploy contracts --network localnet
```

**CI with pre-built DARs**

```bash
dpm build
dpm canton-deploy deploy --skip-build --network localnet --log-file deploy.log
```

**DevNet with a JWT**

```bash
export DEVNET_JWT_TOKEN='eyJ...'
dpm canton-deploy status --network devnet
dpm canton-deploy deploy --network devnet
dpm canton-deploy packages --network devnet
```

## Environment variables

| Variable | Purpose |
|---|---|
| `CANTON_DEPLOY_NETWORK` | Default `--network` |
| `CANTON_DEPLOY_HOST` | Override `host` |
| `CANTON_DEPLOY_ADMIN_PORT` / `LEDGER_PORT` / `HTTP_PORT` | Ports |
| `CANTON_DEPLOY_TOKEN` | JWT |
| `CANTON_DEPLOY_HTTP_HOST` / `GRPC_AUTHORITY` / `ADMIN_GRPC_AUTHORITY` | Proxy name overrides |
| `CANTON_DEPLOY_HTTP_USE_TLS` | `true` / `false` |
| `CANTON_DEPLOY_CONFIG` | Path to the config file |
| `CANTON_DEPLOY_SCRIPT_USER_ID` | User id for `dpm script` |
| `CANTON_DEPLOY_GRPC_DEADLINE_MS` | Per-RPC deadline (default `60000`) |
| `CANTON_DEPLOY_GRPC_CONNECT_MS` | Channel ready wait (default `10000`) |

## Troubleshooting

**`dpm canton-deploy` not found** — the component is not installed for this project. Add it under `components:` and run `dpm install package`.

**`status` cannot reach Admin API** — check `adminPort` (and `adminGrpcAuthority` if a proxy routes Admin gRPC by name). Upload uses the Admin API.

**Token expired / unauthenticated** — `dpm canton-deploy token --decode`, then refresh `token`, `tokenFile`, or `tokenCommand`.

**`PROTO_DESERIALIZATION_FAILURE` on upload** — `synchronizerId` must be logical (`namespace::fingerprint`). Drop a trailing `::NN-N` from `status`, or omit the field on a single-synchronizer participant.

**`run` cannot reach `grpcAuthority`** — that name must resolve to the validator on `ledgerPort`, or set `host` and `grpcAuthority` to the same reachable name.

**`contracts` returns `PACKAGE_NAMES_NOT_FOUND`** — use `#<package-name>:Module:Template` from `daml.yaml`, not a hex package id.

**`contracts` is empty after `deploy`** — run a script (`deploy --script` or `run`).

**JSON API unreachable, Admin and Ledger OK** — upload can still succeed. Fix `httpPort` / `httpHost` / `httpUseTls` for `contracts` and a full `status`.
