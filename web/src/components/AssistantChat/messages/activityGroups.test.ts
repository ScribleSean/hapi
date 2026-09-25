import { describe, expect, it } from 'vitest'
import type { ThreadMessage } from '@assistant-ui/react'
import { groupActivityMessages } from './activityGroups'

const message = (id: string, content: unknown[], role = 'assistant') => ({ id, role, content }) as unknown as ThreadMessage
const tool = (state = 'completed', kind = 'tool-call') => ({ type: 'tool-call', artifact: { kind, tool: { name: 'shell', state }, children: [] } })

describe('combined activity', () => {
    it('folds alternating reasoning and tools into one group but preserves text boundaries', () => {
        const groups = groupActivityMessages([
            message('r1', [{ type: 'reasoning', text: 'thinking' }]),
            message('t1', [tool()]),
            message('r2', [{ type: 'reasoning', text: 'thinking again' }]),
            message('reply', [{ type: 'text', text: 'Answer' }]),
            message('t2', [tool()]),
        ])
        expect(groups.map(group => group.ids)).toEqual([['r1', 't1', 'r2'], ['reply'], ['t2']])
    })
    it('keeps approvals, generated media, unknown tools and user messages outside collapsed activity', () => {
        const groups = groupActivityMessages([
            message('approval', [tool('pending')]),
            message('image', [tool('completed', 'generated-image')]),
            message('unknown', [{ type: 'tool-call' }]),
            message('user', [{ type: 'text', text: 'hello' }], 'user'),
        ])
        expect(groups.every(group => !group.activity)).toBe(true)
    })
})
