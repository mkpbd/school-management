import { z } from 'zod';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import type { RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import { house } from '../../../shared/infrastructure/db/schema/cca.js';

/** CCA-02 houses (master data): students belong to a house; notices can target one. */
export class CcaController extends BaseController {
  readonly basePath = '/cca';
  readonly tag = 'Co-curricular';

  routes(): RouteDefinition[] {
    return [
      ...crudRoutes({
        path: '/houses',
        entity: 'house',
        table: house,
        orgScoped: true,
        permissions: { view: 'cca.house.view', create: 'cca.house.create', edit: 'cca.house.edit' },
        filters: { isActive: house.isActive },
        search: [house.nameEn, house.code],
        orderBy: [house.code],
        createSchema: z.object({
          code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
          nameEn: zx.name(),
          nameBn: z.string().max(200).nullable().optional(),
          colourHex: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .nullable()
            .optional(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          nameBn: z.string().max(200).nullable(),
          colourHex: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .nullable(),
          isActive: z.boolean(),
        }),
      }),
    ];
  }
}
