import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { getSessionTitle } from '@/lib/sessionTitle'
import { applyReasoningTargets, loadReasoningTarget, reasoningLabel, type ReasoningResult, type ReasoningTarget } from '@/lib/sessionReasoning'
import { applyServiceTierTargets, loadServiceTierTarget, type ServiceTierResult, type ServiceTierTarget } from '@/lib/sessionServiceTier'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const DEFAULT = '__default__'
const effortOrder = ['__default__', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
type Tab = 'reasoning' | 'speed'
type Target = ReasoningTarget | ServiceTierTarget
type Result = ReasoningResult | ServiceTierResult

export function SessionReasoningControl(props: { api: ApiClient | null; sessions: SessionSummary[]; bulk?: boolean }) {
    const [snapshot, setSnapshot] = useState<SessionSummary[] | null>(null)
    const single = !props.bulk
    if (!props.api || !props.sessions.length) return null
    const title = single ? `Bot settings for ${getSessionTitle(props.sessions[0])}` : `Bot settings for ${props.sessions.length} sessions`
    return <>
        <button type="button" aria-label={title} title={title}
            className={single ? 'absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-[var(--app-bg)] text-[var(--app-hint)] hover:text-[var(--app-link)] sm:opacity-0 sm:group-hover/reasoning-row:opacity-100 sm:group-focus-within/reasoning-row:opacity-100 [@media(hover:none)]:opacity-100' : 'rounded-md px-3 py-1.5 text-xs text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]'}
            onClick={event => { event.stopPropagation(); setSnapshot([...props.sessions]) }}>
            {single ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 3a4 4 0 0 0-4 4 4 4 0 0 0-2 7 4 4 0 0 0 5 6 3 3 0 0 4-3V6a3 3 0 0 0-3-3Zm6 0a4 4 0 0 1 4 4 4 4 0 0 1 2 7 4 4 0 0 1-5 6 3 3 0 0 1-4-3V6a3 3 0 0 1 3-3Z"/><path d="M5 7c2 0 3 1 3 3m11-3c-2 0-3 1-3 3M3 14h4m14 0h-4"/></svg> : `Bot settings · ${props.sessions.length}`}
        </button>
        {snapshot ? <BotSettingsDialog api={props.api} sessions={snapshot} bulk={Boolean(props.bulk)} onClose={() => setSnapshot(null)} /> : null}
    </>
}

function BotSettingsDialog({ api, sessions, bulk, onClose }: { api: ApiClient; sessions: SessionSummary[]; bulk: boolean; onClose: () => void }) {
    const queryClient = useQueryClient()
    const [tab, setTab] = useState<Tab>('reasoning')
    const [reasoningTargets, setReasoningTargets] = useState<ReasoningTarget[]>([])
    const [speedTargets, setSpeedTargets] = useState<ServiceTierTarget[]>([])
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [reasoningValue, setReasoningValue] = useState(DEFAULT)
    const [speedValue, setSpeedValue] = useState<'fast' | 'standard'>('standard')
    const [filter, setFilter] = useState('')
    const [group, setGroup] = useState('all')
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [revision, setRevision] = useState(0)
    const [results, setResults] = useState<Result[] | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true); setResults(null)
        void (async () => {
            const reasoning: ReasoningTarget[] = []; const speed: ServiceTierTarget[] = []
            for (let start = 0; start < sessions.length; start += 4) {
                if (cancelled) return
                const batch = sessions.slice(start, start + 4)
                const [nextReasoning, nextSpeed] = await Promise.all([Promise.all(batch.map(session => loadReasoningTarget(api, session))), Promise.all(batch.map(session => loadServiceTierTarget(api, session)))])
                reasoning.push(...nextReasoning); speed.push(...nextSpeed)
            }
            if (cancelled) return
            setReasoningTargets(reasoning); setSpeedTargets(speed); setSelected(new Set(sessions.map(session => session.id)))
            setReasoningValue(!bulk ? reasoning[0]?.current ?? DEFAULT : DEFAULT); setSpeedValue(!bulk ? speed[0]?.current ?? 'standard' : 'standard'); setLoading(false)
        })()
        return () => { cancelled = true }
    }, [api, sessions, bulk, revision])

    const targets = tab === 'reasoning' ? reasoningTargets : speedTargets
    const chosen = tab === 'reasoning' ? (reasoningValue === DEFAULT ? null : reasoningValue) : speedValue
    const options = useMemo(() => new Map(reasoningTargets.flatMap(target => target.options.map(option => [option.value ?? DEFAULT, option.label] as const))), [reasoningTargets])
    const groups = useMemo(() => [...new Set(targets.map(target => tab === 'reasoning' ? (target as ReasoningTarget).flavor : 'codex'))].sort(), [targets, tab])
    const visibleTargets = targets.filter(target => {
        const flavor = tab === 'reasoning' ? (target as ReasoningTarget).flavor : 'codex'
        return (group === 'all' || group === flavor) && `${target.title} ${flavor} ${target.model ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase())
    })
    const supports = (target: Target) => tab === 'reasoning' ? (target as ReasoningTarget).options.some(option => option.value === chosen) : !target.unavailable
    const eligible = targets.filter(target => selected.has(target.id) && !target.unavailable && supports(target))
    const selectedCount = targets.filter(target => selected.has(target.id)).length
    const apply = async () => {
        setBusy(true)
        try {
            const chosenTargets = targets.filter(target => selected.has(target.id))
            const next = tab === 'reasoning' ? await applyReasoningTargets(api, chosenTargets as ReasoningTarget[], chosen as string | null) : await applyServiceTierTargets(api, chosenTargets as ServiceTierTarget[], chosen as 'fast' | 'standard')
            setResults(next); await queryClient.invalidateQueries({ queryKey: queryKeys.sessions }); await Promise.all(chosenTargets.map(target => queryClient.invalidateQueries({ queryKey: queryKeys.session(target.id) })))
        } finally { setBusy(false) }
    }
    const toggleVisible = () => setSelected(previous => {
        const next = new Set(previous); const everyVisible = visibleTargets.length > 0 && visibleTargets.every(target => next.has(target.id))
        for (const target of visibleTargets) everyVisible ? next.delete(target.id) : next.add(target.id)
        return next
    })
    const summary = results ? `${results.filter(result => result.status === 'applied').length} applied · ${results.filter(result => result.status === 'unchanged').length} already selected · ${results.filter(result => result.status === 'skipped').length} skipped · ${results.filter(result => result.status === 'failed').length} not confirmed` : null
    const noSpeed = !loading && speedTargets.every(target => target.unavailable)
    return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="max-h-[85dvh] overflow-y-auto" onPointerDownOutside={event => { if (busy) event.preventDefault() }}><DialogHeader><DialogTitle>{bulk ? 'Bot settings across sessions' : `Bot settings: ${getSessionTitle(sessions[0])}`}</DialogTitle><DialogDescription>Changes apply to later model requests. Each bot is checked again before an update; unavailable bots stay unchanged.</DialogDescription></DialogHeader>
        <div className="mt-4 flex gap-2" role="tablist" aria-label="Bot settings"><button type="button" role="tab" aria-selected={tab === 'reasoning'} className={`rounded px-3 py-1.5 text-sm ${tab === 'reasoning' ? 'bg-[var(--app-secondary-bg)] text-[var(--app-link)]' : ''}`} onClick={() => { setTab('reasoning'); setResults(null) }}>Reasoning</button><button type="button" role="tab" aria-selected={tab === 'speed'} disabled={noSpeed} className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 ${tab === 'speed' ? 'bg-[var(--app-secondary-bg)] text-[var(--app-link)]' : ''}`} onClick={() => { setTab('speed'); setResults(null) }}>Speed</button></div>
        {loading ? <p role="status" className="py-4 text-sm">Checking supported settings…</p> : <>{!results ? <><label className="mt-4 block text-sm">{tab === 'reasoning' ? 'Requested reasoning level' : 'Requested speed'}{tab === 'reasoning' ? <select aria-label="Requested reasoning level" value={options.has(reasoningValue) ? reasoningValue : ''} disabled={busy || !options.size} onChange={event => setReasoningValue(event.target.value)} className="mt-1 w-full rounded border border-[var(--app-divider)] bg-[var(--app-bg)] p-2">{!options.has(reasoningValue) ? <option value="" disabled>Choose a supported level</option> : null}{[...options].sort(([a], [b]) => (effortOrder.indexOf(a) < 0 ? 99 : effortOrder.indexOf(a)) - (effortOrder.indexOf(b) < 0 ? 99 : effortOrder.indexOf(b)) || a.localeCompare(b)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : <select aria-label="Requested speed" value={speedValue} disabled={busy || noSpeed} onChange={event => setSpeedValue(event.target.value as 'fast' | 'standard')} className="mt-1 w-full rounded border border-[var(--app-divider)] bg-[var(--app-bg)] p-2"><option value="standard">Standard</option><option value="fast">Fast</option></select>}</label><p className="my-2 text-xs text-[var(--app-hint)]">Requested: {tab === 'reasoning' ? reasoningLabel(chosen as string | null) : chosen === 'fast' ? 'Fast' : 'Standard'}. Supported by {eligible.length} of {selectedCount} selected bots; {selectedCount - eligible.length} will be skipped.</p>{bulk ? <div className="mb-2 grid gap-2 sm:grid-cols-2"><input aria-label="Filter bots" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter bots" className="rounded border border-[var(--app-divider)] bg-[var(--app-bg)] px-2 py-1 text-sm"/><select aria-label="Filter bot group" value={group} onChange={event => setGroup(event.target.value)} className="rounded border border-[var(--app-divider)] bg-[var(--app-bg)] px-2 py-1 text-sm"><option value="all">All providers</option>{groups.map(value => <option key={value} value={value}>{value}</option>)}</select><button type="button" disabled={busy || !visibleTargets.length} className="text-left text-xs text-[var(--app-link)] disabled:opacity-40" onClick={toggleVisible}>{visibleTargets.every(target => selected.has(target.id)) ? 'Deselect filtered' : 'Select filtered'}</button></div> : null}</> : <p role="status" className="my-3 text-sm">{summary}</p>}
            <ul className="max-h-[38dvh] space-y-2 overflow-y-auto py-2">{visibleTargets.map(target => { const outcome = results?.find(result => result.id === target.id); const flavor = tab === 'reasoning' ? (target as ReasoningTarget).flavor : 'codex'; const available = !target.unavailable && supports(target); const current = tab === 'reasoning' ? reasoningLabel((target as ReasoningTarget).current) : (target as ServiceTierTarget).current === 'fast' ? 'Fast' : 'Standard'; return <li key={target.id} className="rounded border border-[var(--app-divider)] p-2 text-sm"><label className="flex items-center gap-2">{bulk && !results ? <input type="checkbox" aria-label={`Include ${target.title}`} checked={selected.has(target.id)} disabled={busy} onChange={event => setSelected(previous => { const next = new Set(previous); event.target.checked ? next.add(target.id) : next.delete(target.id); return next })} /> : null}<span className="min-w-0 break-words font-medium">{target.title}</span></label><p className="text-xs text-[var(--app-hint)] break-words">{flavor} · {target.model ?? 'Default model'} · {current}</p><p className="mt-1 text-xs break-words">{outcome ? `${outcome.status}: ${outcome.detail}` : results ? 'Not selected; unchanged.' : target.unavailable ?? (available ? 'Requested setting supported.' : 'Requested setting unsupported; will skip.')}</p></li> })}</ul>
            <div className="mt-3 flex justify-end gap-2"><button type="button" disabled={busy} className="rounded border border-[var(--app-divider)] px-3 py-2 text-sm" onClick={() => setRevision(revision + 1)}>Refresh</button>{!results ? <button type="button" disabled={busy || !eligible.length || (tab === 'reasoning' && !options.has(reasoningValue))} onClick={() => void apply()} className="rounded bg-[var(--app-link)] px-3 py-2 text-sm text-white disabled:opacity-40">{busy ? 'Applying…' : `Apply to ${eligible.length} bot${eligible.length === 1 ? '' : 's'}`}</button> : null}</div>
        </>}</DialogContent></Dialog>
}
