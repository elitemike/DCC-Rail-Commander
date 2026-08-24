import type { FileService } from '../services/file.service'
import type { ProductDetail } from '../models/product-details'

const SOURCE_EXTS = ['.ino', '.cpp', '.h']
const SOURCE_SUBDIRS = ['src', 'libraries']

function isSourceFile(name: string): boolean {
    if (name.endsWith('.template')) return false
    if (SOURCE_EXTS.some(ext => name.endsWith(ext))) return true
    // "config.h.example" doesn't end in a SOURCE_EXTS extension, but is still
    // a config example worth copying/tracking (see isExampleConfigFile).
    return isExampleConfigFile(name)
}

/**
 * True if `name` is one of the product's user-owned config files (config.h,
 * myAutomation.h, etc.) — these are never overwritten by a repo source copy.
 */
export function isProductUserFile(product: ProductDetail, name: string): boolean {
    if (product.minimumConfigFiles.includes(name)) return true
    return (product.otherConfigFilePatterns ?? []).some(p => new RegExp(p).test(name))
}

/**
 * True for the repo's shipped example config files — DCC-EX repos use both
 * "config.example.h" and "config.h.example" naming conventions across
 * products. These aren't real firmware source and aren't the user's own
 * config, but they're still worth surfacing (grouped) in the editor rather
 * than silently copied or silently dropped.
 */
export function isExampleConfigFile(name: string): boolean {
    return name.endsWith('.example') || /\.example\.[^.]+$/i.test(name)
}

/**
 * Reads every example config file (non-recursive — these live at the repo
 * root) already present in `dir` (typically a scratch dir populated by
 * copyProductSourceFiles). Used to surface them as tracked config files so
 * they render in the editor grouped under "Examples" instead of sitting on
 * disk with no editor entry.
 */
export async function collectExampleConfigFiles(
    files: FileService,
    dir: string,
): Promise<Array<{ name: string; content: string }>> {
    const entries = await files.listDir(dir)
    const result: Array<{ name: string; content: string }> = []
    for (const name of entries) {
        if (isExampleConfigFile(name)) {
            result.push({ name, content: await files.readFile(`${dir}/${name}`) })
        }
    }
    return result
}

/**
 * Recursively copy firmware source files (.ino/.cpp/.h under the repo root
 * and allowed subdirs) from `srcDir` into `destDir`, skipping templates and
 * any file the product considers user-owned (so in-progress config edits
 * already sitting in `destDir` are never overwritten) — except example
 * config files, which are copied even though their names also match the
 * user-owned pattern (see isExampleConfigFile / collectExampleConfigFiles).
 */
export async function copyProductSourceFiles(
    files: FileService,
    product: ProductDetail,
    srcDir: string,
    destDir: string,
): Promise<void> {
    const entries = await files.listDir(srcDir)
    for (const entry of entries) {
        const src = `${srcDir}/${entry}`
        const dest = `${destDir}/${entry}`
        if (SOURCE_SUBDIRS.includes(entry)) {
            await files.mkdir(dest)
            await copyProductSourceFiles(files, product, src, dest)
        } else if (isSourceFile(entry) && (isExampleConfigFile(entry) || !isProductUserFile(product, entry))) {
            await files.copyFiles(src, dest)
        }
    }
}
