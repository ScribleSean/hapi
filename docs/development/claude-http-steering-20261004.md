# HTTP Claude message delivery, October 4, 2026

HTTP Claude sessions (`flavor: claude`, `version: claude-http-v1`) accept normal
messages on arrival through the add-on. A separate `/steer` message is unnecessary.
The composer consumes that literal command locally, without a send or optimistic
row; REST callers receive a successful no-op. Other transports are unchanged.

The web pending list distinguishes ordinary sends awaiting acknowledgment from
explicit Queue messages waiting for another turn. The existing `messages-consumed`
event stamps the original message and removes it from the list without waiting
for an assistant response. Acknowledgment means acceptance, not completion.

User prompt echoes with `meta.isTranscriptEcho: true` are hidden by both the hub
history projection and the web normalizer. Their stored rows are retained. The
filter requires the boolean marker and does not deduplicate matching human text.

## Add-on contract and deployment dependency

Inbound messages now carry top-level `deliveryMode: 'steer' | 'queue'`, derived
from durable message metadata. Normal Send, including omitted delivery intent,
uses `steer` for this transport; explicit Queue and every schedule use `queue`.
The decision does not depend on delayed thinking heartbeats. Native steering RPC
support is unchanged, and HTTP Claude does not gain a per-row Steer button.

The add-on must honor `queue` using its actual turn state, retaining it until the
running turn ends, then apply and acknowledge. It must continue handling other
available steer messages while a queue item waits. It should not add a waiting
queue item to its applied ledger or acknowledge it before acceptance. A mature
schedule remains queue delivery. Keep localId deduplication and lost-ack recovery.
Previously stored queue rows retain their original intent across restart/retry.

The coordinator owns the add-on. The inspected version still folds every busy
inbound message regardless of mode, so explicit Queue is not yet verified end to
end. All mirrored copies of accepted hub input must either be omitted or carry
the echo marker, including copies produced by folding a steer into a turn.
No content-based deduplication is applied to unmarked rows.

Deployment requires approval and coordinated add-on acceptance. This change
does not change authentication, exposure, runners, or the live database.

## Verification

- Web and hub typechecks passed.
- 453 unique web tests passed across the focused suites and fixture conformance.
  This includes pending-row removal on acknowledgment, delivery intent,
  echo normalization, send recovery and unchanged native send behavior.
- 104 hub tests passed across external HTTP routes, message REST routes and
  message service checks. One existing cold-start test fails at temporary SQLite
  directory deletion with Windows `EBUSY`; reproduced on unchanged `ea522e6`.
  The same service suite excluding that cleanup test passes all 54 other tests.
- Fixture generation completed with no generated content changes.
- Web production build and hub build passed after generating embedded assets.
- Local diff and React component review completed.

No live deployment, browser/phone acceptance, add-on provider turn, or native
mobile toolchain check was performed for this patch.
