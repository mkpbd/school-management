import type { EventPublisher, NumberAllocator, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import type { DomainEvent } from '../../../shared/domain/DomainEvent.js';
import { ConflictError, ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { AcaModuleApi } from '../../aca/public-api/AcaModuleApi.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { FeeModuleApi } from '../../fee/public-api/FeeModuleApi.js';
import type { HrmModuleApi } from '../../hrm/public-api/HrmModuleApi.js';
import type { FilesModuleApi } from '../../platform/public-api/FilesModuleApi.js';
import type { SisModuleApi } from '../../sis/public-api/SisModuleApi.js';
import {
  assessFine,
  copyStatusAfterReturn,
  memberTypeOf,
  overdueDays,
  type BorrowerType,
  type FineBreakdown,
  type MemberPolicy,
  type MemberType,
  type ReturnCondition,
} from '../domain/library.js';
import type {
  CopyRow,
  DigitalItemRow,
  LibRepository,
  LoanRow,
  ReservationRow,
  StockTakeReport,
  TitleSummary,
} from './ports.js';

export interface LibDeps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  libRepo: LibRepository;
  scopePolicy: ScopePolicy;
  numbers: NumberAllocator;
  outbox: EventPublisher;
  sisApi: SisModuleApi;
  acaApi: AcaModuleApi;
  hrmApi: HrmModuleApi;
  coreApi: CoreModuleApi;
  feeApi: FeeModuleApi;
  filesApi: FilesModuleApi;
}

export interface Borrower {
  type: BorrowerType;
  id: string;
  name: string;
  campusId: string;
  memberType: MemberType;
  active: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------------------------------------------

async function setting<T>(d: LibDeps, key: string, campusId: string | null, fallback: T): Promise<T> {
  return (await d.coreApi.getSetting<T>(key, campusId)) ?? fallback;
}

/** Students via SIS (+ year group order from ACA), staff via HRM; never reads their tables (ADR-008). */
async function resolveBorrower(d: LibDeps, type: BorrowerType, id: string): Promise<Borrower> {
  if (type === 'staff') {
    const s = await d.hrmApi.staffSummary(id);
    if (!s) throw new NotFoundError('Staff member not found', 'BORROWER_NOT_FOUND');
    return {
      type,
      id,
      name: s.fullNameEn,
      campusId: s.campusId,
      memberType: memberTypeOf({ type: 'staff', staffType: s.staffType }, 0),
      active: s.status === 'active',
    };
  }
  const brief = (await d.sisApi.studentBriefs([id])).get(id);
  if (!brief) throw new NotFoundError('Student not found', 'BORROWER_NOT_FOUND');
  const enrolment = await d.sisApi.activeEnrolment(id, LocalDate.today(d.clock).iso);
  const yearGroup = enrolment ? await d.acaApi.yearGroup(enrolment.yearGroupId) : null;
  const seniorFrom = await setting(d, 'lib.senior_from_year_seq', brief.campusId, 10);
  return {
    type,
    id,
    name: brief.fullNameEn,
    campusId: brief.campusId,
    memberType: memberTypeOf({ type: 'student', yearGroupSeq: yearGroup?.seq ?? null }, seniorFrom),
    active: brief.status === 'active',
  };
}

function isSelf(ctx: RequestContext, type: BorrowerType, id: string): boolean {
  return (type === 'staff' && ctx.staffId === id) || (type === 'student' && ctx.studentId === id);
}

/** The signed-in user as a borrower (teacher / staff / student self-service). */
function selfBorrower(ctx: RequestContext): { type: BorrowerType; id: string } | null {
  if (ctx.studentId) return { type: 'student', id: ctx.studentId };
  if (ctx.staffId) return { type: 'staff', id: ctx.staffId };
  return null;
}

/** Librarian (permission), the borrower themself, or a guardian of the student borrower. */
async function assertBorrowerAccess(
  d: LibDeps,
  permission: 'lib.circulation.view' | 'lib.reservation.view',
  type: BorrowerType,
  id: string,
): Promise<void> {
  if (d.scopePolicy.has(permission)) return;
  if (isSelf(d.ctx, type, id)) return;
  if (type === 'student' && d.ctx.guardianId && (await d.sisApi.isGuardianOf(d.ctx.guardianId, id))) return;
  throw new NotFoundError();
}

async function policyFor(d: LibDeps, memberType: MemberType): Promise<MemberPolicy> {
  const p = await d.libRepo.policy(memberType);
  if (!p) throw new InvariantError('LIB_POLICY_MISSING', `No library policy for ${memberType}`);
  return p;
}

/** Due date = today + loan days, moved forward to the next school day of the campus (max two weeks). */
async function dueDate(d: LibDeps, campusId: string, loanDays: number): Promise<string> {
  let due = LocalDate.today(d.clock).addDays(loanDays);
  for (let i = 0; i < 14; i++) {
    const day = await d.coreApi.isSchoolDay(campusId, due.iso);
    if (day.schoolDay || day.reason === 'outside_year') break;
    due = due.addDays(1);
  }
  return due.iso;
}

/**
 * A copy back on the shelf goes to the oldest waiting reservation of its title at the campus (held for
 * lib.reservation_hold_days), otherwise becomes available.
 */
async function releaseCopy(
  d: LibDeps,
  copy: Pick<CopyRow, 'id' | 'campusId' | 'bookTitleId' | 'title'>,
): Promise<{ status: 'available' | 'reserved'; reservationId?: string }> {
  const next = await d.libRepo.nextWaiting(copy.bookTitleId, copy.campusId);
  if (!next) {
    await d.libRepo.setCopyStatus(copy.id, 'available');
    return { status: 'available' };
  }
  const holdDays = await setting(d, 'lib.reservation_hold_days', copy.campusId, 3);
  const expiresAt = new Date(d.clock.now().getTime() + holdDays * 86_400_000);
  await d.libRepo.updateReservation(next.id, { status: 'ready', readyCopyId: copy.id, expiresAt });
  await d.libRepo.setCopyStatus(copy.id, 'reserved');
  await d.outbox.write([
    {
      type: 'lib.reservation_ready.v1',
      aggregateType: 'reservation',
      aggregateId: next.id,
      orgId: d.ctx.orgId,
      campusId: copy.campusId,
      occurredAt: d.clock.now(),
      payload: {
        reservationId: next.id,
        titleId: copy.bookTitleId,
        title: copy.title,
        borrowerType: next.borrowerType,
        borrowerId: next.borrowerId,
        expiresAt: expiresAt.toISOString(),
      },
    },
  ]);
  return { status: 'reserved', reservationId: next.id };
}

async function copyAtDesk(d: LibDeps, barcode: string): Promise<CopyRow> {
  const copy = await d.libRepo.copyByBarcode(barcode.trim(), true);
  if (!copy) throw new NotFoundError('No copy with this barcode', 'COPY_NOT_FOUND');
  d.scopePolicy.requireCampus(copy.campusId);
  return copy;
}

// ---------------------------------------------------------------------------------------------------------------
// Catalogue (LIB-01)
// ---------------------------------------------------------------------------------------------------------------

export interface TitleDetail extends TitleSummary {
  copiesList: CopyRow[];
}

export class SearchCatalogue extends Query<
  { q?: string; campusId?: string; availableOnly?: boolean; limit: number; offset: number },
  TitleSummary[]
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected handle(i: { q?: string; campusId?: string; availableOnly?: boolean; limit: number; offset: number }) {
    return this.d.libRepo.titleSummaries({ ...i, campusId: i.campusId ?? this.d.ctx.activeCampusId });
  }
}

export class GetTitle extends Query<{ id: string; campusId?: string }, TitleDetail> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; campusId?: string }) {
    const [title] = await this.d.libRepo.titleSummaries({ ids: [i.id], campusId: i.campusId, limit: 1, offset: 0 });
    if (!title) throw new NotFoundError();
    const copies = await this.d.libRepo.copiesOfTitle(i.id);
    return { ...title, copiesList: i.campusId ? copies.filter((c) => c.campusId === i.campusId) : copies };
  }
}

export class AddCopies extends UseCase<
  {
    titleId: string;
    campusId?: string;
    count?: number;
    barcodes?: string[];
    shelfLocation?: string;
    acquiredOn?: string;
    pricePaisa?: number;
  },
  CopyRow[]
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    titleId: string;
    campusId?: string;
    count?: number;
    barcodes?: string[];
    shelfLocation?: string;
    acquiredOn?: string;
    pricePaisa?: number;
  }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    if (!(await this.d.libRepo.titleExists(i.titleId))) throw new NotFoundError('Title not found', 'TITLE_NOT_FOUND');
    const labels = i.barcodes?.map((b) => b.trim()) ?? [];
    if (new Set(labels).size !== labels.length) throw new InvariantError('BARCODE_DUPLICATE', 'A barcode is repeated');
    const count = labels.length || i.count || 1;
    const rows: Array<Record<string, unknown>> = [];
    for (let n = 0; n < count; n++) {
      const accessionNo = await this.d.numbers.next({ campusId, key: 'lib_accession' });
      rows.push({
        orgId: this.d.ctx.orgId,
        campusId,
        bookTitleId: i.titleId,
        accessionNo,
        barcode: labels[n] ?? accessionNo, // pre-printed label, else the accession number is the barcode
        shelfLocation: i.shelfLocation ?? null,
        acquiredOn: i.acquiredOn ?? LocalDate.today(this.d.clock).iso,
        pricePaisa: i.pricePaisa ?? null,
      });
    }
    return this.d.libRepo.insertCopies(rows);
  }
}

export class ChangeCopyStatus extends UseCase<
  { id: string; status: 'available' | 'withdrawn' | 'in_repair' | 'damaged' | 'lost' },
  { id: string; status: string }
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; status: 'available' | 'withdrawn' | 'in_repair' | 'damaged' | 'lost' }) {
    const copy = await this.d.libRepo.copyForUpdate(i.id);
    if (!copy) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(copy.campusId);
    if (copy.status === 'on_loan' || copy.status === 'reserved')
      throw new ConflictError(
        'COPY_IN_CIRCULATION',
        `Copy is ${copy.status}; return it or cancel the reservation first`,
      );
    if (i.status === 'available') {
      const r = await releaseCopy(this.d, copy);
      return { id: i.id, status: r.status };
    }
    await this.d.libRepo.setCopyStatus(i.id, i.status);
    return { id: i.id, status: i.status };
  }
}

export class SetTitleCover extends UseCase<
  { id: string; fileId: string | null },
  { id: string; coverFileId: string | null }
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; fileId: string | null }) {
    if (i.fileId) await this.d.filesApi.requireUsable(i.fileId, 'library_cover');
    if (!(await this.d.libRepo.setTitleCover(i.id, i.fileId))) throw new NotFoundError();
    return { id: i.id, coverFileId: i.fileId };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Circulation (LIB-02, LIB-03)
// ---------------------------------------------------------------------------------------------------------------

export interface IssueResult {
  loanId: string;
  title: string;
  accessionNo: string;
  borrower: { type: BorrowerType; id: string; name: string; memberType: MemberType };
  dueOn: string;
  activeLoans: number;
  maxLoans: number;
  reservationFulfilled: string | null;
}

/** Issue a copy at the desk (scan barcode + borrower). Limits come from lib.member_policy. */
export class IssueBook extends UseCase<
  { barcode: string; borrowerType: BorrowerType; borrowerId: string },
  IssueResult
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }

  protected async handle(i: { barcode: string; borrowerType: BorrowerType; borrowerId: string }) {
    const { d } = this;
    const copy = await copyAtDesk(d, i.barcode);
    const borrower = await resolveBorrower(d, i.borrowerType, i.borrowerId);
    if (!borrower.active) throw new ConflictError('BORROWER_INACTIVE', `${borrower.name} is not an active member`);
    const policy = await policyFor(d, borrower.memberType);
    const today = LocalDate.today(d.clock).iso;
    const counts = await d.libRepo.activeLoanCount(borrower.type, borrower.id, today);
    if (counts.overdue > 0 && (await setting(d, 'lib.block_on_overdue', copy.campusId, true)))
      throw new ConflictError('BORROWER_HAS_OVERDUE', `${borrower.name} has ${counts.overdue} overdue book(s)`);
    if (counts.active >= policy.maxLoans)
      throw new ConflictError('LOAN_LIMIT_REACHED', `Limit of ${policy.maxLoans} book(s) reached`);

    let fulfilled: ReservationRow | null = null;
    if (copy.status === 'reserved') {
      const r = await d.libRepo.readyReservationForCopy(copy.id);
      if (r && (r.borrowerType !== borrower.type || r.borrowerId !== borrower.id))
        throw new ConflictError('COPY_RESERVED_FOR_OTHER', 'This copy is held for another reader');
      fulfilled = r;
    } else if (copy.status !== 'available') {
      throw new ConflictError('COPY_NOT_AVAILABLE', `Copy is ${copy.status}`);
    }
    // a reader who queued for the title and gets any copy has their reservation fulfilled
    fulfilled ??= await d.libRepo.openReservation(borrower.type, borrower.id, copy.bookTitleId);
    if (fulfilled) await d.libRepo.updateReservation(fulfilled.id, { status: 'fulfilled' });

    const dueOn = await dueDate(d, copy.campusId, policy.loanDays);
    const loanId = await d.libRepo.insertLoan({
      orgId: d.ctx.orgId,
      campusId: copy.campusId,
      bookCopyId: copy.id,
      borrowerType: borrower.type,
      borrowerId: borrower.id,
      issuedAt: d.clock.now(),
      dueOn,
      issuedBy: d.ctx.userId,
    });
    await d.libRepo.setCopyStatus(copy.id, 'on_loan');
    return {
      loanId,
      title: copy.title,
      accessionNo: copy.accessionNo,
      borrower: { type: borrower.type, id: borrower.id, name: borrower.name, memberType: borrower.memberType },
      dueOn,
      activeLoans: counts.active + 1,
      maxLoans: policy.maxLoans,
      reservationFulfilled: fulfilled?.id ?? null,
    };
  }
}

export interface ReturnResult {
  loanId: string;
  title: string;
  accessionNo: string;
  borrower: { type: BorrowerType; id: string; name: string };
  overdueDays: number;
  fine: FineBreakdown & { waived: boolean };
  feeInvoiceNo: string | null;
  copyStatus: string;
  heldForReservation: string | null;
}

/**
 * Return at the desk. Fine = overdue days x daily rate (capped) + replacement (lost) / assessed damage; a student's
 * fine is billed to the family through FEE (idempotent per loan), a staff fine is recorded on the loan.
 */
export class ReturnBook extends UseCase<
  { barcode: string; condition?: ReturnCondition; damageFinePaisa?: number; waiveFine?: boolean },
  ReturnResult
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }

  protected async handle(i: {
    barcode: string;
    condition?: ReturnCondition;
    damageFinePaisa?: number;
    waiveFine?: boolean;
  }) {
    const { d } = this;
    const condition = i.condition ?? 'good';
    const copy = await copyAtDesk(d, i.barcode);
    const loan = await d.libRepo.activeLoanOfCopy(copy.id);
    if (!loan) throw new ConflictError('COPY_NOT_ON_LOAN', 'This copy is not on loan');
    if (i.waiveFine && !d.scopePolicy.has('lib.circulation.edit'))
      throw new ForbiddenError('FORBIDDEN', 'Waiving fines needs lib.circulation.edit');
    const borrower = await resolveBorrower(d, loan.borrowerType, loan.borrowerId);
    const policy = await d.libRepo.policy(borrower.memberType);
    const today = LocalDate.today(d.clock);
    const days = overdueDays(LocalDate.parse(loan.dueOn), today);
    const assessed = assessFine({
      overdueDays: days,
      finePerDayPaisa: policy?.finePerDayPaisa ?? 0,
      overdueCapPaisa: await setting<number | null>(d, 'lib.max_overdue_fine_paisa', copy.campusId, null),
      condition,
      replacementPaisa: copy.pricePaisa ?? (await setting(d, 'lib.lost_book_default_paisa', copy.campusId, 50_000)),
      damagePaisa: i.damageFinePaisa ?? 0,
    });
    const fine = i.waiveFine ? { ...assessed, totalPaisa: 0 } : assessed;

    await d.libRepo.closeLoan(loan.id, {
      returnedAt: d.clock.now(),
      condition,
      finePaisa: fine.totalPaisa,
      receivedBy: d.ctx.userId,
    });

    let feeInvoiceNo: string | null = null;
    if (fine.totalPaisa > 0 && borrower.type === 'student') {
      const parts = [
        days ? `${days} day(s) late` : '',
        condition === 'lost' ? 'lost' : condition === 'damaged' ? 'damaged' : '',
      ].filter(Boolean);
      const charge = await d.feeApi.raiseCharge({
        studentId: borrower.id,
        feeHeadCode: await setting(d, 'lib.fine_fee_head', copy.campusId, 'LIB_FINE'),
        amountPaisa: fine.totalPaisa,
        description: `Library fine: ${copy.title} (${copy.accessionNo})${parts.length ? `, ${parts.join(', ')}` : ''}`,
        source: 'library',
        sourceRef: `lib:${loan.id}`,
      });
      await d.libRepo.setFineLine(loan.id, charge.invoiceLineId);
      feeInvoiceNo = charge.invoiceNo;
    }

    const after = copyStatusAfterReturn(condition);
    const released = after === 'available' ? await releaseCopy(d, copy) : null;
    if (!released) await d.libRepo.setCopyStatus(copy.id, after);
    return {
      loanId: loan.id,
      title: copy.title,
      accessionNo: copy.accessionNo,
      borrower: { type: borrower.type, id: borrower.id, name: borrower.name },
      overdueDays: days,
      fine: { ...fine, waived: !!i.waiveFine && assessed.totalPaisa > 0 },
      feeInvoiceNo,
      copyStatus: released?.status ?? after,
      heldForReservation: released?.reservationId ?? null,
    };
  }
}

/** Renew a loan (desk or the borrower themself): within max renewals, not overdue, nobody waiting. */
export class RenewLoan extends UseCase<{ id: string }, { loanId: string; dueOn: string; renewCount: number }> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const { d } = this;
    const loan = await d.libRepo.loan(id, true);
    if (!loan) throw new NotFoundError();
    if (!isSelf(d.ctx, loan.borrowerType, loan.borrowerId)) {
      if (!d.scopePolicy.has('lib.circulation.create')) throw new NotFoundError();
      d.scopePolicy.requireCampus(loan.campusId);
    }
    if (loan.returnedAt) throw new ConflictError('LOAN_CLOSED', 'This loan was already returned');
    const borrower = await resolveBorrower(d, loan.borrowerType, loan.borrowerId);
    const policy = await policyFor(d, borrower.memberType);
    if (loan.renewCount >= policy.maxRenewals)
      throw new ConflictError('RENEWAL_LIMIT_REACHED', `Already renewed ${loan.renewCount} time(s)`);
    if (LocalDate.parse(loan.dueOn).isBefore(LocalDate.today(d.clock)))
      throw new ConflictError('LOAN_OVERDUE', 'Overdue books must be returned (and any fine settled) first');
    if (await d.libRepo.nextWaiting(loan.bookTitleId, loan.campusId))
      throw new ConflictError('RESERVED_BY_OTHERS', 'Another reader is waiting for this title');
    const dueOn = await dueDate(d, loan.campusId, policy.loanDays);
    await d.libRepo.renewLoan(loan.id, dueOn);
    return { loanId: loan.id, dueOn, renewCount: loan.renewCount + 1 };
  }
}

export class ListLoans extends Query<
  {
    status?: 'active' | 'overdue' | 'returned';
    campusId?: string;
    borrowerType?: BorrowerType;
    borrowerId?: string;
    titleId?: string;
    limit: number;
    offset: number;
  },
  Array<LoanRow & { borrowerName: string; overdueDays: number }>
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    status?: 'active' | 'overdue' | 'returned';
    campusId?: string;
    borrowerType?: BorrowerType;
    borrowerId?: string;
    titleId?: string;
    limit: number;
    offset: number;
  }) {
    const today = LocalDate.today(this.d.clock);
    const rows = await this.d.libRepo.loans({ ...i, today: today.iso });
    return withBorrowerNames(this.d, rows, today);
  }
}

async function withBorrowerNames(
  d: LibDeps,
  rows: LoanRow[],
  today: LocalDate,
): Promise<Array<LoanRow & { borrowerName: string; overdueDays: number }>> {
  const students = await d.sisApi.studentBriefs(
    rows.filter((r) => r.borrowerType === 'student').map((r) => r.borrowerId),
  );
  const staff = await d.hrmApi.staffSummaries(rows.filter((r) => r.borrowerType === 'staff').map((r) => r.borrowerId));
  return rows.map((r) => ({
    ...r,
    borrowerName:
      (r.borrowerType === 'student' ? students.get(r.borrowerId)?.fullNameEn : staff.get(r.borrowerId)?.fullNameEn) ??
      '',
    overdueDays: r.returnedAt ? 0 : overdueDays(LocalDate.parse(r.dueOn), today),
  }));
}

export interface BorrowerAccount {
  borrower: { type: BorrowerType; id: string; name: string; memberType: MemberType; active: boolean };
  policy: MemberPolicy | null;
  activeLoans: Array<LoanRow & { overdueDays: number }>;
  history: LoanRow[];
  reservations: ReservationRow[];
  totals: { active: number; overdue: number; finesPaisa: number };
}

/** Reader account: librarian, the borrower, or a guardian of the student. */
export class GetBorrowerAccount extends Query<{ type: BorrowerType; id: string }, BorrowerAccount> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: { type: BorrowerType; id: string }) {
    const { d } = this;
    await assertBorrowerAccess(d, 'lib.circulation.view', i.type, i.id);
    const borrower = await resolveBorrower(d, i.type, i.id);
    const today = LocalDate.today(d.clock);
    const f = { borrowerType: i.type, borrowerId: i.id, today: today.iso, offset: 0 };
    const active = await d.libRepo.loans({ ...f, status: 'active', limit: 100 });
    const history = await d.libRepo.loans({ ...f, status: 'returned', limit: 20 });
    const reservations = (
      await d.libRepo.reservations({ borrowerType: i.type, borrowerId: i.id, limit: 50, offset: 0 })
    ).filter((r) => r.status === 'waiting' || r.status === 'ready');
    const activeLoans = active.map((l) => ({ ...l, overdueDays: overdueDays(LocalDate.parse(l.dueOn), today) }));
    return {
      borrower: {
        type: borrower.type,
        id: borrower.id,
        name: borrower.name,
        memberType: borrower.memberType,
        active: borrower.active,
      },
      policy: await d.libRepo.policy(borrower.memberType),
      activeLoans,
      history,
      reservations,
      totals: {
        active: activeLoans.length,
        overdue: activeLoans.filter((l) => l.overdueDays > 0).length,
        finesPaisa: history.reduce((s, l) => s + l.finePaisa, 0),
      },
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reservations (LIB-04)
// ---------------------------------------------------------------------------------------------------------------

export class ReserveTitle extends UseCase<
  { titleId: string; campusId?: string; borrowerType?: BorrowerType; borrowerId?: string },
  { reservationId: string; position: number }
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: { titleId: string; campusId?: string; borrowerType?: BorrowerType; borrowerId?: string }) {
    const { d } = this;
    let who = i.borrowerType && i.borrowerId ? { type: i.borrowerType, id: i.borrowerId } : selfBorrower(d.ctx);
    if (!who) throw new InvariantError('BORROWER_REQUIRED', 'borrowerType and borrowerId are required');
    const forOther = !isSelf(d.ctx, who.type, who.id);
    if (forOther) {
      const guardianOwn =
        who.type === 'student' && !!d.ctx.guardianId && (await d.sisApi.isGuardianOf(d.ctx.guardianId, who.id));
      if (!guardianOwn && !d.scopePolicy.has('lib.reservation.create')) throw new NotFoundError();
    }
    const borrower = await resolveBorrower(d, who.type, who.id);
    who = { type: borrower.type, id: borrower.id };
    const campusId = i.campusId ?? borrower.campusId;
    if (forOther && d.scopePolicy.has('lib.reservation.create')) d.scopePolicy.requireCampus(campusId);
    if (!borrower.active) throw new ConflictError('BORROWER_INACTIVE', `${borrower.name} is not an active member`);
    const [title] = await d.libRepo.titleSummaries({ ids: [i.titleId], campusId, limit: 1, offset: 0 });
    if (!title) throw new NotFoundError('Title not found', 'TITLE_NOT_FOUND');
    if (!title.copies) throw new ConflictError('NO_COPIES_ON_CAMPUS', 'The campus library has no copy of this title');
    if (title.available > 0) throw new ConflictError('COPY_AVAILABLE', 'A copy is on the shelf; borrow it at the desk');
    if (await d.libRepo.openReservation(who.type, who.id, i.titleId))
      throw new ConflictError('ALREADY_RESERVED', 'Already in the queue for this title');
    if (await d.libRepo.hasActiveLoanOfTitle(who.type, who.id, i.titleId))
      throw new ConflictError('ALREADY_ON_LOAN', 'This reader already has a copy of the title');
    const reservationId = await d.libRepo.insertReservation({
      orgId: d.ctx.orgId,
      campusId,
      bookTitleId: i.titleId,
      borrowerType: who.type,
      borrowerId: who.id,
      reservedAt: d.clock.now(),
    });
    return { reservationId, position: title.waiting + 1 };
  }
}

export class CancelReservation extends UseCase<{ id: string }, { id: string; status: 'cancelled' }> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const { d } = this;
    const r = await d.libRepo.reservation(id, true);
    if (!r) throw new NotFoundError();
    const own =
      isSelf(d.ctx, r.borrowerType, r.borrowerId) ||
      (r.borrowerType === 'student' &&
        !!d.ctx.guardianId &&
        (await d.sisApi.isGuardianOf(d.ctx.guardianId, r.borrowerId)));
    if (!own) {
      if (!d.scopePolicy.has('lib.reservation.edit')) throw new NotFoundError();
      d.scopePolicy.requireCampus(r.campusId);
    }
    if (r.status !== 'waiting' && r.status !== 'ready')
      throw new ConflictError('RESERVATION_CLOSED', `Reservation is ${r.status}`);
    await d.libRepo.updateReservation(id, { status: 'cancelled' });
    if (r.status === 'ready' && r.readyCopyId) {
      const copy = await d.libRepo.copyForUpdate(r.readyCopyId);
      if (copy?.status === 'reserved') await releaseCopy(d, copy);
    }
    return { id, status: 'cancelled' as const };
  }
}

export class ListReservations extends Query<
  {
    campusId?: string;
    status?: string;
    borrowerType?: BorrowerType;
    borrowerId?: string;
    limit: number;
    offset: number;
  },
  ReservationRow[]
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected handle(i: {
    campusId?: string;
    status?: string;
    borrowerType?: BorrowerType;
    borrowerId?: string;
    limit: number;
    offset: number;
  }) {
    return this.d.libRepo.reservations(i);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Scheduled work (system context in jobs; also callable from the desk)
// ---------------------------------------------------------------------------------------------------------------

/** Ready reservations not collected in time expire; the copy goes to the next reader or back on the shelf. */
export class ExpireReservations extends UseCase<Record<string, never>, { expired: number; passedOn: number }> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle() {
    const { d } = this;
    const rows = await d.libRepo.expiredReady(d.clock.now(), 200);
    let passedOn = 0;
    for (const r of rows) {
      await d.libRepo.updateReservation(r.id, { status: 'expired' });
      if (!r.readyCopyId) continue;
      const copy = await d.libRepo.copyForUpdate(r.readyCopyId);
      if (copy?.status === 'reserved' && (await releaseCopy(d, copy)).status === 'reserved') passedOn++;
    }
    return { expired: rows.length, passedOn };
  }
}

/** Overdue reminders on configured days late (lib.overdue_reminder_days); COM dedupes per loan and stage. */
export class SendOverdueReminders extends UseCase<Record<string, never>, { overdue: number; reminded: number }> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle() {
    const { d } = this;
    const today = LocalDate.today(d.clock);
    const loans = await d.libRepo.overdueLoans(today.iso, 2_000);
    const events: DomainEvent[] = [];
    for (const l of loans) {
      const days = overdueDays(LocalDate.parse(l.dueOn), today);
      const stages = await setting(d, 'lib.overdue_reminder_days', l.campusId, [1, 3, 7, 14]);
      if (!stages.includes(days)) continue;
      events.push({
        type: 'lib.loan_overdue.v1',
        aggregateType: 'loan',
        aggregateId: l.id,
        orgId: d.ctx.orgId,
        campusId: l.campusId,
        occurredAt: d.clock.now(),
        payload: {
          loanId: l.id,
          borrowerType: l.borrowerType,
          borrowerId: l.borrowerId,
          title: l.title,
          dueOn: l.dueOn,
          daysOverdue: days,
        },
      });
    }
    if (events.length) await d.outbox.write(events);
    return { overdue: loans.length, reminded: events.length };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Stock take (LIB-05)
// ---------------------------------------------------------------------------------------------------------------

export class StartStockTake extends UseCase<{ campusId?: string }, { id: string }> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: { campusId?: string }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    if (await this.d.libRepo.inProgressStockTake(campusId))
      throw new ConflictError('STOCK_TAKE_IN_PROGRESS', 'Finish the running stock-take first');
    const id = await this.d.libRepo.insertStockTake({
      orgId: this.d.ctx.orgId,
      campusId,
      startedOn: LocalDate.today(this.d.clock).iso,
    });
    return { id };
  }
}

export class ScanCopies extends UseCase<
  { id: string; barcodes: string[]; condition?: string },
  { scanned: number; alreadyScanned: number; unknown: string[] }
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; barcodes: string[]; condition?: string }) {
    const st = await this.d.libRepo.stockTake(i.id, true);
    if (!st) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(st.campusId);
    if (st.status !== 'in_progress') throw new ConflictError('STOCK_TAKE_COMPLETED', 'Stock-take is completed');
    const barcodes = [...new Set(i.barcodes.map((b) => b.trim()).filter(Boolean))];
    const found = await this.d.libRepo.copiesByBarcodes(st.campusId, barcodes);
    const known = new Set(found.map((c) => c.barcode));
    const added = await this.d.libRepo.addScans(
      i.id,
      found.map((c) => c.id),
      i.condition ?? null,
    );
    return { scanned: added, alreadyScanned: found.length - added, unknown: barcodes.filter((b) => !known.has(b)) };
  }
}

export class GetStockTakeReport extends Query<{ id: string }, StockTakeReport> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const r = await this.d.libRepo.stockTakeReport(id);
    if (!r) throw new NotFoundError();
    return r;
  }
}

/** Completes the stock-take; optionally marks missing shelf copies lost and brings found "lost" copies back. */
export class CompleteStockTake extends UseCase<
  { id: string; markMissingAsLost?: boolean },
  { expected: number; scanned: number; missing: number; markedLost: number; recovered: number }
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; markMissingAsLost?: boolean }) {
    const { d } = this;
    const st = await d.libRepo.stockTake(i.id, true);
    if (!st) throw new NotFoundError();
    d.scopePolicy.requireCampus(st.campusId);
    if (st.status !== 'in_progress') throw new ConflictError('STOCK_TAKE_COMPLETED', 'Stock-take is completed');
    const report = (await d.libRepo.stockTakeReport(i.id))!;
    let markedLost = 0;
    if (i.markMissingAsLost) {
      for (const m of report.missing.filter((x) => x.status !== 'reserved')) {
        await d.libRepo.setCopyStatus(m.copyId, 'lost');
        markedLost++;
      }
    }
    let recovered = 0;
    for (const u of report.unexpected.filter((x) => x.status === 'lost')) {
      const copy = await d.libRepo.copyForUpdate(u.copyId);
      if (copy) {
        await releaseCopy(d, copy);
        recovered++;
      }
    }
    await d.libRepo.completeStockTake(i.id, LocalDate.today(d.clock).iso);
    return {
      expected: report.expected,
      scanned: report.scanned,
      missing: report.missing.length,
      markedLost,
      recovered,
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Member policies
// ---------------------------------------------------------------------------------------------------------------

export class ListPolicies extends Query<Record<string, never>, MemberPolicy[]> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected handle() {
    return this.d.libRepo.policies();
  }
}

export class SavePolicy extends UseCase<MemberPolicy, MemberPolicy> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(p: MemberPolicy) {
    await this.d.libRepo.upsertPolicy(this.d.ctx.orgId, p);
    return p;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Digital library (LIB-06): e-books, past papers, videos; access by class
// ---------------------------------------------------------------------------------------------------------------

export interface DigitalItemInput {
  title: string;
  kind: DigitalItemRow['kind'];
  fileId?: string;
  url?: string;
  programmeId?: string;
  yearGroupIds?: string[];
  subjectId?: string;
}

export class CreateDigitalItem extends UseCase<DigitalItemInput, DigitalItemRow> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: DigitalItemInput) {
    if (!i.fileId === !i.url) throw new InvariantError('DIGITAL_SOURCE', 'Give exactly one of fileId or url');
    if (i.url && !/^https:\/\//i.test(i.url)) throw new InvariantError('URL_INSECURE', 'Links must use https');
    if (i.fileId) await this.d.filesApi.requireUsable(i.fileId, 'library_digital');
    return this.d.libRepo.insertDigitalItem({
      orgId: this.d.ctx.orgId,
      title: i.title,
      kind: i.kind,
      fileId: i.fileId ?? null,
      url: i.url ?? null,
      programmeId: i.programmeId ?? null,
      yearGroupIds: i.yearGroupIds ?? [],
      subjectId: i.subjectId ?? null,
    });
  }
}

/** Staff see everything; a student sees items open to all classes or to their own year group. */
export class ListDigitalItems extends Query<
  { q?: string; kind?: string; subjectId?: string; yearGroupId?: string; limit: number; offset: number },
  DigitalItemRow[]
> {
  constructor(private readonly d: LibDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    q?: string;
    kind?: string;
    subjectId?: string;
    yearGroupId?: string;
    limit: number;
    offset: number;
  }) {
    let yearGroupId = i.yearGroupId;
    if (this.d.ctx.userType === 'student') {
      const e = this.d.ctx.studentId
        ? await this.d.sisApi.activeEnrolment(this.d.ctx.studentId, LocalDate.today(this.d.clock).iso)
        : null;
      if (!e) return [];
      yearGroupId = e.yearGroupId;
    }
    return this.d.libRepo.digitalItems({ ...i, yearGroupId });
  }
}
