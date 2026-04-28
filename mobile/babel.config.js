module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 ships its worklet transform via react-native-worklets.
    // The legacy 'react-native-reanimated/plugin' is a no-op / errors on v4.
    // Must be the last plugin in the list.
    plugins: ['react-native-worklets/plugin'],
  };
};
