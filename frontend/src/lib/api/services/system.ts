import { client, idempotencyKey, unwrap } from "../client";
import type { Body, IdempotencyOptions, Job, Row } from "../types";

/** Health, background jobs and file uploads (backend/src/modules/platform). */
export const system = {
  live: () => unwrap<Row>(client.GET("/health/live")),
  ready: () => unwrap<Row>(client.GET("/health/ready")),
  /** Status and result of a queued job (202 responses carry `jobId`). */
  job: (id: string) =>
    unwrap<Job>(client.GET("/api/v1/jobs/{id}", { params: { path: { id } } })),
};

export const files = {
  /** Step 1: returns a presigned PUT URL. */
  startUpload: <T = Row>(
    body: Body<"/api/v1/files/uploads", "post">,
    opts?: IdempotencyOptions,
  ) =>
    unwrap<T>(
      client.POST("/api/v1/files/uploads", {
        body,
        headers: idempotencyKey(opts?.idempotencyKey),
      }),
    ),

  /** Step 3: confirm the upload; queues the virus scan. */
  complete: <T = Row>(id: string) =>
    unwrap<T>(
      client.POST("/api/v1/files/{id}/complete", { params: { path: { id } } }),
    ),

  /** Short-lived download URL (after the permission check). */
  downloadUrl: <T = Row>(id: string) =>
    unwrap<T>(
      client.GET("/api/v1/files/{id}/url", { params: { path: { id } } }),
    ),
};
