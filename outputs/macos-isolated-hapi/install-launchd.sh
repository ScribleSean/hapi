#!/bin/sh
# Prepared example only. Default mode is a no-write, no-start dry run.
set -eu

mode="dry-run"
if [ "${1:-}" = "--install" ]; then
    mode="install"
elif [ "${1:-}" != "" ] && [ "${1:-}" != "--dry-run" ]; then
    echo "Usage: $0 [--dry-run|--install]" >&2
    exit 64
fi

# Intentionally do not read ambient HAPI_HOME: on this Mac it belongs to the
# existing live runner connected to the Windows hub.
hapi_home_input="${HAPI_LOCAL_HOME:-$HOME/.hapi-mac-local}"
workspace_root_input="${HAPI_WORKSPACE_ROOT:-}"
hapi_port="${HAPI_LOCAL_PORT:-3016}"
primary_port="${HAPI_PRIMARY_PORT:-3006}"
hapi_bin="${HAPI_BIN:-}"
launch_dir="$HOME/Library/LaunchAgents"
hub_label="com.hapi.isolated-local-hub"
runner_label="com.hapi.isolated-local-runner"
uid="$(id -u)"

case "$hapi_port" in ''|*[!0-9]*) echo "HAPI_LOCAL_PORT must be numeric" >&2; exit 64 ;; esac
case "$primary_port" in ''|*[!0-9]*) echo "HAPI_PRIMARY_PORT must be numeric" >&2; exit 64 ;; esac
if [ "$hapi_port" -lt 1 ] || [ "$hapi_port" -gt 65535 ]; then
    echo "HAPI_LOCAL_PORT must be between 1 and 65535" >&2
    exit 64
fi
if [ "$hapi_port" = "$primary_port" ]; then
    echo "HAPI_LOCAL_PORT must differ from the primary HAPI port ($primary_port)" >&2
    exit 64
fi
if [ -z "$workspace_root_input" ]; then
    echo "Set HAPI_WORKSPACE_ROOT to a specific Mac development directory." >&2
    exit 64
fi
if [ -z "$hapi_bin" ]; then
    hapi_bin="$(command -v hapi || true)"
fi
if [ -z "$hapi_bin" ] || [ ! -x "$hapi_bin" ]; then
    echo "Set HAPI_BIN to the executable to use for this isolated instance." >&2
    exit 66
fi

# Resolve symlinks before comparing paths. Python 3 and plistlib are included
# with supported macOS developer setups and avoid unsafe XML interpolation.
resolved="$(python3 - "$hapi_home_input" "$workspace_root_input" "$HOME" <<'PY'
import os
import sys

home_input, workspace_input, user_home = sys.argv[1:]
local_home = os.path.realpath(os.path.abspath(os.path.expanduser(home_input)))
workspace = os.path.realpath(os.path.abspath(os.path.expanduser(workspace_input)))
default_hapi = os.path.realpath(os.path.join(os.path.expanduser(user_home), '.hapi'))
user_home = os.path.realpath(os.path.expanduser(user_home))

if local_home == default_hapi or local_home.startswith(default_hapi + os.sep):
    raise SystemExit('HAPI_LOCAL_HOME must not be ~/.hapi or a path inside it')
if not os.path.isdir(workspace):
    raise SystemExit('HAPI_WORKSPACE_ROOT must be an existing directory')
if workspace == user_home:
    raise SystemExit('HAPI_WORKSPACE_ROOT must be a specific development directory, not $HOME')
print(local_home)
print(workspace)
PY
)"
old_ifs="$IFS"
IFS='
'
set -- $resolved
IFS="$old_ifs"
hapi_home="$1"
workspace_root="$2"
hub_plist="$launch_dir/$hub_label.plist"
runner_plist="$launch_dir/$runner_label.plist"

show_plan() {
    cat <<EOF
Prepared isolated HAPI configuration (nothing started):
  HAPI_LOCAL_HOME:  $hapi_home
  Workspace root:   $workspace_root
  Hub URL:          http://127.0.0.1:$hapi_port
  Hub label:        $hub_label
  Runner label:     $runner_label
  HAPI executable:  $hapi_bin
  Relay:            disabled
  Existing ~/.hapi: untouched

To write and start these new LaunchAgents later, run:
  $0 --install
EOF
}

if [ "$mode" = "dry-run" ]; then
    show_plan
    exit 0
fi

# Refuse before writing anything if either service or its plist already exists.
for plist in "$hub_plist" "$runner_plist"; do
    label="$(basename "$plist" .plist)"
    if [ -e "$plist" ]; then
        echo "LaunchAgent file already exists: $plist; refusing to replace it" >&2
        exit 73
    fi
    if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
        echo "LaunchAgent already loaded: $label; refusing to replace it" >&2
        exit 73
    fi
done

mkdir -p "$launch_dir" "$hapi_home/logs"
HAPI_HOME_OUT="$hapi_home" HAPI_PORT_OUT="$hapi_port" HAPI_BIN_OUT="$hapi_bin" \
WORKSPACE_ROOT_OUT="$workspace_root" HUB_PLIST_OUT="$hub_plist" RUNNER_PLIST_OUT="$runner_plist" \
HUB_LABEL_OUT="$hub_label" RUNNER_LABEL_OUT="$runner_label" python3 - <<'PY'
import os
import plistlib

home = os.environ['HAPI_HOME_OUT']
port = os.environ['HAPI_PORT_OUT']
binary = os.environ['HAPI_BIN_OUT']
workspace = os.environ['WORKSPACE_ROOT_OUT']

def plist(label, arguments, environment, log_name):
    return {
        'Label': label,
        'ProgramArguments': arguments,
        'EnvironmentVariables': environment,
        'RunAtLoad': True,
        'KeepAlive': True,
        'StandardOutPath': os.path.join(home, 'logs', log_name),
        'StandardErrorPath': os.path.join(home, 'logs', log_name),
    }

hub = plist(os.environ['HUB_LABEL_OUT'], [binary, 'hub'], {
    'HAPI_HOME': home,
    'HAPI_LISTEN_HOST': '127.0.0.1',
    'HAPI_LISTEN_PORT': port,
}, 'local-hub.log')
runner = plist(os.environ['RUNNER_LABEL_OUT'], [binary, 'runner', 'start-sync', '--workspace-root', workspace], {
    'HAPI_HOME': home,
    'HAPI_API_URL': f'http://127.0.0.1:{port}',
    'HAPI_RUNNER_SUPERVISED': '1',
}, 'local-runner.log')

for path, value in ((os.environ['HUB_PLIST_OUT'], hub), (os.environ['RUNNER_PLIST_OUT'], runner)):
    with open(path, 'wb') as file:
        plistlib.dump(value, file, sort_keys=False)
PY

launchctl bootstrap "gui/$uid" "$hub_plist"
launchctl bootstrap "gui/$uid" "$runner_plist"
echo "Started isolated local hub and runner. Existing ~/.hapi was not modified."
