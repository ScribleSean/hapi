#!/bin/sh
set -eu
mode="dry-run"
if [ "${1:-}" = "--install" ]; then mode="install"
elif [ "${1:-}" != "" ] && [ "${1:-}" != "--dry-run" ]; then echo "Usage: $0 [--dry-run|--install]" >&2; exit 64; fi
hapi_home_input="${HAPI_LOCAL_HOME:-$HOME/.hapi-mac-local}"
workspace_root_input="${HAPI_WORKSPACE_ROOT:-$HOME/Developer}"
hapi_port="${HAPI_LOCAL_PORT:-3016}"; primary_port="${HAPI_PRIMARY_PORT:-3006}"
hapi_bin="${HAPI_BIN:-$HOME/.local/share/hapi-runner-releases/20260928/hapi-custom}"
web_root_input="${HAPI_LOCAL_WEB_ROOT:-$HOME/.local/share/hapi-mac-local-web/20260928}"
launch_dir="$HOME/Library/LaunchAgents"; bin_dir="$HOME/.local/bin"
hub_label="com.hapi.mac-local-hub"; runner_label="com.hapi.mac-local-runner"; uid="$(id -u)"
service_path="$bin_dir/hapi-local"; service_env=""
service_path_env="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
case "$hapi_port" in ''|*[!0-9]*) echo "HAPI_LOCAL_PORT must be numeric" >&2; exit 64;; esac
case "$primary_port" in ''|*[!0-9]*) echo "HAPI_PRIMARY_PORT must be numeric" >&2; exit 64;; esac
if [ "$hapi_port" -lt 1 ] || [ "$hapi_port" -gt 65535 ]; then echo "HAPI_LOCAL_PORT must be between 1 and 65535" >&2; exit 64; fi
if [ "$hapi_port" = "$primary_port" ]; then echo "HAPI_LOCAL_PORT must differ from primary port" >&2; exit 64; fi
if [ ! -x "$hapi_bin" ]; then echo "HAPI_BIN must name the signed, executable local release." >&2; exit 66; fi
resolved="$(python3 - "$hapi_home_input" "$workspace_root_input" "$HOME" "$hapi_bin" "$web_root_input" <<'PY'
import os, sys
home_input, workspace_input, user_home, binary_input, web_root_input = sys.argv[1:]
local_home = os.path.realpath(os.path.abspath(os.path.expanduser(home_input)))
workspace = os.path.realpath(os.path.abspath(os.path.expanduser(workspace_input)))
default_hapi = os.path.realpath(os.path.join(os.path.expanduser(user_home), '.hapi'))
user_home = os.path.realpath(os.path.expanduser(user_home))
binary = os.path.realpath(os.path.abspath(os.path.expanduser(binary_input)))
web_root = os.path.realpath(os.path.abspath(os.path.expanduser(web_root_input)))
if local_home == default_hapi or local_home.startswith(default_hapi + os.sep): raise SystemExit('HAPI_LOCAL_HOME must not be ~/.hapi or a path inside it')
if not os.path.isdir(workspace): raise SystemExit('HAPI_WORKSPACE_ROOT must be an existing directory')
if workspace == user_home: raise SystemExit('HAPI_WORKSPACE_ROOT must be a specific development directory, not $HOME')
if not os.path.isfile(binary) or not os.access(binary, os.X_OK): raise SystemExit('HAPI_BIN must resolve to an executable file')
if not os.path.isfile(os.path.join(web_root, 'web', 'dist', 'index.html')): raise SystemExit('HAPI_LOCAL_WEB_ROOT must contain web/dist/index.html')
print(local_home); print(workspace); print(binary); print(web_root)
PY
)"
old_ifs="$IFS"; IFS='
'; set -- $resolved; IFS="$old_ifs"
hapi_home="$1"; workspace_root="$2"; hapi_bin="$3"; web_root="$4"
service_env="$hapi_home/mac-local-launch.env"
hub_plist="$launch_dir/$hub_label.plist"; runner_plist="$launch_dir/$runner_label.plist"
if [ "$mode" = "dry-run" ]; then
cat <<EOF
Prepared Mac-local HAPI configuration (nothing started):
  HAPI_LOCAL_HOME:  $hapi_home
  Workspace root:   $workspace_root
  Hub URL:          http://127.0.0.1:$hapi_port
  Hub label:        $hub_label
  Runner label:     $runner_label
  HAPI executable:  $hapi_bin
  Web assets:       $web_root/web/dist
  Relay:            disabled (--no-relay)
  Existing ~/.hapi: untouched
EOF
exit 0
fi
mkdir -p "$launch_dir" "$bin_dir" "$hapi_home/logs"
chmod 700 "$hapi_home" "$hapi_home/logs"
for label in "$runner_label" "$hub_label"; do
if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then launchctl bootout "gui/$uid/$label"; fi
done
HAPI_HOME_OUT="$hapi_home" HAPI_PORT_OUT="$hapi_port" HAPI_BIN_OUT="$hapi_bin" WORKSPACE_ROOT_OUT="$workspace_root" WEB_ROOT_OUT="$web_root" HUB_PLIST_OUT="$hub_plist" RUNNER_PLIST_OUT="$runner_plist" HUB_LABEL_OUT="$hub_label" RUNNER_LABEL_OUT="$runner_label" PATH_OUT="$service_path_env" python3 - <<'PY'
import os, plistlib
home, port, binary, workspace, web_root, path = (os.environ[k] for k in ('HAPI_HOME_OUT','HAPI_PORT_OUT','HAPI_BIN_OUT','WORKSPACE_ROOT_OUT','WEB_ROOT_OUT','PATH_OUT'))
def plist(label, arguments, environment, log_name, working_directory):
 return {'Label': label, 'ProgramArguments': arguments, 'EnvironmentVariables': environment, 'WorkingDirectory': working_directory, 'RunAtLoad': True, 'KeepAlive': True, 'StandardOutPath': os.path.join(home, 'logs', log_name), 'StandardErrorPath': os.path.join(home, 'logs', log_name)}
shared = {'HAPI_HOME': home, 'HAPI_CLI_EXECUTABLE': binary, 'PATH': path}
hub = plist(os.environ['HUB_LABEL_OUT'], [binary, 'hub', '--no-relay'], {**shared, 'HAPI_LISTEN_HOST': '127.0.0.1', 'HAPI_LISTEN_PORT': port}, 'local-hub.log', web_root)
runner = plist(os.environ['RUNNER_LABEL_OUT'], [binary, 'runner', 'start-sync', '--workspace-root', workspace], {**shared, 'HAPI_API_URL': f'http://127.0.0.1:{port}', 'HAPI_RUNNER_SUPERVISED': '1'}, 'local-runner.log', workspace)
for file_path, value in ((os.environ['HUB_PLIST_OUT'], hub), (os.environ['RUNNER_PLIST_OUT'], runner)):
 with open(file_path, 'wb') as file: plistlib.dump(value, file, sort_keys=False)
PY
cat > "$service_env" <<EOF
HAPI_HOME='$hapi_home'
HAPI_API_URL='http://127.0.0.1:$hapi_port'
HAPI_CLI_EXECUTABLE='$hapi_bin'
HAPI_HUB_PLIST='$hub_plist'
HAPI_RUNNER_PLIST='$runner_plist'
HAPI_HUB_LABEL='$hub_label'
HAPI_RUNNER_LABEL='$runner_label'
HAPI_GUI_DOMAIN='gui/$uid'
EOF
chmod 600 "$service_env"
SERVICE_ENV_OUT="$service_env" SERVICE_PATH_OUT="$service_path" python3 - <<'PY'
import os
env_file, service_path = os.environ['SERVICE_ENV_OUT'], os.environ['SERVICE_PATH_OUT']
script = f'''#!/bin/sh
set -eu
. {env_file!r}
command="${{1:-status}}"
health() {{ curl -fsS --max-time 3 "$HAPI_API_URL/health" >/dev/null; }}
loaded() {{ launchctl print "$HAPI_GUI_DOMAIN/$1" >/dev/null 2>&1; }}
start() {{
 if ! loaded "$HAPI_HUB_LABEL"; then launchctl bootstrap "$HAPI_GUI_DOMAIN" "$HAPI_HUB_PLIST"; fi
 i=0; until health; do i=$((i + 1)); [ "$i" -lt 20 ] || {{ echo "Local hub did not become healthy" >&2; return 1; }}; sleep 1; done
 if ! loaded "$HAPI_RUNNER_LABEL"; then launchctl bootstrap "$HAPI_GUI_DOMAIN" "$HAPI_RUNNER_PLIST"; fi
 echo "Mac-local HAPI started: $HAPI_API_URL"
}}
stop() {{
 if loaded "$HAPI_RUNNER_LABEL"; then launchctl bootout "$HAPI_GUI_DOMAIN/$HAPI_RUNNER_LABEL"; fi
 if loaded "$HAPI_HUB_LABEL"; then launchctl bootout "$HAPI_GUI_DOMAIN/$HAPI_HUB_LABEL"; fi
 echo "Mac-local HAPI stopped"
}}
status() {{
 echo "Mac-local HAPI: $HAPI_API_URL"
 if health; then echo "Hub: healthy"; else echo "Hub: unavailable"; return 1; fi
 if HAPI_HOME="$HAPI_HOME" HAPI_API_URL="$HAPI_API_URL" HAPI_CLI_EXECUTABLE="$HAPI_CLI_EXECUTABLE" "$HAPI_CLI_EXECUTABLE" runner list >/dev/null 2>&1; then echo "Runner: online"; else echo "Runner: unavailable"; return 1; fi
}}
login() {{
 python3 - "$HAPI_HOME/settings.json" <<'PY2'
import json, subprocess, sys
with open(sys.argv[1], encoding='utf-8') as file: token = json.load(file).get('cliApiToken')
if not isinstance(token, str) or not token: raise SystemExit('Local token is unavailable; run hapi-local start and wait for the hub.')
subprocess.run(['pbcopy'], input=token.encode(), check=True)
PY2
 echo "Local token copied to the Mac clipboard. Open: $HAPI_API_URL"
}}
case "$command" in
status) status ;; start) start ;; stop) stop ;; login) login ;;
*) echo "Usage: hapi-local [status|start|stop|login]" >&2; exit 64 ;;
esac
'''
with open(service_path, 'w', encoding='utf-8') as file: file.write(script)
os.chmod(service_path, 0o700)
PY
launchctl bootstrap "gui/$uid" "$hub_plist"
i=0
until curl -fsS --max-time 3 "http://127.0.0.1:$hapi_port/health" >/dev/null; do
i=$((i + 1)); if [ "$i" -ge 20 ]; then launchctl bootout "gui/$uid/$hub_label" || true; echo "Local hub did not become healthy; runner was not started." >&2; exit 70; fi; sleep 1
done
i=0
until python3 - "$hapi_home/settings.json" <<'PY'
import json, sys
try:
 with open(sys.argv[1], encoding='utf-8') as file: assert isinstance(json.load(file).get('cliApiToken'), str)
except (OSError, ValueError, AssertionError): raise SystemExit(1)
PY
do
i=$((i + 1)); if [ "$i" -ge 20 ]; then launchctl bootout "gui/$uid/$hub_label" || true; echo "Local hub did not generate its local token; runner was not started." >&2; exit 70; fi; sleep 1
done
chmod 600 "$hapi_home/settings.json"
find "$hapi_home/logs" -type f -exec chmod 600 {} \;
launchctl bootstrap "gui/$uid" "$runner_plist"
echo "Started Mac-local hub and runner at http://127.0.0.1:$hapi_port. Existing ~/.hapi was not modified."
