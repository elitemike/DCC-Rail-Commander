import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { resolve } from 'aurelia'
import type { ImportResult, ImportFileReport, AliasReviewItem } from '../../models/project-importer'

interface ImportSummaryDialogModel {
    result: ImportResult
    /** Names of the files that will actually be created in the new project (canonical + leftover), for the header count. */
    outputFileCount: number
}

type Tab = 'files' | 'aliases'

const STATUS_LABEL: Record<ImportFileReport['status'], string> = {
    'fully-migrated': 'Fully migrated — nothing left in this file',
    'partial-leftover': 'Partially migrated — some content moved to a new file',
    'fully-leftover': 'Nothing recognized — kept as-is in a new file',
}

const STATUS_DOT: Record<ImportFileReport['status'], string> = {
    'fully-migrated': 'bg-emerald-500',
    'partial-leftover': 'bg-blue-500',
    'fully-leftover': 'bg-amber-500',
}

export class ImportSummaryDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)

    result: ImportResult = { configFiles: [], fileReports: [], aliasReview: [], conflicts: [] }
    outputFileCount = 0
    tab: Tab = 'files'
    selectedIndex = 0

    readonly statusLabel = STATUS_LABEL
    readonly statusDot = STATUS_DOT

    activate(model: ImportSummaryDialogModel): void {
        this.result = model.result
        this.outputFileCount = model.outputFileCount
        this.tab = 'files'
        this.selectedIndex = 0
    }

    setTab(tab: Tab): void {
        this.tab = tab
    }

    selectFile(index: number): void {
        this.selectedIndex = index
    }

    get selectedReport(): ImportFileReport | null {
        return this.result.fileReports[this.selectedIndex] ?? null
    }

    /** The actual leftover text for the selected file, if it has one — read straight out of
     *  the assembled configFiles so this dialog needs no separate copy of the content. */
    get selectedLeftoverContent(): string | null {
        const report = this.selectedReport
        if (!report?.leftoverFileName) return null
        return this.result.configFiles.find(f => f.name === report.leftoverFileName)?.content ?? null
    }

    formatValues(item: AliasReviewItem): string {
        return item.values.map(v => `${v.value} (${v.files.join(', ')})`).join(' vs. ')
    }

    formatRoles(item: AliasReviewItem): string {
        return item.observedRoles.length > 0 ? item.observedRoles.join(', ') : 'none observed'
    }

    cancel(): void {
        void this.$dialog.cancel()
    }

    continue(): void {
        void this.$dialog.ok()
    }
}
