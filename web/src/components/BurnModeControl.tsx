import { useMemo, useState } from 'react'
import type { BurnModeState, BurnSessionStatus } from '@hapi/protocol/burnMode'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { useBurnMode } from '@/hooks/queries/useBurnMode'
import { getSessionTitle } from '@/lib/sessionTitle'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const STATUS_LABELS: Record<BurnSessionStatus, string> = {
    pending: 'Pending', applied: 'Applied', restored: 'Restored', unsupported: 'No controls', blocked: 'Blocked', failed: 'Failed',
}

function countStatus(state: BurnModeState, status: BurnSessionStatus): number {
    return state.sessions.filter((session) => session.status === status).length
}

export function getBurnModeSummary(state: BurnModeState | undefined): string {
    if (!state) return 'Unavailable'
    const blockedOrFailed = countStatus(state, 'blocked') + countStatus(state, 'failed')
    const unsupported = countStatus(state, 'unsupported')
    if (state.restoring) {
        const pending = countStatus(state, 'pending')
        if (blockedOrFailed) return `Restore needs attention: ${blockedOrFailed}`
        return pending ? `Restoring ${pending}` : 'Restoring saved settings'
    }
    if (!state.enabled) return 'Off'
    const pending = countStatus(state, 'pending')
    if (blockedOrFailed) return `${blockedOrFailed} needs attention${unsupported ? `, ${unsupported} no controls` : ''}`
    if (pending) return `${pending} pending${unsupported ? `, ${unsupported} no controls` : ''}`
    if (unsupported) return `${unsupported} no controls`
    return `${countStatus(state, 'applied')} applied`
}

function defaultValue(value: string | null): string { return value ?? 'Default' }

function savedSettings(previous: BurnModeState['sessions'][number]['previous']): string | null {
    if (!previous) return null
    const withEffort = previous as typeof previous & { effort?: string | null }
    if (Object.prototype.hasOwnProperty.call(withEffort, 'effort')) return `Saved: effort ${defaultValue(withEffort.effort ?? null)}`
    return `Saved: reasoning ${defaultValue(previous.modelReasoningEffort)} · tier ${defaultValue(previous.serviceTier)}`
}

function FlameIcon({ animated = false }: { animated?: boolean }) {
    return <svg viewBox="0 0 24 24" fill="none" className={`h-5 w-5 ${animated ? 'motion-safe:animate-pulse motion-reduce:animate-none' : ''}`} aria-hidden="true">
        <path d="M13.7 2.8c.4 3-1.7 4.2-2.2 6.2-.4-1-1.4-1.9-2.8-2.7.1 3.1-3.3 4.8-3.3 8.3 0 4.1 2.9 6.6 6.6 6.6 3.8 0 6.6-2.7 6.6-6.7 0-4-2.9-6.5-4.9-11.7Z" fill="currentColor" opacity=".95" />
        <path d="M12.3 10.5c.1 2-1.7 2.9-1.7 5 0 1.6.8 2.6 2 2.6 1.3 0 2.2-1 2.2-2.7 0-1.5-1-2.8-2.5-4.9Z" fill="white" opacity=".7" />
    </svg>
}

export function BurnModeControl(props: { api: ApiClient | null; sessions: SessionSummary[] }) {
    const [detailsOpen, setDetailsOpen] = useState(false)
    const burn = useBurnMode(props.api)
    const sessionNames = useMemo(() => new Map(props.sessions.map((session) => [session.id, getSessionTitle(session)])), [props.sessions])
    const state = burn.state
    const canRetryUpdates = Boolean(state?.sessions.some((session) => session.status === 'failed' || session.status === 'blocked'))
    const isSwitchDisabled = burn.isUpdating || !state
    const switchLabel = state?.enabled ? 'Turn Burn off and restore saved settings' : 'Turn Burn on for supported bots'
    const statusSummary = burn.readError ? 'Unavailable (stale)' : getBurnModeSummary(state)
    const enabledTextStyle = state?.enabled ? { color: 'light-dark(#9a3412, #fdba74)' } : undefined

    return <>
        <div style={enabledTextStyle} className={`flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs transition-colors ${state?.enabled ? 'bg-orange-500/10 shadow-[0_0_20px_rgba(249,115,22,0.18)]' : 'text-[var(--app-link)]'}`}>
            <span className={`flex min-h-11 items-center gap-1.5 pl-2 font-semibold ${state?.enabled ? '' : 'text-[var(--app-fg)]'}`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${state?.enabled ? 'bg-gradient-to-br from-amber-300 via-orange-500 to-red-500 text-white shadow-[0_0_14px_rgba(249,115,22,0.7)]' : 'bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'}`}><FlameIcon animated={Boolean(state?.enabled)} /></span>
                Burn
            </span>
            <button type="button" role="switch" aria-checked={Boolean(state?.enabled)} aria-label={switchLabel} title={switchLabel}
                disabled={isSwitchDisabled} onClick={() => burn.setEnabled(!state?.enabled)}
                className="relative flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                <span className="sr-only">{state?.enabled ? 'On' : 'Off'}</span>
                <span aria-hidden="true" className={`absolute h-6 w-11 rounded-full transition-colors ${state?.enabled ? 'bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 shadow-[0_0_12px_rgba(249,115,22,0.65)]' : 'bg-[var(--app-divider)]'}`} />
                <span aria-hidden="true" className={`absolute left-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${state?.enabled ? 'translate-x-5 text-orange-500' : ''}`}>{state?.enabled ? <FlameIcon /> : null}</span>
            </button>
            <button type="button" style={enabledTextStyle} className="min-h-11 min-w-0 rounded-md px-2 text-left text-xs text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                aria-label={`Burn status: ${statusSummary}. View details`} onClick={() => setDetailsOpen(true)}>
                {burn.isLoading ? 'Loading…' : statusSummary}
            </button>
            {burn.updateError ? <span role="alert" className="max-w-24 truncate text-xs text-[var(--app-badge-warning-text)]" title={burn.updateError}>Update failed</span> : null}
        </div>
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
            <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0">
                <div className="shrink-0 px-4 pt-4">
                    <DialogHeader><DialogTitle>Burn mode</DialogTitle><DialogDescription>Uses the highest available reasoning and speed for each capable bot. Turn it off to restore each bot’s saved settings.</DialogDescription></DialogHeader>
                    {burn.readError ? <div className="mt-3 flex items-center justify-between gap-3 rounded border border-[var(--app-divider)] p-2 text-sm text-[var(--app-hint)]"><span>{burn.readError}</span><button type="button" className="min-h-11 rounded px-2 text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]" onClick={() => { void burn.refetch() }}>Retry</button></div> : null}
                    {burn.updateError ? <p role="alert" className="mt-3 text-sm text-[var(--app-badge-warning-text)]">{burn.updateError}</p> : null}
                    {burn.retryError ? <p role="alert" className="mt-3 text-sm text-[var(--app-badge-warning-text)]">{burn.retryError}</p> : null}
                    {state && canRetryUpdates ? <button type="button" disabled={burn.isRetrying} className="mt-3 min-h-11 rounded-md px-3 text-sm text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-45" onClick={() => burn.retryFailed()}>{burn.isRetrying ? 'Retrying failed updates…' : 'Retry failed updates'}</button> : null}
                </div>
                {state ? <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-3">
                    <p className="mb-2 text-sm text-[var(--app-hint)]">{state.restoring ? 'Restoring exact saved settings.' : state.enabled ? 'Applying the highest supported settings where available.' : 'Burn mode is off; saved settings are restored.'}</p>
                    <ul className="space-y-2" aria-label="Burn mode session results">
                        {state.sessions.map((session) => <li key={session.sessionId} className="rounded border border-[var(--app-divider)] p-2 text-sm">
                            <div className="flex items-start justify-between gap-3"><span className="font-medium break-words">{sessionNames.get(session.sessionId) ?? 'Unavailable session'}</span><span className="shrink-0 text-xs text-[var(--app-hint)]">{STATUS_LABELS[session.status]}</span></div>
                            <p className="mt-1 text-xs text-[var(--app-hint)]">{session.detail}</p>
                            {savedSettings(session.previous) ? <p className="mt-1 text-xs text-[var(--app-hint)]">{savedSettings(session.previous)}</p> : null}
                        </li>)}
                    </ul>
                </div> : null}
            </DialogContent>
        </Dialog>
    </>
}
