import type { FileService } from '../services/file.service'
import type { ProductDetail } from '../models/product-details'

const SOURCE_EXTS = ['.ino', '.cpp', '.h']
const SOURCE_SUBDIRS = ['src', 'libraries']

function isSourceFile(name: string): boolean {
    if (name.endsWith('.example') || name.endsWith('.template')) return false
    return SOURCE_EXTS.some(ext => name.endsWith(ext))
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
 * Recursively copy firmware source files (.ino/.cpp/.h under the repo root
 * and allowed subdirs) from `srcDir` into `destDir`, skipping examples,
 * templates, and any file the product considers user-owned so in-progress
 * config edits already sitting in `destDir` are never overwritten.
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
        } else if (isSourceFile(entry) && !isProductUserFile(product, entry)) {
            await files.copyFiles(src, dest)
        }
    }
}
