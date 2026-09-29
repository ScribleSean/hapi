#!/bin/sh
# Prepared deployment only. Default mode makes no changes.
set -eu

label="com.hapi.runner"
version="${HAPI_RELEASE_VERSION:-20260928}"
release_root="$HOME/.local/share/hapi-runner-releases/$version"
release_binary="$release_root/hapi-custom"
backup_plist="$release_root/rollback/$label.plist"
plist="$HOME/Library/LaunchAgents/$label.plist"
uid="$(id -u)"
mode="dry-run"
artifact="${HAPI_RELEASE_ARTIFACT:-}"

usage() {
    echo "Usage: $0 [--dry-run|--deploy] <staged-arm64-hapi> | --rollback" >&2
    exit 64
}

case "${1:-}" in
    --rollback) mode="rollback"; shift ;;
    --deploy) mode="deploy"; shift ;;
    --dry-run) mode="dry-run"; shift ;;
    '') ;;
    *) usage ;;
esac
if [ "$mode" != "rollback" ] && [ "${1:-}" != "" ]; then
    artifact="$1"
    shift
fi
[ "${1:-}" = "" ] || usage

require_live_plist() {
    [ -r "$plist" ] || { echo "Missing LaunchAgent plist: $plist" >&2; exit 66; }
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || {
        echo "Runner LaunchAgent is not loaded: $label" >&2
        exit 69
    }
}

require_artifact() {
    [ -n "$artifact" ] || usage
    [ -f "$artifact" ] && [ -x "$artifact" ] || {
        echo "Staged artifact is not an executable file: $artifact" >&2
        exit 66
    }
    file "$artifact" | grep -q 'arm64' || {
        echo "Staged artifact is not an arm64 macOS executable" >&2
        exit 65
    }
}

runner_pid() {
    launchctl print "gui/$uid/$label" 2>/dev/null | awk '/^[[:space:]]*pid = [0-9]+/ { print $3; exit }'
}

wait_for_exit() {
    pid="$1"
    [ -n "$pid" ] || return 0
    count=0
    while kill -0 "$pid" 2>/dev/null; do
        count=$((count + 1))
        if [ "$count" -gt 50 ]; then
            echo "Runner PID $pid did not exit after launchctl bootout" >&2
            return 1
        fi
        sleep 0.2
    done
}

restore_and_bootstrap() {
    cp -p "$backup_plist" "$plist"
    launchctl bootstrap "gui/$uid" "$plist"
}

if [ "$mode" = "rollback" ]; then
    [ -r "$backup_plist" ] || { echo "No rollback plist: $backup_plist" >&2; exit 66; }
    require_live_plist
    old_pid="$(runner_pid)"
    launchctl bootout "gui/$uid/$label"
    wait_for_exit "$old_pid"
    restore_and_bootstrap
    echo "Restored the prior runner LaunchAgent. Native sessions were not stopped."
    exit 0
fi

require_live_plist
require_artifact
if [ "$mode" = "dry-run" ]; then
    cat <<EOF
Prepared runner-only replacement (nothing changed):
  LaunchAgent: $label
  Staged arm64 artifact: $artifact
  Versioned binary: $release_binary
  Rollback plist: $backup_plist
  Existing remote-hub environment: retained without printing it
  Existing runner arguments after 'runner': retained
EOF
    exit 0
fi

[ ! -e "$backup_plist" ] || {
    echo "Rollback backup already exists: $backup_plist; refusing to overwrite it" >&2
    exit 73
}
mkdir -p "$release_root/rollback"
cp -p "$artifact" "$release_binary"
chmod 755 "$release_binary"
cp -p "$plist" "$backup_plist"

# Keep every current runner argument from 'runner' onward and retain the
# complete EnvironmentVariables dictionary without reading it into shell.
candidate="$plist.release-$version"
RELEASE_BINARY="$release_binary" SOURCE_PLIST="$plist" CANDIDATE_PLIST="$candidate" python3 - <<'PY'
import os
import plistlib

source = os.environ['SOURCE_PLIST']
candidate = os.environ['CANDIDATE_PLIST']
binary = os.environ['RELEASE_BINARY']
with open(source, 'rb') as file:
    data = plistlib.load(file)
arguments = data.get('ProgramArguments')
if not isinstance(arguments, list) or 'runner' not in arguments:
    raise SystemExit('LaunchAgent has no recognizable runner ProgramArguments')
runner_index = arguments.index('runner')
data['ProgramArguments'] = [binary, *arguments[runner_index:]]
with open(candidate, 'wb') as file:
    plistlib.dump(data, file, sort_keys=False)
PY

old_pid="$(runner_pid)"
if ! launchctl bootout "gui/$uid/$label" || ! wait_for_exit "$old_pid"; then
    rm -f "$candidate"
    echo "Runner did not stop cleanly; original plist remains installed." >&2
    exit 1
fi

mv "$candidate" "$plist"
if ! launchctl bootstrap "gui/$uid" "$plist"; then
    echo "Replacement runner did not bootstrap; restoring previous LaunchAgent." >&2
    restore_and_bootstrap
    exit 1
fi
echo "Replacement runner bootstrapped. Verify its status before submitting work."
