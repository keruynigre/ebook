// Lets the app talk to the person's own computer over plain http on the home network
// (Unsloth at http://192.168.x.x:8888). Release builds block http unless this is set.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withCleartextHttp(config) {
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return c;
  });
};
