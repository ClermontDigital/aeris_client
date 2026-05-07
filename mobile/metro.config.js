const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Workspace symlink awareness — Metro must watch the shared package source so changes
// hot-reload, and must resolve modules from both the mobile-local and root node_modules.
// The shared package's `react-native` field points at src/, so Metro reads TS via Babel
// without requiring a `dist/` build during development. (Phase 0 plan, step 4.)
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, '../shared'),
];

config.resolver = {
  ...(config.resolver ?? {}),
  nodeModulesPaths: [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(__dirname, '../node_modules'),
  ],
};

module.exports = config;
