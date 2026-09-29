import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('schema v26 additive scheduled-message index', () => {
    it('adds the index to an existing v26 database without changing user_version', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-v26-scheduled-index-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        new Store(dbPath).close()
        const existing = new Database(dbPath)
        existing.exec('DROP INDEX idx_messages_future_scheduled_by_session')
        existing.close()

        const reopened = new Store(dbPath)
        const db = (reopened as unknown as { db: Database }).db
        const index = db.prepare(`
            SELECT sql FROM sqlite_master
            WHERE type = 'index' AND name = 'idx_messages_future_scheduled_by_session'
        `).get() as { sql: string } | undefined
        const version = db.prepare('PRAGMA user_version').get() as { user_version: number }

        expect(index?.sql).toContain('ON messages(session_id, scheduled_at)')
        expect(version.user_version).toBe(26)
        reopened.close()
    })
})
