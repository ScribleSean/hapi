export function isExternalClaudeSession(metadata: { flavor?: string | null; version?: string } | null | undefined): boolean {
    return metadata?.flavor === 'claude' && metadata.version === 'claude-http-v1'
}
