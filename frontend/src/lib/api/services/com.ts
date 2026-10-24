import { client, idempotencyKey, unwrap } from "../client";
import type { Body, IdempotencyOptions, Query, Row } from "../types";

/** Notices, messaging and notification preferences (backend/src/modules/com/presentation/*Controller.ts). */
export const com = {
  notices: {
    /** All notices (drafts, scheduled, published, withdrawn), newest first; offset paging. */
    list: <T = Row[]>(query?: Query<"/api/v1/com/notices", "get">) =>
      unwrap<T>(client.GET("/api/v1/com/notices", { params: { query } })),
    /** Draft a notice / circular; `publishNow` publishes it (or schedules it when publishAt is later). */
    create: <T = Row>(
      body: Body<"/api/v1/com/notices", "post">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/com/notices", {
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
    /** Staff with com.notice.view: any state (with audiences). Recipients: published only (with readAt). */
    get: <T = Row>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/com/notices/{id}", { params: { path: { id } } }),
      ),
    /** Edit a draft / scheduled notice (it goes back to draft). */
    update: <T = Row>(
      id: string,
      body: Body<"/api/v1/com/notices/{id}", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/com/notices/{id}", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Publish now (or schedule when publishAt is later): audience resolved, push / SMS sent. */
    publish: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/com/notices/{id}/publish", {
          params: { path: { id } },
        }),
      ),
    /** Disappears from boards and the website. */
    withdraw: <T = Row>(
      id: string,
      body: Body<"/api/v1/com/notices/{id}/withdraw", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/com/notices/{id}/withdraw", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Short-lived download link of an attachment (recipients, or notice managers). */
    attachmentUrl: <T = Row>(id: string, fileId: string) =>
      unwrap<T>(
        client.GET("/api/v1/com/notices/{id}/attachments/{fileId}/url", {
          params: { path: { id, fileId } },
        }),
      ),
    /** Read receipt of the signed-in recipient. */
    markRead: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/com/notices/{id}/read", {
          params: { path: { id } },
        }),
      ),
    /** Totals, by guardians / students / staff, and the unread list (contact masked). */
    receipts: <T = Row>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/com/notices/{id}/receipts", {
          params: { path: { id } },
        }),
      ),
    /** My notice board: notices addressed to me, urgent first, unread flag. */
    mine: <T = Row[]>(query?: Query<"/api/v1/com/me/notices", "get">) =>
      unwrap<T>(client.GET("/api/v1/com/me/notices", { params: { query } })),
    /** Website listing (no login): published notices marked for the public site. */
    website: <T = Row[]>(query?: Query<"/api/v1/com/public/notices", "get">) =>
      unwrap<T>(
        client.GET("/api/v1/com/public/notices", { params: { query } }),
      ),
    /** Publish scheduled notices that are due (the job also runs every minute). */
    publishDue: <T = Row>() =>
      unwrap<T>(client.POST("/api/v1/com/tasks/publish-due-notices")),
  },
  me: {
    /** Every notification with its channels, my quiet hours and the school default. */
    preferences: <T = Row>() =>
      unwrap<T>(client.GET("/api/v1/com/me/notification-preferences")),
    /** Mute / unmute per event and channel ("*" = all events); quiet hours (null = school default). */
    updatePreferences: <T = Row>(
      body: Body<"/api/v1/com/me/notification-preferences", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/com/me/notification-preferences", { body }),
      ),
    /** My registered push devices (token tail only). */
    devices: <T = Row[]>() =>
      unwrap<T>(client.GET("/api/v1/com/me/push-devices")),
    /** Register this app install for push (FCM token). */
    registerDevice: <T = Row>(
      body: Body<"/api/v1/com/me/push-devices", "post">,
    ) => unwrap<T>(client.POST("/api/v1/com/me/push-devices", { body })),
    /** Stop push to a device (needs its full token). */
    /** Stop push to one of my devices from the device list. */
    removeDevice: (id: string) =>
      unwrap<null>(
        client.DELETE("/api/v1/com/me/push-devices/{id}", {
          params: { path: { id } },
        }),
      ),
    /** Stop push by token (an app signing out on its own device). */
    revokeDevice: <T = Row>(
      body: Body<"/api/v1/com/me/push-devices/revoke", "post">,
    ) => unwrap<T>(client.POST("/api/v1/com/me/push-devices/revoke", { body })),
    /** My in-app notifications. */
    inbox: <T = Row[]>(query?: Query<"/api/v1/com/me/inbox", "get">) =>
      unwrap<T>(client.GET("/api/v1/com/me/inbox", { params: { query } })),
  },
  templates: {
    /** Message templates, all versions. */
    list: <T = Row[]>(query?: Query<"/api/v1/com/templates", "get">) =>
      unwrap<T>(client.GET("/api/v1/com/templates", { params: { query } })),
    /** New version (inactive until activated). E-mail bodies are HTML; values are escaped. */
    create: <T = Row>(body: Body<"/api/v1/com/templates", "post">) =>
      unwrap<T>(client.POST("/api/v1/com/templates", { body })),
    /** Make this version the live one (the previous version is deactivated). */
    activate: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/com/templates/{id}/activate", {
          params: { path: { id } },
        }),
      ),
    /** Render a draft with sample data (e-mail inside the school layout). */
    preview: <T = Row>(body: Body<"/api/v1/com/templates/preview", "post">) =>
      unwrap<T>(client.POST("/api/v1/com/templates/preview", { body })),
  },
};
