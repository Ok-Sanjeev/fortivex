# FORTIVEX — Google Play Store Android Build Guide

FORTIVEX is fully engineered for Google Play Store publication as an Android App utilizing [Capacitor](https://capacitorjs.com/) or PWA TWA (Trusted Web Activity).

---

## 1. Prerequisites
- **Node.js**: v18 or higher
- **Java Development Kit (JDK)**: OpenJDK 17 or 21
- **Android Studio**: Latest version with Android SDK Build Tools (API 34)

---

## 2. One-Time Setup

Run the following commands in the project root:

```bash
# 1. Install Capacitor CLI and Android platform
npm install --save-dev @capacitor/core @capacitor/cli @capacitor/android

# 2. Add Android native project
npx cap add android

# 3. Copy web assets and configuration into native wrapper
npx cap copy
npx cap sync
```

---

## 3. Configure Android Manifest (`android/app/src/main/AndroidManifest.xml`)

Ensure the following permissions and orientation settings are enabled:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="io.fortivex.game">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="FORTIVEX"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="true">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:name=".MainActivity"
            android:label="FORTIVEX"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:screenOrientation="portrait"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

---

## 4. Build Release Android App Bundle (AAB) for Google Play Console

To publish on Google Play Store, Google requires an Android App Bundle (`.aab`):

```bash
# Open native project in Android Studio
npx cap open android
```

In Android Studio:
1. Go to **Build** > **Generate Signed Bundle / APK**.
2. Select **Android App Bundle**.
3. Create or select your production upload keystore (`fortivex-release-key.jks`).
4. Select `release` build variant with V1 and V2 signature schemes.
5. The output bundle will be located at:
   `android/app/release/app-release.aab`
6. Upload `app-release.aab` to the **Google Play Console** under **Production** or **Open Testing**.

---

## 5. Direct APK Generation (For side-loading and direct testing)

Run inside `android/` directory:
```bash
./gradlew assembleRelease
```
The installable APK will be available at:
`android/app/build/outputs/apk/release/app-release-unsigned.apk`
