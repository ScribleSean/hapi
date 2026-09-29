import { z } from 'zod'

export const BurnSessionStatusSchema = z.enum(['pending', 'applied', 'restored', 'unsupported', 'blocked', 'failed'])
export const BurnPreviousSettingsSchema = z.object({
    modelReasoningEffort: z.string().nullable(),
    serviceTier: z.string().nullable(),
})
export const BurnSessionStateSchema = z.object({
    sessionId: z.string(),
    status: BurnSessionStatusSchema,
    detail: z.string(),
    previous: BurnPreviousSettingsSchema.nullable(),
})
export const BurnModeStateSchema = z.object({
    enabled: z.boolean(),
    revision: z.number().int().nonnegative(),
    updatedAt: z.number(),
    restoring: z.boolean(),
    sessions: z.array(BurnSessionStateSchema),
})
export const UpdateBurnModeRequestSchema = z.object({
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
}).strict()

export type BurnSessionStatus = z.infer<typeof BurnSessionStatusSchema>
export type BurnPreviousSettings = z.infer<typeof BurnPreviousSettingsSchema>
export type BurnSessionState = z.infer<typeof BurnSessionStateSchema>
export type BurnModeState = z.infer<typeof BurnModeStateSchema>
export type UpdateBurnModeRequest = z.infer<typeof UpdateBurnModeRequestSchema>
