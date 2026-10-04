import { describe, expect, it } from 'vitest'
import { isExternalClaudeSession } from './sessionTransport'
import { inactiveSessionCanResume } from './sessionResume'
import { isRemoteTerminalSupported } from '@/utils/terminalSupport'
import type { Session } from '@/types/api'

describe('HTTP Claude transport', () => {
    it('requires the exact flavor and version marker', () => {
        expect(isExternalClaudeSession({ flavor: 'claude', version: 'claude-http-v1' })).toBe(true)
        for (const metadata of [null, undefined, { flavor: 'claude' }, { flavor: 'claude', version: 'native' }, { flavor: 'codex', version: 'claude-http-v1' }]) {
            expect(isExternalClaudeSession(metadata)).toBe(false)
        }
    })

    it.each([true, false])('does not offer runner resume for an active=%s external session', active => {
        const session = { active, metadata: { flavor: 'claude', version: 'claude-http-v1', host: 'host', path: '/repo', claudeSessionId: 'native-thread' } } as Session
        expect(inactiveSessionCanResume(session, 5)).toBe(false)
        expect(isRemoteTerminalSupported({ ...session.metadata!, capabilities: { terminal: true } })).toBe(false)
    })
})
