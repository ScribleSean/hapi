import type { Database } from 'bun:sqlite'
import type { BurnModeState, BurnSessionState } from '@hapi/protocol/burnMode'

type Snapshot = BurnSessionState & { generation: number }

export class BurnModeStore {
    constructor(private readonly db: Database) {}

    get(namespace: string): BurnModeState {
        const policy = this.db.query('SELECT enabled, revision, updated_at AS updatedAt, restoring FROM burn_mode WHERE namespace = ?')
            .get(namespace) as { enabled: number, revision: number, updatedAt: number, restoring: number } | null
        const rows = this.db.query('SELECT session_id AS sessionId, status, detail, previous_reasoning AS reasoning, previous_tier AS tier, generation FROM burn_mode_session WHERE namespace = ? ORDER BY session_id')
            .all(namespace) as Array<{ sessionId: string, status: BurnSessionState['status'], detail: string, reasoning: string | null, tier: string | null, generation: number }>
        return {
            enabled: policy?.enabled === 1,
            revision: policy?.revision ?? 0,
            updatedAt: policy?.updatedAt ?? 0,
            restoring: policy?.restoring === 1,
            sessions: rows.map(row => ({ sessionId: row.sessionId, status: row.status, detail: row.detail,
                previous: { modelReasoningEffort: row.reasoning, serviceTier: row.tier } }))
        }
    }

    updatePolicy(namespace: string, enabled: boolean, expectedRevision: number): BurnModeState | null {
        return this.db.transaction(() => {
            const current = this.get(namespace)
            if (current.revision !== expectedRevision) return null
            if (current.enabled === enabled) return current
            const now = Date.now()
            const revision = current.revision + 1
            this.db.query(`INSERT INTO burn_mode(namespace, enabled, revision, updated_at, restoring) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(namespace) DO UPDATE SET enabled = excluded.enabled, revision = excluded.revision, updated_at = excluded.updated_at, restoring = excluded.restoring`)
                .run(namespace, enabled ? 1 : 0, revision, now, enabled ? 0 : 1)
            return this.get(namespace)
        })()
    }

    snapshot(namespace: string, sessionId: string, generation: number, reasoning: string | null, tier: string | null): void {
        this.db.query(`INSERT INTO burn_mode_session(namespace, session_id, generation, previous_reasoning, previous_tier, status, detail)
            VALUES (?, ?, ?, ?, ?, 'pending', 'Waiting for a capability check.')
            ON CONFLICT(namespace, session_id) DO NOTHING`).run(namespace, sessionId, generation, reasoning, tier)
    }

    setResult(namespace: string, sessionId: string, status: BurnSessionState['status'], detail: string): void {
        this.db.query('UPDATE burn_mode_session SET status = ?, detail = ? WHERE namespace = ? AND session_id = ?')
            .run(status, detail, namespace, sessionId)
    }

    retryFailed(namespace: string): void {
        this.db.query("UPDATE burn_mode_session SET status = 'pending', detail = 'Retry requested.' WHERE namespace = ? AND status = 'failed'")
            .run(namespace)
    }

    snapshotFor(namespace: string, sessionId: string): Snapshot | null {
        const row = this.db.query('SELECT session_id AS sessionId, generation, previous_reasoning AS reasoning, previous_tier AS tier, status, detail FROM burn_mode_session WHERE namespace = ? AND session_id = ?')
            .get(namespace, sessionId) as { sessionId: string, generation: number, reasoning: string | null, tier: string | null, status: BurnSessionState['status'], detail: string } | null
        return row && { generation: row.generation, sessionId: row.sessionId, status: row.status, detail: row.detail,
            previous: { modelReasoningEffort: row.reasoning, serviceTier: row.tier } }
    }

    finishRestoreWhenComplete(namespace: string): void {
        const remaining = this.db.query("SELECT COUNT(*) AS count FROM burn_mode_session WHERE namespace = ? AND status NOT IN ('restored', 'unsupported')").get(namespace) as { count: number }
        if (remaining.count) return
        this.db.query('UPDATE burn_mode SET restoring = 0, updated_at = ? WHERE namespace = ?').run(Date.now(), namespace)
        this.db.query('DELETE FROM burn_mode_session WHERE namespace = ?').run(namespace)
    }
}
