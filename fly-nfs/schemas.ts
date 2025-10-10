import { z } from 'zod'

export const imageRecordSchema = z.object({
  /** Docker image reference used when creating the Machine, such as registry.fly.io/app:tag. */
  image: z.string(),
  cpu_kind: z.enum(['shared', 'dedicated']),
  cpus: z.number().int().positive(),
  memory_mb: z.number().int().multipleOf(256),
})

export type ImageRecord = z.infer<typeof imageRecordSchema>

export const hostInstanceSchema = z.object({
  /** state requested by the software */
  software: z.enum(['running', 'stopped']),
  /** the state of the instance from the hardware perspective */
  hardware: z.enum([
    /** hardware reconciliation is queued */
    'queued',
    /** hardware reconciliation is starting */
    'starting',
    /** waiting to load an agent in a running instance */
    'loadable',
    /** the instance is running and serving requests */
    'running',
    /** the instance is stopping and will be deleted */
    'stopping',
  ]),
  /** the container image to use for the instance */
  record: imageRecordSchema,
  /** the machine id of the machine that is serving this instance */
  machineId: z.string().optional(),
})

export type HostInstance = z.infer<typeof hostInstanceSchema>
