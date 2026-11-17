@echo off
echo ====================================================
echo  FORTIVEX — Google Play Release Keystore Generator
echo ====================================================
echo.
echo This script generates a production keystore (fortivex-release-key.jks)
echo required for signing your Android App Bundle (.aab).
echo.

set KEYSTORE_NAME=fortivex-release-key.jks
set ALIAS=fortivex

keytool -genkey -v -keystore %KEYSTORE_NAME% -alias %ALIAS% -keyalg RSA -keysize 2048 -validity 10000

if %ERRORLEVEL% equ 0 (
    echo.
    echo ====================================================
    echo [SUCCESS] Keystore created: %KEYSTORE_NAME%
    echo Alias: %ALIAS%
    echo KEEP THIS FILE SAFE AND DO NOT COMMIT TO PUBLIC GIT!
    echo ====================================================
) else (
    echo.
    echo [ERROR] Keystore generation failed. Ensure Java JDK is installed and in PATH.
)
pause
