import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionList } from '../src/components/SessionList'
import { I18nProvider } from '../src/lib/i18n-context'
import { ToastProvider } from '../src/lib/toast-context'
import type { Machine, SessionSummary } from '../src/types/api'
import '../src/index.css'

localStorage.setItem('hapi-bots-view', 'false')
localStorage.setItem('hapi-show-active-sessions-only', 'false')
const lastSeen = Date.UTC(2026, 9, 4, 12, 30)
const machine = (id: string, active: boolean): Machine => ({
    id, namespace: 'fixture', seq: 0, createdAt: lastSeen, updatedAt: lastSeen,
    active, activeAt: lastSeen, metadata: null, metadataVersion: 0,
    runnerState: null, runnerStateVersion: 0,
})
const machinesById = { mac: machine('mac', true), windows: machine('windows', false) }
const sessions: SessionSummary[] = ['claude', 'codex'].map(flavor => ({
    id: flavor, active: false, thinking: false, activeAt: lastSeen, updatedAt: lastSeen,
    metadata: { path: '/work/harness', machineId: 'windows', flavor, name: `${flavor} phone task with a long title`, agentSessionId: flavor },
    metadataVersion: 0, agentStateVersion: 0, todosUpdatedAt: 0, todoProgress: null,
    pendingRequestsCount: 0, pendingRequestKinds: [], pendingRequests: [], backgroundTaskCount: 0,
    futureScheduledMessageCount: 0, nextScheduledAt: null, model: null, effort: null, pinned: true,
}))
const mode = new URLSearchParams(location.search).get('mode')
createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={new QueryClient()}>
        <ToastProvider><I18nProvider>
            <div style={{ width: '100%', maxWidth: 600, height: '100dvh', display: 'flex', flexDirection: 'column' }}>
                <SessionList sessions={mode === 'empty' ? [] : sessions}
                    machinesById={mode === 'single' ? { windows: machinesById.windows } : machinesById}
                    machineLabelsById={mode === 'single' ? { windows: 'Windows' } : { mac: 'Mac', windows: 'Windows' }}
                    onSelect={() => {}} onNewSession={() => {}} onRefresh={() => {}}
                    isLoading={false} renderHeader={false} api={null} />
            </div>
        </I18nProvider></ToastProvider>
    </QueryClientProvider>
)
