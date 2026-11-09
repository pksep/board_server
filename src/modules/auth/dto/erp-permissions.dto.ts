import { z } from 'zod';

/** Неизвестная или неполная матрица ERP никогда не выдаёт доступ. */
export const ErpPermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      resource_code: z.string(),
      action: z.string()
    })
  )
});
