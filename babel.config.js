module.exports = {
  presets: ['module:@react-native/babel-preset'],
  env: {
    // Strip console.* from release bundles (smaller, faster)
    production: {
      plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]],
    },
  },
};
