import { Task } from './task.ts'
import {
  TaskExitEvent,
  TaskOptions,
  TaskResult,
  TaskStateEvent,
  WorkflowOptions,
  WorkflowResult,
} from './types.ts'

interface TaskStartEventDetail {
  id: string
  index: number
  total: number
}

interface TaskErrorEventDetail {
  id: string
  error: unknown
}

export class Workflow extends EventTarget {
  readonly tasks: Task[]
  private readonly options: WorkflowOptions

  constructor(tasks: Array<Task | TaskOptions>, options: WorkflowOptions = {}) {
    super()
    this.tasks = tasks.map((task) =>
      task instanceof Task ? task : new Task(task)
    )
    this.options = options
  }

  async validate(): Promise<void> {
    await Promise.all(this.tasks.map((task) => task.validate()))
  }

  async run(): Promise<WorkflowResult> {
    await this.validate()
    const results: TaskResult[] = []
    for (let index = 0; index < this.tasks.length; index += 1) {
      const task = this.tasks[index]
      this.dispatchEvent(
        new CustomEvent<TaskStartEventDetail>('task:start', {
          detail: { id: task.id, index, total: this.tasks.length },
        }),
      )
      try {
        const result = await task.run()
        results.push(result)
        this.dispatchExitEvent(result)
        if (!result.success && this.options.stopOnError !== false) {
          break
        }
      } catch (error) {
        this.dispatchEvent(
          new CustomEvent<TaskErrorEventDetail>('task:error', {
            detail: { id: task.id, error },
          }),
        )
        if (this.options.stopOnError !== false) {
          break
        }
      }
    }

    const success = results.length === this.tasks.length &&
      results.every((result) => result.success)

    return { success, results }
  }

  stopAll(signal?: Deno.Signal): void {
    for (const task of this.tasks) {
      task.stop(signal)
    }
  }

  onTaskState(listener: (event: CustomEvent<TaskStateEvent>) => void): void {
    for (const task of this.tasks) {
      task.addEventListener('state', listener as EventListener)
    }
  }

  onTaskExit(listener: (event: CustomEvent<TaskExitEvent>) => void): void {
    for (const task of this.tasks) {
      task.addEventListener('exit', listener as EventListener)
    }
  }

  private dispatchExitEvent(result: TaskResult): void {
    this.dispatchEvent(
      new CustomEvent('task:exit', { detail: result }) as CustomEvent<
        TaskResult
      >,
    )
  }
}
