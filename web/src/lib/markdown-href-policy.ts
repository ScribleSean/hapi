/**
 * Fail-closed policy for scheme-less markdown hrefs in chat.
 *
 * Product rule (#1452): never paint a clickable control that SPA-404s.
 * Use session file/folder preview within the workspace. Outside paths expose
 * details without filesystem access; known in-app routes stay navigable.
 */

import { COMMON_FILE_EXTENSIONS } from '@/lib/remark-file-path-links'

export type MarkdownHrefDecision =
    | { action: 'navigate' }
    | { action: 'file'; path: string }
    | { action: 'details'; path: string }
    | { action: 'inert' }

const STATIC_SPA_PATHS = new Set([
    '/',
    '/browse',
    '/share',
    '/sessions',
    '/settings',
    '/settings/general',
    '/settings/display',
    '/settings/chat',
    '/settings/voice',
    '/settings/voice/voices',
    '/settings/voice/advanced',
    '/settings/machines',
    '/settings/about',
    '/settings/storage',
    '/settings/usage',
])

// /sessions/<id> plus known children only (files | file | terminal).
const SESSION_SPA_PATH =
    /^\/sessions\/[^/]+(?:\/(?:files|file|terminal))?\/?$/

export function splitHrefMeta(href: string): { path: string; suffix: string } {
    const hashIdx = href.indexOf('#')
    const queryIdx = href.indexOf('?')
    let cut = -1
    if (hashIdx >= 0 && queryIdx >= 0) cut = Math.min(hashIdx, queryIdx)
    else if (hashIdx >= 0) cut = hashIdx
    else if (queryIdx >= 0) cut = queryIdx
    if (cut < 0) return { path: href, suffix: '' }
    return { path: href.slice(0, cut), suffix: href.slice(cut) }
}

function stripLineSuffix(value: string): string {
    return value.replace(/:\d+(?::\d+)?$/, '')
}

function isWindowsAbsolutePath(value: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(value)
}

export function hasKnownFileExtension(value: string): boolean {
    const path = stripLineSuffix(value).toLowerCase()
    const dot = path.lastIndexOf('.')
    if (dot < 0 || dot === path.length - 1) return false
    const ext = path.slice(dot + 1)
    return COMMON_FILE_EXTENSIONS.has(ext)
}

export function isKnownSpaHref(
    href: string,
    options: { baseUrl?: string } = {}
): boolean {
    if (href.startsWith('#') || href.startsWith('?')) return true
    if (href.startsWith('//')) return false
    const { path: raw } = splitHrefMeta(href)
    const path = raw.replace(/\/+$/, '') || '/'
    const rawBase = options.baseUrl ?? (import.meta.env.BASE_URL as string | undefined) ?? '/'
    const base = rawBase === '/' ? '' : rawBase.replace(/\/+$/, '')
    const routePath =
        base && (path === base || path.startsWith(`${base}/`))
            ? path.slice(base.length) || '/'
            : path
    if (STATIC_SPA_PATHS.has(routePath)) return true
    return SESSION_SPA_PATH.test(routePath)
}

export function inferHomeDir(workspacePath: string): string | null {
    if (workspacePath === '/root' || workspacePath.startsWith('/root/')) return '/root'
    const posix = workspacePath.match(/^(\/(?:home|Users)\/[^/]+)/)
    if (posix) return posix[1]
    const win = workspacePath.match(/^([A-Za-z]:[\\/]Users[\\/][^\\/]+)/i)
    if (win) return win[1]
    return null
}

export function expandTildePath(path: string, workspacePath: string | null | undefined): string | null {
    if (path !== '~' && !path.startsWith('~/')) return null
    if (!workspacePath) return null
    const home = inferHomeDir(workspacePath)
    if (!home) return null
    if (path === '~') return home
    const sep = home.includes('\\') && !home.includes('/') ? '\\' : '/'
    const rest = path.slice(2).replace(/\\/g, '/')
    if (sep === '\\') return `${home}\\${rest.replace(/\//g, '\\')}`
    return `${home}/${rest}`
}

/** Lexically resolve `.` / `..`; return null if `..` escapes above the root. */
export function resolveLexicalPath(absPath: string): string | null {
    const norm = isWindowsAbsolutePath(absPath) ? absPath.replace(/\\/g, '/') : absPath
    const absolute = norm.startsWith('/')
    const drive = /^[A-Za-z]:/.exec(norm)
    const parts = norm.split('/')
    const out: string[] = []
    for (const part of parts) {
        if (part === '' || part === '.') continue
        if (drive && part === drive[0]) {
            out.push(part)
            continue
        }
        if (part === '..') {
            if (out.length === 0) return null
            // Do not pop a Windows drive root segment.
            if (out.length === 1 && /^[A-Za-z]:$/.test(out[0]!)) return null
            out.pop()
            continue
        }
        out.push(part)
    }
    if (absolute) return `/${out.join('/')}`
    if (drive) {
        const [root, ...rest] = out
        return rest.length === 0 ? `${root}\\` : `${root}\\${rest.join('\\')}`
    }
    return out.join('/')
}

export function isWithinWorkspace(absPath: string, workspacePath: string): boolean {
    const target = resolveLexicalPath(absPath)
    const root = resolveLexicalPath(workspacePath)
    if (!target || !root) return false
    const normalize = (value: string) => (isWindowsAbsolutePath(value) ? value.replace(/\\/g, '/') : value).replace(/\/+$/, '')
    const normTarget = normalize(target)
    const normRoot = normalize(root)
    // Windows filesystems are case-insensitive; compare folded when both sides
    // are drive-qualified so `c:\Users\…` matches `C:\Users\…`.
    const windows = isWindowsAbsolutePath(normTarget) && isWindowsAbsolutePath(normRoot)
    const comparableTarget = windows ? normTarget.toLowerCase() : normTarget
    const comparableRoot = windows ? normRoot.toLowerCase() : normRoot
    return comparableTarget === comparableRoot || comparableTarget.startsWith(`${comparableRoot}/`)
}

function isRepoRelativeCandidate(path: string): boolean {
    if (path.includes('://')) return false
    if (path.startsWith('/') || path.startsWith('~/') || path === '~') return false
    if (path.startsWith('../') || path.includes('/../')) return false
    // Drive-qualified paths need workspace containment — never treat as relative.
    if (isWindowsAbsolutePath(path)) return false
    return hasKnownFileExtension(path)
}

/**
 * Classify a scheme-less markdown href for the chat <A> renderer.
 *
 * @param workspacePath session metadata.path when available (enables ~/ expansion + containment)
 */
export function classifyNoSchemeHref(
    href: string,
    options: { workspacePath?: string | null; decodedPath?: boolean } = {}
): MarkdownHrefDecision {
    const trimmed = href.trim()
    if (!trimmed) return { action: 'inert' }

    // Protocol-relative URLs keep browser navigation (existing policy).
    if (trimmed.startsWith('//')) return { action: 'navigate' }

    if (isKnownSpaHref(trimmed)) return { action: 'navigate' }

    const rawPath = options.decodedPath ? trimmed : splitHrefMeta(trimmed).path
    // mdast→hast percent-encodes spaces etc.; compare against literal workspace.
    let decodedPath: string
    try {
        decodedPath = options.decodedPath ? rawPath : decodeURIComponent(rawPath)
    } catch {
        return { action: 'inert' }
    }
    if (/[\x00-\x1F\x7F]/.test(decodedPath)) return { action: 'inert' }
    const path = stripLineSuffix(decodedPath)
    const workspacePath = options.workspacePath ?? null

    const unavailable = (target: string): MarkdownHrefDecision => workspacePath
        ? { action: 'details', path: target }
        : { action: 'inert' }

    // These are session paths, never URLs on the browser or hub machine.
    // The authenticated session RPC still enforces the filesystem boundary.
    if (isWindowsAbsolutePath(path) || path.startsWith('/')) {
        if (!workspacePath || !isWithinWorkspace(path, workspacePath)) return unavailable(path)
        return { action: 'file', path }
    }
    if (path.startsWith('~/') || path === '~') {
        const expanded = expandTildePath(path, workspacePath)
        if (!expanded) return unavailable(path)
        if (!workspacePath || !isWithinWorkspace(expanded, workspacePath)) return unavailable(expanded)
        return { action: 'file', path: expanded }
    }

    // Do not turn traversal, UNC paths or URI schemes into relative files.
    const windows = Boolean(workspacePath && isWindowsAbsolutePath(workspacePath))
    const parts = windows ? path.split(/[\\/]/) : path.split('/')
    if (path.startsWith('\\') || path.includes(':') || parts.includes('..')) return { action: 'inert' }

    // Explicit relative links also name folders and extensionless files.
    // Their actual type is resolved by the existing session viewer after click.
    if (isRepoRelativeCandidate(path) || (workspacePath && path)) return { action: 'file', path }
    return { action: 'inert' }
}
