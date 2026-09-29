#!/bin/sh
# Read-only checks for the Mac-local HAPI option. It never prints the token.
set -eu
home="${HAPI_LOCAL_HOME:-$HOME/.hapi-mac-local}"
url="${HAPI_LOCAL_URL:-http://127.0.0.1:3016}"
"$HOME/.local/bin/hapi-local" status
python3 - "$home" "$url" <<'PY'
import json
import os
import sys
import urllib.request

home, url = sys.argv[1:]
with open(os.path.join(home, 'settings.json'), encoding='utf-8') as file:
    token = json.load(file)['cliApiToken']
request = urllib.request.Request(
    f'{url}/api/auth',
    data=json.dumps({'accessToken': token}).encode(),
    headers={'Content-Type': 'application/json'},
)
with urllib.request.urlopen(request, timeout=5) as response:
    assert response.status == 200 and json.loads(response.read())['token']
primary = os.path.realpath(os.path.expanduser('~/.hapi'))
local = os.path.realpath(home)
assert primary != local and not local.startswith(primary + os.sep)
assert os.path.isfile(os.path.join(home, 'settings.json'))
assert not os.path.islink(os.path.join(home, 'settings.json'))
print('local_auth=ok stores_distinct=ok local_settings_regular=ok')
PY
index_html="$(curl -fsS --max-time 5 "$url/")"
printf '%s' "$index_html" | grep -q '<!doctype html\|<!DOCTYPE html'
echo 'ui_http=200'
asset_path="$(printf '%s' "$index_html" | sed -n 's|.*src="\(/assets/[^"]*\)".*|\1|p' | head -n 1)"
[ -n "$asset_path" ]
curl -fsS -o /dev/null -w 'ui_asset_http=%{http_code}\n' --max-time 5 "$url$asset_path"
uid="$(id -u)"
printf 'local_hub_pid='
launchctl print "gui/$uid/com.hapi.mac-local-hub" | awk '/pid =/{print $3; exit}'
printf 'local_runner_pid='
launchctl print "gui/$uid/com.hapi.mac-local-runner" | awk '/pid =/{print $3; exit}'
