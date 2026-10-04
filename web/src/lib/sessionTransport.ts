export function isExternalClaudeSession(metadata: { flavor?: string | null; version?: string } | null | undefined): boolean {
    return metadata?.flavor === 'claude' && metadata.version === 'claude-http-v1'
}

/** HTTP Claude steers normal messages on arrival; this command sends nothing. */
export function isExternalClaudeSteerCommand(
    metadata: Parameters<typeof isExternalClaudeSession>[0],
    text: string,
    attachmentCount = 0,
): boolean {
    return isExternalClaudeSession(metadata) && text.trim() === '/steer' && attachmentCount === 0
}
