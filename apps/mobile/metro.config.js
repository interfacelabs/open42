const path = require('path');
const exclusionList = require('metro-config/private/defaults/exclusionList').default;
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const mobileNodeModules = path.resolve(projectRoot, 'node_modules');
const workspaceNodeModules = path.resolve(workspaceRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), workspaceRoot]));
config.resolver.nodeModulesPaths = Array.from(
  new Set([...(config.resolver.nodeModulesPaths ?? []), mobileNodeModules, workspaceNodeModules])
);
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  react: path.resolve(mobileNodeModules, 'react'),
  'react-native': path.resolve(mobileNodeModules, 'react-native'),
  'react-native-css-interop': path.resolve(mobileNodeModules, 'react-native-css-interop'),
  'react-native-reanimated': path.resolve(mobileNodeModules, 'react-native-reanimated'),
  'react-native-worklets': path.resolve(mobileNodeModules, 'react-native-worklets'),
};
config.resolver.blockList = exclusionList([
  ...workspacePackages([
    'react',
    'react-native',
    'react-native-css-interop',
    'react-native-reanimated',
    'react-native-worklets',
  ]),
  ...nativewindNestedPackages([
    'react',
    'react-native',
    'react-native-css-interop',
    'react-native-reanimated',
    'react-native-worklets',
  ]),
]);

module.exports = withNativeWind(config, { input: './global.css' });

function workspacePackages(packageNames) {
  return packageNames.map(
    (packageName) => new RegExp(`${escapeRegExp(path.join(workspaceNodeModules, packageName))}/.*`)
  );
}

function nativewindNestedPackages(packageNames) {
  return packageNames.map(
    (packageName) =>
      new RegExp(
        `${escapeRegExp(path.join(workspaceNodeModules, 'nativewind', 'node_modules', packageName))}/.*`
      )
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
