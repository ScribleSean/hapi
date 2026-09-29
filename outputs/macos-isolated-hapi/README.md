# Mac-local HAPI fallback

`install-launchd.sh` installs a separate Mac-local hub and runner without
altering the Windows-connected `~/.hapi` or `com.hapi.runner`. It uses
`~/.hapi-mac-local`, binds the hub to `http://127.0.0.1:3016`, runs with
`--no-relay`, and owns only `com.hapi.mac-local-hub` and
`com.hapi.mac-local-runner`.

The defaults require the versioned executable at
`~/.local/share/hapi-runner-releases/20260928/hapi-custom`, the workspace
`~/Developer`, and matching UI assets at
`~/.local/share/hapi-mac-local-web/20260928/web/dist`. Override the last path
with `HAPI_LOCAL_WEB_ROOT` when needed. The installer rejects `~/.hapi`,
paths inside it, invalid or conflicting ports, a home-wide workspace, missing
assets, and a non-executable binary.

Run without arguments for a no-write preview, then use `--install`. The local
home and logs are mode `0700`; settings and log files are mode `0600`. The hub
creates its own local token before its runner starts. No live token, store, or
native identity is copied.

`~/.local/bin/hapi-local` has idempotent `status`, `start`, and `stop`
commands. `login` is explicit: it copies only the local token to the Mac
clipboard and prints the local URL. `verify-local.sh` performs read-only hub,
local-runner, local-auth, store-isolation, and UI HTTP checks without printing
the token.

This local identity cannot resume Windows-owned HAPI/Codex sessions. Keep the
two hub URLs separate in the client hub selector.
