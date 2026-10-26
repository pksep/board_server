import { z } from 'zod';

/** Матрица ERP проверяется до чтения отчёта; неизвестный ответ не выдаёт доступ. */
export const ErpTimeReportPermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      resource_code: z.string(),
      action: z.string()
    })
  )
});
