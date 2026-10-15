// Dynamic wrapper over app.json (received as `config`). Plain-HTTP (LAN test server) is allowed only for development/preview builds;
// the production profile keeps Android's default (cleartext blocked) so release builds must use https.
module.exports = ({ config: base }) => {
  const profile = process.env.EAS_BUILD_PROFILE ?? 'local';
  const allowCleartext = profile !== 'production';
  const expo = { ...base, plugins: [...base.plugins] };
  if (allowCleartext) {
    // iOS counterpart: ATS exception for LAN/IP hosts (non-production only).
    expo.ios = {
      ...base.ios,
      infoPlist: { ...base.ios.infoPlist, NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
    };
  }
  if (allowCleartext) {
    expo.plugins.push(['expo-build-properties', { android: { usesCleartextTraffic: true } }]);
  }
  return expo;
};
