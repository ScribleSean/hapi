import type { ReactNode } from 'react'

/** Keep operational details available without dominating the conversation. */
export function CompactActivity(props: {
    count: number
    running: boolean
    failed: boolean
    needsAttention: boolean
    children: ReactNode
}) {
    if (props.needsAttention) return <>{props.children}</>

    return (
        <details data-hapi-share-exclude="true" className="my-0.5 min-w-0 text-xs text-[var(--app-hint)]">
            <summary className="min-h-8 cursor-pointer rounded-md px-1 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] hover:text-[var(--app-fg)]">
                <span>Tool activity · {props.count} {props.count === 1 ? 'action' : 'actions'}</span>
                <span className={props.failed ? 'ml-2 text-red-500' : 'ml-2'}>
                    {props.failed ? 'Error' : props.running ? 'Working…' : 'Done'}
                </span>
            </summary>
            <div className="mt-1 border-l border-[var(--app-divider)] pl-2">
                {props.children}
            </div>
        </details>
    )
}
