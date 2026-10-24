import { API_BASE_URL, client, unwrap } from "../client";
import { resource } from "../resource";
import type { Body, Query, Row } from "../types";

/**
 * Transport: fleet, routes, assignments, trips (TrnController) and live tracking (TrackingController).
 * Device endpoints (/trn/gps/ingest, /trn/gps/osmand) are for GPS trackers, not the web app.
 */
export const trn = {
  vehicles: {
    ...resource("/api/v1/trn/vehicles", "/api/v1/trn/vehicles/{id}"),
    /** Link a GPS tracker and issue its key (shown only once). */
    issueDeviceKey: <T = Row>(
      id: string,
      body: Body<"/api/v1/trn/vehicles/{id}/device-key", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/trn/vehicles/{id}/device-key", {
          params: { path: { id } },
          body,
        }),
      ),
    documents: <T = Row[]>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/trn/vehicles/{id}/documents", {
          params: { path: { id } },
        }),
      ),
    addDocument: <T = Row>(
      id: string,
      body: Body<"/api/v1/trn/vehicles/{id}/documents", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/trn/vehicles/{id}/documents", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Today's driver / helper / attendant. */
    crew: <T = Row[]>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/trn/vehicles/{id}/crew", {
          params: { path: { id } },
        }),
      ),
    assignCrew: <T = Row>(
      id: string,
      body: Body<"/api/v1/trn/vehicles/{id}/crew", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/trn/vehicles/{id}/crew", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Route history (polyline) between two ISO date-times, downsampled. */
    track: <T = Row>(
      id: string,
      query: Query<"/api/v1/trn/vehicles/{id}/track", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/trn/vehicles/{id}/track", {
          params: { path: { id }, query },
        }),
      ),
    /** Driver app: post the phone's GPS fixes for the vehicle driven today. */
    postPings: <T = Row>(
      id: string,
      body: Body<"/api/v1/trn/vehicles/{id}/pings", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/trn/vehicles/{id}/pings", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  documents: {
    remove: (id: string) =>
      unwrap<null>(
        client.DELETE("/api/v1/trn/vehicle-documents/{id}", {
          params: { path: { id } },
        }),
      ),
    /** Expiring within `withinDays` (negative daysLeft = already expired). */
    expiring: <T = Row[]>(
      query?: Query<"/api/v1/trn/vehicle-documents/expiring", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/trn/vehicle-documents/expiring", {
          params: { query },
        }),
      ),
  },
  crew: {
    end: <T = Row>(
      id: string,
      body: Body<"/api/v1/trn/crew/{id}/end", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/trn/crew/{id}/end", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  stops: resource("/api/v1/trn/stops", "/api/v1/trn/stops/{id}"),
  routes: {
    ...resource("/api/v1/trn/routes", "/api/v1/trn/routes/{id}"),
    /** Route with ordered stops, vehicle and number of students. */
    get: <T = Row>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/trn/routes/{id}", { params: { path: { id } } }),
      ),
    /** Replace the stops in pickup order (the drop run is the reverse). */
    setStops: <T = Row>(
      id: string,
      body: Body<"/api/v1/trn/routes/{id}/stops", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/trn/routes/{id}/stops", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Students on the route with their pickup / drop stops. */
    manifest: <T = Row[]>(
      id: string,
      query?: Query<"/api/v1/trn/routes/{id}/manifest", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/trn/routes/{id}/manifest", {
          params: { path: { id }, query },
        }),
      ),
  },
  assignments: {
    /** Seat limit = vehicle capacity. */
    create: <T = Row>(body: Body<"/api/v1/trn/assignments", "post">) =>
      unwrap<T>(client.POST("/api/v1/trn/assignments", { body })),
    end: <T = Row>(
      id: string,
      body: Body<"/api/v1/trn/assignments/{id}/end", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/trn/assignments/{id}/end", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  trips: {
    list: <T = Row[]>(query?: Query<"/api/v1/trn/trips", "get">) =>
      unwrap<T>(client.GET("/api/v1/trn/trips", { params: { query } })),
    /** Driver starts today's pickup / drop run (resumes if already started). */
    start: <T = Row>(body: Body<"/api/v1/trn/trips/start", "post">) =>
      unwrap<T>(client.POST("/api/v1/trn/trips/start", { body })),
    end: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/trn/trips/{id}/end", { params: { path: { id } } }),
      ),
  },
  tracking: {
    /** All vehicles: position, moving / idle / offline, current trip, next stop and ETA. */
    live: <T = Row[]>(query?: Query<"/api/v1/trn/tracking/live", "get">) =>
      unwrap<T>(client.GET("/api/v1/trn/tracking/live", { params: { query } })),
    /** SSE URL for EventSource (event "update"). */
    streamUrl: (query: { campusId?: string; intervalSec?: number } = {}) =>
      sseUrl("/api/v1/trn/tracking/stream", query),
    /** Where is the child's bus: position, status, distance and ETA to the child's stop. */
    studentBus: <T = Row>(studentId: string) =>
      unwrap<T>(
        client.GET("/api/v1/trn/students/{id}/bus", {
          params: { path: { id: studentId } },
        }),
      ),
    studentBusStreamUrl: (
      studentId: string,
      query: { intervalSec?: number } = {},
    ) =>
      sseUrl(
        `/api/v1/trn/students/${encodeURIComponent(studentId)}/bus/stream`,
        query,
      ),
  },
  alerts: {
    list: <T = Row[]>(query?: Query<"/api/v1/trn/alerts", "get">) =>
      unwrap<T>(client.GET("/api/v1/trn/alerts", { params: { query } })),
    acknowledge: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/trn/alerts/{id}/acknowledge", {
          params: { path: { id } },
        }),
      ),
  },
};

function sseUrl(
  path: string,
  query: Record<string, string | number | undefined>,
): string {
  const qs = new URLSearchParams(
    Object.entries(query).flatMap(([k, v]) =>
      v === undefined || v === "" ? [] : [[k, String(v)]],
    ),
  ).toString();
  return `${API_BASE_URL}${path}${qs ? `?${qs}` : ""}`;
}
