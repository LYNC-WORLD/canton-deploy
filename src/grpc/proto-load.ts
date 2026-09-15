import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { adminProtoPath, ledgerProtoPath, getProtoRoot } from '../proto-root.js';

const LOADER_OPTS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

function loadProto(protoPath: string, includeDirs: string[]) {
  return grpc.loadPackageDefinition(
    protoLoader.loadSync(protoPath, { ...LOADER_OPTS, includeDirs })
  );
}

export function loadLedgerProto(protoFile: string) {
  const root = getProtoRoot();
  return loadProto(ledgerProtoPath(protoFile), [
    path.join(root, 'ledger-api'),
    path.join(root, 'admin-api'),
  ]);
}

export function loadAdminProto(protoFile: string) {
  const root = getProtoRoot();
  return loadProto(adminProtoPath(protoFile), [
    path.join(root, 'admin-api'),
    path.join(root, 'ledger-api'),
  ]);
}
