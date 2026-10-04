import type { ReactNode } from 'react'
import type { Session } from '@/types/api'
import { isExternalClaudeSession } from '@/lib/sessionTransport'
import { useTranslation } from '@/lib/use-translation'

export function SessionRunnerGate(props: { session: Session; onBack: () => void; children: ReactNode }) {
    const { t } = useTranslation()
    if (!isExternalClaudeSession(props.session.metadata)) return props.children
    return (
        <div className="p-4 text-sm text-[var(--app-hint)]">
            <p>{t('session.external.controlsUnavailable')}</p>
            <button type="button" onClick={props.onBack} className="mt-3 text-[var(--app-link)]">
                {t('session.external.backToChat')}
            </button>
        </div>
    )
}
