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
      additionalDars: [
        // './vendor/splice-api-token-standard.dar',
      ],
      parties: ['Alice', 'Bob'],
      users: [{
        userId: 'ledger-api-user',
        parties: ['Alice', 'Bob'],
        rights: ['CanActAs', 'CanReadAs'],
      }],
    },

    devnet: {
      host: '192.168.50.10',
      adminPort: 5002,
      ledgerPort: 5011,
      httpPort: 8080,
      vetOnUpload: true,
      tokenFile: './.tokens/devnet.jwt',
      parties: ['Operator'],
      users: [{
        userId: 'app-operator',
        parties: ['Operator'],
        rights: ['CanActAs', 'CanReadAs'],
      }],
      additionalDars: [],
      excludePackages: [],
    },
  },
};
