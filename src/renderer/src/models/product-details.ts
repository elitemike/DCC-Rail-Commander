/**
 * Product metadata — ported from ex_installer/product_details.py
 */

export interface ProductDetail {
    productName: string
    repoName: string
    defaultBranch: string
    repoUrl: string
    supportedDevices: string[]
    minimumConfigFiles: string[]
    otherConfigFilePatterns?: string[]
}

export const productDetails: Record<string, ProductDetail> = {
    ex_commandstation: {
        productName: 'EX-CommandStation',
        repoName: 'DCC-EX/CommandStation-EX',
        defaultBranch: 'master',
        repoUrl: 'https://github.com/DCC-EX/CommandStation-EX.git',
        supportedDevices: [
            'arduino:avr:uno',
            'arduino:avr:nano',
            'arduino:avr:mega',
            'esp32:esp32:esp32',
            'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE',
            'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F446RE',
        ],
        minimumConfigFiles: ['config.h'],
        otherConfigFilePatterns: [
            String.raw`^my.*\.[^?]*example\.cpp$|(^my.*\.cpp$)`,
            String.raw`^my.*\.[^?]*example\.h$|(^my.*\.h$)`,
        ],
    },
    ex_ioexpander: {
        productName: 'EX-IOExpander',
        repoName: 'DCC-EX/EX-IOExpander',
        defaultBranch: 'main',
        repoUrl: 'https://github.com/DCC-EX/EX-IOExpander.git',
        supportedDevices: [
            'arduino:avr:uno',
            'arduino:avr:nano',
            'arduino:avr:mega',
            'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE',
        ],
        minimumConfigFiles: ['myConfig.h'],
    },
    ex_turntable: {
        productName: 'EX-Turntable',
        repoName: 'DCC-EX/EX-Turntable',
        defaultBranch: 'main',
        repoUrl: 'https://github.com/DCC-EX/EX-Turntable.git',
        supportedDevices: [
            'arduino:avr:uno',
            'arduino:avr:nano',
        ],
        minimumConfigFiles: ['config.h'],
    },
}

/**
 * Extract version details from a tag string matching the pattern vX.Y.Z-Type
 */
export function extractVersionDetails(tag: string): {
    major: number
    minor: number
    patch: number
    type: 'Prod' | 'Devel' | 'unknown'
} {
    const match = tag.match(/^v(\d+)\.(\d+)\.(\d+)(?:-(Prod|Devel))?/)
    if (!match) return { major: 0, minor: 0, patch: 0, type: 'unknown' }
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        type: (match[4] as 'Prod' | 'Devel') ?? 'unknown',
    }
}

/** Sort tags newest-first by semver (major, then minor, then patch). */
export function sortVersionsDescending(tags: string[]): string[] {
    return [...tags].sort((a, b) => {
        const va = extractVersionDetails(a)
        const vb = extractVersionDetails(b)
        if (va.major !== vb.major) return vb.major - va.major
        if (va.minor !== vb.minor) return vb.minor - va.minor
        return vb.patch - va.patch
    })
}

/**
 * The version to preselect by default: the newest tag with a Prod suffix,
 * falling back to the newest tag overall if none are Prod-suffixed.
 * `sortedTags` must already be newest-first (see sortVersionsDescending).
 */
export function pickLatestVersion(sortedTags: string[]): string | null {
    return sortedTags.find((t) => extractVersionDetails(t).type === 'Prod') ?? sortedTags[0] ?? null
}

/**
 * Device FQBN to friendly name mapping.
 *
 * The FQBN is the app-wide board identity; the main process maps it to a
 * PlatformIO target in `src/main/board-targets.ts`.
 */
export const supportedDevices: Record<string, string> = {
    'arduino:avr:mega': 'Arduino Mega or Mega 2560',
    'arduino:avr:uno': 'Arduino Uno',
    'arduino:avr:nano': 'Arduino Nano',
    'esp32:esp32:esp32': 'ESP32 Dev Module',
    'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE': 'Nucleo F411RE',
    'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F446RE': 'Nucleo F446RE',
}
