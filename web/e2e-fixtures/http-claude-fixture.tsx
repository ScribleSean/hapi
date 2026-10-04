import { createRoot } from 'react-dom/client'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionChat } from '../src/components/SessionChat'
import { I18nProvider } from '../src/lib/i18n-context'
import { ToastProvider } from '../src/lib/toast-context'
import type { ApiClient } from '../src/api/client'
import type { DecryptedMessage, Session } from '../src/types/api'
import '../src/index.css'

declare global {
    interface Window {
        fixtureCalls: string[]
        fixturePrompts: string[]
    }
}
window.fixtureCalls = []
window.fixturePrompts = []
const params = new URLSearchParams(location.search)
const external = !params.has('native')
const session: Session = {
    id: 'http-claude', namespace: 'fixture', seq: 0, createdAt: 1, updatedAt: 1,
    active: true, activeAt: 1, thinking: params.has('thinking'), thinkingAt: 0,
    metadata: {
        flavor: 'claude', version: external ? 'claude-http-v1' : 'native',
        path: '/work/harness', host: 'Windows', machineId: 'windows', name: 'HTTP Claude',
        claudeSessionId: 'native-thread', startingMode: 'remote',
        capabilities: { terminal: !external || params.has('capabilities'), concurrentClients: params.has('capabilities') },
    },
    metadataVersion: 0, agentState: null, agentStateVersion: 0,
    model: 'claude-sonnet-4-6', modelReasoningEffort: null, effort: 'high', permissionMode: 'default', serviceTier: null,
}
const messages: DecryptedMessage[] = [{
    id: 'transcript', seq: 1, localId: 'external-transcript:1', createdAt: 1, invokedAt: 1,
    content: { role: 'user', content: { type: 'text', text: 'Existing HTTP transcript remains readable.' } },
}]
const methods: Record<string, (...args: unknown[]) => unknown> = {
    getSessions: async () => ({ sessions: [] }),
    getMachines: async () => ({ machines: [] }),
    getScratchlist: async () => ({ entries: [] }),
    getHubSettings: async () => ({ sessionSummaryInChat: false }),
}
const api = new Proxy(methods, {
    get(target, key: string) {
        return (...args: unknown[]) => {
            window.fixtureCalls.push(key)
            if (target[key]) return target[key](...args)
            return Promise.reject(new Error(`Unexpected fixture API: ${key}`))
        }
    },
}) as unknown as ApiClient

function Fixture() {
    return (
        <div style={{ height: '100dvh' }}>
            <SessionChat session={session} api={api} messages={messages}
                messagesWarning={null} hasMoreMessages={false} isSyncingTail={false}
                isLoadingMoreMessages={false} isSending={false} sendSettlement={null}
                viewMode="tail" messagesVersion={1} historyVersion={0} tailRevision={0}
                onBack={() => {}} onRefresh={() => {}} onCancelLoadMore={() => {}}
                onLoadMore={async () => ({ kind: 'stopped', reason: 'exhausted' })} onViewModeChange={() => {}}
                onSend={async text => {
                    window.fixturePrompts.push(text)
                    return { attemptId: `prompt-${window.fixturePrompts.length}` }
                }} />
        </div>
    )
}
const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
})
createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><I18nProvider><RouterProvider router={router} /></I18nProvider></ToastProvider>
    </QueryClientProvider>
)
