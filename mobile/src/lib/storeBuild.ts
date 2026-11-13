import * as Updates from 'expo-updates';

/**
 * Play Market / App Store build: the app runs fully on the phone (local account), no server, no sign-in.
 * Decided by the update channel baked into the native binary ("production"), NOT by app config: an OTA update is
 * exported with the local config, so a config flag would flip after the first update. Dev builds are never store builds.
 */
export const STORE_BUILD: boolean = !__DEV__ && Updates.channel === 'production';
