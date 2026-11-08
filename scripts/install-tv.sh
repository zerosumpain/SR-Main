#!/usr/bin/env bash
# Install (or update) sr. tv on an Android TV over the network, from homeserv.
# The TV needs Developer options → USB/network debugging on; the first connect
# shows an "Allow debugging?" prompt on the TV — accept it.
#
#   scripts/install-tv.sh <tv address>     e.g. scripts/install-tv.sh 192.168.0.42
set -euo pipefail
tv="${1:?usage: scripts/install-tv.sh <tv address>}"
command -v adb >/dev/null || { echo "adb is not installed (apt install adb, or Android platform-tools)"; exit 1; }
apk="$(mktemp --suffix=.apk)"
trap 'rm -f "$apk"' EXIT
curl -fsSL -o "$apk" https://github.com/zerosumpain/SR-TV/releases/latest/download/sr-tv.apk
adb connect "$tv:5555"
adb -s "$tv:5555" install -r "$apk"
adb -s "$tv:5555" shell monkey -p com.strangeramblings.tv -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null
echo "sr. tv installed on $tv"
