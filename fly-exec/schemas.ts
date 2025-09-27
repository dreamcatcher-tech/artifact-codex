import { z } from 'zod'

export const imageRecordSchema = z.object({
  /** Docker image reference used when creating the Machine, such as registry.fly.io/app:tag. */
  image: z.string(),
  cpu_kind: z.enum(['shared', 'dedicated']),
  cpus: z.number().int().positive(),
  memory_mb: z.number().int().multipleOf(256),
})

export type ImageRecord = z.infer<typeof imageRecordSchema>

export const execInstanceSchema = z.object({
  /** state requested by the computer */
  software: z.enum(['running', 'stopped']),
  /** the status of the instance from the hardware perspective */
  hardware: z.enum(['queued', 'starting', 'running', 'stopping']),
  /** the container image to use for the instance */
  record: imageRecordSchema,
  /** the machine id of the machine that is serving this instance */
  machineId: z.string().optional(),
})

export type ExecInstance = z.infer<typeof execInstanceSchema>
