import { and, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { Database } from '../../../shared/infrastructure/db/client.js';
import { jobRun } from '../../../shared/infrastructure/db/schema/sys.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type { CompleteUpload, CreateUpload, GetDownloadUrl } from '../application/FileUseCases.js';

/** Liveness/readiness for the orchestrator (no auth, not logged). */
export class HealthController extends BaseController {
  readonly basePath = '/health';
  readonly tag = 'System';
  override readonly mount = 'root' as const;

  constructor(private readonly deps: { db: Database; redis: Redis | undefined }) {
    super();
  }

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'get',
        path: '/live',
        summary: 'Process is up',
        auth: 'none',
        handler: async () => this.ok({ status: 'ok' }),
      }),
      defineRoute({
        method: 'get',
        path: '/ready',
        summary: 'Database (and Redis) reachable, schema migrated',
        auth: 'none',
        handler: async (_i, _req, res) => {
          const checks: Record<string, string> = {};
          try {
            const r = await this.deps.db.execute<{ version: string | null }>(
              sql`SELECT max(version) AS version FROM sys.schema_migration`,
            );
            checks.database = 'ok';
            checks.schema = r.rows[0]?.version ?? 'unknown';
          } catch {
            checks.database = 'down';
          }
          if (this.deps.redis)
            checks.redis = (await this.deps.redis.ping().catch(() => 'down')) === 'PONG' ? 'ok' : 'down';
          const healthy = !Object.values(checks).includes('down');
          res.status(healthy ? 200 : 503).json({ data: { status: healthy ? 'ready' : 'degraded', checks } });
          return undefined;
        },
      }),
    ];
  }
}

/** Status of user-visible background jobs (sys.job_run), e.g. exports and PDF batches. */
export class JobsController extends BaseController {
  readonly basePath = '/jobs';
  readonly tag = 'System';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'get',
        path: '/:id',
        summary: 'Background job status and result',
        schema: { params: z.object({ id: z.string().uuid() }) },
        handler: async ({ params }, req) => {
          const uow = this.resolve<UnitOfWork>(req, 'uow');
          const job = await uow.run(
            async () => {
              const [row] = await uow
                .tx()
                .select()
                .from(jobRun)
                .where(and(eq(jobRun.id, params.id), eq(jobRun.requestedBy, req.ctx.userId!)));
              return row;
            },
            { readOnly: true },
          );
          if (!job) throw new NotFoundError();
          return this.ok({
            id: job.id,
            kind: job.kind,
            status: job.status,
            progress: job.progress,
            error: job.error,
            resultFileId: job.resultFileId,
            createdAt: job.createdAt,
            finishedAt: job.finishedAt,
          });
        },
      }),
    ];
  }
}

const UploadBody = z
  .object({
    purpose: z.string().min(1).max(50),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(3).max(127),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

/** Presigned upload/download (docs/backend/cross-cutting.md §13, flows.md §14). */
export class FilesController extends BaseController {
  readonly basePath = '/files';
  readonly tag = 'Files';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'post',
        path: '/uploads',
        summary: 'Start an upload: returns a presigned PUT URL',
        idempotent: true,
        schema: { body: UploadBody },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateUpload>(req, 'createUpload').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/:id/complete',
        summary: 'Confirm the upload; queues the virus scan',
        successStatus: 200,
        schema: { params: z.object({ id: z.string().uuid() }) },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<CompleteUpload>(req, 'completeUpload').execute({ fileId: params.id })),
      }),
      defineRoute({
        method: 'get',
        path: '/:id/url',
        summary: 'Short-lived download URL (after permission check)',
        schema: { params: z.object({ id: z.string().uuid() }) },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetDownloadUrl>(req, 'getDownloadUrl').execute({ fileId: params.id })),
      }),
    ];
  }
}
