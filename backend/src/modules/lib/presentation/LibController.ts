import { z } from 'zod';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { bookCopy, bookTitle, digitalItem } from '../../../shared/infrastructure/db/schema/lib.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import { MANUAL_COPY_STATUSES } from '../domain/library.js';
import type {
  AddCopies,
  CancelReservation,
  ChangeCopyStatus,
  CompleteStockTake,
  CreateDigitalItem,
  ExpireReservations,
  GetBorrowerAccount,
  GetStockTakeReport,
  GetTitle,
  IssueBook,
  ListDigitalItems,
  ListLoans,
  ListPolicies,
  ListReservations,
  RenewLoan,
  ReserveTitle,
  ReturnBook,
  SavePolicy,
  ScanCopies,
  SearchCatalogue,
  SendOverdueReminders,
  SetTitleCover,
  StartStockTake,
} from '../application/LibraryUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Borrower = z.enum(['student', 'staff']);
const MemberType = z.enum(['student_junior', 'student_senior', 'teacher', 'staff']);
const Paging = {
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
};
const Barcode = z.string().trim().min(1).max(64);

const titleFields = {
  isbn: z
    .string()
    .regex(/^[0-9X-]{10,17}$/i, 'ISBN-10 or ISBN-13')
    .optional(),
  title: z.string().min(1).max(300),
  subtitle: z.string().max(300).optional(),
  authors: z.array(z.string().min(1).max(120)).max(20).default([]),
  publisher: z.string().max(200).optional(),
  edition: z.string().max(50).optional(),
  publishedYear: z.number().int().min(1000).max(2100).optional(),
  language: z.string().min(2).max(10).default('en'),
  categoryCode: z.string().max(30).optional(),
  readingLevel: z.string().max(30).optional(),
  mediaType: z.enum(['book', 'journal', 'magazine', 'dvd', 'audio', 'kit']).default('book'),
};

/** LIB: catalogue, circulation, fines, reservations, stock-take, e-library (LIB-01..06). */
export class LibController extends BaseController {
  readonly basePath = '/lib';
  readonly tag = 'Library';

  routes(): RouteDefinition[] {
    return [
      // ---------------- catalogue ----------------
      defineRoute({
        method: 'get',
        path: '/catalogue',
        summary: 'Search the catalogue (title, subtitle, ISBN, author) with copies / available / waiting per campus',
        permission: 'lib.catalogue.view',
        schema: {
          query: z.object({
            q: z.string().max(100).optional(),
            campusId: zx.uuid().optional(),
            availableOnly: z
              .enum(['true', 'false'])
              .transform((v) => v === 'true')
              .optional(),
            ...Paging,
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<SearchCatalogue>(req, 'searchCatalogue').execute(query)),
      }),
      ...crudRoutes({
        path: '/titles',
        entity: 'book title',
        table: bookTitle,
        orgScoped: true,
        permissions: { view: 'lib.catalogue.view', create: 'lib.catalogue.create', edit: 'lib.catalogue.edit' },
        filters: { isbn: bookTitle.isbn, categoryCode: bookTitle.categoryCode, mediaType: bookTitle.mediaType },
        search: [bookTitle.title],
        orderBy: [bookTitle.title],
        createSchema: z.object(titleFields),
        updateSchema: z.object({ ...titleFields, isbn: titleFields.isbn.nullable() }),
      }).filter((r) => !(r.method === 'get' && r.path === '/titles/:id')),
      defineRoute({
        method: 'get',
        path: '/titles/:id',
        summary: 'Title with copies (status, shelf) and availability',
        permission: 'lib.catalogue.view',
        schema: { params: Id, query: z.object({ campusId: zx.uuid().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(await this.resolve<GetTitle>(req, 'getTitle').execute({ id: params.id, campusId: query.campusId })),
      }),
      defineRoute({
        method: 'put',
        path: '/titles/:id/cover',
        summary: 'Set the cover image (file uploaded with purpose library_cover)',
        permission: 'lib.catalogue.edit',
        schema: { params: Id, body: z.object({ fileId: zx.uuid().nullable() }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetTitleCover>(req, 'setTitleCover').execute({ id: params.id, fileId: body.fileId }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/titles/:id/copies',
        summary: 'Accession copies (accession number per campus; barcode = pre-printed label or accession no)',
        permission: 'lib.catalogue.create',
        idempotent: true,
        schema: {
          params: Id,
          body: z
            .object({
              campusId: zx.uuid().optional(),
              count: z.number().int().min(1).max(100).optional(),
              barcodes: z.array(Barcode).min(1).max(100).optional(),
              shelfLocation: z.string().max(50).optional(),
              acquiredOn: zx.date().optional(),
              pricePaisa: zx.paisa().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<AddCopies>(req, 'addCopies').execute({ titleId: params.id, ...body })),
      }),
      ...crudRoutes({
        path: '/copies',
        entity: 'book copy',
        table: bookCopy,
        campusScoped: true,
        permissions: { view: 'lib.catalogue.view', edit: 'lib.catalogue.edit' },
        filters: {
          campusId: bookCopy.campusId,
          bookTitleId: bookCopy.bookTitleId,
          status: bookCopy.status,
          barcode: bookCopy.barcode,
        },
        search: [bookCopy.accessionNo, bookCopy.barcode],
        orderBy: [bookCopy.accessionNo],
        updateSchema: z.object({
          shelfLocation: z.string().max(50).nullable(),
          rfidUid: z.string().max(64).nullable(),
          pricePaisa: zx.paisa().nullable(),
        }),
      }),
      defineRoute({
        method: 'post',
        path: '/copies/:id/status',
        summary: 'Withdraw / send to repair / mark damaged or lost / put back on the shelf',
        permission: 'lib.catalogue.edit',
        successStatus: 200,
        schema: { params: Id, body: z.object({ status: z.enum(MANUAL_COPY_STATUSES) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<ChangeCopyStatus>(req, 'changeCopyStatus').execute({
              id: params.id,
              status: body.status,
            }),
          ),
      }),

      // ---------------- circulation ----------------
      defineRoute({
        method: 'post',
        path: '/issue',
        summary: 'Issue a copy (scan barcode) to a student or staff member; limits from the member policy',
        permission: 'lib.circulation.create',
        idempotent: true,
        schema: { body: z.object({ barcode: Barcode, borrowerType: Borrower, borrowerId: zx.uuid() }).strict() },
        handler: async ({ body }, req) => this.created(await this.resolve<IssueBook>(req, 'issueBook').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/return',
        summary: 'Return a copy; overdue / lost / damage fine is billed to the student family through FEE',
        permission: 'lib.circulation.create',
        idempotent: true,
        successStatus: 200,
        schema: {
          body: z
            .object({
              barcode: Barcode,
              condition: z.enum(['good', 'damaged', 'lost']).default('good'),
              damageFinePaisa: zx.paisa().optional(),
              waiveFine: z.boolean().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) => this.ok(await this.resolve<ReturnBook>(req, 'returnBook').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/loans/:id/renew',
        summary: 'Renew a loan (librarian, or the borrower themself)',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<RenewLoan>(req, 'renewLoan').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/loans',
        summary: 'Loans: active, overdue (with days late) or returned',
        permission: 'lib.circulation.view',
        schema: {
          query: z.object({
            status: z.enum(['active', 'overdue', 'returned']).optional(),
            campusId: zx.uuid().optional(),
            borrowerType: Borrower.optional(),
            borrowerId: zx.uuid().optional(),
            titleId: zx.uuid().optional(),
            ...Paging,
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<ListLoans>(req, 'listLoans').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/borrowers/:type/:id',
        summary: 'Reader account: loans, history, reservations, fines (librarian, self or guardian)',
        schema: { params: z.object({ type: Borrower, id: zx.uuid() }) },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetBorrowerAccount>(req, 'getBorrowerAccount').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/me',
        summary: 'My library account (signed-in staff member or student)',
        handler: async (_input, req) => {
          const ctx = req.ctx;
          const me = ctx.studentId
            ? { type: 'student' as const, id: ctx.studentId }
            : ctx.staffId
              ? { type: 'staff' as const, id: ctx.staffId }
              : null;
          if (!me) throw new NotFoundError('No library membership for this login', 'NOT_A_MEMBER');
          return this.ok(await this.resolve<GetBorrowerAccount>(req, 'getBorrowerAccount').execute(me));
        },
      }),

      // ---------------- reservations ----------------
      defineRoute({
        method: 'post',
        path: '/reservations',
        summary: 'Join the queue for a title with no copy on the shelf (self, guardian for a child, or librarian)',
        schema: {
          body: z
            .object({
              titleId: zx.uuid(),
              campusId: zx.uuid().optional(),
              borrowerType: Borrower.optional(),
              borrowerId: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<ReserveTitle>(req, 'reserveTitle').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/reservations/:id/cancel',
        summary: 'Cancel a reservation (a held copy moves to the next reader)',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<CancelReservation>(req, 'cancelReservation').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/reservations',
        summary: 'Reservation queue',
        permission: 'lib.reservation.view',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            status: z.enum(['waiting', 'ready', 'fulfilled', 'cancelled', 'expired']).optional(),
            borrowerType: Borrower.optional(),
            borrowerId: zx.uuid().optional(),
            ...Paging,
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListReservations>(req, 'listReservations').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/tasks/overdue-reminders',
        summary: 'Run the daily overdue reminders now (also scheduled 08:00)',
        permission: 'lib.circulation.edit',
        successStatus: 200,
        handler: async (_input, req) =>
          this.ok(await this.resolve<SendOverdueReminders>(req, 'sendOverdueReminders').execute({})),
      }),
      defineRoute({
        method: 'post',
        path: '/tasks/expire-reservations',
        summary: 'Expire uncollected reservations now (also scheduled hourly)',
        permission: 'lib.reservation.edit',
        successStatus: 200,
        handler: async (_input, req) =>
          this.ok(await this.resolve<ExpireReservations>(req, 'expireReservations').execute({})),
      }),

      // ---------------- stock take ----------------
      defineRoute({
        method: 'post',
        path: '/stock-takes',
        summary: 'Start a stock-take for a campus library',
        permission: 'lib.stock_take.create',
        schema: { body: z.object({ campusId: zx.uuid().optional() }).strict() },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<StartStockTake>(req, 'startStockTake').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/stock-takes/:id/scans',
        summary: 'Record scanned barcodes (repeat scans are ignored)',
        permission: 'lib.stock_take.create',
        successStatus: 200,
        schema: {
          params: Id,
          body: z
            .object({ barcodes: z.array(Barcode).min(1).max(500), condition: z.string().max(30).optional() })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<ScanCopies>(req, 'scanCopies').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'get',
        path: '/stock-takes/:id',
        summary: 'Stock-take report: expected vs scanned, missing and unexpected copies',
        permission: 'lib.stock_take.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetStockTakeReport>(req, 'getStockTakeReport').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/stock-takes/:id/complete',
        summary: 'Complete; optionally mark missing copies lost (found "lost" copies return to the shelf)',
        permission: 'lib.stock_take.create',
        successStatus: 200,
        schema: { params: Id, body: z.object({ markMissingAsLost: z.boolean().default(false) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<CompleteStockTake>(req, 'completeStockTake').execute({ id: params.id, ...body })),
      }),

      // ---------------- policies ----------------
      defineRoute({
        method: 'get',
        path: '/policies',
        summary: 'Loan limits, loan days, renewals and daily fine per member type',
        permission: 'lib.policy.view',
        handler: async (_input, req) => this.ok(await this.resolve<ListPolicies>(req, 'listPolicies').execute({})),
      }),
      defineRoute({
        method: 'put',
        path: '/policies/:memberType',
        summary: 'Set the policy of a member type',
        permission: 'lib.policy.edit',
        schema: {
          params: z.object({ memberType: MemberType }),
          body: z
            .object({
              maxLoans: z.number().int().min(0).max(50),
              loanDays: z.number().int().min(1).max(365),
              maxRenewals: z.number().int().min(0).max(10),
              finePerDayPaisa: zx.paisa(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SavePolicy>(req, 'savePolicy').execute({ memberType: params.memberType, ...body }),
          ),
      }),

      // ---------------- digital library ----------------
      defineRoute({
        method: 'get',
        path: '/digital-items',
        summary: 'E-library and past papers (students: own class + open items)',
        permission: 'lib.digital.view',
        schema: {
          query: z.object({
            q: z.string().max(100).optional(),
            kind: z.enum(['ebook', 'past_paper', 'journal', 'video']).optional(),
            subjectId: zx.uuid().optional(),
            yearGroupId: zx.uuid().optional(),
            ...Paging,
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListDigitalItems>(req, 'listDigitalItems').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/digital-items',
        summary: 'Add an e-book / past paper / video (uploaded file with purpose library_digital, or https link)',
        permission: 'lib.digital.create',
        schema: {
          body: z
            .object({
              title: z.string().min(1).max(300),
              kind: z.enum(['ebook', 'past_paper', 'journal', 'video']),
              fileId: zx.uuid().optional(),
              url: z.string().url().max(500).optional(),
              programmeId: zx.uuid().optional(),
              yearGroupIds: z.array(zx.uuid()).max(30).optional(),
              subjectId: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateDigitalItem>(req, 'createDigitalItem').execute(body)),
      }),
      ...crudRoutes({
        path: '/digital-items',
        entity: 'digital item',
        table: digitalItem,
        orgScoped: true,
        permissions: { view: 'lib.digital.view', edit: 'lib.digital.edit', delete: 'lib.digital.edit' },
        updateSchema: z.object({
          title: z.string().min(1).max(300),
          yearGroupIds: z.array(zx.uuid()).max(30),
          subjectId: zx.uuid().nullable(),
        }),
      }).filter((r) => r.path !== '/digital-items'),
    ];
  }
}
