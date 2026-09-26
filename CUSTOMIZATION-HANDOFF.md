# Custom HAPI continuation

Checkpoint: September 25, 2026. Branch `feature/unified-workspace-20260925`, based on upstream `97cf69b` (0.30.7). The fork's main branch may contain newer upstream changes; this feature branch preserves the tested deployment baseline. Do not assume it has been rebased onto main.

## Implemented

- Copilot mode changes use the exact advertised ACP identifier, accepting the standard session-mode URI as well as legacy short IDs. This fixes startup failure on a CLI that rejects `agent` and requires its full URI. An unavailable requested mode fails explicitly instead of substituting another permission/agent mode. See the [ACP session-mode contract](https://agentclientprotocol.com/protocol/v1/session-modes).
- Session rows expose reasoning controls on desktop hover/focus and touch. The list also offers a bulk reasoning preview with selection, exact-level eligibility, per-session outcomes and no automatic resume. Codex/OpenCode use reasoning endpoints; Claude/Grok/Pi use effort endpoints; Cursor uses advertised same-model variants while preserving speed/context parameters. Unknown capabilities, offline sessions, changed models and unsupported harnesses are skipped explicitly. Ambiguous writes are not retried.
- Models & connections overview lists current session models, effort, host and runner connectivity, queries installed agents on demand, and surfaces a recent agent-reported authentication failure. It does not equate runner connectivity or installed executables with live provider authentication/allowance. Source tests and 1280px/390px live browser checks covered both panels without changing session model settings.
- Model settings have persistent Models / Effort & speed / All settings navigation on desktop and mobile, and the settings entry point survives hidden-toolbar preferences. Existing per-harness catalogs and capability checks still govern available choices. Codex Fast also recognizes the native priority tier without requiring a display-name alias. Live Codex catalog and 1280px/390px browser checks confirmed Ultra and Fast are reachable; other harnesses retain their existing discovery and mutation paths, not newly verified provider entitlements.
- Flat Bots sidebar by default, with machine filters, existing names and pinned/recent ordering. Display settings can restore folder grouping.
- Browse defaults to a project home organized by agent. Existing project paths come from session metadata and remain unchanged. All folders retains the original browser. New project names suggest `AI-Projects/<agent>/<name>` below the selected workspace root, then open the existing setup form for review.
- Consecutive tool-only and reasoning messages share a collapsed Activity disclosure. User messages, text replies, pending questions/approvals and generated media remain visible. Details are retained, not removed.
- Ordinary composer sends prefer steering where supported and active. Save once, then steer the saved message. Failed steering does not resend. Scheduled sends, explicit queue, scratchlists and retry semantics remain unchanged.
- The hub now assigns missing message IDs and defaults immediate sends without an explicit queue preference to native steering for supported remote sessions. This covers already-running peer CLI/MCP clients that send only text. Explicit queue, schedules and capability boundaries are preserved. The source CLI consumes the hub's delivery receipt without sending a second steer; its old-hub fallback remains save-once/steer-once. Never describe failed or ambiguous steering as confirmed or resend blindly.

## Deployment boundary

The web changes and patched hub are deployed on an existing Windows-hosted private installation. A separately compiled hub runs on loopback 3006; Caddy on loopback 3007 serves the custom web build and proxies API/WebSocket traffic. A separate compiled Windows CLI now runs the runner and future agent launches to load the Copilot fix; ten pre-existing HAPI agent processes survived that runner replacement. Mac runner/native client binaries remain unchanged. Windows login startup selects both patched executables.

The hub deployment makes steering the default for existing Windows/Mac peer clients without relaunching agents. All seven active sessions reconnected, the private HTTPS health check passed, and Windows startup now selects the patched hub. An installed MCP peer-send self-test reached an active Codex turn automatically: exactly one user row, a non-null ID, an invocation receipt, and no queued or indeterminate copy. CLI receipt improvements load in new Windows processes; older in-process MCP servers may still report only "Delivered". No separate live Mac-origin model turn or unsupported-provider steering was tested. Existing duplicate historical rows were not deleted or replayed.

Cursor browser authentication was renewed and its existing bot reconnected. Copilot browser authentication completed, the patched runner connected the bot returned by HAPI's resume API, and a normal assistant reply was observed. Cursor also processed user messages and approval requests. Default approval-required permissions were preserved; no paid fallback or billing setting was added. Sign-in and observed replies are not a claim about remaining allowance.

Private host paths, startup configuration and personal context belong in the owner's private context repository, not here. No session databases, provider logins, raw chat exports, browser state, local logs, generated assets or credentials should be committed.

## Verification

Web TypeScript and focused suites covering sidebar, composer steering, acknowledgement races, project paths, collapsed activity, reasoning and transcript rewind passed. Production web build passed under Node 22.22.0. Existing font/chunk/PWA warnings remain. Live desktop and 390px mobile-width checks covered the sidebar, projects and steering; the latest Activity refinement was checked in the browser, not independently on a physical iPhone.

For CLI changes, run `bun run --cwd cli typecheck` and focused Vitest tests for `src/modules/pingPeer/pingPeer.test.ts` and `src/commands/pingPeer.test.ts`. CLI test setup starts an isolated test hub; it must not use production credentials or data. See AGENTS.md and package README files for the normal checks.

Hub and CLI TypeScript passed. The latest peer-focused run passed 32 CLI tests and 36 hub route/steering tests, covering legacy text-only sends, stable IDs, one steering path for Pi, stale thinking metadata, already-invoked delivery, explicit queue/schedules, capability gates and ambiguous acknowledgements without resend. The broader message-service run passed its delivery assertions but has one Windows EBUSY failure while deleting a temporary SQLite restart-test directory; do not report that broader suite as fully passing. A compiled hub also passed isolated startup/authentication checks before activation.

The Copilot follow-up passed 65 focused tests across the launcher, backend configuration and ACP SDK adapter, plus CLI TypeScript and the Windows executable build. Fixtures cover mode IDs returned by both new/load session, all three Copilot modes, malformed metadata and refusing an unavailable mode. Live provider logs confirmed the URI mode was accepted; the connected bot then returned a reply.

## Pending

1. Preserve the hub steering default during upgrades. True native steering is available for Codex, Pi and Cursor ACP; unsupported harnesses retain normal delivery. A provider upgrade needs its own capability and receipt checks. Do not promise steering for Claude from this change.
2. Shared UI preferences: currently browser-local. Implement authenticated, namespace-scoped allowlisted preference sync; never sync all localStorage because it contains credentials and transient state.
3. Embedded browser: feasibility discussed only. First verify a supported browser-control tool, then evaluate a reusable remote-browser viewer. No browser service has been added.
4. Preserve current project files; no bulk folder migration. Project home only indexes known session paths, not every repository on disk.

### Peer delivery observation to verify

Reported around 02:10 UTC on September 26, 2026: one MCP peer-send call per target appeared twice as identical user messages when later inspected on both a Mac-owned and Windows-owned Codex session. Read-only receipts showed web-origin rows with null localId paired with CLI-origin user rows with generated IDs. The shared Codex adapter generates an ID when ingress supplies none, preventing echo reconciliation. The hub now supplies that ID before emitting; the live self-test produced one consumed row. This establishes the duplicate storage cause, not that the previous messages caused duplicate model execution.

For future regressions, correlate message IDs, native receipts and sender call counts before retrying. Require one logical user message and at most one invocation per send. Do not resend original coordination messages, restart unrelated sessions, or publish raw message contents, credentials or runtime databases.

Resume by reading AGENTS.md, this file and the relevant changed module. Inspect Git and runtime state before edits. Source availability is not proof that a running host loaded the change.
