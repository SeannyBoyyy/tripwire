# Install Tripwire as a real iPhone app

In Expo Go, tapping an alert opens Expo Go, and Tripwire only opens while `npx expo start` is running on a
computer. A real build is an ordinary app: it opens anywhere with no laptop, and tapping an alert opens Tripwire
on the Tripwires tab. Alerts themselves already work without it; this is only about opening the app.

## What you need

- An **Apple Developer Program** membership (US$99 a year). Installing a build on your own iPhone needs it.
- An **Expo account** (free). The free plan includes up to 15 iOS builds a month, in a slower queue.
- **Developer Mode** on the iPhone: Settings -> Privacy & Security -> Developer Mode, then restart.

## Steps

PowerShell, in the project root.

**1. Give the app its own id.** The placeholder `com.example.tripwire` can't be registered. Pick one that is yours:

```powershell
(Get-Content app.json) -replace 'com.example.tripwire','com.yourname.tripwire' | Set-Content app.json
```

**2. Hand the build your server address and key.** EAS builds don't see your `.env` (it is gitignored), so store the
two values on Expo's side. The key is read straight from your `.env`:

```powershell
npx eas-cli env:create --name EXPO_PUBLIC_TRIPWIRE_API --value https://tripwire.YOURNAME.workers.dev --environment preview --visibility plaintext
$k = (Select-String -Path .env -Pattern '^EXPO_PUBLIC_TRIPWIRE_KEY=(.*)$').Matches.Groups[1].Value
npx eas-cli env:create --name EXPO_PUBLIC_TRIPWIRE_KEY --value $k --environment preview --visibility sensitive
```

**3. Register your iPhone**, then build. Open the link it prints on the iPhone and install the profile. When the
build asks about push notifications, say yes.

```powershell
npx eas-cli device:create
npx eas-cli build --platform ios --profile preview
```

**4. Install.** When the build finishes, open its page on expo.dev (or the link in the terminal) on the iPhone and tap
Install. Allow notifications the first time it asks.

**5. Switch over.** The new app has a different push token from Expo Go, so the tripwires you made in Expo Go still
point at Expo Go. Clear them, then set your tripwires in the new app (from `server/`):

```powershell
npx wrangler d1 execute tripwire --remote --command "DELETE FROM tripwires"
```

## Good to know

- **A brand-new Apple membership can be slow.** Apple can take 24 to 72 hours before a newly registered device can
  be installed on. If the install fails, try again later.
- **Code changes need a new build.** The app's code is inside the build. Keep using Expo Go (`npx expo start`) while
  you develop, and rebuild when you want the installed app updated. Server changes (the Worker) never need a rebuild.
- **`.env` changes don't reach the installed app.** Update the EAS variables (`eas env:update`) and rebuild.
- **The key is inside the app.** `EXPO_PUBLIC_` values ship in plain text in the build, so anyone who gets the app can
  read it. Only your registered iPhone can install this build, which keeps that to you.
- If the installed app connects to your server but alerts never arrive, add `"mode": "production"` to the
  `expo-notifications` plugin options in `app.json` and rebuild. Ad hoc builds use Apple's production push service.
- Only the iPhone is covered here. Android needs a different build profile.
