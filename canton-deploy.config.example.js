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
      vetOnUpload: true,
      token: process.env.DEVNET_JWT_TOKEN,
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
