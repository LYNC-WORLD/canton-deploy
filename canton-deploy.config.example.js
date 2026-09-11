// Example: LocalNet profile (Admin API upload).

module.exports = {
  defaultNetwork: 'localnet',

  networks: {
    localnet: {
      host: 'localhost',
      adminPort: 5002,
      ledgerPort: 5001,
      httpPort: 7575,
    },
  },
};
