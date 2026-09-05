#!/usr/bin/env bash
# Install the runner and prove namespace isolation before tests or release.
set -euo pipefail
if ! command -v bwrap >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends bubblewrap
fi
node_bin="$(node -p 'process.execPath')"
smoke() {
  bwrap --unshare-all --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 --proc /proc --dev /dev --tmpfs /tmp --dir /runtime --ro-bind "$node_bin" /runtime/node -- /runtime/node -e 'process.exit(0)'
}
if smoke; then exit 0; fi
# Ubuntu's kernel can enforce userns restrictions even when its packaged
# bwrap profile has not been loaded (including hosted CI images). Load only
# the distribution's dedicated profile; never disable AppArmor globally.
# https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007
if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends apparmor
  if [ ! -f /etc/apparmor.d/bwrap-userns-restrict ]; then
    # Ubuntu packages this in apparmor-profiles' extra-profiles directory.
    # Extract only bwrap: installing the whole package would enable unrelated
    # profiles on a production host. apt verifies the repository package hash.
    profile_tmp="$(mktemp -d)"
    trap 'rm -rf "$profile_tmp"' EXIT
    (
      cd "$profile_tmp"
      apt-get download apparmor-profiles
      dpkg-deb --fsys-tarfile ./*.deb | tar -xO ./usr/share/apparmor/extra-profiles/bwrap-userns-restrict > bwrap-profile
    )
    sudo install -m 644 "$profile_tmp/bwrap-profile" /etc/apparmor.d/bwrap-userns-restrict
  fi
  sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
fi
smoke
