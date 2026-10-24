-- 0034_trn_tracking: live vehicle tracking (TRN-04) on top of trn.gps_ping
--   * device credentials for GPS trackers / gateways (hash only; the key is shown once)
--   * latest position per vehicle (one row, upserted) so "where is every bus now" never scans ping history
--   * per trip and stop: when the bus came near / arrived (drives the one-time "bus near your stop" message)
--   * operational alerts (overspeed, ...) for the transport desk
-- New tables come after 0030_standardize, so RLS / touch are enabled here explicitly (the calls are idempotent).

ALTER TABLE trn.vehicle
  ADD COLUMN gps_device_key_hash bytea,           -- sha256 of the device key; NULL = device ingest disabled
  ADD COLUMN gps_key_rotated_at  timestamptz;
CREATE UNIQUE INDEX ux_vehicle_gps_device ON trn.vehicle (org_id, gps_device_id) WHERE gps_device_id IS NOT NULL;

CREATE TABLE trn.vehicle_position (                -- latest fix per vehicle
  vehicle_id   uuid PRIMARY KEY REFERENCES trn.vehicle(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL,
  campus_id    uuid NOT NULL,
  recorded_at  timestamptz NOT NULL,              -- device time of the fix
  received_at  timestamptz NOT NULL DEFAULT now(),
  lat          numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  speed_kmh    numeric(5,1),
  heading      smallint CHECK (heading BETWEEN 0 AND 359),
  trip_id      uuid REFERENCES trn.trip(id),
  source       text NOT NULL CHECK (source IN ('device','driver_app'))
);
CREATE INDEX ix_vehicle_position_campus ON trn.vehicle_position (campus_id);

CREATE TABLE trn.trip_stop_event (                 -- bus near / at a stop during a trip (once each)
  trip_id     uuid NOT NULL REFERENCES trn.trip(id) ON DELETE CASCADE,
  stop_id     uuid NOT NULL REFERENCES trn.stop(id),
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL,
  near_at     timestamptz,
  arrived_at  timestamptz,
  PRIMARY KEY (trip_id, stop_id)
);

CREATE TABLE trn.vehicle_alert (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  vehicle_id       uuid NOT NULL REFERENCES trn.vehicle(id),
  trip_id          uuid REFERENCES trn.trip(id),
  kind             text NOT NULL CHECK (kind IN ('overspeed','device_offline','route_deviation')),
  at               timestamptz NOT NULL,
  lat              numeric(9,6),
  lng              numeric(9,6),
  details          jsonb NOT NULL DEFAULT '{}',
  acknowledged_at  timestamptz,
  acknowledged_by  uuid
);
CREATE INDEX ix_vehicle_alert_open ON trn.vehicle_alert (campus_id, at DESC) WHERE acknowledged_at IS NULL;
CREATE INDEX ix_vehicle_alert_vehicle ON trn.vehicle_alert (vehicle_id, kind, at DESC);

-- trip lookup by vehicle and day (active trip while ingesting pings)
CREATE INDEX ix_trip_vehicle_day ON trn.trip (vehicle_id, trip_date) WHERE ended_at IS NULL;

CALL core.enable_campus_rls('trn.vehicle_position');
CALL core.enable_campus_rls('trn.trip_stop_event');
CALL core.enable_campus_rls('trn.vehicle_alert');

COMMENT ON TABLE trn.vehicle_position IS 'Latest GPS fix per vehicle (upserted on ingest). [TRN-04]';
COMMENT ON TABLE trn.trip_stop_event IS 'When the bus came near / arrived at each stop during a trip; drives the one-time guardian alert. [TRN-04]';
COMMENT ON TABLE trn.vehicle_alert IS 'Operational alerts for the transport desk (overspeed, offline device). [TRN-04]';
COMMENT ON COLUMN trn.vehicle.gps_device_key_hash IS 'SHA-256 of the GPS device key (the key itself is shown once when generated)';
