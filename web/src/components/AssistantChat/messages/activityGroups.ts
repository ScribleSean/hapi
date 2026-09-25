import type { ThreadMessage } from '@assistant-ui/react'
import { isObject } from '@hapi/protocol'

function attention(value: unknown): boolean {
    if (!isObject(value)) return true
    if (value.kind === 'tool-group') return !Array.isArray(value.tools) || value.tools.some(attention)
    if (value.kind !== 'tool-call' || !isObject(value.tool)) return true
    const tool = value.tool
    if (tool.state === 'pending' || (isObject(tool.permission) && tool.permission.status === 'pending')) return true
    if (tool.state === 'running' && /question|request.?user.?input/i.test(String(tool.name))) return true
    return Array.isArray(value.children) && value.children.some((child) => isObject(child) && child.kind === 'tool-call' && attention(child))
}

export function groupActivityMessages(messages: readonly ThreadMessage[]) {
    const groups: { ids: string[]; activity: boolean; running: boolean; failed: boolean }[] = []
    for (const message of messages) {
        const activity = message.role === 'assistant' && message.content.length > 0 && message.content.every(part =>
            part.type === 'reasoning' || (part.type === 'tool-call' && !attention(part.artifact)))
        const running = message.status?.type === 'running'
        const failed = message.content.some(part => part.type === 'tool-call' && part.isError)
        const previous = groups.at(-1)
        if (activity && previous?.activity) {
            previous.ids.push(message.id)
            previous.running ||= running
            previous.failed ||= failed
        } else groups.push({ ids: [message.id], activity, running, failed })
    }
    return groups
}
