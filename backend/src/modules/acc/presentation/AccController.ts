import { z } from 'zod';
import { account } from '../../../shared/infrastructure/db/schema/acc.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  CreateJournal,
  GetJournal,
  GetLedger,
  GetTrialBalance,
  ListJournals,
  ListPeriods,
  ReverseJournal,
  SetPeriodStatus,
} from '../application/AccountingUseCases.js';

const Id = z.object({ id: zx.uuid() });
const AccountCode = z.string().regex(/^\d{3,8}$/, 'numeric account code');
const Line = z
  .object({
    accountCode: AccountCode,
    debitPaisa: z.number().int().min(0).default(0),
    creditPaisa: z.number().int().min(0).default(0),
    memo: z.string().max(200).optional(),
    partyType: z.enum(['family', 'vendor', 'staff']).optional(),
    partyId: zx.uuid().optional(),
  })
  .strict();

/** ACC: chart of accounts, journals (manual + auto-posted), trial balance, ledger, fiscal periods (ACC-01, ACC-02). */
export class AccController extends BaseController {
  readonly basePath = '/acc';
  readonly tag = 'Accounts';

  routes(): RouteDefinition[] {
    return [
      ...crudRoutes({
        path: '/accounts',
        entity: 'account',
        table: account,
        orgScoped: true,
        permissions: { view: 'acc.journal.view', create: 'acc.journal.create', edit: 'acc.journal.create' },
        filters: { kind: account.kind, isActive: account.isActive, isPostable: account.isPostable },
        search: [account.code, account.nameEn],
        orderBy: [account.code],
        createSchema: z.object({
          code: AccountCode,
          nameEn: zx.name(),
          nameBn: z.string().max(200).optional(),
          kind: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
          parentId: zx.uuid().optional(),
          isPostable: z.boolean().default(true),
          isBank: z.boolean().default(false),
          isCash: z.boolean().default(false),
        }),
        updateSchema: z.object({ nameEn: zx.name(), nameBn: z.string().max(200).nullable(), isActive: z.boolean() }),
      }),
      defineRoute({
        method: 'get',
        path: '/journals',
        summary: 'Posted journals (filter by campus, dates, source module e.g. hrm / fee)',
        permission: 'acc.journal.view',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            from: zx.date().optional(),
            to: zx.date().optional(),
            sourceModule: z.string().max(10).optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListJournals>(req, 'listJournals').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/journals/:id',
        summary: 'Journal with lines',
        permission: 'acc.journal.view',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetJournal>(req, 'getJournal').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/journals',
        summary: 'Post a manual voucher (balanced; the fiscal period must be open)',
        permission: 'acc.journal.create',
        idempotent: true,
        schema: {
          body: z
            .object({
              campusId: zx.uuid().optional(),
              date: zx.date(),
              voucherType: z.enum(['receipt', 'payment', 'journal', 'contra']),
              narration: z.string().min(3).max(300),
              lines: z.array(Line).min(2).max(100),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateJournal>(req, 'createJournal').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/journals/:id/reverse',
        summary: 'Reverse a posted journal (posted journals are never edited)',
        permission: 'acc.journal.approve',
        schema: {
          params: Id,
          body: z.object({ reason: z.string().min(3).max(200), date: zx.date().optional() }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<ReverseJournal>(req, 'reverseJournal').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'get',
        path: '/trial-balance',
        summary: 'Trial balance as of a date (optionally one campus)',
        permission: 'acc.journal.view',
        schema: { query: z.object({ asOf: zx.date(), campusId: zx.uuid().optional() }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<GetTrialBalance>(req, 'getTrialBalance').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/ledger/:id',
        summary: 'Account ledger with opening, running and closing balance',
        permission: 'acc.journal.view',
        schema: {
          params: Id,
          query: z.object({ from: zx.date(), to: zx.date(), campusId: zx.uuid().optional() }),
        },
        handler: async ({ params, query }, req) =>
          this.ok(await this.resolve<GetLedger>(req, 'getLedger').execute({ accountId: params.id, ...query })),
      }),
      defineRoute({
        method: 'get',
        path: '/periods',
        summary: 'Fiscal periods (created per month on first posting)',
        permission: 'acc.journal.view',
        handler: async (_i, req) => this.ok(await this.resolve<ListPeriods>(req, 'listPeriods').execute({})),
      }),
      defineRoute({
        method: 'post',
        path: '/periods/:code/status',
        summary: 'Open, soft-lock or lock a fiscal period (locked: no postings)',
        permission: 'acc.journal.approve',
        successStatus: 200,
        schema: {
          params: z.object({ code: z.string().regex(/^\d{4}-\d{2}$/) }),
          body: z.object({ status: z.enum(['open', 'soft_locked', 'locked']) }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<SetPeriodStatus>(req, 'setPeriodStatus').execute({ code: params.code, ...body })),
      }),
    ];
  }
}
