# Experimental Jev task picker

The new-session form has a collapsed **Auto choose with Jev** panel. Enter a short task brief, select **Auto choose**, and the returned model and supported reasoning level are applied to the form. Manual model controls remain available. The brief is for selection only; it is not sent to a coding agent or used to start a task.

This first version stays within the selected harness. Codex, Cursor, Antigravity and Copilot use the form's discovered model options. Claude uses HAPI's existing native aliases and effort presets; that is not live provider discovery. Other harnesses keep their ordinary controls. Codex must be on Standard speed. History imports, existing conversations, permissions, Fast mode and running turns are not changed. Cross-harness handoffs and per-turn automatic selection are not implemented.

## Activation

Disabled until the hub owner configures both:

1. `TYPESAFE_API_KEY` in the **hub process** environment. Keep it out of browser storage, Git, logs and chat. This is separate from native coding subscriptions.
2. `HAPI_HOME/jev-task-picker.json`, using the schema in `hub/src/services/jevTaskPicker.ts`.

Example with deliberately expired authorization and placeholder model/host values:

```json
{
  "enabled": true,
  "creditWindow": {
    "id": "replace-with-verified-free-credit-window",
    "freeOnly": true,
    "autoRechargeDisabled": true,
    "expiresAt": "2000-01-01T00:00:00Z",
    "maxCalls": 20
  },
  "minimumConfidence": 0.6,
  "routes": [
    {
      "id": "general_coding",
      "machineId": "replace-with-hapi-machine-id",
      "harness": "codex",
      "option": {
        "model": "replace-with-advertised-model-id",
        "effort": "medium",
        "effortKind": "reasoning"
      },
      "description": "Approved general coding option with medium reasoning",
      "includedOnly": true,
      "paidFallbackDisabled": true,
      "verifiedUntil": "2000-01-01T00:00:00Z"
    }
  ]
}
```

Verify provider sign-in, entitlement, remaining included allowance, exact model/effort support and paid-fallback settings before adding a route. Set short eligibility expirations and renew only after checking again. These are owner attestations, not an automated allowance integration. An online runner or visible model is insufficient evidence. For Cursor, use the complete native model variant ID; do not invent a separate effort. Claude effort uses `effortKind: "effort"`. Omit both effort fields when selecting a model's default.

Verify TypeSafe free credits and disabled auto-recharge before enabling a small call budget. The local cap is a number of attempts, not a dollar meter or provider-side spending limit. Do not enable this experiment on a paid-fallback account under a zero-spend policy. Preserve the usage ledger and credit-window ID across restarts; resetting them would reset the local cap. Corrupt ledgers or an existing lock block requests. A leftover lock after a crash requires confirming there is no running reservation before removing that exact lock file.

## Request and failure behavior

- Owner-only, authenticated `GET /api/experimental/task-picker/status` and `POST /api/experimental/task-picker/choose`; other namespaces get 403.
- Only the explicit brief, harness label and approved candidate descriptions go to the fixed TypeSafe endpoint. No repository files, history, screenshots, machine ID or credentials are included in the decision state.
- Choice options are the intersection of owner eligibility and form capabilities. The endpoint returns a selection; it cannot launch an agent or change permissions.
- A durable ledger reserves an attempt before sending. Failures count, with no automatic retry or paid fallback.
- Unknown choices, abstention, low confidence, expired eligibility and malformed responses leave the form unchanged. The confidence threshold is provisional, not a probability of task success.
- If the task, machine, harness, manual selection or model capabilities change while awaiting the decision, the result is discarded.
- No automatic background calls, retries on typing, raw prompt logging, new dependencies or provider credential migration.

## Verification and open work

Focused hub tests cover eligibility, abstention, expiry, request shape, call caps, concurrent reservations and namespace checks. Frontend tests cover automatic application, manual-override races and unavailable setup. These use synthetic inputs and mocked TypeSafe responses, so they establish control behavior, not routing quality.

Before activation: build/deploy the updated hub and web assets, configure credentials locally, verify eligible routes, and run one non-sensitive live choice. Then evaluate a held-out set of representative tasks and compare choices, latency and successful task outcomes with manual selection. Do not claim cost savings from the tests or marketing demos.

Sources: [TypeSafe API](https://docs.typesafe.ai/api), [intent routing](https://docs.typesafe.ai/patterns/intent-routing), [confidence](https://docs.typesafe.ai/confidence), [Astra-Ares reference](https://github.com/miuuyy/Astra-Ares). Astra-Ares requires a patched Codex runtime and does not support Windows; it was not installed or vendored. The community typesafe-router was reviewed but not added as a dependency.
