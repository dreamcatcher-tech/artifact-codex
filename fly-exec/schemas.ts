import { z } from 'zod'

export const execInstanceSchema = z.object({
  /** state requested by the computer */
  software: z.enum(['running', 'stopped']),
  /** the status of the instance from the hardware perspective */
  hardware: z.enum(['queued', 'starting', 'running', 'stopping']),
  /** the container image to use for the instance */
  image: z.string(),
  /** the machine id of the machine that is serving this instance */
  machineId: z.string().optional(),
})

export type ExecInstance = z.infer<typeof execInstanceSchema>
