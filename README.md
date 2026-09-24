# canton-deploy

Deploy Daml packages to a Canton validator from your project: build, upload, vet, allocate parties, onboard users, run scripts, and inspect what is on the ledger.

Docs: [canton-deploy](https://docs.lync.world/docs/CANTON/deploy/canton-deploy)

canton-deploy is a [DPM](https://docs.canton.network/sdks-tools/cli-tools/dpm) component. You invoke it as `dpm canton-deploy`.

```bash
dpm add component oci://ghcr.io/lync-world/canton-deploy:0.2.0
dpm install package
dpm canton-deploy init
dpm canton-deploy deploy --network localnet
```

## Requirements

- DPM 1.0.20 or later (bundles Daml SDK 3.5)
- Node.js 18 or later
- `damlc` and `daml-script` for your SDK version (installed with the SDK via DPM)
- A running Canton participant with the Ledger and JSON APIs reachable from your machine. The Admin API is optional: it is needed only for `uploadVia: "admin"` and the `dars`, `vet`, and `vet-dar` commands. For LocalNet, add `canton-open-source` as a component to get `dpm sandbox` (see [Quick start](#quick-start)).


## Using canton-deploy with Claude

A Claude skill for canton-deploy is published in the [LYNC plugin marketplace](https://github.com/LYNC-WORLD/claude-plugins). With it installed, asking Claude to deploy a Daml package to Canton, set up a validator profile, or debug a failed upload gets answers built on `dpm canton-deploy` rather than hand-rolled API calls.

```
claude plugin marketplace add LYNC-WORLD/claude-plugins
claude plugin install canton-deploy@lync
```

In the Claude desktop app: Customize → Plugins → Add marketplace → `https://github.com/LYNC-WORLD/claude-plugins`.


## Install

Work from your Daml project root (the directory that contains `daml.yaml`, or the `multi-package.yaml` root).

Add the component to that file. DPM does not allow `sdk-version` and `components:` in the same file; use `components:` and list `damlc` / `daml-script` next to this component if you need to pin them.

```yaml
components:
  - damlc:3.5.2
  - daml-script:3.5.2
  - oci://ghcr.io/lync-world/canton-deploy:0.2.0
```

Then install everything the project declares:

```bash
dpm install package
```

`dpm install` in the same directory also installs listed components.

On first install DPM pins the component by digest and rewrites the line in `daml.yaml` to `oci://ghcr.io/lync-world/canton-deploy:0.2.0@sha256:…`. That is expected; leave it in place.

You can add and pin the component in one step instead of editing `daml.yaml`:

```bash
dpm add component oci://ghcr.io/lync-world/canton-deploy:0.2.0
dpm install package
```

`dpm add component` accepts `"<name>:<version>"`, `oci://<reference>`, or a local path object. For GHCR you must use the `oci://` form. The short form `canton-deploy:0.2.0` resolves against Digital Asset's component registry and will work once canton-deploy is published there. Do not pass a bare `ghcr.io/...` host, and do not paste a `@sha256:…` digest into `dpm add component` — let DPM pin the digest into `daml.yaml` on install.

Confirm it is on the CLI:

```bash
dpm canton-deploy --help
```

## Quick start

1. Start a participant. For LocalNet, add `canton-open-source` to `components:` (for example `- canton-open-source:3.5.17`), run `dpm install package`, then:

   ```
   dpm sandbox --ledger-api-port 5001 --admin-api-port 5002 --json-api-port 7575
   ```

   It takes about 30 seconds and prints `Canton sandbox is ready.` Leave it running in its own terminal.

2. From the project root, in another terminal:

   ```
   dpm canton-deploy init
   dpm canton-deploy status --network localnet
   dpm canton-deploy deploy --network localnet
   ```

`init` asks whether to add a DevNet profile alongside LocalNet and whether to accept the defaults for each (LocalNet: `localhost`, Admin `5002`, Ledger `5001`, JSON API `7575`, no TLS, LocalNet HMAC token, parties `Alice`/`Bob`, user `ledger-api-user`). Answer No to any of them to enter your own values.

On LocalNet, canton-deploy can mint a development HMAC JWT (`unsafe` secret, user `ledger-api-user`). This is a development convenience for a local sandbox only. Other networks need an explicit JWT — see [Authentication](#authentication).

## Configuration

Settings live in `canton-deploy.config.js` at the project root (or a parent directory). Select a named network with `--network`. Run `init` or copy [`canton-deploy.config.example.js`](./canton-deploy.config.example.js).

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
      uploadVia: 'ledger',
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
| --- | --- |
| `host` | Validator host or IP |
| `adminPort` | Admin gRPC port (default `5002`) |
| `ledgerPort` | Ledger gRPC port (default `5001`) |
| `httpPort` | HTTP JSON API port (default `7575`) |
| `grpcAuthority` | gRPC `:authority` for the Ledger API when a proxy routes on name |
| `adminGrpcAuthority` | Same for the Admin API |
| `httpHost` | HTTP `Host` header for the JSON API |
| `httpUseTls` | Use `https` for JSON API calls |
| `token` / `oauth2` / `tokenFile` / `tokenCommand` | JWT source (see [Authentication](#authentication)) |
| `tunnel.ssh` | Optional SSH `-L` forwards before network commands (remote DevNet) |
| `tls` / `tlsCertFile` | TLS for gRPC; optional CA file |
| `uploadVia` | `"admin"` or `"ledger"` — DAR upload path (default ledger). Ledger uses gRPC `UploadDarFile`, with JSON `POST /v2/dars` fallback if Ledger gRPC is unreachable. |
| `synchronizerId` | Logical synchronizer id (`namespace::fingerprint`). Required when the participant has more than one synchronizer. Use the logical id from `status`, not a trailing `::NN-N` suffix. |
| `vetOnUpload` | Vet during upload. Defaults **on** for `localnet`, **off** otherwise (TestNet/MainNet upload-only by default). Override with `--vet` / `--no-vet`. |
| `additionalDars` | Extra DAR paths uploaded before project DARs |
| `includePackages` / `excludePackages` | Filter packages from `daml.yaml` / `multi-package.yaml` |
| `parties` | Display names allocated on `deploy` (skipped if they already exist) |
| `users` | Users created on `deploy` with `CanActAs` / `CanReadAs` for their parties |
| `scriptUserId` | `--user-id` passed to `dpm script` (otherwise JWT `sub`) |

Vendored DARs go in `additionalDars` or `--dar`. `data-dependencies` are not uploaded on their own.

**Upload paths:** `ledger` (default) works on managed validators where only Ledger/JSON API is exposed. `admin` uses Canton Admin `UploadDar` (operator tooling; needs `adminPort`). Commands `dars`, `vet`, and `vet-dar` always use the Admin API. On validators without Admin, vet during upload with `deploy --vet` on the ledger path.

Upload path precedence: `--upload-via` → `CANTON_DEPLOY_UPLOAD_VIA` → `CANTON_PLUGIN_UPLOAD_VIA` → config `uploadVia` → `ledger`.

## Authentication

The JWT is resolved in this order:

1. `--token`
2. `CANTON_DEPLOY_TOKEN`
3. config `token`
4. config `oauth2` (OAuth2 client credentials — client secret via `clientSecretEnv`, never in config)
5. config `tokenCommand` (a shell command whose stdout is the token)
6. config `tokenFile`
7. LocalNet development HMAC (network name `localnet` only)

```js
oauth2: {
  tokenUrl: 'https://YOUR_TENANT.auth0.com/oauth/token',
  clientId: 'YOUR_M2M_CLIENT_ID',
  clientSecretEnv: 'DEVNET_OAUTH_CLIENT_SECRET',
  audience: 'https://your-ledger-api-audience',
},
```

Tokens are cached in-process and refreshed when expiry is within five minutes. `dpm canton-deploy token --decode` shows the resolved source (`oauth2`, `tokenCommand`, etc.).

```bash
export DEVNET_OAUTH_CLIENT_SECRET='...'
dpm canton-deploy token --decode --network devnet
dpm canton-deploy token --show --network devnet
```

### SSH tunnel (remote DevNet)

When the validator runs on a remote host (e.g. Splice docker compose with nginx on `127.0.0.1:80`), canton-deploy can open local port forwards before any network command and tear them down on exit:

```js
host: '127.0.0.1',
ledgerPort: 5001,
httpPort: 7575,
grpcAuthority: 'grpc-ledger-api.localhost',
httpHost: 'json-ledger-api.localhost',
tunnel: {
  ssh: {
    host: 'dev-server.example.com',
    user: 'ubuntu',
    forwards: [
      { localPort: 5001, remoteHost: '127.0.0.1', remotePort: 80 },
      { localPort: 7575, remoteHost: '127.0.0.1', remotePort: 80 },
    ],
  },
},
```

Multiple forwards to the same remote `:80` are intentional: nginx routes by gRPC `:authority` and HTTP `Host`. See [examples/devnet-compose-remote](./examples/devnet-compose-remote).

## Commands

Shared flags: `--network`, `--host`, `--admin-port`, `--ledger-port`, `--http-port`, `--grpc-authority`, `--http-host`, `--token`, `--log-file`.

Exit code `0` is success. `--log-file` appends output for CI.

| Command | What it does |
| --- | --- |
| `deploy` | Build (unless `--skip-build`), upload DARs, optionally vet, onboard parties/users, optional `--script` |
| `vet` | Vet the same DAR set `deploy` would upload |
| `vet-dar <mainPackageId>` | Vet one already-uploaded DAR by main package id |
| `dars` | List uploaded DARs (Admin API) |
| `packages` | List known packages (Ledger API) |
| `status` | Probe Admin, Ledger, and JSON API; exit 1 only if Ledger fails or Admin fails when `uploadVia` is `admin`. Lists connected synchronizers (Admin or JSON API). |
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
dpm canton-deploy deploy --network testnet --skip-build --vet --script Setup:seed --input-file seed.json
dpm canton-deploy deploy --network devnet --skip-build --dry-run
dpm canton-deploy deploy --network localnet --no-vet
dpm canton-deploy deploy --network testnet --upload-via ledger --skip-build
dpm canton-deploy deploy --network mainnet --skip-build --no-vet
```

| Flag | Meaning |
| --- | --- |
| `--upload-via admin\|ledger` | Override upload path for this run |
| `--dar <path>` | Extra DAR (repeatable) |
| `--skip-build` | Use existing `.daml/dist` or `.dpm/dist` artifacts |
| `--vet` / `--no-vet` | Override `vetOnUpload` |
| `--dry-run` | Print the DAR set; do not upload |
| `--script <Module:fn>` | Run a Daml Script after upload |
| `--input-file <path>` | JSON input passed to the `--script` function |

Upload does not create contracts. Use `--script` or `run` to seed the ledger.

A party name has one owner: either the config `parties` list or your script, not both. `deploy` allocates config parties before running `--script`, and Canton rejects a second `allocatePartyByHint` with the same hint. If a name is in `parties`, have the script look the party up instead of allocating it (filter `listKnownParties` by the `Alice::` prefix, or pass party ids in with `--input-file`); if the script allocates it, leave it out of `parties`.

### vet / vet-dar

```bash
dpm canton-deploy vet --network localnet
dpm canton-deploy vet --network localnet --skip-build
dpm canton-deploy vet-dar <mainPackageId> --network localnet
```

By default vetting waits until it is observed on the synchronizer. `--no-sync` returns as soon as the request is accepted.

### dars / packages

```bash
dpm canton-deploy dars --network localnet
dpm canton-deploy packages --network localnet
```

### status

```bash
dpm canton-deploy status --network localnet
```

Ledger must be reachable. With default `uploadVia: ledger`, Admin and JSON failures are reported but do not fail the command. With `uploadVia: admin`, Admin must also be up. Copy logical synchronizer ids from the output into config `synchronizerId` when needed.

### parties / allocate-party

```bash
dpm canton-deploy parties --network localnet
dpm canton-deploy parties --network localnet --local
dpm canton-deploy allocate-party Alice --network localnet
```

| Flag | Meaning |
| --- | --- |
| `--local` | Only parties hosted on this participant |
| `--filter-party <prefix>` | Prefix filter |
| `--party <ids>` | Comma-separated party ids to look up |
| `--limit <n>` / `--page-token` | Pagination |

Config `parties` are display names (for example `Alice`). The name is used as the party id hint exactly as written, so `Alice` becomes `Alice::1220…` — the same party a Daml Script gets from `allocatePartyByHint "Alice"`. An existing party with that hint is reused.

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

Parties listed in the config are already allocated when the script runs; look them up rather than calling `allocatePartyByHint` for the same name (see [deploy](#deploy)).

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

Writes `canton-deploy.config.js` with a LocalNet profile and optional DevNet, TestNet, and MainNet profiles. It asks which networks to add and whether to accept the defaults for each profile; answer No to enter host, ports, TLS, and token source by hand.

## Examples

### LocalNet

```bash
dpm sandbox --ledger-api-port 5001 --admin-api-port 5002 --json-api-port 7575   # separate terminal
dpm canton-deploy init
dpm canton-deploy status --network localnet
dpm canton-deploy deploy --network localnet
dpm canton-deploy contracts --network localnet
```

### CI with pre-built DARs

Pin the component by digest in CI so every run installs the same image. Use the `@sha256:…` value DPM wrote into your `daml.yaml` on first install:

```yaml
components:
  - damlc:3.5.2
  - daml-script:3.5.2
  - oci://ghcr.io/lync-world/canton-deploy:0.2.0@sha256:<digest from your daml.yaml>
```

```bash
dpm install package
dpm build
dpm canton-deploy deploy --skip-build --network localnet --log-file deploy.log
```

### DevNet with a JWT

```bash
export DEVNET_JWT_TOKEN='eyJ...'
dpm canton-deploy status --network devnet
dpm canton-deploy deploy --network devnet
dpm canton-deploy packages --network devnet
```

### TestNet / MainNet (ledger upload, no auto-vet)

Use one config file with named profiles; switch with `--network` only:

```bash
dpm canton-deploy status --network testnet
dpm canton-deploy deploy --network testnet --skip-build
dpm canton-deploy deploy --network mainnet --skip-build --no-vet
```

MainNet JWTs often come from `tokenCommand` (Vault or similar) in config — see [canton-deploy.config.example.js](./canton-deploy.config.example.js).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CANTON_DEPLOY_NETWORK` | Default `--network` |
| `CANTON_DEPLOY_HOST` | Override `host` |
| `CANTON_DEPLOY_ADMIN_PORT` / `LEDGER_PORT` / `HTTP_PORT` | Ports |
| `CANTON_DEPLOY_TOKEN` | JWT |
| `CANTON_DEPLOY_HTTP_HOST` / `GRPC_AUTHORITY` / `ADMIN_GRPC_AUTHORITY` | Proxy name overrides |
| `CANTON_DEPLOY_HTTP_USE_TLS` | `true` / `false` |
| `CANTON_DEPLOY_CONFIG` | Path to the config file |
| `CANTON_DEPLOY_UPLOAD_VIA` | Default upload path (`admin` or `ledger`) |
| `CANTON_PLUGIN_UPLOAD_VIA` | Alias for `CANTON_DEPLOY_UPLOAD_VIA` (proposal env name) |
| `CANTON_DEPLOY_SCRIPT_USER_ID` | User id for `dpm script` |
| `CANTON_DEPLOY_GRPC_DEADLINE_MS` | Per-RPC deadline (default `60000`) |
| `CANTON_DEPLOY_GRPC_CONNECT_MS` | Channel ready wait (default `10000`) |

## Troubleshooting

**`dpm install package` says `…/components/canton-deploy:0.2.0: not found`** — a bare `canton-deploy:0.2.0` resolves against Digital Asset's registry (`europe-docker.pkg.dev/da-images`). Use `oci://ghcr.io/lync-world/canton-deploy:0.2.0` until the component is published there.

**Every `dpm` command fails with `component "…" is currently not installed`, even `dpm --help`** — while any component listed in `daml.yaml` is not installed, DPM refuses all commands in that directory. Run `dpm install package`, or fix/remove the offending line.

**Getting 401 on `dpm install`?** — check for `DPM_INSECURE_REGISTRY=true` in your shell configuration and `insecure: true` in `~/.dpm/dpm-config.yaml` 

Run to fix:

`DPM_INSECURE_REGISTRY=false dpm install package`

**`dpm canton-deploy` not found** — the component is not installed for this project. Add it under `components:` and run `dpm install package`.

**`dpm sandbox` is an unknown command** — it comes from the `canton-open-source` component. Add `- canton-open-source:<version>` under `components:` and run `dpm install package`.

**`status` cannot reach Admin API** — required only when `uploadVia` is `admin` or for `dars` / `vet`. For ledger upload, Admin is optional; synchronizers still appear via JSON API when Admin is down.

**Managed validator (no Admin port)** — set `uploadVia: "ledger"` (default). Use `deploy --vet` for vetting; `vet` / `dars` need Admin.

**Token expired / unauthenticated** — `dpm canton-deploy token --decode`, then refresh `token`, `tokenFile`, or `tokenCommand`.

**`KNOWN_PACKAGE_VERSION` after changing Daml source** — bump the package version in `daml.yaml`, rebuild, and deploy.

**`PROTO_DESERIALIZATION_FAILURE` on upload** — `synchronizerId` must be logical (`namespace::fingerprint`). Drop a trailing `::NN-N` from `status`, or omit the field on a single-synchronizer participant.

**`run` cannot reach `grpcAuthority`** — that name must resolve to the validator on `ledgerPort`, or set `host` and `grpcAuthority` to the same reachable name.

**`contracts` returns `PACKAGE_NAMES_NOT_FOUND`** — use `#<package-name>:Module:Template` from `daml.yaml`, not a hex package id.

**`contracts` is empty after `deploy`** — run a script (`deploy --script` or `run`).

**Script fails with `Party already exists` on `allocatePartyByHint`** — the name is also in config `parties`, so `deploy` allocated it first. Look the party up in the script, or remove it from `parties`.

**JSON API unreachable, Admin and Ledger OK** — upload can still succeed. Fix `httpPort` / `httpHost` / `httpUseTls` for `contracts` and a full `status`.
