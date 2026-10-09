import type { CodexAppServerClient } from '../codexAppServerClient';
import { record, string } from './gateway';

const PAGE_SIZE = 8;

export type HistoryTurn = Record<string, unknown>;

/** A single bounded page establishes active-turn state before full replay. */
export async function readHistoryHead(client: CodexAppServerClient, threadId: string): Promise<HistoryTurn | undefined> {
    const page = record(await client.request('thread/turns/list', {
        threadId, sortDirection: 'desc', itemsView: 'notLoaded', limit: 1
    }));
    if (!Array.isArray(page.data)) throw new Error('Invalid Codex turn history');
    return page.data.length ? { ...record(page.data[0]), items: [] } : undefined;
}

/**
 * Reads native history without ever asking the app-server to serialize a
 * complete turn or thread.  Keep item pages small: one tool result can be
 * large, and a complete turn is not a safe WebSocket response unit.
 */
export async function streamThreadHistory(client: CodexAppServerClient, threadId: string,
    onItems: (turn: HistoryTurn, items: unknown[]) => Promise<void>, shouldContinue: () => boolean = () => true): Promise<HistoryTurn | undefined> {
    let cursor: string | undefined;
    const turnCursors = new Set<string>();
    let latest: HistoryTurn | undefined;
    do {
        if (!shouldContinue()) throw new Error('Codex history sync stopped');
        const turnsPage = record(await client.request('thread/turns/list', {
            threadId, cursor, sortDirection: 'asc', itemsView: 'notLoaded', limit: PAGE_SIZE
        }));
        if (!Array.isArray(turnsPage.data)) throw new Error('Invalid Codex turn history');
        for (const value of turnsPage.data) {
            if (!shouldContinue()) throw new Error('Codex history sync stopped');
            const turn = record(value);
            const turnId = string(turn.id);
            if (!turnId) throw new Error('Codex history turn has no ID');
            // Retain only lightweight summary metadata. Item payloads are
            // passed straight through to the projection and then released.
            const latestPlanItems: unknown[] = [];
            latest = { ...turn, items: latestPlanItems };
            let itemCursor: string | undefined;
            const itemCursors = new Set<string>();
            do {
                if (!shouldContinue()) throw new Error('Codex history sync stopped');
                const itemsPage = record(await client.request('thread/items/list', {
                    threadId, turnId, cursor: itemCursor, sortDirection: 'asc', limit: PAGE_SIZE
                }));
                if (!Array.isArray(itemsPage.data)) throw new Error('Invalid Codex item history');
                const items: unknown[] = [];
                for (const entryValue of itemsPage.data) {
                    const entry = record(entryValue);
                    // The API returns an exact { turnId, item } entry. Refuse
                    // a cross-turn response rather than projecting it here.
                    if (string(entry.turnId) !== turnId || !('item' in entry)) throw new Error('Invalid Codex history item');
                    items.push(entry.item);
                    // Root state only needs plan items from the newest turn.
                    // Keep those small, actionable records without retaining
                    // the rest of a potentially huge transcript.
                    if (record(entry.item).type === 'plan') latestPlanItems.push(entry.item);
                }
                if (items.length) await onItems(turn, items);
                itemCursor = nextCursor(itemsPage.nextCursor, itemCursors, 'item');
            } while (itemCursor);
        }
        cursor = nextCursor(turnsPage.nextCursor, turnCursors, 'turn');
    } while (cursor);
    return latest;
}

/** Find the initial user item without retaining a complete turn. */
export async function firstTurnUserMessage(client: CodexAppServerClient, threadId: string, turnId: string): Promise<Record<string, unknown> | undefined> {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
        const page = record(await client.request('thread/items/list', { threadId, turnId, cursor, sortDirection: 'asc', limit: PAGE_SIZE }));
        if (!Array.isArray(page.data)) throw new Error('Invalid Codex item history');
        for (const value of page.data) {
            const entry = record(value);
            if (string(entry.turnId) !== turnId || !('item' in entry)) throw new Error('Invalid Codex history item');
            const item = record(entry.item);
            if (item.type === 'userMessage') return item;
        }
        cursor = nextCursor(page.nextCursor, cursors, 'item');
    } while (cursor);
    return undefined;
}

function nextCursor(value: unknown, seen: Set<string>, kind: string): string | undefined {
    const cursor = string(value);
    if (!cursor) return undefined;
    if (seen.has(cursor)) throw new Error(`Invalid Codex ${kind} history cursor`);
    seen.add(cursor);
    return cursor;
}
