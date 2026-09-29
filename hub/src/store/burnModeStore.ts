import type { Database } from 'bun:sqlite'
import type { BurnModeState, BurnSessionState } from '@hapi/protocol/burnMode'

type Snapshot = BurnSessionState & { generation: number, hasBaseline: boolean, attemptRevision: number }
type Row = { sessionId: string, generation: number, reasoning: string | null, tier: string | null, status: BurnSessionState['status'], detail: string, hasBaseline: number, attemptRevision: number }

export class BurnModeStore {
    constructor(private readonly db: Database) {}

    get(namespace: string): BurnModeState {
        const policy = this.db.query('SELECT enabled, revision, updated_at AS updatedAt, restoring FROM burn_mode WHERE namespace = ?').get(namespace) as { enabled: number, revision: number, updatedAt: number, restoring: number } | null
        const rows = this.db.query('SELECT session_id AS sessionId, generation, previous_reasoning AS reasoning, previous_tier AS tier, status, detail, has_baseline AS hasBaseline, attempt_revision AS attemptRevision FROM burn_mode_session WHERE namespace = ? ORDER BY session_id').all(namespace) as Row[]
        return { enabled: policy?.enabled === 1, revision: policy?.revision ?? 0, updatedAt: policy?.updatedAt ?? 0, restoring: policy?.restoring === 1,
            sessions: rows.map(row => ({ sessionId: row.sessionId, status: row.status, detail: row.detail,
                previous: row.hasBaseline ? { modelReasoningEffort: row.reasoning, serviceTier: row.tier } : null })) }
    }

    updatePolicy(namespace: string, enabled: boolean, expectedRevision: number): BurnModeState | null {
        return this.db.transaction(() => {
            const current = this.get(namespace)
            if (current.revision !== expectedRevision) return null
            if (current.enabled === enabled) return current
            const revision = current.revision + 1
            this.db.query(`INSERT INTO burn_mode(namespace, enabled, revision, updated_at, restoring) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(namespace) DO UPDATE SET enabled = excluded.enabled, revision = excluded.revision, updated_at = excluded.updated_at, restoring = excluded.restoring`)
                .run(namespace, enabled ? 1 : 0, revision, Date.now(), enabled ? 0 : 1)
            return this.get(namespace)
        })()
    }

    ensureStatus(namespace: string, sessionId: string, generation: number, status: BurnSessionState['status'], detail: string): void {
        this.db.query(`INSERT INTO burn_mode_session(namespace, session_id, generation, previous_reasoning, previous_tier, has_baseline, status, detail, attempt_revision)
            VALUES (?, ?, ?, NULL, NULL, 0, ?, ?, 0)
            ON CONFLICT(namespace, session_id) DO UPDATE SET generation = excluded.generation, status = excluded.status, detail = excluded.detail`)
            .run(namespace, sessionId, generation, status, detail)
    }

    captureBaseline(namespace: string, sessionId: string, generation: number, reasoning: string | null, tier: string | null): void {
        this.db.query(`INSERT INTO burn_mode_session(namespace, session_id, generation, previous_reasoning, previous_tier, has_baseline, status, detail, attempt_revision)
            VALUES (?, ?, ?, ?, ?, 1, 'pending', 'Applying Burn settings.', 0)
            ON CONFLICT(namespace, session_id) DO UPDATE SET generation = excluded.generation, previous_reasoning = CASE WHEN burn_mode_session.has_baseline = 0 THEN excluded.previous_reasoning ELSE burn_mode_session.previous_reasoning END,
              previous_tier = CASE WHEN burn_mode_session.has_baseline = 0 THEN excluded.previous_tier ELSE burn_mode_session.previous_tier END,
              has_baseline = 1, status = 'pending', detail = excluded.detail`)
            .run(namespace, sessionId, generation, reasoning, tier)
    }

    setResult(namespace: string, sessionId: string, status: BurnSessionState['status'], detail: string, attemptRevision = 0): void {
        this.db.query('UPDATE burn_mode_session SET status = ?, detail = ?, attempt_revision = ? WHERE namespace = ? AND session_id = ?')
            .run(status, detail, attemptRevision, namespace, sessionId)
    }

    retryFailed(namespace: string): void {
        this.db.query("UPDATE burn_mode_session SET status = 'pending', detail = 'Retry requested.', attempt_revision = 0 WHERE namespace = ? AND status = 'failed'").run(namespace)
    }

    snapshotFor(namespace: string, sessionId: string): Snapshot | null {
        const row = this.db.query('SELECT session_id AS sessionId, generation, previous_reasoning AS reasoning, previous_tier AS tier, status, detail, has_baseline AS hasBaseline, attempt_revision AS attemptRevision FROM burn_mode_session WHERE namespace = ? AND session_id = ?').get(namespace, sessionId) as Row | null
        return row && { generation: row.generation, sessionId: row.sessionId, status: row.status, detail: row.detail, hasBaseline: row.hasBaseline === 1, attemptRevision: row.attemptRevision,
            previous: row.hasBaseline ? { modelReasoningEffort: row.reasoning, serviceTier: row.tier } : null }
    }

    namespacesNeedingReconcile(): string[] {
        return (this.db.query('SELECT namespace FROM burn_mode WHERE enabled = 1 OR restoring = 1').all() as Array<{ namespace: string }>).map(row => row.namespace)
    }

    finishRestoreWhenComplete(namespace: string): void {
        const remaining = this.db.query("SELECT COUNT(*) AS count FROM burn_mode_session WHERE namespace = ? AND status NOT IN ('restored', 'unsupported')").get(namespace) as { count: number }
        if (remaining.count) return
        this.db.query('UPDATE burn_mode SET restoring = 0, updated_at = ? WHERE namespace = ?').run(Date.now(), namespace)
        this.db.query('DELETE FROM burn_mode_session WHERE namespace = ?').run(namespace)
    }
}
