import { z } from 'zod';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  BudgetVsActual,
  CreateBudget,
  CreateCostCentre,
  DecideBudget,
  GetBudget,
  ListBudgets,
  ListCostCentres,
  SetBudgetLines,
  SubmitBudget,
} from '../application/BudgetUseCases.js';
import type {
  AddQuotation,
  CancelPurchaseOrder,
  CancelRequisition,
  CreateRequisition,
  CreateVendor,
  DecideRequisition,
  GetPurchaseOrder,
  GetRequisition,
  GetSupplierBill,
  GetVendor,
  IssuePurchaseOrder,
  ListPurchaseOrders,
  ListRequisitions,
  ListSupplierBills,
  ListVendors,
  PayablesAging,
  PaySupplierBill,
  ReceiveGoods,
  RecordSupplierBill,
  RenderPurchaseOrder,
  SelectQuotation,
  SubmitRequisition,
  UpdateVendor,
} from '../application/ProcurementUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Qty = z.number().positive().max(1_000_000).multipleOf(0.001);
const Pct = z.number().min(0).max(100).multipleOf(0.01);
const Decision = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(500).optional(),
  })
  .strict();
const BudgetLine = z
  .object({
    accountId: zx.uuid(),
    costCentreId: zx.uuid().nullable().optional(),
    annualPaisa: zx.paisa().optional(),
    months: z.array(zx.paisa()).length(12).optional(),
  })
  .strict();
const VendorBody = z
  .object({
    code: z
      .string()
      .regex(/^[A-Za-z0-9_-]{2,20}$/)
      .optional(),
    name: zx.name(),
    phone: zx.phone().nullable().optional(),
    email: z.string().email().nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    tin: z.string().max(20).nullable().optional(),
    binVat: z.string().max(20).nullable().optional(),
    tdsRatePct: Pct.nullable().optional(),
    vatRatePct: Pct.nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
    performanceNote: z.string().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
const Lines = z
  .array(z.object({ poLineId: zx.uuid(), quantity: Qty }).strict())
  .min(1)
  .max(200);

/** ACC-03 budgets vs actual, ACC-04 requisition -> quotations -> PO -> goods receipt -> bill -> payment, ACC-05 vendors. */
export class ProcurementController extends BaseController {
  readonly basePath = '/acc';
  readonly tag = 'Budget & procurement';

  routes(): RouteDefinition[] {
    return [
      // ---------------- cost centres and budgets ----------------
      defineRoute({
        method: 'get',
        path: '/cost-centres',
        summary: 'Cost centres (budget departments)',
        permission: 'acc.budget.view',
        handler: async (_i, req) => this.ok(await this.resolve<ListCostCentres>(req, 'listCostCentres').execute({})),
      }),
      defineRoute({
        method: 'post',
        path: '/cost-centres',
        summary: 'Create a cost centre, optionally for one campus or HR department',
        permission: 'acc.budget.create',
        schema: {
          body: z
            .object({
              code: z.string().regex(/^[A-Za-z0-9_-]{2,20}$/),
              nameEn: zx.name(),
              campusId: zx.uuid().nullable().optional(),
              departmentId: zx.uuid().nullable().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateCostCentre>(req, 'createCostCentre').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/budgets',
        summary: 'Budgets of the campus',
        permission: 'acc.budget.view',
        schema: {
          query: z.object({
            academicYearId: zx.uuid().optional(),
            status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'superseded', 'closed']).optional(),
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<ListBudgets>(req, 'listBudgets').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/budgets',
        summary:
          'Create an annual budget (lines: annual amount spread evenly, or 12 months) or a revision of the approved one',
        permission: 'acc.budget.create',
        schema: {
          body: z
            .object({
              campusId: zx.uuid().optional(),
              academicYearId: zx.uuid(),
              name: zx.name(),
              lines: z.array(BudgetLine).max(2000).optional(),
              revisionOfId: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateBudget>(req, 'createBudget').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/budgets/:id',
        summary: 'Budget with lines per account x cost centre (12 months)',
        permission: 'acc.budget.view',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetBudget>(req, 'getBudget').execute(params)),
      }),
      defineRoute({
        method: 'put',
        path: '/budgets/:id/lines',
        summary: 'Replace the lines of a draft (or rejected) budget',
        permission: 'acc.budget.create',
        successStatus: 200,
        schema: { params: Id, body: z.object({ lines: z.array(BudgetLine).max(2000) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetBudgetLines>(req, 'setBudgetLines').execute({ id: params.id, lines: body.lines }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/budgets/:id/submit',
        summary: 'Submit for approval',
        permission: 'acc.budget.create',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<SubmitBudget>(req, 'submitBudget').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/budgets/:id/decide',
        summary: 'Approve (a revision supersedes the approved budget) or reject; not by the submitter',
        permission: 'acc.budget.approve',
        successStatus: 200,
        schema: { params: Id, body: Decision },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<DecideBudget>(req, 'decideBudget').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'get',
        path: '/budgets/:id/vs-actual',
        summary: 'Budget vs actual: year-to-date budget, actuals, open commitments, what is left, variance',
        permission: 'acc.budget.view',
        schema: { params: Id, query: z.object({ asOf: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<BudgetVsActual>(req, 'budgetVsActual').execute({
              budgetId: params.id,
              asOf: query.asOf,
            }),
          ),
      }),

      // ---------------- vendors ----------------
      defineRoute({
        method: 'get',
        path: '/vendors',
        summary: 'Supplier master',
        permission: 'acc.procurement.view',
        schema: {
          query: z.object({
            q: z.string().max(100).optional(),
            active: z
              .enum(['true', 'false'])
              .transform((v) => v === 'true')
              .optional(),
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<ListVendors>(req, 'listVendors').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/vendors',
        summary: 'Add a supplier (TIN, BIN, VAT / TDS deduction rates, payment terms)',
        permission: 'acc.procurement.create',
        schema: { body: VendorBody.required({ code: true }) },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateVendor>(req, 'createVendor').execute(body as never)),
      }),
      defineRoute({
        method: 'get',
        path: '/vendors/:id',
        summary: 'Supplier with performance (on-time deliveries, rating, billed, outstanding)',
        permission: 'acc.procurement.view',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetVendor>(req, 'getVendor').execute(params)),
      }),
      defineRoute({
        method: 'patch',
        path: '/vendors/:id',
        summary: 'Update a supplier (rates, terms, performance note, active)',
        permission: 'acc.procurement.create',
        schema: { params: Id, body: VendorBody.omit({ code: true }).partial() },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<UpdateVendor>(req, 'updateVendor').execute({ id: params.id, ...body })),
      }),

      // ---------------- requisitions and quotations ----------------
      defineRoute({
        method: 'post',
        path: '/requisitions',
        summary: 'Raise a purchase requisition for a cost centre (optionally submitted at once)',
        permission: 'acc.requisition.create',
        schema: {
          body: z
            .object({
              campusId: zx.uuid().optional(),
              title: zx.name(),
              costCentreId: zx.uuid(),
              departmentId: zx.uuid().optional(),
              neededBy: zx.date().optional(),
              justification: z.string().max(2000).optional(),
              lines: z
                .array(
                  z
                    .object({
                      description: z.string().trim().min(2).max(500),
                      quantity: Qty,
                      estUnitPaisa: zx.paisa(),
                      accountId: zx.uuid(),
                      itemVariantId: zx.uuid().optional(),
                    })
                    .strict(),
                )
                .min(1)
                .max(100),
              submit: z.boolean().default(false),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateRequisition>(req, 'createRequisition').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/requisitions',
        summary: 'Requisitions (procurement staff: the campus; others: their own)',
        schema: {
          query: z.object({
            status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'ordered', 'closed', 'cancelled']).optional(),
            mine: z
              .enum(['true', 'false'])
              .transform((v) => v === 'true')
              .optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListRequisitions>(req, 'listRequisitions').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/requisitions/:id',
        summary: 'Requisition with lines, quotation comparison and budget check',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetRequisition>(req, 'getRequisition').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/requisitions/:id/submit',
        summary: 'Submit own requisition for approval',
        permission: 'acc.requisition.create',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<SubmitRequisition>(req, 'submitRequisition').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/requisitions/:id/decide',
        summary: 'Approve or reject; beyond the budget needs budget approval and an overrun reason',
        permission: 'acc.procurement.approve',
        successStatus: 200,
        schema: {
          params: Id,
          body: Decision.extend({ overrunReason: z.string().trim().min(5).max(1000).optional() }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<DecideRequisition>(req, 'decideRequisition').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/requisitions/:id/cancel',
        summary: 'Cancel a requisition that is not yet ordered',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<CancelRequisition>(req, 'cancelRequisition').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/requisitions/:id/quotations',
        summary: 'Record a vendor quotation for an approved requisition',
        permission: 'acc.procurement.create',
        schema: {
          params: Id,
          body: z
            .object({
              vendorId: zx.uuid(),
              totalPaisa: zx.paisa(),
              validUntil: zx.date().optional(),
              deliveryDays: z.number().int().min(0).max(365).optional(),
              quoteRef: z.string().max(60).optional(),
              note: z.string().max(1000).optional(),
              fileId: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<AddQuotation>(req, 'addQuotation').execute({ requisitionId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/requisitions/:id/quotations/:quotationId/select',
        summary: 'Choose a quotation (enough quotes, a reason when it is not the lowest)',
        permission: 'acc.procurement.approve',
        successStatus: 200,
        schema: {
          params: z.object({ id: zx.uuid(), quotationId: zx.uuid() }),
          body: z.object({ reason: z.string().trim().max(1000).optional() }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SelectQuotation>(req, 'selectQuotation').execute({
              requisitionId: params.id,
              quotationId: params.quotationId,
              reason: body.reason,
            }),
          ),
      }),

      // ---------------- purchase orders, receipts, bills, payments ----------------
      defineRoute({
        method: 'post',
        path: '/requisitions/:id/purchase-order',
        summary: 'Issue the PO to the selected vendor (total = quoted price; must fit the budget)',
        permission: 'acc.procurement.create',
        schema: {
          params: Id,
          body: z
            .object({
              orderDate: zx.date().optional(),
              expectedOn: zx.date().optional(),
              terms: z.string().max(2000).optional(),
              lines: z
                .array(
                  z
                    .object({
                      description: z.string().trim().min(2).max(500),
                      quantity: Qty,
                      unitPaisa: zx.paisa(),
                      accountId: zx.uuid(),
                      itemVariantId: zx.uuid().optional(),
                    })
                    .strict(),
                )
                .min(1)
                .max(100),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<IssuePurchaseOrder>(req, 'issuePurchaseOrder').execute({
              requisitionId: params.id,
              ...body,
            }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/purchase-orders',
        summary: 'Purchase orders of the campus',
        permission: 'acc.procurement.view',
        schema: {
          query: z.object({
            status: z
              .enum(['draft', 'issued', 'partially_received', 'received', 'billed', 'closed', 'cancelled'])
              .optional(),
            vendorId: zx.uuid().optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListPurchaseOrders>(req, 'listPurchaseOrders').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/purchase-orders/:id',
        summary: 'Purchase order with lines (ordered / received / billed), receipts and bills',
        permission: 'acc.procurement.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetPurchaseOrder>(req, 'getPurchaseOrder').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/purchase-orders/:id/pdf',
        summary: 'Purchase order PDF for the supplier',
        permission: 'acc.procurement.view',
        schema: { params: Id },
        handler: async ({ params }, req, res) => {
          const { filename, pdf } = await this.resolve<RenderPurchaseOrder>(req, 'renderPurchaseOrder').execute(params);
          res
            .status(200)
            .set({
              'Content-Type': 'application/pdf',
              'Content-Disposition': `inline; filename="${filename}"`,
              'Cache-Control': 'private, no-store',
            })
            .send(pdf);
          return undefined;
        },
      }),
      defineRoute({
        method: 'post',
        path: '/purchase-orders/:id/cancel',
        summary: 'Cancel an issued order with nothing received (the requisition reopens)',
        permission: 'acc.procurement.approve',
        successStatus: 200,
        schema: { params: Id, body: z.object({ reason: z.string().trim().min(3).max(500) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<CancelPurchaseOrder>(req, 'cancelPurchaseOrder').execute({ id: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/purchase-orders/:id/receipts',
        summary: 'Goods receipt note (partial deliveries; on-time flag; rating 1-5); stock items go into storeId',
        permission: 'acc.procurement.create',
        schema: {
          params: Id,
          body: z
            .object({
              receivedOn: zx.date().optional(),
              storeId: zx.uuid().optional(),
              lines: Lines,
              rating: z.number().int().min(1).max(5).optional(),
              note: z.string().max(1000).optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<ReceiveGoods>(req, 'receiveGoods').execute({ poId: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/purchase-orders/:id/bills',
        summary: 'Supplier bill for received goods (three-way match); VAT / TDS withheld; posts the journal',
        permission: 'acc.procurement.create',
        schema: {
          params: Id,
          body: z
            .object({
              billNo: z.string().trim().min(1).max(60),
              billDate: zx.date().optional(),
              lines: Lines.optional(),
              vatPaisa: zx.paisa().optional(),
              tdsPaisa: zx.paisa().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<RecordSupplierBill>(req, 'recordSupplierBill').execute({ poId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/supplier-bills',
        summary: 'Supplier bills of the campus',
        permission: 'acc.procurement.view',
        schema: {
          query: z.object({
            vendorId: zx.uuid().optional(),
            status: z.enum(['open', 'partially_paid', 'paid', 'cancelled']).optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListSupplierBills>(req, 'listSupplierBills').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/supplier-bills/:id',
        summary: 'Supplier bill with payments',
        permission: 'acc.procurement.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetSupplierBill>(req, 'getSupplierBill').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/supplier-bills/:id/payments',
        summary: 'Pay a supplier bill in full or in part (posts Dr payable, Cr bank / cash / mobile)',
        permission: 'acc.procurement.approve',
        schema: {
          params: Id,
          body: z
            .object({
              amountPaisa: zx.paisa().optional(),
              paidOn: zx.date().optional(),
              method: z.enum(['bank', 'cash', 'mobile']),
              reference: z.string().max(100).optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<PaySupplierBill>(req, 'paySupplierBill').execute({ billId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/payables/aging',
        summary: 'Accounts payable aging per vendor (not due, 1-30, 31-60, 61-90, 90+ days)',
        permission: 'acc.procurement.view',
        schema: { query: z.object({ asOf: zx.date().optional() }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<PayablesAging>(req, 'payablesAging').execute(query)),
      }),
    ];
  }
}
