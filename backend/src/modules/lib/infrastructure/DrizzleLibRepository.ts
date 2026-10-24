import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  bookCopy,
  bookTitle,
  circulation,
  digitalItem,
  memberPolicy,
  reservation,
  stockTake,
  stockTakeScan,
} from '../../../shared/infrastructure/db/schema/lib.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { BorrowerType, CopyStatus, MemberPolicy, MemberType, ReturnCondition } from '../domain/library.js';
import type {
  CopyRow,
  DigitalItemRow,
  LibRepository,
  LoanFilter,
  LoanRow,
  ReservationRow,
  StockTakeReport,
  TitleSummary,
} from '../application/ports.js';

const copyCols = {
  id: bookCopy.id,
  campusId: bookCopy.campusId,
  bookTitleId: bookCopy.bookTitleId,
  title: bookTitle.title,
  accessionNo: bookCopy.accessionNo,
  barcode: bookCopy.barcode,
  shelfLocation: bookCopy.shelfLocation,
  pricePaisa: bookCopy.pricePaisa,
  status: bookCopy.status,
};

const loanCols = {
  id: circulation.id,
  campusId: circulation.campusId,
  bookCopyId: circulation.bookCopyId,
  bookTitleId: bookCopy.bookTitleId,
  title: bookTitle.title,
  accessionNo: bookCopy.accessionNo,
  borrowerType: circulation.borrowerType,
  borrowerId: circulation.borrowerId,
  issuedAt: circulation.issuedAt,
  dueOn: circulation.dueOn,
  renewCount: circulation.renewCount,
  returnedAt: circulation.returnedAt,
  returnCondition: circulation.returnCondition,
  finePaisa: circulation.finePaisa,
  fineInvoiceLineId: circulation.fineInvoiceLineId,
};

const reservationCols = {
  id: reservation.id,
  campusId: reservation.campusId,
  bookTitleId: reservation.bookTitleId,
  title: bookTitle.title,
  borrowerType: reservation.borrowerType,
  borrowerId: reservation.borrowerId,
  reservedAt: reservation.reservedAt,
  readyCopyId: reservation.readyCopyId,
  expiresAt: reservation.expiresAt,
  status: reservation.status,
};

const policyCols = {
  memberType: memberPolicy.memberType,
  maxLoans: memberPolicy.maxLoans,
  loanDays: memberPolicy.loanDays,
  maxRenewals: memberPolicy.maxRenewals,
  finePerDayPaisa: memberPolicy.finePerDayPaisa,
};

const digitalCols = {
  id: digitalItem.id,
  title: digitalItem.title,
  kind: digitalItem.kind,
  fileId: digitalItem.fileId,
  url: digitalItem.url,
  programmeId: digitalItem.programmeId,
  yearGroupIds: digitalItem.yearGroupIds,
  subjectId: digitalItem.subjectId,
};

/** copies counted as "should be on the shelf" during a stock-take */
const SHELF_STATUSES: CopyStatus[] = ['available', 'reserved', 'in_repair', 'damaged'];

export class DrizzleLibRepository implements LibRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  // ---------------- catalogue ----------------
  async titleExists(id: string): Promise<boolean> {
    const [r] = await this.tx.select({ id: bookTitle.id }).from(bookTitle).where(eq(bookTitle.id, id));
    return !!r;
  }

  async titleSummaries(f: {
    ids?: string[];
    q?: string;
    campusId?: string;
    availableOnly?: boolean;
    limit: number;
    offset: number;
  }): Promise<TitleSummary[]> {
    // the outer column is written out: drizzle drops the table name in single-table selects, and an
    // unqualified "id" would bind to the subquery's own row
    const titleId = sql`${sql.identifier('lib')}.${sql.identifier('book_title')}.${sql.identifier('id')}`;
    const copyOnCampus = f.campusId ? sql`AND c.campus_id = ${f.campusId}` : sql``;
    const copies = sql<number>`(SELECT count(*) FROM lib.book_copy c WHERE c.book_title_id = ${titleId} AND c.status <> 'withdrawn' ${copyOnCampus})::int`;
    const available = sql<number>`(SELECT count(*) FROM lib.book_copy c WHERE c.book_title_id = ${titleId} AND c.status = 'available' ${copyOnCampus})::int`;
    const resOnCampus = f.campusId ? sql`AND r.campus_id = ${f.campusId}` : sql``;
    const waiting = sql<number>`(SELECT count(*) FROM lib.reservation r WHERE r.book_title_id = ${titleId} AND r.status = 'waiting' ${resOnCampus})::int`;
    const where: SQL[] = [];
    if (f.ids) where.push(inArray(bookTitle.id, f.ids.length ? f.ids : ['00000000-0000-0000-0000-000000000000']));
    if (f.q) {
      const q = f.q.toLowerCase();
      where.push(
        sql`(${bookTitle.searchText} LIKE ${`%${q}%`} OR EXISTS (SELECT 1 FROM unnest(${bookTitle.authors}) a WHERE lower(a) LIKE ${`%${q}%`}))`,
      );
    }
    if (f.availableOnly) where.push(sql`${available} > 0`);
    const rows = await this.tx
      .select({
        id: bookTitle.id,
        isbn: bookTitle.isbn,
        title: bookTitle.title,
        subtitle: bookTitle.subtitle,
        authors: bookTitle.authors,
        publisher: bookTitle.publisher,
        categoryCode: bookTitle.categoryCode,
        mediaType: bookTitle.mediaType,
        copies,
        available,
        waiting,
      })
      .from(bookTitle)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(bookTitle.title))
      .limit(f.limit)
      .offset(f.offset);
    return rows;
  }

  async setTitleCover(id: string, fileId: string | null): Promise<boolean> {
    const rows = await this.tx
      .update(bookTitle)
      .set({ coverFileId: fileId })
      .where(eq(bookTitle.id, id))
      .returning({ id: bookTitle.id });
    return rows.length > 0;
  }

  async copiesOfTitle(titleId: string): Promise<CopyRow[]> {
    return this.tx
      .select(copyCols)
      .from(bookCopy)
      .innerJoin(bookTitle, eq(bookTitle.id, bookCopy.bookTitleId))
      .where(eq(bookCopy.bookTitleId, titleId))
      .orderBy(asc(bookCopy.accessionNo));
  }

  async insertCopies(rows: Array<Record<string, unknown>>): Promise<CopyRow[]> {
    const ids = await this.tx
      .insert(bookCopy)
      .values(rows as Array<typeof bookCopy.$inferInsert>)
      .returning({ id: bookCopy.id });
    return this.tx
      .select(copyCols)
      .from(bookCopy)
      .innerJoin(bookTitle, eq(bookTitle.id, bookCopy.bookTitleId))
      .where(
        inArray(
          bookCopy.id,
          ids.map((r) => r.id),
        ),
      )
      .orderBy(asc(bookCopy.accessionNo));
  }

  // Row locks are taken on the bare table first (PostgreSQL rejects the schema-qualified FOR UPDATE OF that
  // drizzle generates for joins), then the joined row is read.
  private async copyById(id: string): Promise<CopyRow | null> {
    const [r] = await this.tx
      .select(copyCols)
      .from(bookCopy)
      .innerJoin(bookTitle, eq(bookTitle.id, bookCopy.bookTitleId))
      .where(eq(bookCopy.id, id));
    return r ?? null;
  }

  async copyByBarcode(barcode: string, forUpdate: boolean): Promise<CopyRow | null> {
    const q = this.tx.select({ id: bookCopy.id }).from(bookCopy).where(eq(bookCopy.barcode, barcode));
    const [r] = forUpdate ? await q.for('update') : await q;
    return r ? this.copyById(r.id) : null;
  }

  async copyForUpdate(id: string): Promise<CopyRow | null> {
    const [r] = await this.tx.select({ id: bookCopy.id }).from(bookCopy).where(eq(bookCopy.id, id)).for('update');
    return r ? this.copyById(r.id) : null;
  }

  async setCopyStatus(id: string, status: CopyStatus): Promise<void> {
    await this.tx.update(bookCopy).set({ status }).where(eq(bookCopy.id, id));
  }

  // ---------------- policy ----------------
  async policy(memberType: MemberType): Promise<MemberPolicy | null> {
    const [r] = await this.tx.select(policyCols).from(memberPolicy).where(eq(memberPolicy.memberType, memberType));
    return r ?? null;
  }

  async policies(): Promise<MemberPolicy[]> {
    return this.tx.select(policyCols).from(memberPolicy).orderBy(asc(memberPolicy.memberType));
  }

  async upsertPolicy(orgId: string, p: MemberPolicy): Promise<void> {
    await this.tx
      .insert(memberPolicy)
      .values({ orgId, ...p })
      .onConflictDoUpdate({
        target: [memberPolicy.orgId, memberPolicy.memberType],
        set: {
          maxLoans: p.maxLoans,
          loanDays: p.loanDays,
          maxRenewals: p.maxRenewals,
          finePerDayPaisa: p.finePerDayPaisa,
        },
      });
  }

  // ---------------- circulation ----------------
  async insertLoan(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(circulation)
      .values(values as typeof circulation.$inferInsert)
      .returning({ id: circulation.id });
    return r!.id;
  }

  private loanQuery() {
    return this.tx
      .select(loanCols)
      .from(circulation)
      .innerJoin(bookCopy, eq(bookCopy.id, circulation.bookCopyId))
      .innerJoin(bookTitle, eq(bookTitle.id, bookCopy.bookTitleId));
  }

  async loan(id: string, forUpdate: boolean): Promise<LoanRow | null> {
    if (forUpdate)
      await this.tx.select({ id: circulation.id }).from(circulation).where(eq(circulation.id, id)).for('update');
    const [r] = await this.loanQuery().where(eq(circulation.id, id));
    return r ?? null;
  }

  async activeLoanOfCopy(copyId: string): Promise<LoanRow | null> {
    const [locked] = await this.tx
      .select({ id: circulation.id })
      .from(circulation)
      .where(and(eq(circulation.bookCopyId, copyId), isNull(circulation.returnedAt)))
      .for('update');
    return locked ? this.loan(locked.id, false) : null;
  }

  async activeLoanCount(type: BorrowerType, id: string, today: string): Promise<{ active: number; overdue: number }> {
    const [r] = await this.tx
      .select({
        active: sql<number>`count(*)::int`,
        overdue: sql<number>`(count(*) FILTER (WHERE ${circulation.dueOn} < ${today}))::int`,
      })
      .from(circulation)
      .where(and(eq(circulation.borrowerType, type), eq(circulation.borrowerId, id), isNull(circulation.returnedAt)));
    return { active: r?.active ?? 0, overdue: r?.overdue ?? 0 };
  }

  async hasActiveLoanOfTitle(type: BorrowerType, id: string, titleId: string): Promise<boolean> {
    const [r] = await this.tx
      .select({ id: circulation.id })
      .from(circulation)
      .innerJoin(bookCopy, eq(bookCopy.id, circulation.bookCopyId))
      .where(
        and(
          eq(circulation.borrowerType, type),
          eq(circulation.borrowerId, id),
          isNull(circulation.returnedAt),
          eq(bookCopy.bookTitleId, titleId),
        ),
      )
      .limit(1);
    return !!r;
  }

  async closeLoan(
    id: string,
    v: { returnedAt: Date; condition: ReturnCondition; finePaisa: number; receivedBy: string | null },
  ): Promise<void> {
    await this.tx
      .update(circulation)
      .set({ returnedAt: v.returnedAt, returnCondition: v.condition, finePaisa: v.finePaisa, receivedBy: v.receivedBy })
      .where(eq(circulation.id, id));
  }

  async setFineLine(id: string, invoiceLineId: string): Promise<void> {
    await this.tx.update(circulation).set({ fineInvoiceLineId: invoiceLineId }).where(eq(circulation.id, id));
  }

  async renewLoan(id: string, dueOn: string): Promise<void> {
    await this.tx
      .update(circulation)
      .set({ dueOn, renewCount: sql`${circulation.renewCount} + 1` })
      .where(eq(circulation.id, id));
  }

  async loans(f: LoanFilter): Promise<LoanRow[]> {
    const where: SQL[] = [];
    if (f.status === 'active') where.push(isNull(circulation.returnedAt));
    if (f.status === 'overdue') where.push(isNull(circulation.returnedAt), lt(circulation.dueOn, f.today));
    if (f.status === 'returned') where.push(isNotNull(circulation.returnedAt));
    if (f.campusId) where.push(eq(circulation.campusId, f.campusId));
    if (f.borrowerType) where.push(eq(circulation.borrowerType, f.borrowerType));
    if (f.borrowerId) where.push(eq(circulation.borrowerId, f.borrowerId));
    if (f.titleId) where.push(eq(bookCopy.bookTitleId, f.titleId));
    return this.loanQuery()
      .where(where.length ? and(...where) : undefined)
      .orderBy(f.status === 'returned' ? desc(circulation.returnedAt) : asc(circulation.dueOn), asc(circulation.id))
      .limit(f.limit)
      .offset(f.offset);
  }

  async overdueLoans(today: string, limit: number): Promise<LoanRow[]> {
    return this.loanQuery()
      .where(and(isNull(circulation.returnedAt), lt(circulation.dueOn, today)))
      .orderBy(asc(circulation.dueOn), asc(circulation.id))
      .limit(limit);
  }

  // ---------------- reservations ----------------
  async insertReservation(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(reservation)
      .values(values as typeof reservation.$inferInsert)
      .returning({ id: reservation.id });
    return r!.id;
  }

  private reservationQuery() {
    return this.tx
      .select(reservationCols)
      .from(reservation)
      .innerJoin(bookTitle, eq(bookTitle.id, reservation.bookTitleId));
  }

  async reservation(id: string, forUpdate: boolean): Promise<ReservationRow | null> {
    if (forUpdate)
      await this.tx.select({ id: reservation.id }).from(reservation).where(eq(reservation.id, id)).for('update');
    const [r] = await this.reservationQuery().where(eq(reservation.id, id));
    return r ?? null;
  }

  async openReservation(type: BorrowerType, id: string, titleId: string): Promise<ReservationRow | null> {
    const [r] = await this.reservationQuery().where(
      and(
        eq(reservation.borrowerType, type),
        eq(reservation.borrowerId, id),
        eq(reservation.bookTitleId, titleId),
        inArray(reservation.status, ['waiting', 'ready']),
      ),
    );
    return r ?? null;
  }

  async nextWaiting(titleId: string, campusId: string): Promise<ReservationRow | null> {
    const [locked] = await this.tx
      .select({ id: reservation.id })
      .from(reservation)
      .where(
        and(
          eq(reservation.bookTitleId, titleId),
          eq(reservation.campusId, campusId),
          eq(reservation.status, 'waiting'),
        ),
      )
      .orderBy(asc(reservation.reservedAt), asc(reservation.id))
      .limit(1)
      .for('update');
    return locked ? this.reservation(locked.id, false) : null;
  }

  async readyReservationForCopy(copyId: string): Promise<ReservationRow | null> {
    const [locked] = await this.tx
      .select({ id: reservation.id })
      .from(reservation)
      .where(and(eq(reservation.readyCopyId, copyId), eq(reservation.status, 'ready')))
      .for('update');
    return locked ? this.reservation(locked.id, false) : null;
  }

  async updateReservation(
    id: string,
    patch: { status: ReservationRow['status']; readyCopyId?: string | null; expiresAt?: Date | null },
  ): Promise<void> {
    await this.tx.update(reservation).set(patch).where(eq(reservation.id, id));
  }

  async expiredReady(now: Date, limit: number): Promise<ReservationRow[]> {
    const locked = await this.tx
      .select({ id: reservation.id })
      .from(reservation)
      .where(and(eq(reservation.status, 'ready'), lt(reservation.expiresAt, now)))
      .orderBy(asc(reservation.expiresAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (!locked.length) return [];
    return this.reservationQuery()
      .where(
        inArray(
          reservation.id,
          locked.map((r) => r.id),
        ),
      )
      .orderBy(asc(reservation.expiresAt));
  }

  async reservations(f: {
    campusId?: string;
    status?: string;
    borrowerType?: BorrowerType;
    borrowerId?: string;
    limit: number;
    offset: number;
  }): Promise<ReservationRow[]> {
    const where: SQL[] = [];
    if (f.campusId) where.push(eq(reservation.campusId, f.campusId));
    if (f.status) where.push(eq(reservation.status, f.status as ReservationRow['status']));
    if (f.borrowerType) where.push(eq(reservation.borrowerType, f.borrowerType));
    if (f.borrowerId) where.push(eq(reservation.borrowerId, f.borrowerId));
    return this.reservationQuery()
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(reservation.reservedAt), asc(reservation.id))
      .limit(f.limit)
      .offset(f.offset);
  }

  // ---------------- stock take ----------------
  async inProgressStockTake(campusId: string): Promise<{ id: string } | null> {
    const [r] = await this.tx
      .select({ id: stockTake.id })
      .from(stockTake)
      .where(and(eq(stockTake.campusId, campusId), eq(stockTake.status, 'in_progress')));
    return r ?? null;
  }

  async insertStockTake(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(stockTake)
      .values(values as typeof stockTake.$inferInsert)
      .returning({ id: stockTake.id });
    return r!.id;
  }

  async stockTake(id: string, forUpdate: boolean) {
    const q = this.tx
      .select({ id: stockTake.id, campusId: stockTake.campusId, status: stockTake.status })
      .from(stockTake)
      .where(eq(stockTake.id, id));
    const [r] = forUpdate ? await q.for('update') : await q;
    return r ?? null;
  }

  async copiesByBarcodes(campusId: string, barcodes: string[]) {
    if (!barcodes.length) return [];
    return this.tx
      .select({ id: bookCopy.id, barcode: bookCopy.barcode })
      .from(bookCopy)
      .where(and(eq(bookCopy.campusId, campusId), inArray(bookCopy.barcode, barcodes)));
  }

  async addScans(stockTakeId: string, copyIds: string[], condition: string | null): Promise<number> {
    if (!copyIds.length) return 0;
    const rows = await this.tx
      .insert(stockTakeScan)
      .values(copyIds.map((bookCopyId) => ({ stockTakeId, bookCopyId, condition })))
      .onConflictDoNothing()
      .returning({ id: stockTakeScan.bookCopyId });
    return rows.length;
  }

  async stockTakeReport(id: string): Promise<StockTakeReport | null> {
    const [st] = await this.tx.select().from(stockTake).where(eq(stockTake.id, id));
    if (!st) return null;
    const scanned = this.tx
      .select({ id: stockTakeScan.bookCopyId })
      .from(stockTakeScan)
      .where(eq(stockTakeScan.stockTakeId, id));
    const [counts] = await this.tx
      .select({
        expected: sql<number>`(count(*) FILTER (WHERE ${inArray(bookCopy.status, SHELF_STATUSES)}))::int`,
      })
      .from(bookCopy)
      .where(eq(bookCopy.campusId, st.campusId));
    const [scannedCount] = await this.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(stockTakeScan)
      .where(eq(stockTakeScan.stockTakeId, id));
    const missing = await this.tx
      .select({
        copyId: bookCopy.id,
        accessionNo: bookCopy.accessionNo,
        title: bookTitle.title,
        status: bookCopy.status,
        shelfLocation: bookCopy.shelfLocation,
      })
      .from(bookCopy)
      .innerJoin(bookTitle, eq(bookTitle.id, bookCopy.bookTitleId))
      .where(
        and(
          eq(bookCopy.campusId, st.campusId),
          inArray(bookCopy.status, SHELF_STATUSES),
          notInArray(bookCopy.id, scanned),
        ),
      )
      .orderBy(asc(bookCopy.shelfLocation), asc(bookCopy.accessionNo));
    const unexpected = await this.tx
      .select({
        copyId: bookCopy.id,
        accessionNo: bookCopy.accessionNo,
        title: bookTitle.title,
        status: bookCopy.status,
      })
      .from(stockTakeScan)
      .innerJoin(bookCopy, eq(bookCopy.id, stockTakeScan.bookCopyId))
      .innerJoin(bookTitle, eq(bookTitle.id, bookCopy.bookTitleId))
      .where(and(eq(stockTakeScan.stockTakeId, id), notInArray(bookCopy.status, SHELF_STATUSES)))
      .orderBy(asc(bookCopy.accessionNo));
    return {
      id: st.id,
      campusId: st.campusId,
      status: st.status,
      startedOn: st.startedOn,
      completedOn: st.completedOn,
      expected: counts?.expected ?? 0,
      scanned: scannedCount?.n ?? 0,
      missing,
      unexpected,
    };
  }

  async completeStockTake(id: string, on: string): Promise<void> {
    await this.tx.update(stockTake).set({ status: 'completed', completedOn: on }).where(eq(stockTake.id, id));
  }

  // ---------------- digital library ----------------
  async insertDigitalItem(values: Record<string, unknown>): Promise<DigitalItemRow> {
    const [r] = await this.tx
      .insert(digitalItem)
      .values(values as typeof digitalItem.$inferInsert)
      .returning(digitalCols);
    return r!;
  }

  async digitalItems(f: {
    q?: string;
    kind?: string;
    subjectId?: string;
    yearGroupId?: string;
    limit: number;
    offset: number;
  }): Promise<DigitalItemRow[]> {
    const where: SQL[] = [];
    if (f.q) where.push(sql`lower(${digitalItem.title}) LIKE ${`%${f.q.toLowerCase()}%`}`);
    if (f.kind) where.push(eq(digitalItem.kind, f.kind as DigitalItemRow['kind']));
    if (f.subjectId) where.push(eq(digitalItem.subjectId, f.subjectId));
    if (f.yearGroupId)
      where.push(
        sql`(cardinality(${digitalItem.yearGroupIds}) = 0 OR ${f.yearGroupId}::uuid = ANY(${digitalItem.yearGroupIds}))`,
      );
    return this.tx
      .select(digitalCols)
      .from(digitalItem)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(digitalItem.title))
      .limit(f.limit)
      .offset(f.offset);
  }
}
