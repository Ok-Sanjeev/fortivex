#!/bin/bash
echo "===================================================="
echo " FORTIVEX — Google Play Release Keystore Generator"
echo "===================================================="
echo ""

KEYSTORE_NAME="fortivex-release-key.jks"
ALIAS="fortivex"

keytool -genkey -v -keystore $KEYSTORE_NAME -alias $ALIAS -keyalg RSA -keysize 2048 -validity 10000

if [ $? -eq 0 ]; then
    echo ""
    echo "===================================================="
    echo "[SUCCESS] Keystore created: $KEYSTORE_NAME"
    echo "Alias: $ALIAS"
    echo "KEEP THIS FILE SAFE AND NEVER COMMIT TO PUBLIC GIT!"
    echo "===================================================="
else
    echo "[ERROR] Keystore generation failed. Ensure JDK keytool is available."
fi
