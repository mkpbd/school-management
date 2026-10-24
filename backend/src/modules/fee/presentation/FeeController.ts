import { z } from 'zod';
import { concessionType, feeHead, feeStructure, studentFeeItem } from '../../../shared/infrastructure/db/schema/fee.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  ActivateFeeStructure,
  CloseCashSession,
  CreateAdhocInvoice,
  CreateFeeStructure,
  DecideConcession,
  GetFamilyStatement,
  GetFeeStructure,
  GetInvoice,
  GrantConcession,
  ListInvoices,
  OpenCashSession,
  PostBillingRun,
  PreviewBilling,
  RecordCounterPayment,
  VoidInvoice,
} from '../application/FeeUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const InvoiceStatus = z.enum(['draft', 'issued', 'partially_paid', 'paid', 'void']);

/** FEE: structures, concessions, billing, invoices, counter payments, cash sessions, statements (FEE-01..07). */
export class FeeController extends BaseController {
  readonly basePath = '/fee';
  readonly tag = 'Fees';

  routes(): RouteDefinition[] {
    return [
      ...crudRoutes({
        path: '/heads',
        entity: 'fee head',
        table: feeHead,
        orgScoped: true,
        permissions: { view: 'fee.structure.view', create: 'fee.structure.create', edit: 'fee.structure.edit' },
        filters: { kind: feeHead.kind, isActive: feeHead.isActive },
        orderBy: [feeHead.priority],
        createSchema: z.object({
          code: zx.code(),
          nameEn: zx.name(),
          nameBn: z.string().optional(),
          kind: z.enum([
            'tuition',
            'admission',
            'session',
            'exam',
            'lab',
            'transport',
            'activity',
            'uniform',
            'external_exam',
            'fine',
            'service',
            'opening_balance',
            'misc',
          ]),
          frequency: z.enum(['one_time', 'monthly', 'termly', 'annual', 'on_demand']),
          isRefundable: z.boolean().optional(),
          isDiscountable: z.boolean().optional(),
          priority: z.number().int().min(1).max(999).optional(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          nameBn: z.string().nullable(),
          isDiscountable: z.boolean(),
          priority: z.number().int(),
          isActive: z.boolean(),
        }),
      }),
      ...crudRoutes({
        path: '/concession-types',
        entity: 'concession type',
        table: concessionType,
        permissions: { view: 'fee.concession.view' },
      }),
      ...crudRoutes({
        path: '/structures',
        entity: 'fee structure',
        table: feeStructure,
        permissions: { view: 'fee.structure.view' },
        filters: {
          campusId: feeStructure.campusId,
          academicYearId: feeStructure.academicYearId,
          yearGroupId: feeStructure.yearGroupId,
          status: feeStructure.status,
        },
      }).filter((r) => !(r.method === 'get' && r.path.endsWith('/:id'))),
      defineRoute({
        method: 'get',
        path: '/structures/:id',
        summary: 'Fee structure with lines',
        permission: 'fee.structure.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetFeeStructure>(req, 'getFeeStructure').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/structures',
        summary: 'Create a draft fee structure (campus, year, year group) with lines',
        permission: 'fee.structure.create',
        schema: {
          body: z
            .object({
              campusId: zx.uuid().optional(),
              academicYearId: zx.uuid(),
              yearGroupId: zx.uuid(),
              name: zx.name(),
              lines: z
                .array(
                  z
                    .object({
                      feeHeadId: zx.uuid(),
                      amountPaisa: zx.paisa(),
                      billingMonths: z.array(z.number().int().min(1).max(12)).nullable().optional(),
                      dueDay: z.number().int().min(1).max(28).optional(),
                      appliesTo: z.enum(['all', 'new_admission', 'continuing']).optional(),
                    })
                    .strict(),
                )
                .min(1)
                .max(40),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateFeeStructure>(req, 'createFeeStructure').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/structures/:id/activate',
        summary: 'Activate (retires the previous active structure for the same campus/year/year group)',
        permission: 'fee.structure.approve',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<ActivateFeeStructure>(req, 'activateFeeStructure').execute(params)),
      }),
      ...crudRoutes({
        path: '/student-items',
        entity: 'student fee item',
        table: studentFeeItem,
        orgScoped: true,
        campusScoped: true,
        permissions: {
          view: 'fee.structure.view',
          create: 'fee.structure.edit',
          edit: 'fee.structure.edit',
          delete: 'fee.structure.edit',
        },
        filters: { enrolmentId: studentFeeItem.enrolmentId, feeHeadId: studentFeeItem.feeHeadId },
        createSchema: z.object({
          campusId: zx.uuid().optional(),
          enrolmentId: zx.uuid(),
          feeHeadId: zx.uuid(),
          amountPaisa: zx.paisa(),
          billingMonths: z.array(z.number().int().min(1).max(12)).optional(),
          validFrom: zx.date(),
          validTo: zx.date().optional(),
          sourceModule: z.string().max(10).default('fee'),
        }),
        updateSchema: z.object({ amountPaisa: zx.paisa(), validTo: zx.date().nullable() }),
      }),
      defineRoute({
        method: 'post',
        path: '/concessions',
        summary: 'Grant a concession (pending when the type requires approval)',
        permission: 'fee.concession.create',
        schema: {
          body: z
            .object({
              studentId: zx.uuid(),
              concessionTypeId: zx.uuid(),
              feeHeadId: zx.uuid().optional(),
              valuePercent: z.number().min(0).max(100).optional(),
              valuePaisa: zx.paisa().optional(),
              validFrom: zx.date(),
              validTo: zx.date(),
              justification: z.string().max(500).optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<GrantConcession>(req, 'grantConcession').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/concessions/:id/decide',
        summary: 'Approve or reject a pending concession',
        permission: 'fee.concession.approve',
        successStatus: 200,
        schema: { params: Id, body: z.object({ decision: z.enum(['approved', 'rejected']) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<DecideConcession>(req, 'decideConcession').execute({
              id: params.id,
              decision: body.decision,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/billing/preview',
        summary: 'Dry-run a monthly billing run (no invoices written)',
        permission: 'fee.billing.view',
        successStatus: 200,
        schema: {
          body: z.object({ campusId: zx.uuid().optional(), academicYearId: zx.uuid(), period: Period }).strict(),
        },
        handler: async ({ body }, req) =>
          this.ok(await this.resolve<PreviewBilling>(req, 'previewBilling').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/billing-runs',
        summary: 'Post a billing run: one invoice per active enrolment (never double-bills)',
        permission: 'fee.billing.approve',
        idempotent: true,
        schema: {
          body: z.object({ campusId: zx.uuid().optional(), academicYearId: zx.uuid(), period: Period }).strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<PostBillingRun>(req, 'postBillingRun').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/invoices',
        summary: 'List invoices (guardians: familyId of own children required)',
        schema: {
          query: z.object({
            familyId: zx.uuid().optional(),
            studentId: zx.uuid().optional(),
            campusId: zx.uuid().optional(),
            status: InvoiceStatus.optional(),
            period: Period.optional(),
            overdue: z
              .enum(['true', 'false'])
              .transform((v) => v === 'true')
              .optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListInvoices>(req, 'listInvoices').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/invoices/:id',
        summary: 'Invoice with lines',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetInvoice>(req, 'getInvoice').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/invoices',
        summary: 'Create and issue an ad-hoc invoice for a student',
        permission: 'fee.invoice.create',
        idempotent: true,
        schema: {
          body: z
            .object({
              studentId: zx.uuid(),
              dueDate: zx.date(),
              lines: z
                .array(
                  z
                    .object({ feeHeadId: zx.uuid(), description: zx.name(), amountPaisa: z.number().int().positive() })
                    .strict(),
                )
                .min(1)
                .max(20),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateAdhocInvoice>(req, 'createAdhocInvoice').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/invoices/:id/void',
        summary: 'Void an invoice (only when nothing has been paid)',
        permission: 'fee.invoice.delete',
        successStatus: 200,
        schema: { params: Id, body: z.object({ reason: z.string().min(3).max(300) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<VoidInvoice>(req, 'voidInvoice').execute({ id: params.id, reason: body.reason })),
      }),
      defineRoute({
        method: 'post',
        path: '/payments/counter',
        summary: 'Record a counter payment (cash needs an open cash session); surplus becomes family credit',
        permission: 'fee.payment.create',
        idempotent: true,
        schema: {
          body: z
            .object({
              campusId: zx.uuid().optional(),
              familyId: zx.uuid(),
              invoiceIds: z.array(zx.uuid()).max(50).optional(),
              amountPaisa: z.number().int().positive().max(100_000_000_00),
              channel: z.enum(['cash', 'cheque', 'pos_card', 'bank_deposit']),
              payerGuardianId: zx.uuid().optional(),
              instrument: z.record(z.string(), z.unknown()).optional(),
              notes: z.string().max(300).optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<RecordCounterPayment>(req, 'recordCounterPayment').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/cash-sessions',
        summary: 'Open my cash session with an opening float',
        permission: 'fee.cash_session.create',
        schema: {
          body: z.object({ campusId: zx.uuid().optional(), openingFloatPaisa: zx.paisa().default(0) }).strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<OpenCashSession>(req, 'openCashSession').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/cash-sessions/:id/close',
        summary: 'Close a cash session (expected vs counted, variance)',
        permission: 'fee.cash_session.create',
        successStatus: 200,
        schema: {
          params: Id,
          body: z.object({ countedCashPaisa: zx.paisa(), handedOverTo: zx.uuid().optional() }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<CloseCashSession>(req, 'closeCashSession').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'get',
        path: '/families/:id/statement',
        summary: 'Family statement: invoices, payments, outstanding, overdue, credit',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetFamilyStatement>(req, 'getFamilyStatement').execute({ familyId: params.id })),
      }),
    ];
  }
}
