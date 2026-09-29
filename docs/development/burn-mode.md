# Burn mode

Burn sits beside Models & connections. Enabling it requests Ultra reasoning and Fast service for connected Codex sessions whose current model advertises both capabilities. It does not change models, switch providers, resume paused work, or issue a model prompt. Other harnesses and unsupported models remain unchanged and appear in the results.

The hub stores this policy per authenticated namespace, so signed-in browsers share the switch and its results. Clients refresh every five seconds and on focus. The control reports pending, failed, blocked and unsupported targets separately; an enabled switch does not claim that every bot has applied the settings. Settings affect subsequent model requests.

Before the first native update, the hub saves that session's exact reasoning and tier, including null defaults. Disabling Burn restores those saved values. Offline sessions wait until reconnecting. Unconfirmed updates retain their restoration baseline, and failures offer an explicit retry. Toggling during restoration preserves unfinished baselines; sessions already restored can take a fresh baseline on the next activation.

Reconciliation uses existing authenticated session RPC and live model discovery. It limits concurrent work, coalesces heartbeat requests, checks the current policy again after asynchronous work, and prevents conflicting manual reasoning or speed changes while Burn controls a session. Policy updates use a revision check to resolve competing browser requests.

The SQLite tables are additive to schema version 26. Existing hub versions ignore them, allowing binary rollback without rewriting the conversation database. Keep an online database backup and the previous hub binary for deployment recovery.

## Verification boundaries

Focused tests cover the shared API, restoration and asynchronous reconciliation. The desktop and 390-pixel phone preview uses fictional sessions and the actual UI components, with no live model settings or provider calls. Live rollout must independently verify authenticated API access and matching served assets. A healthy hub or a passing preview is not proof that every native bot has acknowledged Burn settings.

## September 29 rollout

- All four workspace typechecks passed. Shared tests passed 323/323; the full web suite passed 3,376/3,376 across 311 files.
- Burn service/race/API checks passed 20/20. The separate route regression run passed 85/85, including rejection of conflicting manual reasoning/speed changes.
- Peer-reviewed local file/folder links passed 244 focused tests and are included in the full web pass. Paths remain scoped to the owning session and its existing file API.
- The broad CLI run failed 37 tests in unchanged CLI code, including Windows path/symlink and timing fixtures. The broad hub run retained baseline path/configuration/schema assertions; six additional mock-engine failures introduced by the Burn guard were fixed and verified in the 85-test route run. The full repository suite is not green.
- Windows hub and web, plus the isolated macOS local hub, were built from production checkpoint `73b9689`. Later `58923cb` changes tests only. Online database backups and previous binaries were retained. Authenticated Burn GET returned 200, unauthenticated access returned 401, and served UI/asset checks passed. All 32 existing Windows wrapper/runner processes survived the hub replacement.
- The Mac verification initially used a CLI token directly as a web bearer token and failed with 401. Recovery restored the earlier hub; the corrected application-authentication flow and guarded deployment then passed. This was a verification error, not a demonstrated Burn authentication defect.
- Both hubs were left with Burn off. No live fleet toggle or provider/model request was used for acceptance. Existing loaded bot wrappers were preserved; their steering-code adoption remains a separate idle reconnect operation.
