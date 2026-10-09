import { describe, expect, it } from 'vitest'
import { canApplyTaskPick } from './taskPicker'

describe('task model choice application', () => {
    const base = { requestedContext: 'pc/codex/project/manual-model', currentContext: 'pc/codex/project/manual-model',
        requestedBrief: 'test', currentBrief: 'test', option: { model: 'new', effort: 'high', effortKind: 'reasoning' as const },
        availableOptions: [{ model: 'new', effort: 'high', effortKind: 'reasoning' as const }], disabled: false }
    it('automatically accepts an exact currently available result', () => expect(canApplyTaskPick(base)).toBe(true))
    it.each([
        { currentContext: 'mac/claude/project/manual-model' },
        { currentContext: 'pc/codex/project/user-override' },
        { currentBrief: 'changed task' },
        { availableOptions: [{ model: 'new' }] },
        { disabled: true },
    ])('preserves a changed task, manual override, or unavailable option', change => {
        expect(canApplyTaskPick({ ...base, ...change })).toBe(false)
    })
})
