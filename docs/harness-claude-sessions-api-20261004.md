# External Claude Code sessions over HTTP

Worker C contract, October 4, 2026. These routes are for the coordinator's
HTTP-only Claude Code mod, not a replacement for the CLI Socket.IO transport.
They create ordinary HAPI sessions and messages, visible through the existing
`GET /api/sessions`, message pagination and web/native SSE APIs.

## Authentication and identity

Every endpoint below lives under `/cli/external-sessions` and inherits the
unchanged `/cli` middleware. Send `Authorization: Bearer <CLI_API_TOKEN>` or
`Authorization: Bearer <CLI_API_TOKEN>:<namespace>`. The default namespace is
`default`. Use HTTPS outside a trusted local transport. Never put tokens in URLs.

The browser keeps using its existing JWT and `POST /api/sessions/:id/messages`.
These external routes do not accept a browser JWT, create credentials, implement
Tailscale sign-in or require auth-file changes.

The identity key is `(namespace, machineId, claudeSessionId)`. Re-registration
returns the same HAPI ID and updates host, directory and title. A different
machine or namespace produces a different session. Use the existing runner's
machine ID when available, not a new ID per process. A machine ID owned by
another namespace returns 403. A native session already registered through the
CLI on the same machine returns 409 rather than creating a competing controller.
Do not connect the same native session through both adapters.

Session metadata includes:

```json
{
  "flavor": "claude",
  "version": "claude-http-v1",
  "host": "windows-host",
  "path": "C:/projects/demo",
  "name": "Claude on Windows",
  "machineId": "windows-device",
  "claudeSessionId": "native-claude-123",
  "startingMode": "remote",
  "lifecycleState": "running",
  "capabilities": { "terminal": false, "concurrentClients": false }
}
```

`agentState.controlledByUser` is false, with empty permission-request maps.
The normal composer can send prompts. The mod is responsible for actual native
input and execution. A newly registered machine is recorded but is **not**
marked runner-online: an HTTP mod cannot implement runner RPCs. Existing machine
metadata, display names, runner state and liveness are preserved.

## Endpoints

All requests and responses use JSON. POST requests require a JSON body, even
`end` (`{}`). Unknown request fields are rejected. All successful responses are
200 and carry `Cache-Control: no-store`. `Session` means the existing shared
`SessionSchema` shape, not a new external-session object.

### POST `/cli/external-sessions`

Register, refresh metadata or explicitly reopen an ended session.

```ts
type RegisterRequest = {
    machineId: string       // 1..512 characters
    host: string            // 1..1024 characters
    directory: string       // 1..8192 characters
    title: string           // 1..1024 characters
    claudeSessionId: string // 1..512 characters, native Claude identity
    platform?: string       // 1..128 characters; new machine defaults to "unknown"
}
type RegisterResponse = { session: Session; heartbeatTimeoutMs: 30000 }
```

Registration activates the session and resets thinking to false. It clears the
archived/end state. The title is last-registration-wins, so send the intended
title on each registration. Heartbeats do not overwrite titles.

### POST `/cli/external-sessions/:id/heartbeat`

```ts
type HeartbeatRequest = { active?: boolean; thinking?: boolean }
type HeartbeatResponse = { session: Session; heartbeatTimeoutMs: 30000 }
```

Defaults: `active: true`, `thinking: false`. `:id` is the returned **HAPI** session
ID, not the native Claude ID. Send a heartbeat every 10 seconds, independently
of turns and long-polls. The hub uses its own receive time, not a client clock.
`active: false` marks the transport offline without ending it; a subsequent
active heartbeat revives it. Thinking only describes current execution.

After more than 30 seconds without an active heartbeat, inbound polling returns
409 `session_inactive`. The existing hub five-second expiry tick also marks the
session offline for all viewers. Liveness is persisted across hub restarts;
thinking is transient, as for CLI sessions. Neither expiry nor an offline
heartbeat consumes queued messages. Transcript append does not renew liveness.

### POST `/cli/external-sessions/:id/messages`

Append transcript entries using the **existing normalized HAPI envelope**.
Do not send unwrapped JSONL rows. Tool/result, reasoning and assistant blocks
remain inside the original Claude row under `content.data`.

```ts
type AppendRequest = {
    messages: Array<{       // 1..200 entries per request, processed in order
        clientMessageId: string // 1..512 characters; stable native UUID preferred
        createdAt: number   // nonnegative integer epoch milliseconds
        content: {
            role: "user" | "agent"
            content: unknown // required; see envelopes below
            meta?: Record<string, unknown>
        }
    }>
}
type AppendResponse = {
    messages: Array<{
        clientMessageId: string
        id: string          // stored HAPI message ID
        seq: number
        inserted: boolean
    }>
}
```

Idempotency is durable and per session/client ID. Retries return the original ID
and sequence, with `inserted: false`, and do not rebroadcast. Changed content for
an existing client ID returns 409 `client_message_id_conflict`. Timestamps on
retries do not change the original timestamp. Future timestamps are clamped to
hub time. Rows use existing storage compression/truncation rules and are stored
already invoked, never as prompts for the mod. Their stored `localId` is
`external-transcript:<clientMessageId>`.

Batches are incremental, **not atomic**. If a later entry conflicts, earlier
entries may already be stored. Retry the entire unchanged batch safely, or fix
the conflicting entry with a new identity. Do not reuse IDs for growing partial
snapshots. An offline session can append late transcript rows; an ended session
must explicitly re-register first.

Assistant, system, tool and other native output envelope:

```json
{
  "role": "agent",
  "content": {
    "type": "output",
    "data": {
      "type": "assistant",
      "uuid": "native-row-uuid",
      "message": {
        "role": "assistant",
        "content": [{ "type": "text", "text": "Hello" }]
      }
    }
  },
  "meta": { "sentFrom": "cli" }
}
```

Native human text envelope:

```json
{
  "role": "user",
  "content": { "type": "text", "text": "Native prompt" },
  "meta": { "sentFrom": "cli" }
}
```

For native human echoes of a prompt received through HAPI, either omit that
echo from append or add `meta.isTranscriptEcho: true`, matching the CLI's
existing normalization. Keep non-text user/tool-result blocks in the native
output envelope. The adapter does not itself infer which native row is a HAPI
echo. No new shared fixtures or rendering format is introduced.

### GET `/cli/external-sessions/:id/inbound?waitMs=20000&limit=100`

```ts
type InboundResponse = {
    messages: Array<{
        id: string
        sessionId: string
        seq: number
        localId: string
        content: unknown
        createdAt: number
        invokedAt: null
        scheduledAt: number | null
    }>
}
```

`waitMs`: integer 0..25000, default 20000. `limit`: integer 1..200, default 100.
Returns unacknowledged, deliverable user prompts in ascending sequence order.
Future scheduled prompts and indeterminate/dispatching rows are withheld.
Mature scheduled prompts become eligible. Timeout returns `{ "messages": [] }`.
No sequence cursor is necessary: acknowledged messages leave this durable queue.

**Long-poll rather than SSE** keeps the mod HTTP-only without requiring a stream
parser, has a bounded request lifetime, and lets ordinary retries recover the
same durable prompts. The hub waits on its existing event publisher, not a
repeated database-polling loop. Heartbeats or other session changes may end a
wait early with an empty result; immediately start another poll. Request abort,
timeout and session end release listeners. End/deletion/expiry during a wait is
rechecked before returning. Use one poller/native dispatcher per session.

Reading is not acknowledgement. The mod must durably deduplicate by `localId`
before applying input to Claude. Repeated polls return the same messages until
acknowledged, including after a hub restart. This is at-least-once delivery,
**not exactly-once native execution**. Persist a mod-side receipt/ledger so a
lost acknowledgement response or mod restart cannot run the same prompt twice.

### POST `/cli/external-sessions/:id/inbound/ack`

```ts
type AcknowledgeRequest = { localIds: string[] } // 1..200 IDs, each 1..512 characters
type AcknowledgeResponse = { ok: true; invokedAt: number }
```

Send only IDs the mod has durably accepted/applied, not merely read. Ack is
idempotent and marks the original UI rows invoked, publishing the existing
`messages-consumed` event. Response `invokedAt` is this request's hub time;
repeated acknowledgements retain the original stored invocation time. Missing
IDs, message UUIDs instead of local IDs, transcript IDs and future-scheduled
rows return 409. A positive acknowledgement can settle an indeterminate row
from a delivery/cancellation race, just like the existing CLI consumed ack.
An offline session may acknowledge already accepted input; an ended session
must re-register first. Ack is not proof Claude completed the resulting turn.

### POST `/cli/external-sessions/:id/end`

Request `{}`; response `{ "ok": true }`. Idempotently marks the session inactive
and archives its lifecycle with reason `External Claude session ended`. Does
not consume unacknowledged prompts. Later heartbeat/append/poll/ack requests
return 410 `session_ended`; registration explicitly reopens the same session.

## Errors

Validation: 400 `{ "error": "Invalid body" }` or `"Invalid query"`.
Existing CLI authentication failures: 401 `{ "error": "..." }`.
Hub engine unavailable: 503 `{ "error": "Not ready" }`.
External API errors: `{ "error": "<code>", "code": "<code>" }`:

| Status | Codes |
| --- | --- |
| 403 | `machine_access_denied`, `session_access_denied` |
| 404 | `session_not_found` |
| 409 | `not_external_session`, `session_already_registered_by_cli`, `client_message_id_conflict`, `metadata_conflict`, `session_inactive`, `not_inbound_message`, `not_deliverable_message` |
| 410 | `session_ended` |

## Example exchange

All mod calls include the CLI bearer header and POSTs use
`Content-Type: application/json`. The UI call uses its existing browser JWT.

1. Mod: `POST /cli/external-sessions` with:

   ```json
   { "machineId": "windows-device", "host": "windows-host", "directory": "C:/projects/demo", "title": "Claude on Windows", "claudeSessionId": "native-claude-123", "platform": "win32" }
   ```

   Save `response.session.id` as `HAPI_ID`. Heartbeat every 10 seconds:
   `POST /cli/external-sessions/HAPI_ID/heartbeat` with `{ "thinking": false }`.

2. Mod after a turn: `POST /cli/external-sessions/HAPI_ID/messages` with:

   ```json
   { "messages": [{ "clientMessageId": "native-row-uuid", "createdAt": 1791115200000, "content": { "role": "agent", "content": { "type": "output", "data": { "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "Hello" }] } } }, "meta": { "sentFrom": "cli" } } }] }
   ```

3. UI: `POST /api/sessions/HAPI_ID/messages` with
   `{ "text": "Please continue", "localId": "ui-prompt-1" }`.

4. Mod: `GET /cli/external-sessions/HAPI_ID/inbound?waitMs=20000`.
   Receives the stored row with `localId: "ui-prompt-1"` and
   `content.content.text: "Please continue"`. Persist a dedup receipt, apply
   input once, then `POST /cli/external-sessions/HAPI_ID/inbound/ack` with
   `{ "localIds": ["ui-prompt-1"] }`. Send thinking heartbeats during execution.
   Append new transcript rows after the turn. Immediately restart the poll.

5. Mod shutdown: `POST /cli/external-sessions/HAPI_ID/end` with `{}`.

## Unsupported web actions for HTTP Claude sessions

Identify this transport with `metadata.version === "claude-http-v1"`. Its
HTTP inbox accepts text prompts only; it exposes **no CLI/runner RPC handlers**.
Hide these actions rather than treating successful prompt storage as execution
of a control command:

| Web action | Not supported by this adapter |
| --- | --- |
| Terminal | Agent-terminal attachment/input/resize and shell terminal creation/input/resize. |
| Permissions | Live permission-request transport, approve/deny buttons and permission-mode changes. The mod does not publish permission requests. |
| Interrupt/control | Abort/stop the native agent, switch local/remote control, or archive an active session by stopping it. Only the mod's HTTP `end` marks it ended; it does not kill Claude. |
| Lifecycle/history | Runner resume/reopen, clear/new-conversation orchestration, fork and rewind. These may call a real runner if one exists, but cannot control or safely resume the external mod. |
| Agent configuration | Model, effort/reasoning, service-tier/speed, burn-mode and other runtime configuration switches. |
| Native discovery | RPC-backed slash-command/skill/model discovery. Do not advertise slash commands as working controls solely because a text prompt can be delivered. |
| Files/git/attachments | Native file/directory browsing or search, generated-image retrieval, git status/diff, uploads and upload deletion, and submitting prompt attachments. |
| Queue controls | Cancel, steer or retry-indeterminate buttons. Polling and consumption acknowledgement exist, but there is no remote cancellation/steering/retry handshake with the mod. |

Session listing, device grouping, transcript reading, text prompt composition,
prompt consumption updates, and hub-only title/pin/scratchlist bookkeeping
continue using existing models. Deleting an inactive session is a hub record
operation, not a command to terminate Claude. Attachment storage in a hub-only
scratchlist does not make native prompt attachments supported. UI hiding is
capability presentation, not new authentication or authorization.

## Known machine inventory and expiry

`GET /api/machines` returns `{ machines: Machine[] }` for **all known machines
in the authenticated namespace**, including offline devices and devices with
zero sessions. Each entry retains the existing full machine shape, including
`active: boolean` and numeric `activeAt` (last heartbeat; creation-time fallback
for machines that have never heartbeated). The browser's existing JWT auth is
unchanged. An empty inventory returns `{ "machines": [] }`.

The existing five-second hub sweep marks a machine `active: false` after more
than 45 seconds without a heartbeat. Expiry preserves the machine, its
`activeAt`, and its stored record; it does **not** drop the device from this
list or emit removal. Stored machines are reloaded after a hub restart, without
requiring sessions. A stale stored active flag can briefly survive reload until
the next expiry sweep. A machine only disappears from the cache if a refresh
finds its stored record missing, not because it expired or has zero sessions.
This change does not modify heartbeat persistence, retention or runner RPCs.

## Integration limits and worker handoff

No web or auth files are changed. Worker A should hide the unsupported actions
listed above for `metadata.version === "claude-http-v1"`. UI grouping can use
`metadata.machineId` and `host`; do not require a runner-online machine entry
to display external sessions. The normal session list, chat rows and composer
use existing models. Worker B's Tailscale sign-in is independent of this API.

Attachments, permission approval transport, native interruption, transcript
team/background-task state and multi-consumer leases are not provided. The
coordinator's mod must implement its own native prompt input and durable dedup
ledger. No running service, database or installed release is modified by this
worktree deliverable.

The coordinator's requested known-machine inventory follow-up is included.
Worker B reports Tailscale production enablement still needs server-side Bun
`requestIP` binding and a
configuration/settings allowlist loader, outside B's current file ownership;
its new auth endpoints default disabled pending integration. These are separate
follow-ups, not prerequisites for the existing CLI-authenticated mod API.
