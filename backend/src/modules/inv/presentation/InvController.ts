import { z } from 'zod';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  AddVariants,
  AdjustStock,
  CreateItem,
  CreateStore,
  GetItem,
  GetStock,
  IssueStock,
  ListItems,
  ListMovements,
  ListStores,
  ReceiveStock,
  SetReorderLevel,
  TransferStock,
  UpdateItem,
  UpdateStore,
} from '../application/InventoryUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Qty = z.number().positive().max(1_000_000).multipleOf(0.001);
const Category = z.enum([
  'uniform',
  'book',
  'stationery',
  'lab_consumable',
  'lab_equipment',
  'ict',
  'cleaning',
  'furniture',
  'sports',
  'other',
]);
const StoreKind = z.enum(['central', 'uniform_shop', 'book_shop', 'lab', 'ict', 'sports']);
const Code = z.string().regex(/^[A-Za-z0-9_-]{1,30}$/);
const Variant = z
  .object({
    code: Code,
    attributes: z.record(z.string(), z.string().max(50)).optional(),
    barcode: z.string().max(60).nullable().optional(),
    salePricePaisa: zx.paisa().nullable().optional(),
  })
  .strict();
const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

/** INV-01 / INV-02: items with variants, stores, stock ledger (receipt, issue, transfer, count), reorder levels. */
export class InvController extends BaseController {
  readonly basePath = '/inv';
  readonly tag = 'Inventory';

  routes(): RouteDefinition[] {
    return [
      // ---------------- items ----------------
      defineRoute({
        method: 'get',
        path: '/items',
        summary: 'Item master with variants (search by name, SKU or barcode)',
        permission: 'inv.stock.view',
        schema: { query: z.object({ q: z.string().max(100).optional(), category: Category.optional(), active: bool }) },
        handler: async ({ query }, req) => this.ok(await this.resolve<ListItems>(req, 'listItems').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/items',
        summary: 'Create an item (without variants it gets one standard variant STD)',
        permission: 'inv.stock.edit',
        schema: {
          body: z
            .object({
              sku: Code,
              nameEn: zx.name(),
              nameBn: z.string().max(200).nullable().optional(),
              category: Category,
              unit: z.string().min(1).max(20),
              isSellable: z.boolean().optional(),
              barcode: z.string().max(60).nullable().optional(),
              variants: z.array(Variant).max(100).optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) => this.created(await this.resolve<CreateItem>(req, 'createItem').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/items/:id',
        summary: 'Item with its variants',
        permission: 'inv.stock.view',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetItem>(req, 'getItem').execute(params)),
      }),
      defineRoute({
        method: 'patch',
        path: '/items/:id',
        summary: 'Update an item (deactivate to stop new receipts)',
        permission: 'inv.stock.edit',
        schema: {
          params: Id,
          body: z
            .object({
              nameEn: zx.name().optional(),
              nameBn: z.string().max(200).nullable().optional(),
              unit: z.string().min(1).max(20).optional(),
              isSellable: z.boolean().optional(),
              barcode: z.string().max(60).nullable().optional(),
              isActive: z.boolean().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<UpdateItem>(req, 'updateItem').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/items/:id/variants',
        summary: 'Add variants (sizes / colours) to an item',
        permission: 'inv.stock.edit',
        schema: { params: Id, body: z.object({ variants: z.array(Variant).min(1).max(100) }).strict() },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<AddVariants>(req, 'addVariants').execute({ itemId: params.id, variants: body.variants }),
          ),
      }),

      // ---------------- stores ----------------
      defineRoute({
        method: 'get',
        path: '/stores',
        summary: 'Stores of the campus',
        permission: 'inv.stock.view',
        handler: async (_i, req) => this.ok(await this.resolve<ListStores>(req, 'listStores').execute({})),
      }),
      defineRoute({
        method: 'post',
        path: '/stores',
        summary: 'Create a store (central, uniform shop, book shop, lab, ICT, sports)',
        permission: 'inv.stock.edit',
        schema: {
          body: z
            .object({
              campusId: zx.uuid().optional(),
              code: Code,
              name: zx.name(),
              kind: StoreKind,
              keeperStaffId: zx.uuid().nullable().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateStore>(req, 'createStore').execute(body)),
      }),
      defineRoute({
        method: 'patch',
        path: '/stores/:id',
        summary: 'Rename, change keeper or close a store',
        permission: 'inv.stock.edit',
        schema: {
          params: Id,
          body: z
            .object({
              name: zx.name().optional(),
              keeperStaffId: zx.uuid().nullable().optional(),
              isActive: z.boolean().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<UpdateStore>(req, 'updateStore').execute({ id: params.id, ...body })),
      }),

      // ---------------- stock ----------------
      defineRoute({
        method: 'get',
        path: '/stores/:id/stock',
        summary: 'Stock on hand with average cost, value and reorder level (lowOnly: at or below minimum)',
        permission: 'inv.stock.view',
        schema: { params: Id, query: z.object({ q: z.string().max(100).optional(), lowOnly: bool }) },
        handler: async ({ params, query }, req) =>
          this.ok(await this.resolve<GetStock>(req, 'getStock').execute({ storeId: params.id, ...query })),
      }),
      defineRoute({
        method: 'get',
        path: '/stores/:id/movements',
        summary: 'Stock ledger of a store (newest first; balance after each movement)',
        permission: 'inv.stock.view',
        schema: {
          params: Id,
          query: z.object({ variantId: zx.uuid().optional(), from: zx.date().optional(), to: zx.date().optional() }),
        },
        handler: async ({ params, query }, req) =>
          this.ok(await this.resolve<ListMovements>(req, 'listMovements').execute({ storeId: params.id, ...query })),
      }),
      defineRoute({
        method: 'post',
        path: '/stores/:id/receipts',
        summary: 'Opening balance or receipt without a purchase order (POs are received in procurement)',
        permission: 'inv.stock.create',
        schema: {
          params: Id,
          body: z
            .object({
              kind: z.enum(['opening', 'receipt']),
              reason: z.string().max(300).optional(),
              lines: z
                .array(z.object({ variantId: zx.uuid(), qty: Qty, unitCostPaisa: zx.paisa() }).strict())
                .min(1)
                .max(200),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<ReceiveStock>(req, 'receiveStock').execute({ storeId: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/stores/:id/issues',
        summary: 'Issue note to a department or person (never more than on hand)',
        permission: 'inv.stock.create',
        schema: {
          params: Id,
          body: z
            .object({
              issuedTo: z.string().trim().min(2).max(120),
              reason: z.string().max(300).optional(),
              lines: z
                .array(z.object({ variantId: zx.uuid(), qty: Qty }).strict())
                .min(1)
                .max(200),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<IssueStock>(req, 'issueStock').execute({ storeId: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/transfers',
        summary: 'Move stock between stores (at average cost)',
        permission: 'inv.stock.create',
        schema: {
          body: z
            .object({
              fromStoreId: zx.uuid(),
              toStoreId: zx.uuid(),
              reason: z.string().max(300).optional(),
              lines: z
                .array(z.object({ variantId: zx.uuid(), qty: Qty }).strict())
                .min(1)
                .max(200),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<TransferStock>(req, 'transferStock').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/stores/:id/counts',
        summary: 'Stock count: counted quantities replace the book quantities (adjustments posted)',
        permission: 'inv.stock.approve',
        schema: {
          params: Id,
          body: z
            .object({
              reason: z.string().trim().min(3).max(300),
              lines: z
                .array(
                  z
                    .object({ variantId: zx.uuid(), countedQty: z.number().min(0).max(1_000_000).multipleOf(0.001) })
                    .strict(),
                )
                .min(1)
                .max(500),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<AdjustStock>(req, 'adjustStock').execute({ storeId: params.id, ...body })),
      }),
      defineRoute({
        method: 'put',
        path: '/stores/:id/levels/:variantId',
        summary: 'Reorder level (minimum / maximum) of an item in a store',
        permission: 'inv.stock.edit',
        successStatus: 200,
        schema: {
          params: z.object({ id: zx.uuid(), variantId: zx.uuid() }),
          body: z
            .object({
              minQty: z.number().min(0).max(1_000_000),
              maxQty: z.number().min(0).max(1_000_000).nullable().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetReorderLevel>(req, 'setReorderLevel').execute({
              storeId: params.id,
              variantId: params.variantId,
              ...body,
            }),
          ),
      }),
    ];
  }
}
