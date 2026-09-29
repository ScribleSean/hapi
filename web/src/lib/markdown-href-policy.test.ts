import { describe, expect, it } from 'vitest'
import {
    classifyNoSchemeHref,
    expandTildePath,
    isKnownSpaHref,
    splitHrefMeta,
} from '@/lib/markdown-href-policy'

describe('splitHrefMeta', () => {
    it('strips #fragment for file targets', () => {
        expect(splitHrefMeta('docs/foo.md#section')).toEqual({
            path: 'docs/foo.md',
            suffix: '#section',
        })
    })

    it('strips query before fragment when both present', () => {
        expect(splitHrefMeta('docs/foo.md?x=1#y')).toEqual({
            path: 'docs/foo.md',
            suffix: '?x=1#y',
        })
    })
})

describe('isKnownSpaHref', () => {
    it.each([
        '/settings',
        '/settings/general',
        '/sessions',
        '/sessions/abc-def',
        '/sessions/abc/file',
        '/sessions/abc/files',
        '/sessions/abc/terminal',
        '/browse',
        '/share',
        '#section',
        '?q=1',
        '/',
    ])('treats %s as SPA', (href) => {
        expect(isKnownSpaHref(href)).toBe(true)
    })

    it.each([
        '/home/user/proj/docs/a.md',
        '~/proj/docs/a.md',
        'docs/foo.md',
        './foo',
        '../escape.md',
        '//example.com/path',
        '/settings/typo',
        '/browse/extra',
        '/sessions/id/unknown',
        '/share/extra',
    ])('does not treat %s as SPA', (href) => {
        expect(isKnownSpaHref(href)).toBe(false)
    })

    it('strips Vite BASE_URL prefix before SPA allowlist checks', () => {
        expect(isKnownSpaHref('/hapi/settings', { baseUrl: '/hapi/' })).toBe(true)
        expect(isKnownSpaHref('/hapi/sessions/abc/file', { baseUrl: '/hapi/' })).toBe(true)
        expect(isKnownSpaHref('/hapi/settings/typo', { baseUrl: '/hapi/' })).toBe(false)
    })
})

describe('expandTildePath', () => {
    it('expands ~/ against /home/<user> workspace', () => {
        expect(expandTildePath('~/coding/hapi/docs/a.md', '/home/ada/coding/hapi')).toBe(
            '/home/ada/coding/hapi/docs/a.md'
        )
    })

    it('expands ~/ against /root workspaces', () => {
        expect(expandTildePath('~/hapi/docs/a.md', '/root/hapi')).toBe('/root/hapi/docs/a.md')
    })

    it('returns null without workspace metadata', () => {
        expect(expandTildePath('~/docs/a.md', null)).toBeNull()
    })
})

describe('classifyNoSchemeHref — fail-closed (#1452)', () => {
    const workspace = '/home/ada/coding/hapi'

    it('keeps allowlisted relative file targets as file preview', () => {
        expect(classifyNoSchemeHref('docs/foo.md')).toEqual({
            action: 'file',
            path: 'docs/foo.md',
        })
    })

    it('opens ./prefixed allowlisted files in preview', () => {
        expect(classifyNoSchemeHref('./diagram.mmd')).toEqual({
            action: 'file',
            path: './diagram.mmd',
        })
    })

    it('strips #fragment and still opens allowlisted relative files', () => {
        expect(classifyNoSchemeHref('docs/foo.md#section')).toEqual({
            action: 'file',
            path: 'docs/foo.md',
        })
    })

    it('routes in-workspace absolute paths to file preview', () => {
        expect(classifyNoSchemeHref('/home/ada/coding/hapi/docs/a.md', { workspacePath: workspace })).toEqual({
            action: 'file',
            path: '/home/ada/coding/hapi/docs/a.md',
        })
    })

    it('expands in-workspace ~/ paths to absolute file preview targets', () => {
        expect(classifyNoSchemeHref('~/coding/hapi/docs/a.md', { workspacePath: workspace })).toEqual({
            action: 'file',
            path: '/home/ada/coding/hapi/docs/a.md',
        })
    })

    it('expands ~/ for root-owned workspaces', () => {
        expect(
            classifyNoSchemeHref('~/hapi/docs/a.md', { workspacePath: '/root/hapi' })
        ).toEqual({
            action: 'file',
            path: '/root/hapi/docs/a.md',
        })
    })

    it('decodes percent-encoded spaces before workspace containment', () => {
        const workspace = '/home/ada/My Project'
        expect(
            classifyNoSchemeHref('/home/ada/My%20Project/docs/a.md', {
                workspacePath: workspace,
            })
        ).toEqual({
            action: 'file',
            path: '/home/ada/My Project/docs/a.md',
        })
        expect(
            classifyNoSchemeHref('~/My%20Project/docs/a.md', {
                workspacePath: workspace,
            })
        ).toEqual({
            action: 'file',
            path: '/home/ada/My Project/docs/a.md',
        })
    })

    it('offers path details without granting outside-workspace access', () => {
        expect(classifyNoSchemeHref('/etc/passwd.sh', { workspacePath: workspace })).toEqual({
            action: 'details', path: '/etc/passwd.sh',
        })
    })

    it('does not treat Windows absolute paths as repo-relative (containment required)', () => {
        expect(classifyNoSchemeHref('D:\\outside\\secret.ts')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('D:/outside/secret.ts#L1')).toEqual({ action: 'inert' })
    })

    it('routes in-workspace Windows absolute paths to file preview', () => {
        const winWorkspace = 'C:\\Users\\ada\\coding\\hapi'
        expect(
            classifyNoSchemeHref('C:\\Users\\ada\\coding\\hapi\\docs\\a.md', {
                workspacePath: winWorkspace,
            })
        ).toEqual({
            action: 'file',
            path: 'C:\\Users\\ada\\coding\\hapi\\docs\\a.md',
        })
    })

    it('compares Windows workspace containment case-insensitively', () => {
        expect(
            classifyNoSchemeHref('c:\\users\\ada\\coding\\hapi\\docs\\a.md', {
                workspacePath: 'C:\\Users\\Ada\\coding\\hapi',
            })
        ).toEqual({
            action: 'file',
            path: 'c:\\users\\ada\\coding\\hapi\\docs\\a.md',
        })
    })

    it('renders absolute paths without workspace metadata as inert (fail closed)', () => {
        expect(classifyNoSchemeHref('/home/ada/coding/hapi/docs/a.md')).toEqual({ action: 'inert' })
    })

    it('rejects tilde paths that lexically escape the workspace via ..', () => {
        expect(classifyNoSchemeHref('~/coding/hapi/../secret.ts', { workspacePath: workspace })).toEqual({
            action: 'details', path: '/home/ada/coding/hapi/../secret.ts',
        })
    })

    it('treats nonexistent SPA children as inert, not navigate', () => {
        expect(classifyNoSchemeHref('/settings/typo')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('/browse/extra')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('/sessions/id/unknown')).toEqual({ action: 'inert' })
    })

    it('renders unresolvable ~/ without workspace as inert (never SPA)', () => {
        expect(classifyNoSchemeHref('~/coding/hapi/docs/a.md')).toEqual({ action: 'inert' })
    })

    it('renders no-extension path-like hrefs as inert', () => {
        expect(classifyNoSchemeHref('docs/foo')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('README')).toEqual({ action: 'inert' })
        expect(classifyNoSchemeHref('./relative-route')).toEqual({ action: 'inert' })
    })

    it('renders parent-relative escape attempts as inert', () => {
        expect(classifyNoSchemeHref('../escape.md')).toEqual({ action: 'inert' })
    })

    it('keeps real app routes navigable', () => {
        expect(classifyNoSchemeHref('/settings')).toEqual({ action: 'navigate' })
        expect(classifyNoSchemeHref('/settings/general')).toEqual({ action: 'navigate' })
        expect(classifyNoSchemeHref('#section')).toEqual({ action: 'navigate' })
        expect(classifyNoSchemeHref('?q=1')).toEqual({ action: 'navigate' })
    })

    it('keeps protocol-relative URLs navigable', () => {
        expect(classifyNoSchemeHref('//example.com/path')).toEqual({ action: 'navigate' })
    })

    it('never classifies /home/... absolute file hrefs as SPA navigate', () => {
        const decision = classifyNoSchemeHref('/home/ada/coding/hapi/docs/a.md', {
            workspacePath: workspace,
        })
        expect(decision.action).not.toBe('navigate')
        expect(decision).toEqual({
            action: 'file',
            path: '/home/ada/coding/hapi/docs/a.md',
        })
    })
})


describe('explicit local path targets', () => {
    const workspacePath = '/Users/ada/My Project'
    it.each(['docs', 'docs/', './assets', '.config', 'README', 'archive.v1'])('routes the explicit path %s without guessing file type', (path) => {
        expect(classifyNoSchemeHref(path, { workspacePath })).toEqual({ action: 'file', path })
    })
    it.each(['/Users/ada/My Project', '/Users/ada/My Project/docs/', '/Users/ada/My Project/archive.v1', '/Users/ada/My Project/README'])('accepts in-session absolute target %s', (path) => {
        expect(classifyNoSchemeHref(encodeURI(path), { workspacePath })).toEqual({ action: 'file', path })
    })
    it('strips line and column from the read target', () => {
        expect(classifyNoSchemeHref('/Users/ada/My%20Project/a.ts:12:3', { workspacePath })).toEqual({ action: 'file', path: '/Users/ada/My Project/a.ts' })
    })
    it.each(['/Users/ada/My Project-other/a.md', '/Users/ada/My Project/../outside/a.md', 'C:/Users/ada/My Project/a.md'])('does not grant access for %s', (path) => {
        expect(classifyNoSchemeHref(path, { workspacePath })).toEqual({ action: 'details', path })
    })
    it.each(['../outside', 'docs/../../outside', '%00bad.md', 'javascript%3Aalert(1)', '//host/a.md'])('never previews unsafe target %s', (href) => {
        expect(classifyNoSchemeHref(href, { workspacePath }).action).not.toBe('file')
    })
    it('preserves decoded percent escapes and filename hash characters', () => {
        const path = 'docs/100%20done#1.md'
        expect(classifyNoSchemeHref(path, { workspacePath, decodedPath: true })).toEqual({ action: 'file', path })
    })
})
