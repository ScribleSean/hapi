import { useMemo, useState } from 'react'
import type { BurnModeState, BurnSessionStatus } from '@hapi/protocol/burnMode'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { useBurnMode } from '@/hooks/queries/useBurnMode'
import { getSessionTitle } from '@/lib/sessionTitle'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const STATUS_LABELS: Record<BurnSessionStatus, string> = {
    pending: 'Pending', applied: 'Applied', restored: 'Restored', unsupported: 'Unsupported', blocked: 'Blocked', failed: 'Failed',
}

function countStatus(state: BurnModeState, status: BurnSessionStatus): number {
    return state.sessions.filter((session) => session.status === status).length
}

export function getBurnModeSummary(state: BurnModeState | undefined): string {
    if (!state) return 'Unavailable'
    if (state.restoring) return `Restoring ${countStatus(state, 'pending')} pending`
    if (!state.enabled) return 'Off'
    const pending = countStatus(state, 'pending')
    const problems = countStatus(state, 'unsupported') + countStatus(state, 'blocked') + countStatus(state, 'failed')
    if (pending) return `${pending} pending${problems ? `, ${problems} needs attention` : ''}`
    if (problems) return `${problems} needs attention`
    return `${countStatus(state, 'applied')} applied`
}

function defaultValue(value: string | null): string { return value ?? 'Default' }

export function BurnModeControl(props: { api: ApiClient | null; sessions: SessionSummary[] }) {
    const [detailsOpen, setDetailsOpen] = useState(false)
    const burn = useBurnMode(props.api)
    const sessionNames = useMemo(() => new Map(props.sessions.map((session) => [session.id, getSessionTitle(session)])), [props.sessions])
    const state = burn.state
    const canRetryUpdates = Boolean(state?.sessions.some((session) => session.status === 'failed' || session.status === 'blocked'))
    const isSwitchDisabled = burn.isUpdating || !state
    const switchLabel = state?.enabled ? 'Turn Burn off and restore saved settings' : 'Turn Burn on for supported bots'

    return <>
        <div className="flex min-h-11 items-center gap-1 rounded-md px-1 text-xs text-[var(--app-link)]">
            <span className="pl-2 font-medium text-[var(--app-fg)]">Burn</span>
            <button type="button" role="switch" aria-checked={Boolean(state?.enabled)} aria-label={switchLabel} title={switchLabel}
                disabled={isSwitchDisabled} onClick={() => burn.setEnabled(!state?.enabled)}
                className="relative h-6 w-11 shrink-0 rounded-full bg-[var(--app-divider)] transition-colors aria-checked:bg-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]">
                <span className="sr-only">{state?.enabled ? 'On' : 'Off'}</span>
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${state?.enabled ? 'translate-x-5' : ''}`} />
            </button>
            <button type="button" className="min-h-11 rounded-md px-2 text-left text-xs text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                aria-label={`Burn status: ${getBurnModeSummary(state)}. View details`} onClick={() => setDetailsOpen(true)}>
                {burn.isLoading ? 'Loading…' : getBurnModeSummary(state)}
            </button>
        </div>
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
            <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0">
                <div className="shrink-0 px-4 pt-4">
                    <DialogHeader><DialogTitle>Burn mode</DialogTitle><DialogDescription>Ultra + Fast for supported bots. Off restores saved settings. Applies to subsequent model requests.</DialogDescription></DialogHeader>
                    {burn.readError ? <div className="mt-3 flex items-center justify-between gap-3 rounded border border-[var(--app-divider)] p-2 text-sm text-[var(--app-hint)]"><span>{burn.readError}</span><button type="button" className="min-h-11 rounded px-2 text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]" onClick={() => { void burn.refetch() }}>Retry</button></div> : null}
                    {burn.updateError ? <p role="alert" className="mt-3 text-sm text-[var(--app-badge-warning-text)]">{burn.updateError}</p> : null}
                    {burn.retryError ? <p role="alert" className="mt-3 text-sm text-[var(--app-badge-warning-text)]">{burn.retryError}</p> : null}
                    {state && canRetryUpdates ? <button type="button" disabled={burn.isRetrying} className="mt-3 min-h-11 rounded-md px-3 text-sm text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-45" onClick={() => burn.retryFailed()}>{burn.isRetrying ? 'Retrying failed updates…' : 'Retry failed updates'}</button> : null}
                </div>
                {state ? <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-3">
                    <p className="mb-2 text-sm text-[var(--app-hint)]">{state.restoring ? 'Restoring saved settings.' : state.enabled ? 'Applying where supported.' : 'Burn mode is off.'}</p>
                    <ul className="space-y-2" aria-label="Burn mode session results">
                        {state.sessions.map((session) => <li key={session.sessionId} className="rounded border border-[var(--app-divider)] p-2 text-sm">
                            <div className="flex items-start justify-between gap-3"><span className="font-medium break-words">{sessionNames.get(session.sessionId) ?? 'Unavailable session'}</span><span className="shrink-0 text-xs text-[var(--app-hint)]">{STATUS_LABELS[session.status]}</span></div>
                            <p className="mt-1 text-xs text-[var(--app-hint)]">{session.detail}</p>
                            {session.previous ? <p className="mt-1 text-xs text-[var(--app-hint)]">Saved: reasoning {defaultValue(session.previous.modelReasoningEffort)} · tier {defaultValue(session.previous.serviceTier)}</p> : null}
                        </li>)}
                    </ul>
                </div> : null}
            </DialogContent>
        </Dialog>
    </>
}
