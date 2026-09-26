# Custom HAPI continuation

Checkpoint: September 25, 2026. Branch `feature/unified-workspace-20260925`, based on upstream `97cf69b` (0.30.7). The fork's main branch may contain newer upstream changes; this feature branch preserves the tested deployment baseline. Do not assume it has been rebased onto main.

## Implemented

- Session rows expose reasoning controls on desktop hover/focus and touch. The list also offers a bulk reasoning preview with selection, exact-level eligibility, per-session outcomes and no automatic resume. Codex/OpenCode use reasoning endpoints; Claude/Grok/Pi use effort endpoints; Cursor uses advertised same-model variants while preserving speed/context parameters. Unknown capabilities, offline sessions, changed models and unsupported harnesses are skipped explicitly. Ambiguous writes are not retried.
- Models & connections overview lists current session models, effort, host and runner connectivity, queries installed agents on demand, and surfaces a recent agent-reported authentication failure. It does not equate runner connectivity or installed executables with live provider authentication/allowance. Source tests and 1280px/390px live browser checks covered both panels without changing session model settings.
- Model settings have persistent Models / Effort & speed / All settings navigation on desktop and mobile, and the settings entry point survives hidden-toolbar preferences. Existing per-harness catalogs and capability checks still govern available choices. Codex Fast also recognizes the native priority tier without requiring a display-name alias. Live Codex catalog and 1280px/390px browser checks confirmed Ultra and Fast are reachable; other harnesses retain their existing discovery and mutation paths, not newly verified provider entitlements.
- Flat Bots sidebar by default, with machine filters, existing names and pinned/recent ordering. Display settings can restore folder grouping.
- Browse defaults to a project home organized by agent. Existing project paths come from session metadata and remain unchanged. All folders retains the original browser. New project names suggest `AI-Projects/<agent>/<name>` below the selected workspace root, then open the existing setup form for review.
- Consecutive tool-only and reasoning messages share a collapsed Activity disclosure. User messages, text replies, pending questions/approvals and generated media remain visible. Details are retained, not removed.
- Ordinary composer sends prefer steering where supported and active. Save once, then steer the saved message. Failed steering does not resend. Scheduled sends, explicit queue, scratchlists and retry semantics remain unchanged.
- CLI/MCP peer messaging now attempts the same save-once/steer sequence for thinking, supported peers. Acknowledgements distinguish steered, already invoked and saved without steering confirmation. Idle/unsupported targets use normal delivery. Never describe failed or ambiguous steering as confirmed.

## Deployment boundary

The web changes are deployed on an existing Windows-hosted private installation. The official hub remains on loopback 3006; a separate Caddy frontend on loopback 3007 serves the custom web build and proxies API/WebSocket traffic to the hub. Native client binaries were not rebuilt.

The new CLI peer-steering change is source work, not yet installed into the running Windows/Mac CLI/MCP processes. Updating the web alone cannot activate it. Coordinate a safe CLI rollout on both hosts after active work is checkpointed; preserve the existing hub database and credentials. Do not restart unrelated agents to deploy this branch.

Private host paths, startup configuration and personal context belong in the owner's private context repository, not here. No session databases, provider logins, raw chat exports, browser state, local logs, generated assets or credentials should be committed.

## Verification

Web TypeScript and focused suites covering sidebar, composer steering, acknowledgement races, project paths, collapsed activity, reasoning and transcript rewind passed. Production web build passed under Node 22.22.0. Existing font/chunk/PWA warnings remain. Live desktop and 390px mobile-width checks covered the sidebar, projects and steering; the latest Activity refinement was checked in the browser, not independently on a physical iPhone.

For CLI changes, run `bun run --cwd cli typecheck` and focused Vitest tests for `src/modules/pingPeer/pingPeer.test.ts` and `src/commands/pingPeer.test.ts`. CLI test setup starts an isolated test hub; it must not use production credentials or data. See AGENTS.md and package README files for the normal checks.

CLI TypeScript passed and those 29 focused tests passed at this checkpoint, including successful steering, an already-invoked race, rejection and timeout without duplicate sends.

## Pending

1. Install and verify peer-steering changes on both execution hosts; test supported active, idle and unsupported peers without duplicate delivery. Include the reported duplicate-message observation below.
2. Shared UI preferences: currently browser-local. Implement authenticated, namespace-scoped allowlisted preference sync; never sync all localStorage because it contains credentials and transient state.
3. Embedded browser: feasibility discussed only. First verify a supported browser-control tool, then evaluate a reusable remote-browser viewer. No browser service has been added.
4. Preserve current project files; no bulk folder migration. Project home only indexes known session paths, not every repository on disk.

### Peer delivery observation to verify

Reported around 02:10 UTC on September 26, 2026: one MCP peer-send call per target appeared twice as identical user messages when later inspected on both a Mac-owned and Windows-owned Codex session. The reporter observed one sender call per target and no ambiguous retry. This is an unverified observation, not evidence yet of duplicate persistence or execution.

At the next safe peer-steering verification, first inspect existing receipts read-only. Correlate the single sender invocation and localId with hub message IDs/sequences, native thread entries, any import/echo reconciliation, inspect-peer output, and rendered rows. Determine whether duplication occurs in storage, history reconciliation, inspection/rendering, or actual model invocation. Check installed CLI/MCP versions against the persist-once/steer source change; prior unit tests do not establish the deployed behavior. Use isolated fixtures for reproduction, including active steering, idle delivery, reconnect/replay and timeout paths. Require one logical user message and at most one invocation per send. Do not resend the original coordination message, restart unrelated sessions, or publish raw message contents, credentials or runtime databases.

Resume by reading AGENTS.md, this file and the relevant changed module. Inspect Git and runtime state before edits. Source availability is not proof that a running host loaded the change.
