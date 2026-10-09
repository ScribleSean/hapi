import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eligibleRoutes, PickPolicySchema, reservePickCall, selectTaskModel, type JevFetch, type PickRequest } from './jevTaskPicker'

const future = new Date(Date.now() + 60_000).toISOString()
const policy = () => PickPolicySchema.parse({
    enabled: true,
    creditWindow: { id: 'test', freeOnly: true, autoRechargeDisabled: true, expiresAt: future, maxCalls: 2 },
    routes: [{ id: 'standard', machineId: 'pc', harness: 'codex',
        option: { model: 'test-model', effort: 'medium', effortKind: 'reasoning' }, description: 'Test model for general coding',
        includedOnly: true, paidFallbackDisabled: true, verifiedUntil: future }],
})
const request: PickRequest = { machineId: 'pc', harness: 'codex', brief: 'Write a unit test',
    options: [{ model: 'test-model', effort: 'medium', effortKind: 'reasoning' }] }
const answer = (choice = 'standard', confidence = 0.9) => Response.json({ answers: { route: { type: 'choice', choice, confidence } } })
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function temp() { const path = await mkdtemp(join(tmpdir(), 'jev-test-')); directories.push(path); return path }

describe('Jev task picker admission and decision', () => {
    it('intersects host, harness, exact effort, and unexpired native eligibility', () => {
        expect(eligibleRoutes(policy(), request, Date.now())).toHaveLength(1)
        for (const change of [{ machineId: 'mac' }, { harness: 'claude' }, { options: [{ model: 'test-model' }] }]) {
            expect(eligibleRoutes(policy(), { ...request, ...change }, Date.now())).toHaveLength(0)
        }
        const expired = policy(); expired.routes[0]!.verifiedUntil = '2000-01-01T00:00:00Z'
        expect(eligibleRoutes(expired, request, Date.now())).toHaveLength(0)
    })
    it('rejects unsafe config and ambiguous/reserved route ids', () => {
        const unsafe = policy(); (unsafe.creditWindow as { freeOnly: boolean }).freeOnly = false
        expect(PickPolicySchema.safeParse(unsafe).success).toBe(false)
        const duplicate = policy(); duplicate.routes.push(duplicate.routes[0]!)
        expect(PickPolicySchema.safeParse(duplicate).success).toBe(false)
        const reserved = policy(); reserved.routes[0]!.id = 'no_match'
        expect(PickPolicySchema.safeParse(reserved).success).toBe(false)
    })
    it('reserves once and sends only the bounded task brief and approved choices', async () => {
        let reserved = 0
        const fetcher = (async (url, init) => {
            expect(reserved).toBe(1)
            expect(url).toBe('https://api.typesafe.ai/v1/systemone')
            const body = JSON.parse(String(init?.body))
            expect(body.state).toEqual({ taskBrief: request.brief, harness: 'codex', boundary: 'new-task' })
            expect(Object.keys(body.questions.route.criteria)).toEqual(['standard', 'no_match'])
            return answer()
        }) as JevFetch
        const result = await selectTaskModel({ policy: policy(), request, apiKey: 'test-only', reserve: async () => { reserved++ }, fetcher })
        expect(result.option).toEqual(request.options[0])
        expect(reserved).toBe(1)
    })
    it('does not call the provider without a key, allowance, or valid candidate', async () => {
        let reserved = 0
        const reserve = async () => { reserved++; throw Error('cap') }
        await expect(selectTaskModel({ policy: policy(), request, apiKey: '', reserve })).rejects.toThrow('TYPESAFE_API_KEY')
        await expect(selectTaskModel({ policy: policy(), request: { ...request, machineId: 'wrong' }, apiKey: 'test', reserve })).rejects.toThrow('No currently verified')
        expect(reserved).toBe(0)
        await expect(selectTaskModel({ policy: policy(), request, apiKey: 'test', reserve })).rejects.toThrow('cap')
    })
    it('abstains for low confidence, no match, and output outside the closed set', async () => {
        for (const [choice, confidence] of [['standard', 0.1], ['no_match', 0.9], ['invented', 1]] as const) {
            await expect(selectTaskModel({ policy: policy(), request, apiKey: 'test', reserve: async () => {},
                fetcher: async () => answer(choice, confidence) })).rejects.toThrow('abstained')
        }
    })
    it('does not retry or expose provider error bodies', async () => {
        let calls = 0
        await expect(selectTaskModel({ policy: policy(), request, apiKey: 'secret-test', reserve: async () => {},
            fetcher: async () => { calls++; return new Response('sensitive provider error', { status: 401 }) },
        })).rejects.toThrow('HTTP 401')
        expect(calls).toBe(1)
    })
    it('rejects eligibility that expires during the request', async () => {
        let tick = Date.now()
        await expect(selectTaskModel({ policy: policy(), request, apiKey: 'test', reserve: async () => {}, now: () => tick,
            fetcher: async () => { tick += 120_000; return answer() },
        })).rejects.toThrow('expired')
    })
})

describe('durable free-credit call cap', () => {
    it('survives new reservations and refuses exhausted or corrupt ledgers', async () => {
        const dir = await temp()
        await reservePickCall(dir, policy()); await reservePickCall(dir, policy())
        await expect(reservePickCall(dir, policy())).rejects.toThrow('cap reached')
        expect(JSON.parse(await readFile(join(dir, 'jev-task-picker-usage.json'), 'utf8'))).toEqual({ test: 2 })
        await writeFile(join(dir, 'jev-task-picker-usage.json'), 'invalid')
        await expect(reservePickCall(dir, policy())).rejects.toThrow('unreadable')
    })
    it('does not exceed the cap when requests overlap', async () => {
        const dir = await temp(); const config = policy(); config.creditWindow.maxCalls = 1
        const results = await Promise.allSettled([reservePickCall(dir, config), reservePickCall(dir, config)])
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    })
})
