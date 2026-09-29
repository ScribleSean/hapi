# macOS runner release replacement

This is a prepared, Mac-side deployment script for replacing only the existing
`com.hapi.runner` LaunchAgent executable. It is inactive unless called with
`--deploy` or `--rollback`.

It preserves the existing LaunchAgent environment exactly, including the remote
hub URL and local authentication settings, because it edits only
`ProgramArguments`. It does not read or print those environment values. The
current runner arguments after `runner` are retained, including its workspace
root restriction.

Before an authorized deployment, stage the compiled ARM64 binary somewhere
outside Documents, for example `/tmp/hapi-custom`, then run on the Mac:

```sh
./replace-runner.sh --dry-run /tmp/hapi-custom
./replace-runner.sh --deploy /tmp/hapi-custom
```

The deployed binary is copied to
`~/.local/share/hapi-runner-releases/20260928/hapi-custom`. The original plist
is retained beside it as `rollback/com.hapi.runner.plist`; rollback restores it
and reboots only the runner service:

```sh
./replace-runner.sh --rollback
```

The script never invokes `hapi runner start`, `hapi doctor clean`, or any
per-session stop command. It bootouts only `com.hapi.runner`, waits for that
runner PID to exit, and bootstraps the replacement. The runner's graceful
shutdown path releases its hub connection and control server without asking
tracked native wrappers to stop. The script does not claim to prove every
native wrapper is healthy afterward; a future operator must check the runner
and session state before using the new release.
