import { asValue, type AwilixContainer } from 'awilix';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cradle } from '../../src/bootstrap/container.js';
import { systemContext, type RequestContext } from '../../src/shared/application/RequestContext.js';
import type { PublishedEvent } from '../../src/shared/domain/DomainEvent.js';
import { ForbiddenError } from '../../src/shared/domain/errors.js';
import { room } from '../../src/shared/infrastructure/db/schema/core.js';
import { mapPgError } from '../../src/shared/infrastructure/db/pg-errors.js';
import type { UnitOfWork } from '../../src/shared/infrastructure/db/UnitOfWork.js';
import type { NumberAllocator } from '../../src/shared/application/ports.js';
import type { EventBus } from '../../src/shared/infrastructure/events/EventBus.js';
import type { SubscriptionRegistry } from '../../src/shared/infrastructure/events/EventSubscription.js';
import { OutboxRelay } from '../../src/shared/infrastructure/events/OutboxRelay.js';
import type { OutboxWriter } from '../../src/shared/infrastructure/events/OutboxWriter.js';
import type { SubscriptionRunner } from '../../src/shared/infrastructure/events/SubscriptionRunner.js';
import type { ModuleDefinition } from '../../src/shared/module.js';
import { createTestApp, type TestApp } from '../helpers/testApp.js';

const received: PublishedEvent[] = [];

class RecordingSubscriber {
  async handle(e: PublishedEvent): Promise<void> {
    received.push(e);
  }
}

const testModule: ModuleDefinition = {
  name: 'test',
  register(_c, mc) {
    mc.subscriptions.add({
      eventType: 'test.thing_happened.v1',
      consumer: 'test.recorder',
      handler: RecordingSubscriber as never,
    });
  },
};

let t: TestApp;
let container: AwilixContainer<Cradle>;
let dhn: string;
let gul: string;
let orgId: string;

function scopeWith(ctx: RequestContext) {
  const scope = container.createScope();
  scope.register({ ctx: asValue(ctx) });
  return scope;
}

function campusCtx(campusIds: string[] | '*', activeCampusId?: string): RequestContext {
  return { ...systemContext(orgId, 'test'), campusIds, activeCampusId, grants: { campusIds, byPermission: {} } };
}

beforeAll(async () => {
  t = await createTestApp([testModule]);
  container = t.container;
  orgId = container.cradle.orgId;
  dhn = await t.owner.campusId('DHN');
  gul = await t.owner.campusId('GUL');
  await t.owner.query(
    `INSERT INTO core.room (org_id, campus_id, code, name, room_type) VALUES ($1, $2, $4, 'Test room D', 'classroom'), ($1, $3, $5, 'Test room G', 'classroom')`,
    [orgId, dhn, gul, `T-${t.owner.runId}-D`, `T-${t.owner.runId}-G`],
  );
});

afterAll(async () => {
  await t.owner.query(`DELETE FROM core.room WHERE code LIKE $1`, [`T-${t.owner.runId}-%`]);
  await t.close();
});

describe('UnitOfWork + PostgreSQL RLS', () => {
  it('a campus-scoped context only sees its campus rows', async () => {
    const uow = scopeWith(campusCtx([dhn])).resolve<UnitOfWork>('uow');
    const rows = await uow.run(() =>
      uow
        .tx()
        .select({ code: room.code })
        .from(room)
        .where(like(room.code, `T-${t.owner.runId}-%`)),
    );
    expect(rows.map((r) => r.code)).toEqual([`T-${t.owner.runId}-D`]);
  });

  it('org-wide context sees every campus', async () => {
    const uow = scopeWith(campusCtx('*')).resolve<UnitOfWork>('uow');
    const rows = await uow.run(() =>
      uow
        .tx()
        .select({ code: room.code })
        .from(room)
        .where(like(room.code, `T-${t.owner.runId}-%`)),
    );
    expect(rows).toHaveLength(2);
  });

  it('writing into another campus is rejected by RLS WITH CHECK (mapped to 403)', async () => {
    const uow = scopeWith(campusCtx([dhn])).resolve<UnitOfWork>('uow');
    const err = await uow
      .run(() =>
        uow
          .tx()
          .insert(room)
          .values({ orgId, campusId: gul, code: `T-${t.owner.runId}-X`, name: 'x', roomType: 'classroom' }),
      )
      .catch((e: unknown) => e);
    expect(mapPgError(err)).toBeInstanceOf(ForbiddenError);
  });

  it('repositories cannot run outside a transaction (no RLS context)', () => {
    const uow = scopeWith(campusCtx([dhn])).resolve<UnitOfWork>('uow');
    expect(() => uow.tx()).toThrow(/outside UnitOfWork/);
  });

  it('read-only transactions reject writes', async () => {
    const uow = scopeWith(campusCtx('*')).resolve<UnitOfWork>('uow');
    const err = await uow
      .run(
        () =>
          uow
            .tx()
            .insert(room)
            .values({ orgId, campusId: dhn, code: `T-${t.owner.runId}-RO`, name: 'x', roomType: 'classroom' }),
        { readOnly: true },
      )
      .catch((e: unknown) => e);
    expect(String((err as { cause?: { message?: string } })?.cause?.message ?? err)).toMatch(/read-only/);
  });
});

describe('NumberAllocator (core.number_sequence)', () => {
  it('is gap-free: a rolled-back transaction does not consume a number', async () => {
    const scope = scopeWith(campusCtx('*'));
    const uow = scope.resolve<UnitOfWork>('uow');
    const numbers = scope.resolve<NumberAllocator>('numbers');
    const first = await uow.run(() => numbers.next({ campusId: dhn, key: 'receipt' }));
    await uow
      .run(async () => {
        await numbers.next({ campusId: dhn, key: 'receipt' });
        throw new Error('rollback');
      })
      .catch(() => undefined);
    const second = await uow.run(() => numbers.next({ campusId: dhn, key: 'receipt' }));
    const seq = (s: string) => Number(s.split('-').at(-1));
    expect(first).toMatch(/^RCP-DHN-\d{2}-\d{6}$/);
    expect(seq(second)).toBe(seq(first) + 1);
  });
});

describe('outbox → relay → subscriber (exactly-once effect)', () => {
  it('delivers committed events once; redelivery is detected by the inbox', async () => {
    received.length = 0;
    const scope = scopeWith(campusCtx('*'));
    const uow = scope.resolve<UnitOfWork>('uow');
    const outbox = scope.resolve<OutboxWriter>('outbox');
    const aggregateId = crypto.randomUUID();

    // rolled back => never published
    await uow
      .run(async () => {
        await outbox.write([
          {
            type: 'test.thing_happened.v1',
            aggregateType: 'thing',
            aggregateId: 'rolled-back',
            orgId,
            occurredAt: new Date(),
            payload: {},
          },
        ]);
        throw new Error('rollback');
      })
      .catch(() => undefined);
    await uow.run(() =>
      outbox.write([
        {
          type: 'test.thing_happened.v1',
          aggregateType: 'thing',
          aggregateId,
          orgId,
          campusId: dhn,
          occurredAt: new Date(),
          payload: { n: 1 },
        },
      ]),
    );

    const { db, pool, logger, metrics } = container.cradle;
    const relay = new OutboxRelay({
      db,
      pool,
      eventBus: container.resolve<EventBus>('eventBus'),
      subscriptions: container.resolve<SubscriptionRegistry>('subscriptions'),
      logger,
      metrics,
    });
    await relay.drain();
    const mine = received.filter((e) => e.aggregateId === aggregateId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: 'test.thing_happened.v1', campusId: dhn, payload: { n: 1 } });
    expect(received.some((e) => e.aggregateId === 'rolled-back')).toBe(false);

    await relay.drain(); // nothing left
    expect(received.filter((e) => e.aggregateId === aggregateId)).toHaveLength(1);

    const runner = container.resolve<SubscriptionRunner>('subscriptionRunner');
    expect(await runner.deliver(mine[0]!, 'test.recorder')).toBe('duplicate');
  });
});
