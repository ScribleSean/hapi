import type { DecryptedMessage } from '@/types/api'
import { normalizeDecryptedMessage } from '@/chat/normalize'

/** A recent reported error is evidence, not a live provider-auth check. */
export function latestReportedAuthIssue(messages: DecryptedMessage[]): string | null {
    const ordered = [...messages].sort((a, b) => b.createdAt - a.createdAt)
    for (const raw of ordered) {
        const message = normalizeDecryptedMessage(raw)
        if (message?.role !== 'agent' || message.isSidechain) continue
        const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').trim()
        if (!text) continue
        if (/^(failed to authenticate|authentication failed|oauth session expired|not logged in|invalid api key)\b/i.test(text)) {
            return 'Last reply reported a sign-in failure. Reauthenticate on the execution host, then retry.'
        }
        // A subsequent normal assistant reply supersedes the old error.
        return null
    }
    return null
}
