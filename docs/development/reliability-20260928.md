# Reliability repair, September 28, 2026

September 29 continuation: [Burn mode and rollout evidence](burn-mode.md) records the shared toggle, exact restoration, file/folder-link integration and accepted Windows/Mac-local deployment. Mac launcher activation is now accepted after the earlier rollback described below. Loaded native wrappers still require their own safe idle adoption; no fleet-wide steering acceptance is implied.

This branch keeps existing shared native Codex thread identities while improving cold resume and bot controls. It excludes the unfinished experimental task/model picker in the separate development checkout.

## Behavior

- Cold resume requests native thread metadata without embedding the entire transcript. Paginated threads replay bounded turn/item pages, with cursor-cycle guards and a visible syncing/error state. Prompts wait for initial history synchronization. Legacy full-thread responses remain supported for non-paginated servers.
- Codex model-provider metadata survives cold resume, including explicit local-provider selection. Explicit launch flags take precedence over stored metadata.
- Native goal snapshots and updates persist into HAPI state. A collapsed goal summary can be shown independently of tool activity. Existing wrappers need to reconnect using the updated CLI before they publish these fields.
- Selecting a disconnected, resumable bot makes one connection attempt when its owning runner is available. Intentionally archived bots are not reopened automatically. Concurrent send/upload actions share the same connection attempt.
- Per-bot and bulk controls separate reasoning from speed. Bulk selection supports search, provider filtering and checkboxes. Capability checks run before preview and again before applying each change. Unsupported/offline targets are skipped explicitly. Speed is shown as unavailable where a harness does not expose it.
- Mobile dialogs retain visible actions and a scrolling bot list; dark-mode buttons use the application theme colors.
- A partial scheduled-message index prevents aggregate queries from scanning the unscheduled transcript. It is additive and preserves schema version 26.

## Verification

- CLI, web, hub and relay typechecks passed.
- Shared tests: 323 passed.
- New bounded-history, root projection, provider restoration, goal and relevant permission tests passed in the CLI suite.
- Focused web control/reconnect/goal checks: 15 passed; the later unsupported-speed label check passed in its 7-test component suite.
- A full web run with three workers passed 3,292 tests and failed 12 tests in one stale mobile fixture. That fixture was corrected to supply the runtime thread message array; its two affected suites then passed all 43 tests.
- Windows CLI, Windows hub, macOS ARM64 CLI and production web assets built. The cross-compiled macOS binary required local ad-hoc signing before its version check succeeded.
- A scratch hub survived an abrupt Windows process restart with an online SQLite backup, integrity check, authenticated state reads and an unchanged fixture message. Native permission settings were checked on a disposable thread without a model turn.
- Actual deployed bot controls and a native goal summary were inspected without applying user settings. Two previously failing large-history sessions reconnected and completed synchronization. A local-model session reconnected with its Ollama provider preserved and completed its bounded text-only test in the original HAPI/native thread.

The complete test suite is not green: the Windows CLI run has 29 failures, the hub run 21, and relay one. Recorded failures concern platform/path/symlink assumptions, SQLite cleanup, process/fixture timing and voice environment fixtures. They have not all been independently reproduced on an unchanged baseline; focused passing checks are not a claim that every regression is excluded.

## Deployment and boundaries

The web frontend and versioned Windows hub/runner and Mac runner were updated. Existing native sessions were preserved during infrastructure replacement; already-running wrappers retain their previous loaded code until a controlled reconnect. The Windows hub replacement used a precise process stop after an online database backup, not a graceful signal shutdown.

One primary hub remains authoritative. Windows login recovery starts only missing infrastructure and does not send model requests. Screen lock can preserve hosting; sleep, logout and shutdown interrupt it. A physical reboot test remains outstanding. An independent Mac-local fallback was installed with separate storage and a dedicated all-in-one executable. Its hub health, runner, authentication, UI HTML and bundled JavaScript checks passed without replacing the primary runner or native sessions. It is not a replicated live database; local browser sign-in and a physical cold-login test remain unverified.

Provider login, tool connections, operating-system file access and GUI consent remain host-specific. These changes do not promise tool parity across harnesses or live Codex Desktop UI synchronization. No provider credentials, runtime databases, transcripts or private project state belong in this branch.

## Inactive-session resume follow-up

Concurrent ordinary resume requests now share one hub operation, preventing two clients from launching competing native writers. The hub checks namespace access before joining that operation and releases it after success or failure. Existing PTY and Pi ownership/quarantine behavior remains intact.

A bot opened while its owner is offline can make its first automatic connection attempt when that owner returns. Failed actual attempts do not loop. Delayed send/upload continuation preserves the draft handoff but cannot navigate over a later route visit. Confirmed resumes clear stale archived presentation without inventing a running lifecycle state.

Verification: the old implementation failed three new concurrency regressions by spawning twice. All six new hub regressions, 78 existing resume/permission/migration checks, 50 focused web tests, hub/web typechecks and the production web build passed. The shared Windows hub and web were updated; all 31 existing wrapper/runner processes and the coordinator's native Codex process survived. The live private web index matched the built output and returned HTTP 200. A separately attempted isolated executable startup check was blocked by automatic policy before execution; live deployment health and access-control checks passed independently. No model turn or queued-message replay was used for this follow-up.

The isolated Mac-local fallback also received this hub/web build after confirming no active local sessions. Its signature/version, hub, runner, authentication, UI and embedded asset checks passed; primary settings and native processes were preserved. This does not add live replication between hubs.

## Steering follow-up, September 29

Queued-message steering now waits for previously scheduled ingress, reads one bounded native history-head page and refreshes the expected active turn before dispatch. The turn-revision guard preserves newer native start/completion notifications. A definite rejection restores the same queue entry and message identity; uncertain transport delivery remains quarantined. There is no automatic resend or duplicate user message.

The original stale-turn regression failed against the previous implementation. All 44 focused root, queue and history tests passed in the release checkout using its normal Vitest setup; the CLI typecheck and Windows/macOS ARM64 executable builds passed. Independent review found no material issue. These checks do not establish end-to-end delivery in an already-running bot.

The Windows launcher was updated while preserving existing native sessions. The repair serves mobile and desktop through the same CLI connection. Already-loaded wrappers retain their old code until a controlled reconnect. The coordinator's current connection is deliberately preserved while its turn is active; its idle-boundary adoption and original saved-message delivery must be verified separately, without replaying requests or removing queued messages.

The signed Mac steering binaries are staged but activation is not accepted: launchd rejected bootstrap with error 5, including after correcting an executable-array edit. The prior shared runner and isolated local hub/runner were restored and verified healthy. Native sessions and settings were preserved. Resolve that launchd rejection before claiming the Mac launchers include this steering repair.
