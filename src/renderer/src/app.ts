import { resolve } from 'aurelia'
import { PythonService } from './services/python.service'
import { Button } from '@syncfusion/ej2/buttons'


export class App {
    private readonly python = resolve(PythonService)
    private primaryButton: HTMLElement = null as any;
    boards: unknown[] = []
    error: string | null = null
    running = false

    public attached(): void {
        var button = new Button({ isPrimary: true });

        button.appendTo(this.primaryButton);
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

