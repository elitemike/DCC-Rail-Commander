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

/** Arduino CLI platform packages */
export const basePlatforms: Record<string, string> = {
    'arduino:avr': '1.8.6',
}

export const extraPlatforms: Record<string, string> = {
    'esp32:esp32': '2.0.17',
    'STMicroelectronics:stm32': '2.7.1',
}

export const requiredLibraries: Record<string, string> = {
    'Ethernet': '2.0.2',
}

/** Device FQBN to friendly name mapping */
export const supportedDevices: Record<string, string> = {
    'arduino:avr:mega': 'Arduino Mega or Mega 2560',
    'arduino:avr:uno': 'Arduino Uno',
    'arduino:avr:nano': 'Arduino Nano',
    'esp32:esp32:esp32': 'ESP32 Dev Module',
    'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE': 'Nucleo F411RE',
    'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F446RE': 'Nucleo F446RE',
}
