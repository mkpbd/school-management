import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { account, fiscalPeriod, journal, journalLine } from '../../../shared/infrastructure/db/schema/acc.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { AccountRow, AccRepository, BalanceRow, JournalRow, PeriodRow } from '../application/ports.js';

const accountCols = {
  id: account.id,
  code: account.code,
  nameEn: account.nameEn,
  kind: account.kind,
  isPostable: account.isPostable,
  isActive: account.isActive,
};
const periodCols = {
  id: fiscalPeriod.id,
  code: fiscalPeriod.code,
  startsOn: fiscalPeriod.startsOn,
  endsOn: fiscalPeriod.endsOn,
  status: fiscalPeriod.status,
};

// correlated subqueries name the outer row explicitly: drizzle prints a bare "id" in single-table selects,
// which would bind to the subquery's own table
const JOURNAL_ID = sql`${sql.identifier('acc')}.${sql.identifier('journal')}.${sql.identifier('id')}`;

export class DrizzleAccRepository implements AccRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async accountsByCode(codes: string[]): Promise<Map<string, AccountRow>> {
    if (!codes.length) return new Map();
    const rows = await this.tx.select(accountCols).from(account).where(inArray(account.code, codes));
    return new Map(rows.map((r) => [r.code, r]));
  }

  async account(id: string): Promise<AccountRow | null> {
    const [r] = await this.tx.select(accountCols).from(account).where(eq(account.id, id));
    return r ?? null;
  }

  async periodFor(orgId: string, date: string): Promise<PeriodRow> {
    const find = async () =>
      (
        await this.tx
          .select(periodCols)
          .from(fiscalPeriod)
          .where(and(lte(fiscalPeriod.startsOn, date), gte(fiscalPeriod.endsOn, date)))
      )[0];
    const existing = await find();
    if (existing) return existing;
    const [y, m] = date.split('-').map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const month = date.slice(0, 7);
    // ON CONFLICT DO NOTHING also covers the no-overlap exclusion constraint (a concurrent creator wins)
    await this.tx
      .insert(fiscalPeriod)
      .values({ orgId, code: month, startsOn: `${month}-01`, endsOn: `${month}-${String(last).padStart(2, '0')}` })
      .onConflictDoNothing();
    return (await find())!;
  }

  async periods(): Promise<PeriodRow[]> {
    return this.tx.select(periodCols).from(fiscalPeriod).orderBy(desc(fiscalPeriod.startsOn));
  }

  async setPeriodStatus(code: string, status: PeriodRow['status'], by: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(fiscalPeriod)
      .set(status === 'open' ? { status, lockedBy: null, lockedAt: null } : { status, lockedBy: by, lockedAt: at })
      .where(eq(fiscalPeriod.code, code))
      .returning({ id: fiscalPeriod.id });
    return rows.length > 0;
  }

  async insertJournal(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(journal)
      .values(values as typeof journal.$inferInsert)
      .returning({ id: journal.id });
    return r!.id;
  }

  async insertLines(rows: Array<Record<string, unknown>>): Promise<void> {
    await this.tx.insert(journalLine).values(rows as Array<typeof journalLine.$inferInsert>);
  }

  private journalQuery() {
    return this.tx
      .select({
        id: journal.id,
        campusId: journal.campusId,
        journalNo: journal.journalNo,
        voucherType: journal.voucherType,
        journalDate: journal.journalDate,
        narration: journal.narration,
        sourceModule: journal.sourceModule,
        sourceType: journal.sourceType,
        sourceId: journal.sourceId,
        reversalOfId: journal.reversalOfId,
        reversedById: sql<string | null>`(SELECT r.id FROM acc.journal r WHERE r.reversal_of_id = ${JOURNAL_ID})`,
        totalPaisa: sql<number>`(SELECT coalesce(sum(l.debit_paisa), 0) FROM acc.journal_line l WHERE l.journal_id = ${JOURNAL_ID})::bigint`,
      })
      .from(journal);
  }

  private async withLines(j: Omit<JournalRow, 'lines'>): Promise<JournalRow> {
    const lines = await this.tx
      .select({
        accountId: journalLine.accountId,
        accountCode: account.code,
        accountName: account.nameEn,
        debitPaisa: journalLine.debitPaisa,
        creditPaisa: journalLine.creditPaisa,
        memo: journalLine.memo,
        partyType: journalLine.partyType,
        partyId: journalLine.partyId,
      })
      .from(journalLine)
      .innerJoin(account, eq(account.id, journalLine.accountId))
      .where(eq(journalLine.journalId, j.id))
      .orderBy(asc(journalLine.id));
    return { ...j, totalPaisa: Number(j.totalPaisa), lines };
  }

  async journal(id: string): Promise<JournalRow | null> {
    const [j] = await this.journalQuery().where(eq(journal.id, id));
    return j ? this.withLines(j) : null;
  }

  async journalBySource(module: string, type: string, id: string): Promise<JournalRow | null> {
    const [j] = await this.journalQuery().where(
      and(
        eq(journal.sourceModule, module),
        eq(journal.sourceType, type),
        eq(journal.sourceId, id),
        sql`${journal.reversalOfId} IS NULL`,
      ),
    );
    return j ? this.withLines(j) : null;
  }

  async journals(f: {
    campusId?: string;
    from?: string;
    to?: string;
    sourceModule?: string;
    limit: number;
    offset: number;
  }): Promise<JournalRow[]> {
    const where: SQL[] = [eq(journal.status, 'posted')];
    if (f.campusId) where.push(eq(journal.campusId, f.campusId));
    if (f.from) where.push(gte(journal.journalDate, f.from));
    if (f.to) where.push(lte(journal.journalDate, f.to));
    if (f.sourceModule) where.push(eq(journal.sourceModule, f.sourceModule));
    const rows = await this.journalQuery()
      .where(and(...where))
      .orderBy(desc(journal.journalDate), desc(journal.journalNo))
      .limit(f.limit)
      .offset(f.offset);
    return rows.map((r) => ({ ...r, totalPaisa: Number(r.totalPaisa) }));
  }

  async balances(f: { campusId?: string; from?: string; to: string }): Promise<BalanceRow[]> {
    const where: SQL[] = [eq(journal.status, 'posted'), lte(journal.journalDate, f.to)];
    if (f.from) where.push(gte(journal.journalDate, f.from));
    if (f.campusId) where.push(eq(journalLine.campusId, f.campusId));
    const rows = await this.tx
      .select({
        accountId: account.id,
        code: account.code,
        nameEn: account.nameEn,
        kind: account.kind,
        debitPaisa: sql<number>`sum(${journalLine.debitPaisa})::bigint`,
        creditPaisa: sql<number>`sum(${journalLine.creditPaisa})::bigint`,
      })
      .from(journalLine)
      .innerJoin(journal, eq(journal.id, journalLine.journalId))
      .innerJoin(account, eq(account.id, journalLine.accountId))
      .where(and(...where))
      .groupBy(account.id, account.code, account.nameEn, account.kind)
      .orderBy(asc(account.code));
    return rows.map((r) => ({ ...r, debitPaisa: Number(r.debitPaisa), creditPaisa: Number(r.creditPaisa) }));
  }

  async ledger(accountId: string, f: { campusId?: string; from: string; to: string }) {
    const base: SQL[] = [eq(journal.status, 'posted'), eq(journalLine.accountId, accountId)];
    if (f.campusId) base.push(eq(journalLine.campusId, f.campusId));
    const [opening] = await this.tx
      .select({
        debitPaisa: sql<number>`coalesce(sum(${journalLine.debitPaisa}), 0)::bigint`,
        creditPaisa: sql<number>`coalesce(sum(${journalLine.creditPaisa}), 0)::bigint`,
      })
      .from(journalLine)
      .innerJoin(journal, eq(journal.id, journalLine.journalId))
      .where(and(...base, lt(journal.journalDate, f.from)));
    const lines = await this.tx
      .select({
        journalId: journal.id,
        journalNo: journal.journalNo,
        journalDate: journal.journalDate,
        narration: journal.narration,
        debitPaisa: journalLine.debitPaisa,
        creditPaisa: journalLine.creditPaisa,
        memo: journalLine.memo,
      })
      .from(journalLine)
      .innerJoin(journal, eq(journal.id, journalLine.journalId))
      .where(and(...base, gte(journal.journalDate, f.from), lte(journal.journalDate, f.to)))
      .orderBy(asc(journal.journalDate), asc(journal.journalNo), asc(journalLine.id));
    return {
      opening: { debitPaisa: Number(opening?.debitPaisa ?? 0), creditPaisa: Number(opening?.creditPaisa ?? 0) },
      lines,
    };
  }
}
