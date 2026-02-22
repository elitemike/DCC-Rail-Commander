import { resolve } from 'aurelia'
import { PythonService } from './services/python.service'

export class MyApp {
    private readonly python = resolve(PythonService)

    boards: unknown[] = []
    error: string | null = null
    running = false

    attached() {

    }

    async binding(): Promise<void> {
        this.running = true
        this.error = null
        try {
            const result = await this.python.run({ script: 'detect_boards.py' })
            this.boards = result.output.map((line) => {
                try { return JSON.parse(line as string) } catch { return { raw: line } }
            })
        } catch (err) {
            this.error = (err as Error).message
        } finally {
            this.running = false
        }
    }
}

