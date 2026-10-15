#!/usr/bin/env bash
# PROTOTYPE harness (throwaway) for the wayfinder ticket
# "Sign-in prototype: loopback PKCE against the live gateway".
#
# Measured on the macOS host (Homebrew Android SDK, AVD `glass`, no mise):
#   ./harness.sh serve    # isolated gated `hermes serve` + adb reverse
#   ./harness.sh app      # build + install the dev client, Metro on 8081
#   ./harness.sh emulator # boot the AVD headless
#   ./harness.sh probe    # device-side HTTP probe of the host server
#   ./harness.sh down     # stop the server and the emulator
#
# Host facts this pins:
#   * JDK 17 (Temurin) - the SDK 57 Gradle wrapper (9.3.1) cannot run on the
#     host default JDK 26 (Gradle >= 9.4.0 required for JVM 26).
#   * ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
#   * AVD `glass` (android-36, arm64, 4 KB pages, Chrome present).
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

HARNESS_HOME="${HARNESS_HOME:-/tmp/hermes-pkce-harness}"
AVD="${AVD:-glass}"
PORT="${PORT:-9119}"
USERNAME="${HERMES_USER:-hermes-mobile}"
PASSWORD="${HERMES_PW:-pkce-harness-pw}"
TTL="${TTL:-120}"   # access-token TTL in seconds; makes the expiry step cheap
HERE="$(cd "$(dirname "$0")" && pwd)"

write_config() {
  mkdir -p "$HARNESS_HOME"
  cat > "$HARNESS_HOME/config.yaml" <<YAML
# Throwaway isolated home for the PKCE prototype. Never point a real client at it.
dashboard:
  # A non-loopback public_url is what engages the auth gate on a loopback bind:
  # should_require_dashboard_auth() = non-loopback bind OR non-loopback public_url.
  # It also allows the emulator's host alias (10.0.2.2) through the Host guard.
  public_url: "http://10.0.2.2:${PORT}"
  basic_auth:
    username: "${USERNAME}"
    password: "${PASSWORD}"          # hashed in memory at load; password_hash preferred in production
    secret: "harness-secret-0123456789abcdef"
    session_ttl_seconds: ${TTL}
YAML
}

case "${1:-}" in
  serve)
    write_config
    HERMES_HOME="$HARNESS_HOME" ~/.local/bin/hermes serve --port "$PORT" --host 127.0.0.1 --skip-build
    ;;
  emulator)
    if ! adb devices | grep -q emulator; then
      nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect \
        > "/tmp/$AVD-emulator.log" 2>&1 &
    fi
    adb wait-for-device
    until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
    adb shell getprop ro.build.version.release
    ;;
  app)
    # The device dials the host's loopback; the gate accepts Host 127.0.0.1 on a loopback bind.
    adb reverse "tcp:$PORT" "tcp:$PORT"
    adb reverse --list
    cd "$HERE" && npx expo run:android
    ;;
  probe)
    adb reverse "tcp:$PORT" "tcp:$PORT"
    adb shell "(printf 'GET /api/status HTTP/1.1\r\nHost: 127.0.0.1:$PORT\r\nConnection: close\r\n\r\n'; sleep 2) | nc -w 5 127.0.0.1 $PORT | head -c 300; echo"
    ;;
  down)
    adb emu kill || true
    pkill -f "HERMES_HOME=$HARNESS_HOME" || true
    ~/.local/bin/hermes serve --stop || true
    ;;
  *)
    sed -n '2,20p' "$0"
    exit 1
    ;;
esac
