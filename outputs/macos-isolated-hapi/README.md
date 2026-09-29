# Isolated macOS local HAPI example

This is a prepared, inactive example for a **new Mac-only HAPI instance**. It
does not alter the Mac's existing `~/.hapi`, existing runner, Windows-hub URL,
credentials, SQLite database, or native stores.

The default home is `~/.hapi-mac-local`; the default hub address is
`http://127.0.0.1:3016`. The hub deliberately has no `--relay` argument and
binds only to loopback. A private Tailscale endpoint, if wanted later, needs a
separate explicit exposure decision. This example does not configure one.

Set `HAPI_WORKSPACE_ROOT` to one specific existing Mac development directory.
The script refuses `$HOME` as a workspace root. It reads only
`HAPI_LOCAL_HOME`, never ambient `HAPI_HOME`, and rejects `~/.hapi`, all paths
inside it, and symlink aliases resolving there. `HAPI_LOCAL_PORT` defaults to
`3016` and must differ from `HAPI_PRIMARY_PORT` (default `3006`).

Run the script without arguments to review the exact intended launchd
configuration. It performs no writes and starts nothing. `--install` is the
only mode that writes the two LaunchAgents and bootstraps them.

```bash
./install-launchd.sh
./install-launchd.sh --install
```

`HAPI_LOCAL_HOME`, `HAPI_LOCAL_PORT`, and `HAPI_BIN` may be overridden only at
the future manual activation point. Both services receive the same isolated home,
so the runner uses the new local hub's generated configuration. No credentials
are copied from the live Mac runner.

This cannot resume or take over a Windows-owned HAPI/Codex session. Cold resume
requires the runner to have the same native `CODEX_HOME` and credentials as the
recorded session; the existing Mac identity remains attached to the Windows hub
until an operator intentionally changes it. Keep the old and new hubs separate
in the client hub selector.
