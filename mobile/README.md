# Raqamli Hamyon — mobile (Expo / React Native / TypeScript)

Android, iOS and Web from one code base. Backend: `../backend` (unchanged .NET 10 + PostgreSQL).

## Run
```bash
cd mobile
npm install
npm run typecheck && npm run lint && npm test
npx expo start --web               # React Native Web
npx expo start                     # Expo Go / dev client (Android, iOS)
```
API URL: `app.json -> expo.extra.apiUrl` (default `http://localhost:5080`), editable in Settings.
Android emulator: `http://10.0.2.2:5080`. Web needs the origin in backend `Cors__Origins__0`.

## Structure
- `app/` expo-router routes (tabs: Bosh, Tarix, Analitika, Loyihalar, Qarzlar; `/settings`)
- `src/design` glass design system, SVG icons, charts · `src/dnd` drag & drop
- `src/state` zustand stores + TanStack Query hooks · `src/offline` SQLite storage/migrations
- `src/updates` OTA + store-update logic

## Drag & drop
Long-press (350 ms) then drag. A drop only opens a pre-filled form; money changes only after "Tasdiqlash"
(API call). Tap on tiles is the accessible alternative.

## Releases and updates (needs YOUR Expo/Apple/Google accounts)
```bash
npm i -g eas-cli && eas login
eas init                       # creates the EAS project id, fills updates.url
eas build -p android --profile preview      # APK for testers (channel: preview)
eas build -p ios --profile preview          # needs Apple Developer account
eas build --profile production --platform all
eas update --channel preview --message "Fix ..."      # OTA to testers first
eas update --channel production --message "Fix ..."   # then production
eas submit -p android|ios --profile production
```
Channels: `development`, `preview`, `production` (see `eas.json`). `runtimeVersion` policy `appVersion`
means an OTA bundle is only delivered to binaries with the same app version, so a JS update can never reach a
build with incompatible native code. Raise the minimum supported version server-side with
`Client__MinVersion` / `Client__LatestVersion` (backend env) — older binaries get a blocking "update" screen.

Downloaded OTA bundles activate on the next cold start; the "Restart now" button is refused while a money form
is open or the offline queue is syncing. expo-updates rolls back to the embedded bundle when a new bundle fails
to launch. Update events are stored in the local update log (Settings -> Yangilanishlar tarixi).
## Android APK for a real phone (preview)

Cloud build (no JDK/Android SDK needed locally):

```bash
cd mobile
npm install -g eas-cli          # or: npx eas-cli@latest <cmd>
eas login                       # type credentials ONLY into this prompt / browser, never into files
eas init                        # creates projectId + updates.url in app.json — commit them
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://YOUR-SERVER --visibility plaintext
eas build -p android --profile preview      # → APK; EAS prints the download URL / QR
```

Install: open the build URL on the phone → download APK → allow "install unknown apps" for the browser → install.

**Server address.** `localhost` on a phone is the phone itself. Options:
- Same Wi-Fi test: run the API with `ASPNETCORE_URLS=http://0.0.0.0:5080`, allow port 5080 in Windows Firewall,
  and enter `http://<PC LAN IP>:5080` on the login screen ("Server manzili"; the field is saved on the device).
  Plain HTTP is enabled **only** for `development`/`preview` builds (`app.config.js`); production requires https.
- Real server: set `EXPO_PUBLIC_API_URL` (EAS environment) to its https URL before building.

iOS: `eas build -p ios --profile preview` (ad-hoc, needs Apple Developer account + `eas device:create`);
`preview-simulator` profile builds a simulator app (needs macOS to run). OTA: `eas update --channel preview`.
