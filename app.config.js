// Adds the CI build number to app.json, so every APK can be installed over the previous one.
module.exports = ({ config }) => {
  const build = Number(process.env.BUILD_NUMBER) || config.android?.versionCode || 1;
  return {
    ...config,
    android: { ...config.android, versionCode: build },
  };
};
