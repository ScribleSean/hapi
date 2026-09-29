# Burn mode

Burn sits beside Models & connections. Enabling it raises each connected chat's available reasoning, effort and speed controls as far as its harness supports. It does not change models, switch providers, resume paused work, or issue a model prompt. A chat with no supported controls stays unchanged and appears under "No controls", rather than as a failed update.

| Harness | Available Burn controls |
| --- | --- |
| Codex | Highest recognized reasoning level advertised for the current model; Fast independently when advertised. HAPI's Fast maps to the native priority tier. |
| Claude Code | Max effort through the maintained effort control. Paid Fast mode is not enabled. |
| Pi | Highest supported thinking level for the exact selected model and provider. |
| Grok | Highest recognized effort level in that session's live options. |
| Other harnesses or models without supported controls | Unchanged, with a specific explanation. Auto never means permission to select another model. |

The flame animates while enabled and respects reduced-motion preferences. All clients of the same hub share the policy; a separate local hub has its own policy and deployment.

The hub stores this policy per authenticated namespace, so signed-in browsers share the switch and its results. Clients refresh every five seconds and on focus. The control reports pending, failed, blocked and unsupported targets separately; an enabled switch does not claim that every bot has applied the settings. Settings affect subsequent model requests.

Before the first native update, the hub saves each controlled field's exact value, including null defaults. Disabling Burn restores only those fields. Offline sessions wait until reconnecting. Apply and restore results are checked against the returned session settings; an unconfirmed update retains its restoration baseline and offers an explicit retry. Toggling during restoration preserves unfinished baselines; sessions already restored can take a fresh baseline on the next activation.

Reconciliation uses existing authenticated session RPC and capability discovery. It limits concurrent work, coalesces heartbeat requests, checks the current policy again after asynchronous work, and prevents conflicting manual reasoning, effort or speed changes while Burn controls a session. Settings drift triggers reconciliation. Policy updates use a revision check to resolve competing browser requests.

The SQLite tables are additive to schema version 26. Existing hub versions ignore them, allowing binary rollback without rewriting the conversation database. Keep an online database backup and the previous hub binary for deployment recovery.

## Verification boundaries

Focused tests cover the shared API, restoration and asynchronous reconciliation. The desktop and 390-pixel phone preview uses fictional sessions and the actual UI components, with no live model settings or provider calls. Live rollout must independently verify authenticated API access and matching served assets. A healthy hub or a passing preview is not proof that every native bot has acknowledged Burn settings.

## Generic controls rollout, September 29

- Production source: `cfcd2d52c2d391974feb43b79a9421ebeda3f9f5`. All four workspace typechecks passed. Focused integrated Burn checks passed 107/107, shared tests 323/323 and UI checks 13/13. The broader hub run passed 1,359 with 3 skips and 21 unrelated Windows/environment failures; the full repository suite is not green.
- Independent review covered preservation of existing baselines, field-specific restoration, unconfirmed acknowledgments, provider-aware Auto handling and asynchronous policy changes.
- Light and dark compact captures were inspected after transitions settled. Reduced-motion disables the pulse and the off state is unanimated.
- The primary Windows hub and shared web were deployed with an online database backup and retained earlier binary/assets. Served index, main JavaScript and service worker matched the build. Application authentication and unauthenticated rejection passed.
- The existing enabled policy remained enabled. Settings readback confirmed supported controls applied, previous baselines survived and model/provider/native-thread identities were unchanged. No prompts were sent and no native bot wrappers were restarted. This verifies configuration, not completion speed or future provider allowance.
- The separate Mac-local fallback was not redeployed in this update; it retains the earlier Codex-only Burn implementation. Native wrapper steering adoption, physical cold-start tests and desktop/browser tool readiness remain separate work.

## Initial September 29 rollout (before generic controls)

- All four workspace typechecks passed. Shared tests passed 323/323; the full web suite passed 3,376/3,376 across 311 files.
- Burn service/race/API checks passed 20/20. The separate route regression run passed 85/85, including rejection of conflicting manual reasoning/speed changes.
- Peer-reviewed local file/folder links passed 244 focused tests and are included in the full web pass. Paths remain scoped to the owning session and its existing file API.
- The broad CLI run failed 37 tests in unchanged CLI code, including Windows path/symlink and timing fixtures. The broad hub run retained baseline path/configuration/schema assertions; six additional mock-engine failures introduced by the Burn guard were fixed and verified in the 85-test route run. The full repository suite is not green.
- Windows hub and web, plus the isolated macOS local hub, were built from production checkpoint `73b9689`. Later `58923cb` changes tests only. Online database backups and previous binaries were retained. Authenticated Burn GET returned 200, unauthenticated access returned 401, and served UI/asset checks passed. All 32 existing Windows wrapper/runner processes survived the hub replacement.
- The Mac verification initially used a CLI token directly as a web bearer token and failed with 401. Recovery restored the earlier hub; the corrected application-authentication flow and guarded deployment then passed. This was a verification error, not a demonstrated Burn authentication defect.
- Both hubs were left with Burn off. No live fleet toggle or provider/model request was used for acceptance. Existing loaded bot wrappers were preserved; their steering-code adoption remains a separate idle reconnect operation.
