import { afterEach, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createJevTaskPickerRoutes } from './jevTaskPicker'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function app(namespace: string) {
    const dataDir = await mkdtemp(join(tmpdir(), 'jev-route-test-')); directories.push(dataDir)
    const result = new Hono<WebAppEnv>()
    result.use('*', async (c, next) => { c.set('namespace', namespace); await next() })
    result.route('/api', createJevTaskPickerRoutes(dataDir))
    return result
}
it('denies non-owner namespaces before configuration or provider calls', async () => {
    const api = await app('guest')
    for (const [path, method] of [['status', 'GET'], ['choose', 'POST']]) {
        const response = await api.request(`/api/experimental/task-picker/${path}`, { method })
        expect(response.status).toBe(403)
    }
})
it('reports a missing config without exposing key material or caching status', async () => {
    const response = await (await app('default')).request('/api/experimental/task-picker/status')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ ready: false })
})
it('rejects invalid or oversized payloads before admission', async () => {
    const api = await app('default')
    const url = '/api/experimental/task-picker/choose'
    expect((await api.request(url, { method: 'POST', body: '{}' })).status).toBe(400)
    expect((await api.request(url, { method: 'POST', body: 'x'.repeat(70000) })).status).toBe(413)
})
