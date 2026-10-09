import { useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import { canApplyTaskPick, type TaskPickOption } from '@/lib/taskPicker'

export function TaskAutoPicker(props: {
    api: ApiClient
    machineId: string | null
    harness: string
    directory: string
    selection: string
    unavailableReason?: string
    options: TaskPickOption[]
    disabled: boolean
    onPick: (option: TaskPickOption) => void
    onBusyChange: (busy: boolean) => void
}) {
    const [brief, setBrief] = useState('')
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [status, setStatus] = useState<{ ready: boolean; reason: string | null } | null>(null)
    const mounted = useRef(true)
    const inFlight = useRef(false)
    const context = JSON.stringify([props.machineId, props.harness, props.directory, props.selection])
    const current = useRef({ context, brief, props })
    current.current = { context, brief, props }
    useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
    }, [])
    async function choose() {
        if (inFlight.current || !props.machineId || props.disabled) return
        inFlight.current = true
        const requestContext = context
        const requestBrief = brief
        setBusy(true)
        props.onBusyChange(true)
        setMessage('Choosing a model and supported reasoning level…')
        try {
            const result = await props.api.chooseTaskModel({
                machineId: props.machineId, harness: props.harness,
                brief, options: props.options,
            })
            const latest = current.current
            if (!mounted.current) return
            if (!canApplyTaskPick({
                requestedContext: requestContext, currentContext: latest.context,
                requestedBrief: requestBrief, currentBrief: latest.brief,
                option: result.option, availableOptions: latest.props.options,
                disabled: latest.props.disabled,
            })) {
                setMessage('The task or available options changed. No selection applied.')
                return
            }
            latest.props.onPick(result.option)
            setMessage(`Selected ${result.option.model}${result.option.effort ? ` · ${result.option.effort}` : ''}. You can override it below.`)
        } catch (error) {
            if (mounted.current) setMessage(error instanceof Error ? error.message : 'Picker unavailable. Choose manually.')
        } finally {
            inFlight.current = false
            props.onBusyChange(false)
            if (mounted.current) setBusy(false)
        }
    }
    return (
        <details className="px-3 py-3" onToggle={(event) => {
            if (!event.currentTarget.open) return
            void props.api.getTaskPickerStatus().then(result => {
                if (mounted.current) setStatus(result)
            }).catch(() => {
                if (mounted.current) setStatus({ ready: false, reason: 'This hub does not have the Jev experiment enabled yet.' })
            })
        }}>
            <summary className="cursor-pointer text-sm font-medium">Auto choose with Jev <span className="text-xs text-[var(--app-hint)]">Experimental</span></summary>
            <div className="mt-3 space-y-2">
                <p className="text-xs text-[var(--app-hint)]">Chooses within {props.harness} for a new task. Only this brief goes to TypeSafe. Existing chats and permissions stay unchanged.</p>
                <textarea aria-label="Task brief for automatic model selection" maxLength={2000} rows={3}
                    className="w-full rounded border border-[var(--app-divider)] bg-[var(--app-input-background)] p-2 text-sm"
                    placeholder="What should this task accomplish? Leave out secrets."
                    value={brief} disabled={busy || props.disabled} onChange={event => setBrief(event.target.value)} />
                {status?.reason ? <p className="text-xs text-[var(--app-hint)]">{status.reason}</p> : null}
                {props.unavailableReason ? <p className="text-xs text-[var(--app-hint)]">{props.unavailableReason}</p> : null}
                <button type="button" className="rounded bg-[var(--app-button)] px-3 py-2 text-sm text-[var(--app-button-text)] disabled:opacity-50"
                    disabled={busy || props.disabled || !props.machineId || !status?.ready || brief.trim().length < 5 || !props.options.length}
                    onClick={() => void choose()}>{busy ? 'Choosing…' : 'Auto choose'}</button>
                <p role="status" className="text-xs text-[var(--app-hint)]">{message || (!props.options.length ? 'Waiting for a supported model catalog.' : 'Automatically applies the selection to the form. It does not start the task.')}</p>
            </div>
        </details>
    )
}
