import type { ApiClient } from '@/api/client'
import type { SessionSummary, PiModelsResponse } from '@/types/api'
import { getSessionTitle } from './sessionTitle'
import { getCodexModelReasoningEfforts } from './codexModelCapabilities'
import { parseCursorWireParams } from './cursorModelOptions'
import { getClaudeComposerEffortOptions } from '@/components/AssistantChat/claudeEffortOptions'
import { getPiThinkingLevelOptions } from '@/components/AssistantChat/piThinkingLevelOptions'
import { isExternalClaudeSession } from './sessionTransport'

export type ReasoningOption = { value: string | null; label: string; modelId?: string }
export type ReasoningTarget = {
    id: string
    title: string
    flavor: string
    model: string | null
    current: string | null
    options: ReasoningOption[]
    action: 'reasoning' | 'effort' | 'model'
    unavailable?: string
}
export type ReasoningResult = { id: string; title: string; status: 'applied' | 'unchanged' | 'skipped' | 'failed'; detail: string }

export const reasoningLabel = (value: string | null) => value === null ? 'Default' : value.charAt(0).toUpperCase() + value.slice(1)
const optionsFor = (values: string[]): ReasoningOption[] => [
    { value: null, label: 'Default' },
    ...[...new Set(values)].map(value => ({ value, label: reasoningLabel(value) })),
]
const supportedFlavors = new Set(['codex', 'claude', 'cursor', 'opencode', 'grok', 'pi'])

/** Only explicit same-model Cursor effort variants; never change speed/context. */
export function cursorReasoningOptions(current: string, models: { modelId: string }[]): ReasoningOption[] {
    const base = current.split('[')[0]
    const params = parseCursorWireParams(current)
    const result: ReasoningOption[] = []
    for (const { modelId } of models) {
        if (modelId.split('[')[0] !== base) continue
        const next = parseCursorWireParams(modelId)
        if (!next.effort) continue
        const keys = new Set([...Object.keys(params), ...Object.keys(next)])
        if ([...keys].some(key => key !== 'effort' && params[key] !== next[key])) continue
        if (!result.some(option => option.value === next.effort)) {
            result.push({ value: next.effort, label: reasoningLabel(next.effort), modelId })
        }
    }
    return result
}

/** Read-only capability preflight, invoked on opening the picker, never on hover. */
export async function loadReasoningTarget(api: ApiClient, summary: Pick<SessionSummary, 'id' | 'active' | 'metadata' | 'model' | 'modelReasoningEffort' | 'effort'>): Promise<ReasoningTarget> {
    const target: ReasoningTarget = {
        id: summary.id, title: getSessionTitle(summary), flavor: summary.metadata?.flavor ?? 'claude',
        model: summary.model, current: summary.modelReasoningEffort ?? summary.effort ?? null,
        action: 'effort', options: [],
    }
    const unavailable = (reason: string) => ({ ...target, options: [], unavailable: reason })
    if (!summary.active) return unavailable('Offline. Resume this session before changing reasoning.')
    if (!supportedFlavors.has(target.flavor)) return unavailable('This harness does not expose a separate reasoning control.')
    try {
        const { session } = await api.getSession(summary.id)
        if (isExternalClaudeSession(session.metadata)) return unavailable('HTTP Claude sessions do not support runner controls.')
        if (!session.active) return unavailable('Session disconnected.')
        if ((session.metadata?.flavor ?? 'claude') !== target.flavor) return unavailable('Harness changed. Refresh the picker.')
        target.model = session.model
        target.current = ['codex', 'opencode'].includes(target.flavor) ? session.modelReasoningEffort ?? null : session.effort ?? null
        if (session.agentState?.controlledByUser && !session.metadata?.capabilities?.concurrentClients && target.flavor !== 'claude' && target.flavor !== 'pi') {
            return unavailable('Controlled in its terminal. Switch to remote control first.')
        }
        if (target.flavor === 'codex') {
            const catalog = await api.getSessionCodexModels(summary.id)
            if (!catalog.success) throw Error(catalog.error ?? 'Model discovery failed')
            const levels = getCodexModelReasoningEfforts(catalog.models ?? [], session.model)
            if (levels?.length) target.options = optionsFor(levels)
            target.action = 'reasoning'
        } else if (target.flavor === 'claude') {
            target.options = getClaudeComposerEffortOptions(null)
        } else if (target.flavor === 'opencode') {
            const catalog = await api.getSessionOpencodeReasoningEffortOptions(summary.id)
            if (!catalog.success) throw Error(catalog.error ?? 'Effort discovery failed')
            const model = session.model ?? catalog.targetModelId
            if (catalog.currentModelId && model && catalog.currentModelId !== model) return unavailable('Model switch pending. Refresh once it completes.')
            if (catalog.options?.length) target.options = optionsFor(catalog.options.map(option => option.value))
            target.action = 'reasoning'
        } else if (target.flavor === 'grok') {
            const catalog = await api.getSessionGrokReasoningEffortOptions(summary.id)
            if (!catalog.success) throw Error(catalog.error ?? 'Effort discovery failed')
            if (catalog.options?.length) target.options = optionsFor(catalog.options.map(option => option.value))
        } else if (target.flavor === 'pi') {
            const catalog = await api.callPiEndpoint<PiModelsResponse>(summary.id, 'models')
            if (!catalog.success) throw Error(catalog.error ?? 'Model discovery failed')
            const selected = session.metadata?.piSelectedModel
            const matches = (catalog.availableModels ?? []).filter(model => selected
                ? model.provider === selected.provider && model.modelId === selected.modelId
                : model.modelId === session.model)
            if (matches.length === 1 && matches[0].reasoning) target.options = [
                { value: null, label: 'Default' }, ...getPiThinkingLevelOptions(null, matches[0].thinkingLevelMap),
            ]
        } else if (target.flavor === 'cursor') {
            const catalog = await api.getSessionCursorModels(summary.id)
            if (!catalog.success) throw Error(catalog.error ?? 'Model discovery failed')
            const current = session.model ?? catalog.currentModelId
            if (current) {
                target.options = cursorReasoningOptions(current, catalog.availableModels ?? [])
                target.current = parseCursorWireParams(current).effort ?? null
                target.model = current
            }
            target.action = 'model'
        }
        return target.options.length ? target : unavailable('No reasoning levels advertised for this model.')
    } catch (error) {
        return unavailable(error instanceof Error ? error.message : 'Could not load reasoning settings.')
    }
}

/** Save exact advertised values once. Recheck each target to catch host/model changes. */
export async function applyReasoningTargets(api: ApiClient, targets: ReasoningTarget[], value: string | null): Promise<ReasoningResult[]> {
    const results: ReasoningResult[] = []
    for (const target of targets) {
        const result = (status: ReasoningResult['status'], detail: string) => results.push({ id: target.id, title: target.title, status, detail })
        if (target.unavailable || !target.options.some(option => option.value === value)) {
            result('skipped', target.unavailable ?? `${reasoningLabel(value)} is not supported.`)
            continue
        }
        try {
            const { session } = await api.getSession(target.id)
            if (session.model !== target.model && !(target.flavor === 'cursor' && session.model === null)) {
                result('skipped', 'Model changed after preview. Refresh before applying.')
                continue
            }
            const fresh = await loadReasoningTarget(api, session)
            const option = fresh.options.find(option => option.value === value)
            if (fresh.unavailable || !option || fresh.flavor !== target.flavor || fresh.model !== target.model) {
                result('skipped', fresh.unavailable ?? 'Capabilities changed. Refresh before applying.')
                continue
            }
            if (fresh.current === value) { result('unchanged', 'Already selected.'); continue }
            if (fresh.action === 'model') await api.setModel(target.id, option.modelId!)
            else if (fresh.action === 'reasoning') await api.setModelReasoningEffort(target.id, value)
            else await api.setEffort(target.id, value)
            result('applied', `${reasoningLabel(value)} accepted for subsequent model requests.`)
        } catch (error) {
            result('failed', `${error instanceof Error ? error.message : 'Request failed'}. Not retried; refresh to verify state.`)
        }
    }
    return results
}
