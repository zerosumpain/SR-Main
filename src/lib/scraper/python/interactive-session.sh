#!/usr/bin/env bash
# Usage: interactive-session.sh <profile> <display_num> <vnc_port> <ws_port> <url>
set -e
PROFILE="$1"; DISPLAY_NUM="$2"; VNC_PORT="$3"; WS_PORT="$4"; URL="$5"
RUNTIME_DIR="/tmp/scraper-sessions/${PROFILE}-${DISPLAY_NUM}"
mkdir -p "$RUNTIME_DIR"
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" 2>/dev/null || true

# Clean stale Chromium singleton locks. When a prior scrape/session crashed
# without cleanup, these lockfiles stick around and Playwright refuses to
# launch ("Failed to create a ProcessSingleton for your profile directory").
PROFILE_DIR="/home/jkai/scraper-profiles/${PROFILE}"
if [ -d "$PROFILE_DIR" ]; then
  rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonCookie" "$PROFILE_DIR/SingletonSocket" "$PROFILE_DIR/lockfile" 2>/dev/null || true
fi

Xvfb ":${DISPLAY_NUM}" -screen 0 1400x900x24 -nolisten tcp -ac > "$RUNTIME_DIR/xvfb.log" 2>&1 &
XVFB_PID=$!; echo "$XVFB_PID" > "$RUNTIME_DIR/xvfb.pid"

for i in 1 2 3 4 5 6 7 8 9 10; do
  [ -S "/tmp/.X11-unix/X${DISPLAY_NUM}" ] && break
  sleep 0.3
done

x11vnc -display ":${DISPLAY_NUM}" -rfbport "${VNC_PORT}" -localhost -forever -shared -quiet -nopw -bg -o "$RUNTIME_DIR/x11vnc.log"

websockify --web=/usr/share/novnc "${WS_PORT}" "localhost:${VNC_PORT}" > "$RUNTIME_DIR/websockify.log" 2>&1 &
WS_PID=$!; echo "$WS_PID" > "$RUNTIME_DIR/websockify.pid"

cleanup() {
  echo "cleanup invoked" >> "$RUNTIME_DIR/cleanup.log"
  [ -n "${PY_PID:-}" ] && kill -TERM "$PY_PID" 2>/dev/null || true
  wait "${PY_PID:-0}" 2>/dev/null || true
  [ -f "$RUNTIME_DIR/websockify.pid" ] && kill -TERM "$(cat $RUNTIME_DIR/websockify.pid)" 2>/dev/null || true
  [ -f "$RUNTIME_DIR/xvfb.pid" ] && kill -TERM "$(cat $RUNTIME_DIR/xvfb.pid)" 2>/dev/null || true
  exit 0
}
trap cleanup SIGTERM SIGINT

DISPLAY=":${DISPLAY_NUM}" python3 /home/jkai/scraper-runtime/interactive.py <<EOF &
{"profile": "${PROFILE}", "url": "${URL}"}
EOF
PY_PID=$!; echo "$PY_PID" > "$RUNTIME_DIR/python.pid"
wait "$PY_PID"
cleanup
