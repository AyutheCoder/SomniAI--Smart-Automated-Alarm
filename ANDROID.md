# Android

The Android app is a [Capacitor](https://capacitorjs.com) shell around the web
app (`android/`, configured in `capacitor.config.ts`). From prompt 2.2 on,
native code in it schedules, rings and dismisses alarms; the web view shows
everything else.

## Commands

| Command | What it does |
| --- | --- |
| `npm run android:doctor` | Lists what is installed, what is missing, and what to install |
| `npm run android:test` | Syncs, then runs the JVM unit tests (`testDebugUnitTest`) |
| `npm run android:build` | Syncs, then builds `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run android:run` | Installs the debug APK on the running emulator or phone and opens it |

`npm run verify:all` runs the unit tests and the debug build too. Without the
toolchain those steps fail and say what is missing; they are never skipped.

## Installing the toolchain (Windows)

What the project needs, read from the generated files rather than assumed:

| Need | Why | Source |
| --- | --- | --- |
| JDK 21 (21-24 work) | Capacitor compiles for Java 21; Gradle 8.14.3 can't run on newer. Tried here: JDK 25 fails with `Unsupported class file major version 69`, JDK 26 with `70` | `node_modules/@capacitor/android/capacitor/build.gradle`, `android/gradle/wrapper/gradle-wrapper.properties` |
| Android SDK Platform 36 | `compileSdkVersion = 36` | `android/variables.gradle` |
| SDK Build-Tools, Platform-Tools | building and installing (`adb`) | Android Gradle Plugin 8.13.0 |
| Android Emulator + an x86_64 system image | running the APK without a phone | |

Steps:

1. **Install Android Studio** (the current stable release) from
   <https://developer.android.com/studio>.
2. **Run its setup wizard** on first start and choose **Standard**. That
   installs the SDK, Platform-Tools, Build-Tools and the Emulator. If the
   wizard was skipped or closed, *More Actions → SDK Manager* offers to install
   the SDK instead.
3. **Get a JDK 21 through Android Studio.** Its own bundled JDK is too new:
   Android Studio 2026.2.1 bundles JDK 25, which this Gradle can't run on.
   *Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK
   → Download JDK…*, version **21**, vendor **Eclipse Temurin**. It goes into
   `.jdks` in your user folder, where `npm run android:doctor` looks. The JDK
   26 already installed stays as it is and is not used for Android builds.
4. **Add API 36** if the wizard installed a different one: *More Actions →
   SDK Manager → SDK Platforms →* tick **Android 16.0 ("Baklava") API 36**, then
   *SDK Tools →* make sure **Android SDK Build-Tools**, **Android SDK
   Platform-Tools** and **Android Emulator** are ticked. Apply.
5. **Turn on Windows Hypervisor Platform.** Virtualization-based security is
   running on this machine, so the emulator can only accelerate through it. In
   an **administrator** PowerShell:
   ```powershell
   Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform
   Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform   # if State is Disabled
   ```
   Restart when asked.
6. **Create a virtual device:** *More Actions → Virtual Device Manager → Create
   device →* a Pixel phone *→* system image **API 36, Google APIs, x86_64**.
   This machine has 8 GB of RAM and little free, so under *Advanced* give the
   device **2048 MB** of RAM, and close other apps before starting it.
7. **Check:** `npm run android:doctor` should report everything OK. It looks for
   the JDK in `JAVA_HOME`, then where Android Studio installed its own, then the
   `java` on your PATH; and for the SDK in `ANDROID_HOME`, `ANDROID_SDK_ROOT`,
   then Android Studio's default location. If it can't find them, set
   `JAVA_HOME` and `ANDROID_HOME` to the paths Android Studio shows (Settings →
   Build Tools → Gradle → Gradle JDK, and SDK Manager → Android SDK Location).

Network note: on this machine Java's downloads time out when they try IPv6
first, though curl works. `android/gradle.properties` and `scripts/android.mjs`
make Gradle prefer IPv4.

## Running it

```bash
npm run dev            # the shell loads this, via 10.0.2.2 on the emulator
npm run android:build
npm run android:run    # with the emulator running
```

On a phone on the same Wi-Fi: start the dev server with `npx next dev -H 0.0.0.0`,
then `CAP_SERVER_URL=http://<this PC's LAN IP>:3000 npm run android:build`.

## Decision: the shell loads the app from a server, not bundled files

**Decided in prompt 2.1.** The web view loads the app from a server
(`server.url`): the local dev server during development, the deployed site
for release. It does not bundle the app's pages into the APK.

### The two options

| | Load from a server (chosen) | Bundle the pages into the APK |
| --- | --- | --- |
| Works with the app as built | Yes: pages, API routes, sign-in and middleware all run as they do in a browser | No: needs a static export. The API stays on a server, so every call becomes cross-origin, and sign-in has to move from cookies to tokens or native HTTP |
| UI with no connection | No: an offline page is shown instead | Yes |
| Shipping a UI change | Deploy the site; no store release | A new store release |
| Capacitor's guidance | `server.url` is documented as "not intended for use in production" | The supported path |
| Native bridge exposure | Whatever the server sends can call the app's native plugins | Only code shipped in the APK can |
| Play Store | Apps that wrap a website risk rejection under the minimum-functionality policy | No such concern |

### Why load from a server

- **The alarm doesn't depend on the web view.** From prompts 2.2–2.4, native
  code schedules the alarm with `AlarmManager`, rings it from a foreground
  service and runs a native challenge to dismiss it. Prompt 2.5 keeps each alarm's
  ring plan on the device. So the UI needing a connection never touches the rule
  that the alarm never waits on the network at ring time.
- **Bundling means rebuilding the app first.** A static export would mean
  reworking sign-in for a cross-origin app and every API call. That is real
  work, and it belongs in a prompt of its own, not hidden inside the shell set-up.

### What this costs, and how it is contained

- **We use `server.url` beyond its documented purpose.** A web view whose
  native bridge is driven by a remote site is only as trustworthy as that site.
  So:
  - A release build must use HTTPS: `capacitor.config.ts` refuses
    `CAP_RELEASE=1` with plain HTTP, and `ShellConfigTest` checks the packaged
    config.
  - Navigation is locked to the app's own host (`allowNavigation`). Every other
    link opens in the browser, outside the bridge.
  - The native plugins offer as little as they can.
  - The security review (prompt 7.1) must cover the server as part of the app.
- **No UI offline.** `mobile/www/offline.html` explains that instead of a blank
  screen. It must say truthfully whether alarms still ring. It currently says
  native alarms are not in this build yet; update that when 2.2–2.4 ship.
- **Native and web can drift apart.** The site can update while an older APK is
  installed, so from 2.5 the web code must check the native plugin's version
  before using it.

### When to revisit

Move to bundled pages if the Play Store review (prompt 7.5) objects, if the UI
is needed offline, or if the server-as-trusted-code risk stops being acceptable.
The route is a static export of the pages plus Capacitor's native HTTP, so that
sign-in cookies work across origins.
