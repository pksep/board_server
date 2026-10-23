import { z } from 'zod';

/** Только поля штатного ERP /users/list/true/false, без ролей и данных сессии. */
export const ErpUserDirectorySchema = z.array(
  z.object({
    id: z.union([
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      z.string().regex(/^[1-9]\d*$/)
    ]),
    tabel: z.string().trim().min(1),
    login: z.string().trim().min(1),
    initial: z.string().optional(),
    image: z.string().nullable().optional(),
    ban: z.boolean().optional()
  })
);
