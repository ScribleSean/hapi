import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/lib/toast-context'
import { DEFAULT_DIRECTORY_SORT } from '@/lib/directory-sort'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'

const mocks = vi.hoisted(() => ({
    useSessionDirectory: vi.fn(),
    entries: [
        { name: 'README.md', type: 'file' as const, size: 12, modified: 1_784_175_060_000 },
        { name: 'src', type: 'directory' as const },
    ] as Array<{ name: string; type: 'file' | 'directory'; size?: number; modified?: number }>,
}))

vi.mock('@/hooks/queries/useSessionDirectory', () => ({
    useSessionDirectory: (...args: unknown[]) => {
        mocks.useSessionDirectory(...args)
        return {
            entries: mocks.entries,
            error: null,
            isLoading: false,
            refetch: vi.fn(),
        }
    },
}))

function renderTree(handlers: {
    onOpenFile?: (path: string) => void
    onRequestFileMenu?: (path: string, point: { x: number; y: number }) => void
    rootPath?: string
    rootEntries?: Array<{ name: string; type: 'file' | 'directory' }>
} = {}) {
    const onOpenFile = handlers.onOpenFile ?? vi.fn()
    const onRequestFileMenu = handlers.onRequestFileMenu ?? vi.fn()

    const result = render(
        <I18nProvider>
            <ToastProvider>
                <DirectoryTree
                    api={{} as never}
                    sessionId="session-1"
                    rootLabel="project"
                    rootPath={handlers.rootPath}
                    rootEntries={handlers.rootEntries}
                    onOpenFile={onOpenFile}
                    onRequestFileMenu={onRequestFileMenu}
                    sort={DEFAULT_DIRECTORY_SORT}
                />
            </ToastProvider>
        </I18nProvider>
    )

    return { ...result, onOpenFile, onRequestFileMenu }
}

/** The file name button (a directory row's download button also mentions the name in its aria-label). */
function fileRow(): HTMLButtonElement {
    return screen.getByText('README.md').closest('button') as HTMLButtonElement
}

beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
})

describe('DirectoryTree target roots', () => {
    it.each([
        ['reports', 'reports/README.md'],
        ['reports/', 'reports/README.md'],
        ['/work/project/release.md', '/work/project/release.md/README.md'],
        ['/', '/README.md'],
        ['C:\\work\\reports', 'C:\\work\\reports/README.md'],
        ['C:\\reports', 'C:\\reports/README.md'],
    ])('expands the target root %s and opens its child path', (rootPath, childPath) => {
        const { onOpenFile } = renderTree({ rootPath })

        expect(mocks.useSessionDirectory).toHaveBeenCalledWith({}, 'session-1', rootPath, { enabled: true })
        fireEvent.click(fileRow())
        expect(onOpenFile).toHaveBeenCalledWith(childPath)
    })

    it('uses supplied root entries without requesting the root again', () => {
        renderTree({ rootPath: 'reports', rootEntries: [{ name: 'summary.md', type: 'file' }] })

        expect(screen.getByRole('button', { name: 'summary.md' })).toBeInTheDocument()
        expect(screen.queryByText('README.md')).not.toBeInTheDocument()
        expect(mocks.useSessionDirectory).toHaveBeenCalledWith({}, 'session-1', 'reports', { enabled: false })
    })

    it('keeps root expansion storage separate from other targets and the workspace tree', () => {
        const first = renderTree({ rootPath: 'reports' })
        fireEvent.click(screen.getByRole('button', { name: 'project' }))
        expect(screen.queryByText('README.md')).not.toBeInTheDocument()
        first.unmount()

        const second = renderTree({ rootPath: 'release.md' })
        expect(fileRow()).toBeInTheDocument()
        second.unmount()

        renderTree()
        expect(fileRow()).toBeInTheDocument()
    })
})

afterEach(() => cleanup())

describe('DirectoryTree file context menu', () => {
    it('requests the menu on right-click with the entry path and pointer', () => {
        const { onRequestFileMenu } = renderTree()

        fireEvent.contextMenu(fileRow(), { clientX: 321, clientY: 123 })

        expect(onRequestFileMenu).toHaveBeenCalledWith('README.md', { x: 321, y: 123 })
    })

    it('requests the menu on touch long-press and does not open the file on release', () => {
        vi.useFakeTimers()
        try {
            const { onOpenFile, onRequestFileMenu } = renderTree()

            fireEvent.touchStart(fileRow(), { touches: [{ clientX: 44, clientY: 55 }] })
            act(() => {
                vi.advanceTimersByTime(600)
            })

            expect(onRequestFileMenu).toHaveBeenCalledWith('README.md', { x: 44, y: 55 })
            expect(onOpenFile).not.toHaveBeenCalled()

            fireEvent.touchEnd(fileRow(), { changedTouches: [{ clientX: 44, clientY: 55 }] })
            expect(onOpenFile).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })
})
