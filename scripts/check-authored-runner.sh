#!/usr/bin/env bash
# Install the runner and prove namespace isolation before tests or release.
set -euo pipefail
if ! command -v bwrap >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends bubblewrap
fi
smoke() {
  bwrap --unshare-all --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 --proc /proc --dev /dev --tmpfs /tmp -- /usr/bin/node -e 'process.exit(0)'
}
if smoke; then exit 0; fi
# Ubuntu's kernel can enforce userns restrictions even when its packaged
# bwrap profile has not been loaded (including hosted CI images). Load only
# the distribution's dedicated profile; never disable AppArmor globally.
# https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007
if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends apparmor
  if [ -f /etc/apparmor.d/bwrap-userns-restrict ]; then
    sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
  fi
fi
smoke
