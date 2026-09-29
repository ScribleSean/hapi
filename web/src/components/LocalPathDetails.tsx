import { useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

/** An actionable explanation, without requesting access outside the session. */
export function LocalPathDetails(props: { path: string; workspace?: string | null; children?: ReactNode; className?: string }) {
    const { t } = useTranslation()
    const { copied, copy } = useCopyToClipboard()
    const [copyFailed, setCopyFailed] = useState(false)
    return (
        <Dialog>
            <DialogTrigger asChild>
                <button type="button" title={props.path} className={cn('aui-md-path-details inline cursor-pointer text-left font-medium text-[var(--app-link)] underline underline-offset-3', props.className)}>
                    {props.children}
                </button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('file.link.details')}</DialogTitle>
                    <DialogDescription>{t('file.link.outsideWorkspace')}</DialogDescription>
                </DialogHeader>
                <p className="my-3 break-all rounded bg-[var(--app-subtle-bg)] p-2 font-mono text-sm">{props.path}</p>
                {props.workspace ? <p className="mb-3 break-all text-xs text-[var(--app-hint)]">{t('file.link.sessionFolder')}: {props.workspace}</p> : null}
                <button type="button" className="rounded bg-[var(--app-button)] px-3 py-2 text-sm text-[var(--app-button-text)]" onClick={async () => setCopyFailed(!await copy(props.path))}>
                    {copied ? t('message.copied') : t('file.page.copyPath')}
                </button>
                {copyFailed ? <p role="status" className="mt-2 text-sm">{t('file.link.copyFailed')}</p> : null}
            </DialogContent>
        </Dialog>
    )
}
