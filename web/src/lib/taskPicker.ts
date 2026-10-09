export type TaskPickOption = { model: string; effort?: string; effortKind?: 'effort' | 'reasoning' }
export type TaskPickRequest = { machineId: string; harness: string; brief: string; options: TaskPickOption[] }
export type TaskPickResult = { option: TaskPickOption; label: string; confidence: number }

export const sameTaskPick = (a: TaskPickOption, b: TaskPickOption) =>
    a.model === b.model && a.effort === b.effort && a.effortKind === b.effortKind

/** Never apply a delayed result to another task, machine, catalog, or harness. */
export function canApplyTaskPick(input: {
    requestedContext: string
    currentContext: string
    requestedBrief: string
    currentBrief: string
    option: TaskPickOption
    availableOptions: TaskPickOption[]
    disabled: boolean
}): boolean {
    return !input.disabled
        && input.requestedContext === input.currentContext
        && input.requestedBrief === input.currentBrief
        && input.availableOptions.some(option => sameTaskPick(option, input.option))
}
