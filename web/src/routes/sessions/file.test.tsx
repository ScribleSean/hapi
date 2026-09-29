import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/lib/toast-context'
import { formatFileMetadata } from '@/lib/file-metadata'
import { encodeBase64 } from '@/lib/utils'
import FilePage from './file'

const goBackMock = vi.fn()
const copyMock = vi.hoisted(() => vi.fn())
const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    path: 'docs/README.md',
    origin: undefined as 'chat' | undefined,
    staged: undefined as boolean | undefined,
    api: {
        getGitDiffFile: vi.fn(),
        readSessionFile: vi.fn(),
        listSessionDirectory: vi.fn(),
    },
}))

const sampleMarkdown = '# Heading\n\n| Col A | Col B |\n| --- | --- |\n| one | two |'
const filePath = 'docs/README.md'
const encodedContent = encodeBase64(sampleMarkdown)
const fileSize = 1024
const fileModified = 1_784_175_060_000

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' }),
    useNavigate: () => mocks.navigate,
    useSearch: () => ({
        path: encodeBase64(mocks.path),
        staged: mocks.staged,
        origin: mocks.origin,
    }),
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: mocks.api,
    }),
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => goBackMock,
}))

vi.mock('@/hooks/useCopyToClipboard', () => ({
    useCopyToClipboard: () => ({
        copied: false,
        copy: copyMock,
    }),
}))

vi.mock('@/lib/shiki', () => ({
    langAlias: { md: 'markdown' },
    useShikiHighlighter: (content: string) => content,
}))

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownRenderer: (props: { content: string }) => (
        <div data-testid="markdown-preview">{props.content}</div>
    ),
}))

function renderWithProviders() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <ToastProvider>
                    <FilePage />
                </ToastProvider>
            </I18nProvider>
        </QueryClientProvider>
    )
}

beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    mocks.path = filePath
    mocks.origin = undefined
    mocks.staged = undefined
    mocks.api.getGitDiffFile.mockReset().mockResolvedValue({ success: true, stdout: '' })
    mocks.api.readSessionFile.mockReset().mockResolvedValue({
        success: true,
        content: encodedContent,
        size: fileSize,
        modified: fileModified,
    })
    mocks.api.listSessionDirectory.mockReset()
})

describe('FilePage markdown preview', () => {
    it('renders markdown preview by default and toggles to source', async () => {
        renderWithProviders()

        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Heading')
        })
        expect(screen.getByText(formatFileMetadata(fileSize, fileModified, 'en')!)).toBeInTheDocument()
        expect(screen.getAllByText(filePath)).toHaveLength(1)
        const previewCopyButton = screen.getByRole('button', { name: 'Copy file content' })
        expect(previewCopyButton.closest('[data-hapi-file-content-header="true"]')).not.toBeNull()
        expect(previewCopyButton).not.toHaveClass('absolute')
        fireEvent.click(previewCopyButton)
        expect(copyMock).toHaveBeenCalledWith(sampleMarkdown)
        expect(screen.getByRole('button', { name: 'Preview' })).toHaveClass('opacity-80')

        fireEvent.click(screen.getByRole('button', { name: 'Source' }))

        await waitFor(() => {
            expect(screen.getByRole('code')).toHaveTextContent('# Heading')
        })
        const sourcePreview = screen.getByRole('code').closest('[data-hapi-file-source-preview="true"]')
        const sourceCopyButton = screen.getByRole('button', { name: 'Copy file content' })
        expect(sourcePreview).not.toBeNull()
        expect(sourcePreview).toContainElement(sourceCopyButton)
        expect(sourceCopyButton.closest('[data-hapi-file-content-header="true"]')).not.toBeNull()
        expect(sourceCopyButton).not.toHaveClass('absolute')
        expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
    })

    it('uses the shared code-wrap preference for the source preview', async () => {
        window.localStorage.setItem('hapi-code-wrap', '1')
        renderWithProviders()

        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
        fireEvent.click(screen.getByRole('button', { name: 'Source' }))

        await waitFor(() => {
            expect(screen.getByRole('code')).toHaveTextContent('# Heading')
        })
        const sourceCode = screen.getByRole('code')
        const sourcePre = sourceCode.closest('pre')
        const wrapToggle = screen.getByRole('button', { pressed: true })

        expect(wrapToggle).toBeInTheDocument()
        expect(sourcePre).toHaveStyle({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' })

        fireEvent.click(wrapToggle)

        expect(screen.getByRole('button', { pressed: false })).toBeInTheDocument()
        expect(sourcePre).toHaveStyle({ whiteSpace: 'pre' })
        expect(window.localStorage.getItem('hapi-code-wrap')).toBeNull()
    })

    it('preserves the file preview scroll position across route remounts', async () => {
        const firstRender = renderWithProviders()

        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
        const firstScrollRegion = document.querySelector('[data-hapi-file-scroll="true"]') as HTMLElement
        expect(firstScrollRegion).not.toBeNull()
        firstScrollRegion.scrollTop = 123
        firstRender.unmount()

        renderWithProviders()
        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
        const secondScrollRegion = document.querySelector('[data-hapi-file-scroll="true"]') as HTMLElement
        expect(secondScrollRegion.scrollTop).toBe(123)
    })
})

describe('FilePage chat directory links', () => {
    it.each(['reports', 'release.md', 'reports/Quarter One'])('opens the exact folder %s and keeps child files in the same session', async (path) => {
        mocks.path = path
        mocks.origin = 'chat'
        mocks.api.readSessionFile.mockResolvedValue({ success: false, error: 'EISDIR: directory cannot be read as a file' })
        mocks.api.listSessionDirectory.mockResolvedValue({
            success: true,
            entries: [{ name: 'notes.md', type: 'file' }],
        })
        mocks.api.getGitDiffFile.mockResolvedValue({ success: false, error: 'No diff available for this folder' })

        renderWithProviders()

        const child = await screen.findByRole('button', { name: 'notes.md' })
        expect(mocks.api.readSessionFile).toHaveBeenCalledWith('session-1', path)
        expect(mocks.api.listSessionDirectory).toHaveBeenCalledExactlyOnceWith('session-1', path)
        expect(screen.queryByText(/EISDIR/)).not.toBeInTheDocument()
        expect(screen.queryByText(/No diff available/)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Source' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument()
        expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()

        fireEvent.click(child)
        expect(mocks.navigate).toHaveBeenCalledWith(expect.objectContaining({
            to: '/sessions/$sessionId/file',
            params: { sessionId: 'session-1' },
            search: { path: encodeBase64(`${path}/notes.md`), origin: 'chat' },
        }))
    })

    it('requires successful directory listing even when the folder is empty', async () => {
        mocks.path = 'empty'
        mocks.origin = 'chat'
        mocks.api.readSessionFile.mockResolvedValue({ success: false, error: 'EISDIR' })
        mocks.api.listSessionDirectory.mockResolvedValue({ success: true, entries: [] })

        renderWithProviders()

        expect(await screen.findByRole('button', { name: 'empty' })).toBeInTheDocument()
        expect(screen.queryByText(/EISDIR/)).not.toBeInTheDocument()
        expect(mocks.api.listSessionDirectory).toHaveBeenCalledExactlyOnceWith('session-1', 'empty')
    })

    it('does not query directories after a successful regular file read', async () => {
        mocks.origin = 'chat'
        renderWithProviders()

        expect(await screen.findByTestId('markdown-preview')).toBeInTheDocument()
        expect(mocks.api.listSessionDirectory).not.toHaveBeenCalled()
    })

    it.each([
        { origin: undefined, staged: undefined },
        { origin: 'chat' as const, staged: true },
        { origin: 'chat' as const, staged: false },
    ])('does not fall back for a regular viewer or diff route: %j', async ({ origin, staged }) => {
        mocks.origin = origin
        mocks.staged = staged
        mocks.api.readSessionFile.mockResolvedValue({ success: false, error: 'EISDIR' })
        renderWithProviders()

        expect(await screen.findByText(/EISDIR/)).toBeInTheDocument()
        expect(mocks.api.listSessionDirectory).not.toHaveBeenCalled()
    })

    it.each(['ENOENT: no such file or directory', 'Access denied: path is outside the working directory', 'RPC target is disconnected'])(
        'keeps a failed directory result visible: %s',
        async (error) => {
            mocks.path = 'unavailable'
            mocks.origin = 'chat'
            mocks.api.readSessionFile.mockResolvedValue({ success: false, error: 'Failed to read file' })
            mocks.api.listSessionDirectory.mockResolvedValue({ success: false, error })
            renderWithProviders()

            expect(await screen.findByText((text) => text.includes(error))).toBeInTheDocument()
            expect(screen.queryByRole('button', { name: 'unavailable' })).not.toBeInTheDocument()
            expect(mocks.api.listSessionDirectory).toHaveBeenCalledExactlyOnceWith('session-1', 'unavailable')
        },
    )

    it('keeps a transport error visible without attempting another endpoint', async () => {
        mocks.origin = 'chat'
        mocks.api.readSessionFile.mockRejectedValue(new Error('Connection unavailable'))
        renderWithProviders()

        expect(await screen.findByText(/Connection unavailable/)).toBeInTheDocument()
        expect(mocks.api.listSessionDirectory).not.toHaveBeenCalled()
    })

    it('preserves a meaningful file error when the directory probe fails differently', async () => {
        mocks.origin = 'chat'
        mocks.api.readSessionFile.mockResolvedValue({ success: false, error: 'EACCES: permission denied reading this file' })
        mocks.api.listSessionDirectory.mockResolvedValue({ success: false, error: 'ENOTDIR: not a directory' })
        renderWithProviders()

        expect(await screen.findByText(/EACCES: permission denied/)).toBeInTheDocument()
        expect(mocks.api.listSessionDirectory).toHaveBeenCalledWith('session-1', filePath)
        expect(screen.queryByText(/ENOTDIR/)).not.toBeInTheDocument()
    })
})
