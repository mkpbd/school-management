import { z } from 'zod';
import { salaryComponent } from '../../../shared/infrastructure/db/schema/hrm.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  BankAdvice,
  CancelPayrollRun,
  ComputePayroll,
  CreateContract,
  CreatePayrollRun,
  DecidePayroll,
  GetPayrollSheet,
  GetPayslip,
  GrantLoan,
  ListContracts,
  ListLoans,
  ListPayrollRuns,
  LockPayroll,
  MarkPayrollPaid,
  MyPayslips,
  PullAttendanceInputs,
  ReviseContract,
  RenderPayslipPdf,
  RenderRunPayslipsPdf,
  SaveTaxYear,
  SetBankAccount,
  SetPayrollInputs,
  SetTaxProfile,
  SubmitPayroll,
  ListTaxYears,
  VerifyTaxYear,
} from '../application/PayrollUseCases.js';

const Id = z.object({ id: zx.uuid() });
const TaxYearCode = z.string().regex(/^\d{4}-\d{2}$/, 'income year, e.g. 2026-27');
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const ComponentCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/);
const ContractComponents = z
  .array(
    z
      .object({
        componentCode: ComponentCode,
        amountPaisa: zx.paisa().optional(),
        percent: z.number().min(0).max(100).optional(),
      })
      .strict(),
  )
  .max(30)
  .default([]);
const Adjustment = z
  .object({
    componentCode: ComponentCode,
    amountPaisa: z.number().int().positive().max(100_000_000_00),
    note: z.string().max(200).optional(),
  })
  .strict();

/** HRM-04 payroll: salary components, contracts, bank accounts, loans, monthly runs with maker-checker. */
export class PayrollController extends BaseController {
  readonly basePath = '/hrm';
  readonly tag = 'HRM · Payroll';

  routes(): RouteDefinition[] {
    return [
      ...crudRoutes({
        path: '/salary-components',
        entity: 'salary component',
        table: salaryComponent,
        orgScoped: true,
        permissions: { view: 'hrm.payroll.view', create: 'hrm.payroll.create', edit: 'hrm.payroll.create' },
        orderBy: [salaryComponent.seq],
        createSchema: z.object({
          code: ComponentCode,
          nameEn: zx.name(),
          kind: z.enum(['earning', 'deduction', 'employer_contribution']),
          calc: z.enum(['fixed', 'percent_of_basic', 'per_unit']),
          taxable: z.boolean().default(true),
          seq: z.number().int().min(0).max(999).default(100),
        }),
        updateSchema: z.object({ nameEn: zx.name(), taxable: z.boolean(), seq: z.number().int().min(0).max(999) }),
      }),

      // ---------------- contracts, bank account, loans ----------------
      defineRoute({
        method: 'get',
        path: '/staff/:id/contracts',
        summary: 'Contracts of a staff member with salary components',
        permission: 'hrm.payroll.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<ListContracts>(req, 'listContracts').execute({ staffId: params.id })),
      }),
      defineRoute({
        method: 'post',
        path: '/staff/:id/contracts',
        summary: 'Create a contract: basic pay + components (fixed / percent of basic / per-unit rate)',
        permission: 'hrm.payroll.create',
        schema: {
          params: Id,
          body: z
            .object({
              contractType: z.enum(['permanent', 'fixed_term', 'part_time', 'hourly', 'probation']),
              startsOn: zx.date(),
              endsOn: zx.date().optional(),
              probationEndsOn: zx.date().optional(),
              basicPaisa: zx.paisa(),
              components: ContractComponents,
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<CreateContract>(req, 'createContract').execute({ staffId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/contracts/:id/revise',
        summary: 'Salary revision from a date (current contract ends the day before)',
        permission: 'hrm.payroll.create',
        schema: {
          params: Id,
          body: z.object({ effectiveFrom: zx.date(), basicPaisa: zx.paisa(), components: ContractComponents }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<ReviseContract>(req, 'reviseContract').execute({ contractId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'put',
        path: '/staff/:id/bank-account',
        summary: 'Salary bank account (stored encrypted; null removes it)',
        permission: 'hrm.staff.edit',
        schema: {
          params: Id,
          body: z
            .object({
              account: z
                .object({
                  bankName: z.string().min(2).max(100),
                  branchName: z.string().min(2).max(100),
                  routingNo: z.string().regex(/^\d{9}$/, '9-digit routing number'),
                  accountName: z.string().min(2).max(100),
                  accountNo: z.string().regex(/^\d{6,20}$/),
                })
                .strict()
                .nullable(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetBankAccount>(req, 'setBankAccount').execute({
              staffId: params.id,
              account: body.account,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/staff/:id/loans',
        summary: 'Grant a loan or salary advance, recovered in monthly installments by payroll',
        permission: 'hrm.payroll.create',
        schema: {
          params: Id,
          body: z
            .object({
              kind: z.enum(['loan', 'advance']),
              principalPaisa: z.number().int().positive(),
              installmentPaisa: z.number().int().positive(),
              startsMonth: Month,
              reason: z.string().max(300).optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<GrantLoan>(req, 'grantStaffLoan').execute({ staffId: params.id, ...body })),
      }),
      defineRoute({
        method: 'get',
        path: '/loans',
        summary: 'Loans and advances with outstanding balance',
        permission: 'hrm.payroll.view',
        schema: {
          query: z.object({
            staffId: zx.uuid().optional(),
            status: z.enum(['active', 'closed', 'written_off']).optional(),
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<ListLoans>(req, 'listStaffLoans').execute(query)),
      }),

      // ---------------- payroll runs ----------------
      defineRoute({
        method: 'get',
        path: '/payroll-runs',
        summary: 'Payroll runs',
        permission: 'hrm.payroll.view',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            year: z.coerce.number().int().min(2000).max(2100).optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListPayrollRuns>(req, 'listPayrollRuns').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/payroll-runs',
        summary: 'Start the monthly payroll of a campus (optionally with festival bonus)',
        permission: 'hrm.payroll.create',
        schema: {
          body: z
            .object({
              campusId: zx.uuid().optional(),
              month: Month,
              includeComponents: z.array(ComponentCode).max(10).optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreatePayrollRun>(req, 'createPayrollRun').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/payroll-runs/:id',
        summary: 'Payroll sheet: every payslip with totals',
        permission: 'hrm.payroll.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetPayrollSheet>(req, 'getPayrollSheet').execute({ runId: params.id })),
      }),
      defineRoute({
        method: 'put',
        path: '/payroll-runs/:id/inputs',
        summary: 'Monthly inputs per staff: unpaid leave days, overtime minutes, cover periods, adjustments',
        permission: 'hrm.payroll.create',
        schema: {
          params: Id,
          body: z
            .object({
              rows: z
                .array(
                  z
                    .object({
                      staffId: zx.uuid(),
                      lwpDays: z.number().min(0).max(31).multipleOf(0.5).optional(),
                      overtimeMinutes: z.number().int().min(0).max(20_000).optional(),
                      coverPeriods: z.number().int().min(0).max(500).optional(),
                      adjustments: z.array(Adjustment).max(20).optional(),
                    })
                    .strict(),
                )
                .min(1)
                .max(1000),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetPayrollInputs>(req, 'setPayrollInputs').execute({
              runId: params.id,
              rows: body.rows,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/payroll-runs/:id/inputs/from-attendance',
        summary: 'Fill unpaid days and overtime from staff attendance and leave (keeps cover periods, adjustments)',
        permission: 'hrm.payroll.create',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<PullAttendanceInputs>(req, 'pullAttendanceInputs').execute({ runId: params.id })),
      }),
      ...(
        [
          ['compute', 'computePayroll', 'Compute (or recompute) all payslips', 'hrm.payroll.create'],
          ['submit', 'submitPayroll', 'Submit for approval', 'hrm.payroll.create'],
          [
            'lock',
            'lockPayroll',
            'Lock: payslips frozen, loan installments taken, staff notified',
            'hrm.payroll.approve',
          ],
          ['cancel', 'cancelPayrollRun', 'Cancel an unapproved run', 'hrm.payroll.create'],
        ] as const
      ).map(([action, useCase, summary, permission]) =>
        defineRoute({
          method: 'post',
          path: `/payroll-runs/:id/${action}`,
          summary,
          permission,
          successStatus: 200,
          schema: { params: Id },
          handler: async ({ params }, req) =>
            this.ok(
              await this.resolve<ComputePayroll | SubmitPayroll | LockPayroll | CancelPayrollRun>(req, useCase).execute(
                {
                  runId: params.id,
                },
              ),
            ),
        }),
      ),
      defineRoute({
        method: 'post',
        path: '/payroll-runs/:id/decision',
        summary: 'Approve or reject a submitted payroll (not by the submitter)',
        permission: 'hrm.payroll.approve',
        successStatus: 200,
        schema: {
          params: Id,
          body: z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).optional() }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<DecidePayroll>(req, 'decidePayroll').execute({ runId: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/payroll-runs/:id/paid',
        summary: 'Record that salaries were transferred',
        permission: 'hrm.payroll.approve',
        successStatus: 200,
        schema: { params: Id, body: z.object({ paymentReference: z.string().min(2).max(100) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<MarkPayrollPaid>(req, 'markPayrollPaid').execute({ runId: params.id, ...body })),
      }),
      defineRoute({
        method: 'get',
        path: '/payroll-runs/:id/bank-advice',
        summary: 'Bank advice CSV (locked or paid payroll)',
        permission: 'hrm.payroll.export',
        schema: { params: Id },
        handler: async ({ params }, req, res) => {
          const advice = await this.resolve<BankAdvice>(req, 'bankAdvice').execute({ runId: params.id });
          res
            .status(200)
            .set({
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="${advice.filename}"`,
              'Cache-Control': 'no-store',
              'X-Missing-Accounts': String(advice.missingAccounts),
            })
            .send(advice.csv);
          return undefined;
        },
      }),

      // ---------------- income tax ----------------
      defineRoute({
        method: 'get',
        path: '/tax-years',
        summary: 'Income-tax tables per income year (used for monthly TDS)',
        permission: 'hrm.payroll.view',
        handler: async (_i, req) => this.ok(await this.resolve<ListTaxYears>(req, 'listTaxYears').execute({})),
      }),
      defineRoute({
        method: 'put',
        path: '/tax-years/:code',
        summary: 'Save the tax rules of an income year (clears its verification)',
        description:
          'Amounts in paisa. thresholds per category (general required), slabs above the threshold (the last one widthPaisa null), salaryExemption {fraction, capPaisa}, rebate {incomePct, investmentPct, capPaisa}, minimumTaxPaisa.',
        permission: 'hrm.payroll.create',
        schema: {
          params: z.object({ code: TaxYearCode }),
          body: z
            .object({
              startsOn: zx.date(),
              endsOn: zx.date(),
              sourceNote: z.string().max(500).optional(),
              rules: z
                .object({
                  thresholds: z
                    .object({
                      general: z.number().int().min(0),
                      female: z.number().int().min(0).optional(),
                      senior: z.number().int().min(0).optional(),
                      disabled: z.number().int().min(0).optional(),
                      third_gender: z.number().int().min(0).optional(),
                      freedom_fighter: z.number().int().min(0).optional(),
                    })
                    .strict(),
                  slabs: z
                    .array(
                      z
                        .object({
                          widthPaisa: z.number().int().positive().nullable(),
                          ratePct: z.number().min(0).max(100),
                        })
                        .strict(),
                    )
                    .min(1)
                    .max(12),
                  salaryExemption: z
                    .object({ fraction: z.number().min(0).max(1), capPaisa: z.number().int().min(0) })
                    .strict(),
                  rebate: z
                    .object({
                      incomePct: z.number().min(0).max(100),
                      investmentPct: z.number().min(0).max(100),
                      capPaisa: z.number().int().min(0),
                    })
                    .strict(),
                  minimumTaxPaisa: z.number().int().min(0),
                })
                .strict(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<SaveTaxYear>(req, 'saveTaxYear').execute({ code: params.code, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/tax-years/:code/verify',
        summary: 'Confirm the tax table matches the Finance Act (removes the payroll warning)',
        permission: 'hrm.payroll.approve',
        successStatus: 200,
        schema: { params: z.object({ code: TaxYearCode }) },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<VerifyTaxYear>(req, 'verifyTaxYear').execute(params)),
      }),
      defineRoute({
        method: 'put',
        path: '/staff/:id/tax-profile',
        summary:
          'Tax category, declared investment (rebate), disabled children (higher threshold) and first-time taxpayer (lower minimum tax) for an income year',
        permission: 'hrm.payroll.create',
        schema: {
          params: Id,
          body: z
            .object({
              taxYearCode: TaxYearCode,
              category: z.enum(['general', 'female', 'senior', 'disabled', 'third_gender', 'freedom_fighter']),
              declaredInvestmentPaisa: z.number().int().min(0).default(0),
              disabledChildren: z.number().int().min(0).max(10).default(0),
              newTaxpayer: z.boolean().default(false),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<SetTaxProfile>(req, 'setTaxProfile').execute({ staffId: params.id, ...body })),
      }),

      // ---------------- payslips ----------------
      defineRoute({
        method: 'get',
        path: '/payslips/:id/pdf',
        summary: 'Payslip as PDF (A4; DRAFT watermark until the payroll is locked)',
        schema: { params: Id },
        handler: async ({ params }, req, res) => {
          const { filename, pdf } = await this.resolve<RenderPayslipPdf>(req, 'renderPayslipPdf').execute(params);
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
        method: 'get',
        path: '/payroll-runs/:id/payslips-pdf',
        summary: 'All payslips of a run in one PDF (one page each)',
        permission: 'hrm.payroll.view',
        schema: { params: Id },
        handler: async ({ params }, req, res) => {
          const { filename, pdf } = await this.resolve<RenderRunPayslipsPdf>(req, 'renderRunPayslipsPdf').execute({
            runId: params.id,
          });
          res
            .status(200)
            .set({
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Cache-Control': 'private, no-store',
            })
            .send(pdf);
          return undefined;
        },
      }),
      defineRoute({
        method: 'get',
        path: '/payslips/:id',
        summary: 'Payslip with lines (payroll staff, or the staff member once locked)',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetPayslip>(req, 'getPayslip').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/me/payslips',
        summary: 'My payslips (locked / paid months)',
        handler: async (_input, req) => this.ok(await this.resolve<MyPayslips>(req, 'myPayslips').execute({})),
      }),
    ];
  }
}
