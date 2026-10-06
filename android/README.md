# Android wrapper

The Android package uses Capacitor 7 and opens the dev web app; API credentials
remain server-side. Install Android Studio with Android SDK and a JDK 17+,
then run `npm install` followed by `npm run build` from this directory. The
build initializes the Capacitor Android project when needed, syncs plugins,
and runs Gradle `assembleDebug` to produce
`android/app/build/outputs/apk/debug/app-debug.apk`.

Do not copy the server `.env` into the Android project or APK. This checkout
currently lacks a working Android SDK/Gradle/emulator, so APK generation and
device verification are not yet confirmed here.
