import { z } from 'zod'

// Reusable Zod schemas for Fly app/computer shapes and tool outputs.

export const appInfoSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  createdAt: z.string().optional(),
  organizationSlug: z.string().optional(),
})

export const readComputerOutputSchema = z.object({
  exists: z.boolean(),
  computer: appInfoSchema.optional(),
})
