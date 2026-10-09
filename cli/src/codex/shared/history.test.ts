import { describe, expect, it, vi } from 'vitest';
import { firstTurnUserMessage, streamThreadHistory } from './history';

describe('bounded native history', () => {
    it('uses summary turn pages and small exact item pages without retaining full turns', async () => {
        const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
            if (method === 'thread/turns/list') {
                expect(params).toMatchObject({ itemsView: 'notLoaded', sortDirection: 'asc', limit: 8 });
                return params.cursor ? { data: [{ id: 'turn-2', status: 'completed', items: [] }], nextCursor: null }
                    : { data: [{ id: 'turn-1', status: 'completed', items: [] }], nextCursor: 'next-turn' };
            }
            if (method === 'thread/items/list') {
                expect(params).toMatchObject({ sortDirection: 'asc', limit: 8 });
                if (params.turnId === 'turn-1' && !params.cursor) return { data: [{ turnId: 'turn-1', item: { id: 'a', type: 'agentMessage', text: 'one' } }], nextCursor: 'next-item' };
                if (params.turnId === 'turn-1') return { data: [{ turnId: 'turn-1', item: { id: 'b', type: 'plan', text: 'plan' } }], nextCursor: null };
                return { data: [{ turnId: 'turn-2', item: { id: 'c', type: 'agentMessage', text: 'two' } }], nextCursor: null };
            }
            throw new Error(`Unexpected ${method}`);
        });
        const batches: Array<{ turn: string; items: string[] }> = [];
        const latest = await streamThreadHistory({ request } as never, 'thread', async (turn, items) => {
            batches.push({ turn: String(turn.id), items: items.map(item => String((item as { id: string }).id)) });
        });

        expect(batches).toEqual([{ turn: 'turn-1', items: ['a'] }, { turn: 'turn-1', items: ['b'] }, { turn: 'turn-2', items: ['c'] }]);
        // The newer turn deliberately has no plan: a completed earlier plan
        // must never cross the latest-turn boundary.
        expect(latest).toMatchObject({ id: 'turn-2', status: 'completed', items: [] });
        expect(request.mock.calls.filter(([method]) => method === 'thread/turns/list')).toHaveLength(2);
        expect(request.mock.calls.filter(([method]) => method === 'thread/items/list')).toHaveLength(3);
    });

    it('keeps only plan payloads from the latest turn for root plan state', async () => {
        const request = vi.fn(async (method: string) => method === 'thread/turns/list'
            ? { data: [{ id: 'huge-turn', status: 'completed', items: [] }], nextCursor: null }
            : { data: Array.from({ length: 8 }, (_, index) => ({ turnId: 'huge-turn', item: {
                id: `tool-${index}`, type: index === 7 ? 'plan' : 'commandExecution', output: 'x'.repeat(1024 * 1024)
            } })), nextCursor: null });
        const latest = await streamThreadHistory({ request } as never, 'thread', async () => {});
        expect((latest?.items as Array<{ id: string }>).map(item => item.id)).toEqual(['tool-7']);
    });

    it('rejects an item page that does not identify the requested turn', async () => {
        const request = vi.fn(async (method: string) => method === 'thread/items/list'
            ? { data: [{ turnId: 'other', item: { id: 'bad' } }], nextCursor: null }
            : { data: [], nextCursor: null });
        await expect(firstTurnUserMessage({ request } as never, 'thread', 'turn')).rejects.toThrow('Invalid Codex history item');
    });

    it('rejects a repeated pagination cursor instead of refreshing forever', async () => {
        const request = vi.fn(async () => ({ data: [], nextCursor: 'again' }));
        await expect(streamThreadHistory({ request } as never, 'thread', async () => {})).rejects.toThrow('Invalid Codex turn history cursor');
    });
});
