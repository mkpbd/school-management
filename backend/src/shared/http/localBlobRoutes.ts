import type { Router } from 'express';
import { LOCAL_BLOB_PATH, type LocalDiskFileStorage } from '../infrastructure/storage/LocalDiskFileStorage.js';

/**
 * Upload / download endpoints of the local-disk storage driver. The signed token is the only credential (like an S3
 * presigned URL): it names the object, the operation, the content type and size, and expires within minutes.
 */
export function mountLocalBlobRoutes(router: Router, storage: LocalDiskFileStorage): void {
  router.put(`${LOCAL_BLOB_PATH}/:token`, async (req, res, next) => {
    try {
      const grant = storage.verify(req.params.token);
      if (!grant || grant.op !== 'put') return void res.status(403).json({ code: 'BLOB_TOKEN_INVALID' });
      const type = (req.header('Content-Type') ?? '').split(';')[0]!.trim();
      if (type !== grant.ct) return void res.status(400).json({ code: 'BLOB_CONTENT_TYPE' });
      const length = Number(req.header('Content-Length'));
      if (Number.isFinite(length) && length !== grant.len) return void res.status(400).json({ code: 'BLOB_SIZE' });
      try {
        const { size } = await storage.putStream(
          { bucket: grant.b, key: grant.k, contentType: grant.ct, maxBytes: grant.len },
          req,
        );
        if (size !== grant.len) {
          await storage.delete({ bucket: grant.b, key: grant.k });
          return void res.status(400).json({ code: 'BLOB_SIZE' });
        }
      } catch (err) {
        if ((err as Error).message === 'BLOB_TOO_LARGE') return void res.status(413).json({ code: 'BLOB_SIZE' });
        throw err;
      }
      res.status(200).end();
    } catch (err) {
      next(err);
    }
  });

  router.get(`${LOCAL_BLOB_PATH}/:token`, async (req, res, next) => {
    try {
      const grant = storage.verify(req.params.token);
      if (!grant || grant.op !== 'get') return void res.status(403).json({ code: 'BLOB_TOKEN_INVALID' });
      const head = await storage.head({ bucket: grant.b, key: grant.k });
      if (!head) return void res.status(404).json({ code: 'NOT_FOUND' });
      res.set({
        'Content-Type': head.contentType ?? 'application/octet-stream',
        'Content-Length': String(head.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(grant.fn ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(grant.fn)}` } : {}),
      });
      (await storage.getStream({ bucket: grant.b, key: grant.k })).pipe(res);
    } catch (err) {
      next(err);
    }
  });
}
