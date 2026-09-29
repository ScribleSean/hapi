# Burn mode

Burn sits beside Models & connections. Enabling it requests Ultra reasoning and Fast service for connected Codex sessions whose current model advertises both capabilities. It does not change models, switch providers, resume paused work, or issue a model prompt. Other harnesses and unsupported models remain unchanged and appear in the results.

The hub stores this policy per authenticated namespace, so signed-in browsers share the switch and its results. Clients refresh every five seconds and on focus. The control reports pending, failed, blocked and unsupported targets separately; an enabled switch does not claim that every bot has applied the settings. Settings affect subsequent model requests.

Before the first native update, the hub saves that session's exact reasoning and tier, including null defaults. Disabling Burn restores those saved values. Offline sessions wait until reconnecting. Unconfirmed updates retain their restoration baseline, and failures offer an explicit retry. Toggling during restoration preserves unfinished baselines; sessions already restored can take a fresh baseline on the next activation.

Reconciliation uses existing authenticated session RPC and live model discovery. It limits concurrent work, coalesces heartbeat requests, checks the current policy again after asynchronous work, and prevents conflicting manual reasoning or speed changes while Burn controls a session. Policy updates use a revision check to resolve competing browser requests.

The SQLite tables are additive to schema version 26. Existing hub versions ignore them, allowing binary rollback without rewriting the conversation database. Keep an online database backup and the previous hub binary for deployment recovery.

## Verification boundaries

Focused tests cover the shared API, restoration and asynchronous reconciliation. The desktop and 390-pixel phone preview uses fictional sessions and the actual UI components, with no live model settings or provider calls. Live rollout must independently verify authenticated API access and matching served assets. A healthy hub or a passing preview is not proof that every native bot has acknowledged Burn settings.
