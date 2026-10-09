import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentState, Metadata } from '@/api/types';
import type { SessionBootstrapResult } from '@/agent/sessionFactory';
import { SharedCodexRoot, type RootHost } from './root';
import { codexPlanProposalId } from './plan';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import { resolveCodexPermissionModeConfig } from '../utils/permissionModeConfig';

type NativeTurn = { id: string; status: string; items: unknown[] };

vi.mock('../codexAppServerClient', () => ({
    CodexAppServerClient: class {
        initialized = false;
        thread = { id: 'thread', historyMode: 'paginated', turns: [] as NativeTurn[] };
        settings: Record<string, unknown> = { model: 'mock', collaborationMode: { mode: 'default' } };
        queue: Array<{ id: string; clientUserMessageId: unknown; input: unknown }> = [];
        goal: Record<string, unknown> | null = null;
        itemGate?: Promise<void>;
        notify?: (method: string, params: unknown) => void;
        abandoned?: () => void;
        setNotificationHandler(handler: typeof this.notify) { this.notify = handler; }
        setTransportAbandonedHandler(handler: (() => void) | null) { this.abandoned = handler ?? undefined; }
        setServerRequestHandler() {}
        async connect() {}
        async initialize() { this.initialized = true; }
        isInitialized() { return this.initialized; }
        async disconnect() { this.initialized = false; }
        async request(method: string, params: Record<string, unknown> = {}) {
            if (method === 'thread/goal/get') return { goal: this.goal };
            if (method === 'thread/read' || method === 'thread/resume') return { ...this.settings, thread: structuredClone(this.thread) };
            if (method === 'thread/turns/list') return { data: this.thread.turns.map(turn => ({ ...turn, items: [] })), nextCursor: null };
            if (method === 'thread/items/list') {
                await this.itemGate;
                const turn = this.thread.turns.find(value => value.id === params.turnId);
                return { data: (turn?.items ?? []).map(item => ({ turnId: params.turnId, item })), nextCursor: null };
            }
            if (method === 'thread/list') return { data: [] };
            if (method === 'thread/queue/list') return { data: this.queue };
            if (method === 'thread/settings/update') {
                this.settings = { ...this.settings, ...params };
                this.notify?.('thread/settings/updated', { threadId: 'thread', threadSettings: this.settings });
                return {};
            }
            if (method === 'thread/queue/add') {
                const entry = { id: `queued-${this.queue.length}`, clientUserMessageId: params.clientUserMessageId, input: params.input };
                this.queue.push(entry);
                return { queuedSubmission: entry };
            }
            throw new Error(`Unexpected request: ${method}`);
        }
    },
    isIndeterminateError: () => false
}));
vi.mock('../utils/buildHapiMcpBridge', () => ({ buildHapiMcpBridge: async () => ({
    mcpServers: {}, server: { stop() {} }
}) }));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    try { for (const cleanup of cleanups.splice(0)) await cleanup(); }
    finally { vi.useRealTimers(); }
});

async function fixture(options: { paginated?: boolean; turns?: NativeTurn[]; itemGate?: Promise<void> } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'hapi-shared-root-'));
    let state: AgentState = { steeringActive: true };
    let metadata: Metadata = { path: directory, host: 'test', flavor: 'codex' };
    let reconnect: (() => void) | null = null;
    let user: ((message: { content: { text: string; attachments?: unknown[] } }, id?: string) => void) | undefined;
    const updateState = vi.fn((fn: (value: AgentState) => AgentState) => { state = fn(state); });
    const rpc = new Map<string, (raw: unknown) => Promise<unknown>>();
    const send = vi.fn();
    const session = {
        sessionId: 'sid', getMetadata: () => metadata,
        updateMetadata: (fn: (value: Metadata) => Metadata) => { metadata = fn(metadata); },
        updateAgentState: updateState, keepAlive() {},
        onUserMessage: (fn: typeof user) => { user = fn; }, onCancelQueuedMessage() {}, onRetryQueuedMessage() {},
        onReconnect: (fn: (() => void) | null) => { reconnect = fn; },
        rpcHandlerManager: { registerHandler: (name: string, handler: (raw: unknown) => Promise<unknown>) => rpc.set(name, handler) },
        sendSessionEvent() {}, sendAgentMessage: send, emitSessionReady() {},
        sendUserMessage() {}, emitMessagesConsumed() {}, emitSteerIndeterminate() {}, syncNativeQueuedMessage() {},
        sendSessionDeath() {}, async flush() {}, close() {}
    } as unknown as ApiSessionClient;
    const root = new SharedCodexRoot({ session, workingDirectory: directory } as SessionBootstrapResult, {
        directory, generation: 'test', endpoint: 'mock', settingsFor: () => undefined,
        create: async () => { throw new Error('Unexpected root creation'); },
        end: async () => { throw new Error('Unexpected root archive'); }
    } satisfies RootHost);
    cleanups.push(async () => { await root.close(false); await rm(directory, { recursive: true, force: true }); });
    await root.prepare();
    const native = root.client as unknown as {
        initialized: boolean;
        goal: Record<string, unknown> | null;
        settings: Record<string, unknown>;
        itemGate?: Promise<void>;
        thread: { id: string; historyMode: string; turns: NativeTurn[] };
        queue: Array<{ id: string; clientUserMessageId: string; input: unknown }>;
        notify(method: string, params: unknown): void;
        abandoned(): void;
    };
    if (options.turns) native.thread.turns = options.turns;
    native.itemGate = options.itemGate;
    await root.bind('thread', { model: 'mock', thread: { id: 'thread', ...(options.paginated ? { historyMode: 'paginated' } : {}), turns: [] } }, false);
    return { root, native, rpc, send, user: () => user, metadata: () => metadata, state: () => state, updateState, reconnect: () => reconnect?.() };
}

describe('durable Codex provider and goal state', () => {
    it('persists native provider identity and preserves it on partial settings events', async () => {
        const f = await fixture();
        f.root.acceptSettings({ model: 'local-model', modelProvider: 'ollama' });
        f.root.acceptSettings({ model: 'local-model' });
        expect(f.metadata().codexModelProvider).toBe('ollama');
    });
    it('reads saved goals without resuming them and persists clear notifications', async () => {
        const f = await fixture();
        f.native.goal = { threadId: 'thread', objective: 'Preserve my goal', status: 'paused', tokensUsed: 42 };
        await f.root.refresh();
        expect(f.state().codexGoal).toMatchObject({ status: 'paused', tokensUsed: 42 });
        f.native.notify('thread/goal/updated', { threadId: 'thread', goal: { ...f.native.goal, status: 'active' } });
        await vi.waitFor(() => expect(f.state().codexGoal?.status).toBe('active'));
        f.native.notify('thread/goal/cleared', { threadId: 'thread' });
        await vi.waitFor(() => expect(f.state().codexGoal).toBeNull());
    });
    it('ignores a goal snapshot for a different native thread', async () => {
        const f = await fixture();
        f.native.goal = { threadId: 'child', objective: 'Other task', status: 'active' };
        await f.root.refresh();
        expect(f.state().codexGoal).toBeNull();
    });
});

describe('shared native permission settings', () => {
    it.each(['default', 'read-only', 'yolo'] as const)('confirms %s only after the full native settings notification', async permissionMode => {
        const f = await fixture();
        await f.root.activate();
        const request = vi.spyOn(f.root.client, 'request');
        const expected = resolveCodexPermissionModeConfig(permissionMode);

        await expect(f.rpc.get(RPC_METHODS.SetSessionConfig)!({ permissionMode })).resolves.toMatchObject({
            applied: { permissionMode }
        });

        const update = request.mock.calls.find(([method]) => method === 'thread/settings/update');
        expect(update?.[1]).toMatchObject({
            threadId: 'thread', approvalPolicy: expected.approvalPolicy, sandboxPolicy: expected.sandboxPolicy
        });
        // The mock sends its complete observed settings object (including
        // model), so this proves the RPC resolves from the notification rather
        // than accepting the requested partial update optimistically.
        expect(f.native.settings).toMatchObject({ model: 'mock', approvalPolicy: expected.approvalPolicy, sandboxPolicy: expected.sandboxPolicy });
    });
});

async function completePlan(f: Awaited<ReturnType<typeof fixture>>, status = 'completed') {
    await f.root.applySettings({ collaborationMode: 'plan' });
    const turn = { id: 'plan-turn', status: 'inProgress', items: [{ id: 'plan-item', type: 'plan', text: '# Implement me' }] };
    f.native.thread.turns.push(turn);
    f.native.notify('turn/started', { threadId: 'thread', turn: { id: turn.id } });
    f.native.notify('item/completed', { threadId: 'thread', turnId: turn.id, item: turn.items[0] });
    expect(f.state().codexPlanProposalId).toBeNull();
    turn.status = status;
    f.native.notify('turn/completed', { threadId: 'thread', turn: { id: turn.id, status } });
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ name: 'ExitPlanMode' }), expect.any(String)));
    return codexPlanProposalId('thread', turn.id, 'plan-item');
}

describe('shared plan actions', () => {
    it('applies remote change_title as metadata.name then lets native terminal rename win', async () => {
        const f = await fixture();
        const item = { id: 'title', type: 'mcpToolCall', server: 'hapi', tool: 'change_title',
            arguments: { title: 'Remote title' }, status: 'completed', result: { content: [], isError: false } };
        f.native.notify('item/completed', { threadId: 'thread', turnId: 'turn', item });
        await vi.waitFor(() => expect(f.metadata().name).toBe('Remote title'));
        f.native.notify('thread/name/updated', { threadId: 'thread', threadName: 'Terminal title' });
        await vi.waitFor(() => expect(f.metadata().name).toBe('Terminal title'));
        await f.root.refresh();
        expect(f.metadata().name).toBe('Terminal title');
    });

    it('preserves content while native turns, mode changes and disconnects withdraw controls', async () => {
        const f = await fixture();
        const id = await completePlan(f);
        expect(f.state().codexPlanProposalId).toBe(id);
        expect(f.state().requests).toEqual({});
        await f.root.applySettings({ collaborationMode: 'default' });
        expect(f.state().codexPlanProposalId).toBeNull();
        await f.root.applySettings({ collaborationMode: 'plan' });
        expect(f.state().codexPlanProposalId).toBe(id);
        f.native.initialized = false; f.native.abandoned();
        expect(f.state().codexPlanProposalId).toBeNull();
        await vi.waitFor(() => expect(f.state().codexPlanProposalId).toBe(id));
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'new' } });
        f.native.notify('turn/completed', { threadId: 'thread', turn: { id: 'plan-turn', status: 'completed' } });
        expect(f.state().codexPlanProposalId).toBeNull();
        expect(f.send.mock.calls.some(([message]) => message.input?.plan === '# Implement me')).toBe(true);
    });

    it.each(['failed', 'interrupted'])('does not offer a proposal from a %s turn', async status => {
        const f = await fixture();
        await completePlan(f, status);
        await f.root.refresh();
        expect(f.state().codexPlanProposalId).toBeNull();
    });

    it('uses only the latest root turn when replaying history', async () => {
        const f = await fixture();
        const id = await completePlan(f);
        f.reconnect();
        await f.root.refresh();
        await vi.waitFor(() => expect(f.state().codexPlanProposalId).toBe(id));
        f.native.thread.turns.push({ id: 'new', status: 'completed', items: [] });
        await f.root.refresh();
        expect(f.state().codexPlanProposalId).toBeNull();
        f.native.notify('item/completed', { threadId: 'child', turnId: 'child-turn', item: { id: 'p', type: 'plan', text: 'child' } });
        expect(f.state().codexPlanProposalId).toBeNull();
    });

    it('switches mode and submits once across repeated Web actions and lost replies', async () => {
        const f = await fixture();
        await f.root.activate();
        const id = await completePlan(f);
        const action = () => f.rpc.get(RPC_METHODS.ImplementCodexPlan)!({ planId: id });
        const request = vi.spyOn(f.root.client, 'request');
        expect(await Promise.all([action(), action()])).toEqual([{ ok: true }, { ok: true }]);
        f.reconnect();
        expect(await action()).toEqual({ ok: true });
        expect(request.mock.calls.filter(([method]) => method === 'thread/queue/add')).toHaveLength(1);
        const settingsIndex = request.mock.calls.findIndex(([method]) => method === 'thread/settings/update');
        const queueIndex = request.mock.calls.findIndex(([method]) => method === 'thread/queue/add');
        expect(settingsIndex).toBeLessThan(queueIndex);
        expect(request.mock.calls[settingsIndex][1]).toMatchObject({ collaborationMode: { mode: 'default' } });
        expect(f.native.queue[0]).toMatchObject({ input: [{ type: 'text', text: 'Implement the plan.' }] });
        expect(f.state().codexPlanProposalId).toBeNull();
    });

    it('does not let a slow history snapshot resurrect a plan after native continuation', async () => {
        const f = await fixture();
        await completePlan(f);
        const request = f.root.client.request.bind(f.root.client);
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        let reading!: () => void;
        const started = new Promise<void>(resolve => { reading = resolve; });
        vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = await request(method, params);
            if (method === 'thread/turns/list') {
                reading(); await blocked;
            }
            return result;
        });
        const refresh = f.root.refresh();
        await started;
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'terminal-continued' } });
        release(); await refresh;
        expect(f.state().codexPlanProposalId).toBeNull();
    });

    it('does not change mode when native input appears during the action preflight', async () => {
        const f = await fixture();
        await f.root.activate();
        const id = await completePlan(f);
        const request = f.root.client.request.bind(f.root.client);
        const spy = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = await request(method, params);
            if (method === 'thread/queue/list') f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'terminal' } });
            return result;
        });
        expect(await f.rpc.get(RPC_METHODS.ImplementCodexPlan)!({ planId: id })).toMatchObject({ ok: false, code: 'stale_plan' });
        expect(spy.mock.calls.some(([method]) => method === 'thread/settings/update')).toBe(false);
        expect(f.native.queue).toHaveLength(0);
    });

    it('rejects stale proposals and native activity arriving during the mode switch', async () => {
        const f = await fixture();
        await f.root.activate();
        const id = await completePlan(f);
        const action = (planId = id) => f.rpc.get(RPC_METHODS.ImplementCodexPlan)!({ planId });
        expect(await action('old')).toMatchObject({ ok: false, code: 'stale_plan' });
        const request = f.root.client.request.bind(f.root.client);
        vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = await request(method, params);
            if (method === 'thread/settings/update') f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'terminal' } });
            return result;
        });
        expect(await action()).toMatchObject({ ok: false, code: 'stale_plan' });
        expect(f.native.queue).toHaveLength(0);
    });

    it('does not resend an implementation with an unknown queue outcome', async () => {
        const f = await fixture();
        await f.root.activate();
        const id = await completePlan(f);
        const request = f.root.client.request.bind(f.root.client);
        const spy = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = await request(method, params);
            // An invalid response schema leaves delivery indeterminate even after acceptance.
            return method === 'thread/queue/add' ? {} : result;
        });
        const action = () => f.rpc.get(RPC_METHODS.ImplementCodexPlan)!({ planId: id });
        expect(await action()).toMatchObject({ ok: false, code: 'indeterminate' });
        f.native.queue = []; // Absence is not proof of cancellation or delivery.
        expect(await action()).toMatchObject({ ok: false, code: 'indeterminate' });
        expect(spy.mock.calls.filter(([method]) => method === 'thread/queue/add')).toHaveLength(1);
    });
});

describe('shared steering availability', () => {
    it('announces an active paginated root from its bounded head while holding prompts for history sync', async () => {
        let release!: () => void;
        const itemGate = new Promise<void>(resolve => { release = resolve; });
        const f = await fixture({ paginated: true, itemGate, turns: [{ id: 'native-active', status: 'inProgress', items: [
            { id: 'history', type: 'agentMessage', text: 'still loading' }
        ] } ] });
        const request = vi.spyOn(f.root.client, 'request');
        await f.root.activate();
        expect(f.state().steeringActive).toBe(true);
        expect((f.state() as Record<string, unknown>).codexHistorySync).toBe('syncing');
        f.user()?.({ content: { text: 'wait for native history' } }, 'held-prompt');
        await Promise.resolve();
        expect(request.mock.calls.some(([method]) => method === 'thread/queue/add')).toBe(false);
        release();
        await vi.waitFor(() => expect(request.mock.calls.some(([method]) => method === 'thread/queue/add')).toBe(true));
        await vi.waitFor(() => expect((f.state() as Record<string, unknown>).codexHistorySync).toBeNull());
    });

    it('refreshes a stale cached turn from the bounded native history head before steering', async () => {
        const f = await fixture();
        await f.root.activate();
        f.user()?.({ content: { text: 'queued steering input' } }, 'queued-steering');
        await vi.waitFor(() => expect(f.native.queue).toHaveLength(1));
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'stale-active' } });
        f.native.thread.turns = [{ id: 'actual-active', status: 'inProgress', items: [] }];
        const request = f.root.client.request.bind(f.root.client);
        const spy = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            if (method === 'thread/queue/delete') {
                const queuedSubmissionId = (params as { queuedSubmissionId?: string }).queuedSubmissionId;
                f.native.queue = f.native.queue.filter(entry => entry.id !== queuedSubmissionId);
                return { deleted: true };
            }
            if (method === 'turn/steer') return {};
            return request(method, params);
        });

        expect(await f.rpc.get(RPC_METHODS.SteerQueuedMessage)!({ localId: 'queued-steering' })).toEqual({ steered: true });
        const steerCalls = spy.mock.calls.filter(([method]) => method === 'turn/steer');
        expect(steerCalls).toHaveLength(1);
        expect(steerCalls[0][1]).toMatchObject({ expectedTurnId: 'actual-active' });
        const headCalls = spy.mock.calls.filter(([method]) => method === 'thread/turns/list');
        expect(headCalls).toHaveLength(1);
        expect(headCalls[0][1]).toEqual({ threadId: 'thread', sortDirection: 'desc', itemsView: 'notLoaded', limit: 1 });
    });

    it('keeps a newer native turn notification that arrives while reading the history head', async () => {
        const f = await fixture();
        await f.root.activate();
        f.user()?.({ content: { text: 'queued steering input' } }, 'newer-turn');
        await vi.waitFor(() => expect(f.native.queue).toHaveLength(1));
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'old-active' } });
        f.native.thread.turns = [{ id: 'old-active', status: 'inProgress', items: [] }];
        const request = f.root.client.request.bind(f.root.client);
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        let reading!: () => void;
        const started = new Promise<void>(resolve => { reading = resolve; });
        const spy = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = method === 'thread/queue/delete' ? (() => {
                const queuedSubmissionId = (params as { queuedSubmissionId?: string }).queuedSubmissionId;
                f.native.queue = f.native.queue.filter(entry => entry.id !== queuedSubmissionId);
                return { deleted: true };
            })() : method === 'turn/steer' ? {} : await request(method, params);
            if (method === 'thread/turns/list') { reading(); await blocked; }
            return result;
        });

        const steering = f.rpc.get(RPC_METHODS.SteerQueuedMessage)!({ localId: 'newer-turn' });
        await started;
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'new-active' } });
        release();
        await expect(steering).resolves.toEqual({ steered: true });
        expect(spy.mock.calls.find(([method]) => method === 'turn/steer')?.[1]).toMatchObject({ expectedTurnId: 'new-active' });
    });

    it('does not steer when completion arrives while reading the history head', async () => {
        const f = await fixture();
        await f.root.activate();
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'old-active' } });
        f.native.thread.turns = [{ id: 'old-active', status: 'inProgress', items: [] }];
        const request = f.root.client.request.bind(f.root.client);
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        let reading!: () => void;
        const started = new Promise<void>(resolve => { reading = resolve; });
        const spy = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = await request(method, params);
            if (method === 'thread/turns/list') { reading(); await blocked; }
            return result;
        });

        const steering = f.rpc.get(RPC_METHODS.SteerQueuedMessage)!({ localId: 'not-queued' });
        await started;
        f.native.notify('turn/completed', { threadId: 'thread', turn: { id: 'old-active', status: 'completed' } });
        release();
        await expect(steering).resolves.toEqual({ steered: false, error: 'No active turn' });
        expect(spy.mock.calls.some(([method]) => method === 'turn/steer')).toBe(false);
    });

    it('waits behind already scheduled queue ingress before reading the history head', async () => {
        const f = await fixture();
        await f.root.activate();
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'active' } });
        f.native.thread.turns = [{ id: 'active', status: 'inProgress', items: [] }];
        const request = f.root.client.request.bind(f.root.client);
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        let adding!: () => void;
        const addStarted = new Promise<void>(resolve => { adding = resolve; });
        const spy = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            if (method === 'thread/queue/add') { adding(); await blocked; }
            if (method === 'thread/queue/delete') {
                const queuedSubmissionId = (params as { queuedSubmissionId?: string }).queuedSubmissionId;
                f.native.queue = f.native.queue.filter(entry => entry.id !== queuedSubmissionId);
                return { deleted: true };
            }
            if (method === 'turn/steer') return {};
            return request(method, params);
        });

        f.user()?.({ content: { text: 'queued steering input' } }, 'pending-ingress');
        await addStarted;
        const steering = f.rpc.get(RPC_METHODS.SteerQueuedMessage)!({ localId: 'pending-ingress' });
        await Promise.resolve();
        expect(spy.mock.calls.some(([method]) => method === 'thread/turns/list')).toBe(false);
        release();
        await expect(steering).resolves.toEqual({ steered: true });
        expect(spy.mock.calls.some(([method]) => method === 'thread/turns/list')).toBe(true);
    });

    it('does not automatically repeat a rejected steer after refreshing the history head', async () => {
        const f = await fixture();
        await f.root.activate();
        f.user()?.({ content: { text: 'queued steering input' } }, 'rejected-steer');
        await vi.waitFor(() => expect(f.native.queue).toHaveLength(1));
        f.native.thread.turns = [{ id: 'actual-active', status: 'inProgress', items: [] }];
        const request = f.root.client.request.bind(f.root.client);
        const spy = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            if (method === 'thread/queue/delete') {
                const queuedSubmissionId = (params as { queuedSubmissionId?: string }).queuedSubmissionId;
                f.native.queue = f.native.queue.filter(entry => entry.id !== queuedSubmissionId);
                return { deleted: true };
            }
            if (method === 'turn/steer') throw new Error('expected active turn id mismatch');
            return request(method, params);
        });

        await expect(f.rpc.get(RPC_METHODS.SteerQueuedMessage)!({ localId: 'rejected-steer' })).resolves.toMatchObject({ steered: false });
        expect(spy.mock.calls.filter(([method]) => method === 'thread/turns/list')).toHaveLength(1);
        expect(spy.mock.calls.filter(([method]) => method === 'turn/steer')).toHaveLength(1);
        expect(f.native.queue).toEqual([{
            id: 'queued-0', clientUserMessageId: 'rejected-steer', input: [{ type: 'text', text: 'queued steering input' }]
        }]);
    });

    it('uses metadata-only resume before replaying bounded history after transport loss', async () => {
        const f = await fixture();
        const request = vi.spyOn(f.root.client, 'request');
        f.native.initialized = false;
        f.native.abandoned();
        await vi.waitFor(() => expect(request.mock.calls.some(([method, params]) => method === 'thread/resume'
            && (params as { excludeTurns?: boolean }).excludeTurns === true)).toBe(true));
    });

    it('keeps idle sessions online without polling usage or publishing agent-state updates', async () => {
        const f = await fixture();
        const requests = vi.spyOn(f.root.client, 'request');
        const heartbeat = vi.spyOn(f.root.session, 'keepAlive');
        const updates = f.updateState.mock.calls.length;
        vi.useFakeTimers();

        await f.root.activate();
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        expect(heartbeat).toHaveBeenCalled();
        expect(requests).not.toHaveBeenCalled();
        expect(f.updateState).toHaveBeenCalledTimes(updates);
    });

    it('publishes root turn transitions, ignores child turns, and clears on shutdown', async () => {
        const f = await fixture();
        expect(f.state().steeringActive).toBe(false);
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'turn' } });
        expect(f.state().steeringActive).toBe(true);
        f.native.notify('turn/completed', { threadId: 'thread', turn: { id: 'old-turn' } });
        expect(f.state().steeringActive).toBe(true);
        f.native.notify('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } });
        expect(f.state().steeringActive).toBe(false);
        f.native.notify('turn/started', { threadId: 'child', turn: { id: 'child-turn' } });
        expect(f.state().steeringActive).toBe(false);
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'next' } });
        f.root.stopAccepting();
        expect(f.state().steeringActive).toBe(false);
    });

    it('reconciles native and Hub reconnects without publishing on every refresh', async () => {
        const f = await fixture();
        const updates = f.updateState.mock.calls.length;
        await f.root.refresh(); await f.root.refresh();
        expect(f.updateState).toHaveBeenCalledTimes(updates);
        f.native.thread.turns = [{ id: 'busy', status: 'inProgress', items: [] }];
        f.reconnect();
        await vi.waitFor(() => expect(f.state().steeringActive).toBe(true));
        f.native.initialized = false; f.native.abandoned();
        expect(f.state().steeringActive).toBe(false);
        await vi.waitFor(() => expect(f.state().steeringActive).toBe(true));
        f.native.thread.turns = [{ id: 'busy', status: 'completed', items: [] }];
        f.reconnect();
        await vi.waitFor(() => expect(f.state().steeringActive).toBe(false));
    });
});
