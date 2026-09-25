import { useState } from 'react'
import type { Machine, SessionSummary } from '@/types/api'

export const PROJECT_AGENTS = [
    ['agy', 'Antigravity'], ['codex', 'Codex'], ['claude', 'Claude'],
    ['cursor', 'Cursor'], ['copilot', 'GitHub Copilot'],
] as const
export type ProjectAgent = typeof PROJECT_AGENTS[number][0]

export function newProjectPath(root: string, category: string, name: string): string | null {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!root || !slug || slug.length > 80 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug)) return null
    const sep = root.includes('\\') ? '\\' : '/'
    return [root.replace(/[\\/]+$/, ''), 'AI-Projects', category === 'agy' ? 'antigravity' : category, slug].join(sep)
}

export function ProjectHome(props: {
    machines: Machine[]
    sessions: SessionSummary[]
    initialMachineId?: string
    onStartSession: (machineId: string, directory: string, agent?: ProjectAgent) => void
}) {
    const [machineId, setMachineId] = useState(props.initialMachineId ?? '')
    const [category, setCategory] = useState<ProjectAgent | null>(null)
    const [name, setName] = useState('')
    const machine = props.machines.find((item) => item.id === machineId) ?? props.machines[0]
    const projects = props.sessions.filter((session) => session.metadata?.machineId === machine?.id && session.metadata?.path)
    const root = machine?.metadata?.workspaceRoots?.[0] ?? ''
    const target = category ? newProjectPath(root, category, name) : null
    const uniqueProjects = [...new Map(projects.filter((session) => session.metadata?.flavor === category)
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .map((session) => [session.metadata!.path!, session] as const)).values()].sort((a, b) => b.updatedAt - a.updatedAt)

    return <div className="app-scroll-y h-full px-4 py-4 space-y-5">
        <label className="block text-sm">Computer
            <select aria-label="Project computer" value={machine?.id ?? ''} onChange={(event) => setMachineId(event.target.value)} className="mt-2 block w-full rounded-lg bg-[var(--app-subtle-bg)] p-2">
                {props.machines.map((item) => <option key={item.id} value={item.id}>{item.metadata?.displayName ?? item.metadata?.host ?? item.id}</option>)}
            </select>
        </label>
        <p className="text-sm text-[var(--app-hint)]">Choose an agent, then a project. Existing projects stay in their current folders.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PROJECT_AGENTS.map(([id, label]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)} className={`rounded-xl border p-4 text-left text-sm ${category === id ? 'border-[var(--app-link)] bg-[var(--app-subtle-bg)]' : 'border-[var(--app-divider)]'}`}>{label}</button>)}
        </div>
        {category && <>
            <section className="space-y-2">
                <h2 className="text-sm font-medium">Existing projects</h2>
                {uniqueProjects.length === 0 && <p className="text-sm text-[var(--app-hint)]">No projects from your chats in this category yet. Use All folders to choose another existing project.</p>}
                {uniqueProjects.map((session) => <button key={session.metadata!.path} type="button" onClick={() => props.onStartSession(machine!.id, session.metadata!.path!, category)} className="block w-full rounded-lg bg-[var(--app-subtle-bg)] p-3 text-left">
                    <span className="block text-sm">{session.metadata?.name ?? session.metadata?.path?.split(/[\\/]/).pop()}</span>
                    <span className="block truncate text-xs text-[var(--app-hint)]" title={session.metadata!.path}>{session.metadata!.path}</span>
                </button>)}
            </section>
            <form className="space-y-2 border-t border-[var(--app-divider)] pt-4" onSubmit={(event) => { event.preventDefault(); if (target && machine) props.onStartSession(machine.id, target, category) }}>
                <label className="block text-sm" htmlFor="project-name">New project name</label>
                <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. portfolio-site" className="w-full rounded-lg border border-[var(--app-divider)] bg-transparent p-3 text-sm" />
                {target && <p className="break-all text-xs text-[var(--app-hint)]">Location: {target}</p>}
                <button disabled={!target} className="rounded-lg bg-[var(--app-button)] px-4 py-2 text-sm text-[var(--app-button-text)] disabled:opacity-40">Continue to setup</button>
                <p className="text-xs text-[var(--app-hint)]">Review the agent and permissions before creating the project.</p>
            </form>
        </>}
    </div>
}
