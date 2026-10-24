-- 0021_trn: transport management (TRN-01..06)

CREATE TABLE trn.vehicle (                         -- TRN-01
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL REFERENCES core.campus(id),
  reg_no           text NOT NULL,                  -- 'DHAKA METRO-JA-11-2233'
  kind             text NOT NULL CHECK (kind IN ('bus','minibus','microbus','van','car')),
  capacity         smallint NOT NULL CHECK (capacity > 0),
  ownership        text NOT NULL DEFAULT 'own' CHECK (ownership IN ('own','leased','contracted')),
  gps_device_id    text,
  rfid_reader_id   uuid,                           -- att.device of kind bus_reader
  is_active        boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, reg_no)
);

CREATE TABLE trn.vehicle_document (                -- fitness / insurance / tax-token / route permit expiry alerts
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  vehicle_id  uuid NOT NULL REFERENCES trn.vehicle(id) ON DELETE CASCADE,
  doc_type    text NOT NULL CHECK (doc_type IN ('fitness','insurance','tax_token','route_permit','registration')),
  doc_no      text,
  expires_on  date NOT NULL,
  file_id     uuid REFERENCES sys.stored_file(id)
);
CREATE INDEX ix_vehicle_doc_expiry ON trn.vehicle_document (expires_on);

CREATE TABLE trn.route (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  campus_id  uuid NOT NULL REFERENCES core.campus(id),
  code       text NOT NULL,
  name       text NOT NULL,
  shift_id   uuid REFERENCES core.shift(id),
  vehicle_id uuid REFERENCES trn.vehicle(id),
  is_active  boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (campus_id, code)
);

CREATE TABLE trn.stop (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  name       text NOT NULL,
  area       text,
  lat        numeric(9,6),
  lng        numeric(9,6),
  fee_zone   text                                   -- zone-based fee (TRN-03)
);

CREATE TABLE trn.route_stop (
  route_id     uuid NOT NULL REFERENCES trn.route(id) ON DELETE CASCADE,
  stop_id      uuid NOT NULL REFERENCES trn.stop(id),
  seq          smallint NOT NULL,
  pickup_time  time,
  drop_time    time,
  PRIMARY KEY (route_id, stop_id),
  UNIQUE (route_id, seq)
);

CREATE TABLE trn.zone_fee (                        -- route/zone-based fee amounts
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL REFERENCES core.academic_year(id),
  fee_zone         text NOT NULL,
  monthly_paisa    core.paisa_nn NOT NULL,
  PRIMARY KEY (campus_id, academic_year_id, fee_zone)
);

CREATE TABLE trn.crew_assignment (                 -- driver / helper
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  vehicle_id  uuid NOT NULL REFERENCES trn.vehicle(id),
  staff_id    uuid NOT NULL REFERENCES hrm.staff(id),
  role        text NOT NULL CHECK (role IN ('driver','helper','attendant')),
  valid_from  date NOT NULL,
  valid_to    date,
  licence_no  text,
  licence_expires_on date
);

CREATE TABLE trn.transport_assignment (            -- TRN-02 student -> route/stop
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  enrolment_id  uuid NOT NULL REFERENCES sis.enrolment(id),
  student_id    uuid NOT NULL REFERENCES sis.student(id),
  route_id      uuid NOT NULL REFERENCES trn.route(id),
  pickup_stop_id uuid NOT NULL REFERENCES trn.stop(id),
  drop_stop_id  uuid REFERENCES trn.stop(id),
  direction     text NOT NULL DEFAULT 'both' CHECK (direction IN ('both','pickup_only','drop_only')),
  valid_from    date NOT NULL,
  valid_to      date,
  fee_item_id   uuid REFERENCES fee.student_fee_item(id),   -- TRN-03 fee integration
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  EXCLUDE USING gist (student_id WITH =, daterange(valid_from, coalesce(valid_to, 'infinity'), '[]') WITH &&)
);
CREATE INDEX ix_transport_route ON trn.transport_assignment (route_id) WHERE valid_to IS NULL;

CREATE TABLE trn.gps_ping (                        -- TRN-04 (P3) high-volume, daily partitions
  vehicle_id  uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  lat         numeric(9,6) NOT NULL,
  lng         numeric(9,6) NOT NULL,
  speed_kmh   numeric(5,1),
  heading     smallint,
  PRIMARY KEY (vehicle_id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE trn.trip (                            -- one run of a route (morning pickup / afternoon drop)
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL,
  route_id    uuid NOT NULL REFERENCES trn.route(id),
  vehicle_id  uuid NOT NULL REFERENCES trn.vehicle(id),
  trip_date   date NOT NULL,
  direction   text NOT NULL CHECK (direction IN ('pickup','drop')),
  started_at  timestamptz,
  ended_at    timestamptz,
  UNIQUE (route_id, trip_date, direction)
);

CREATE TABLE trn.boarding_event (                  -- TRN-05 (P3) RFID/QR boarding & alighting
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id     uuid NOT NULL REFERENCES trn.trip(id),
  student_id  uuid NOT NULL,
  stop_id     uuid REFERENCES trn.stop(id),
  event       text NOT NULL CHECK (event IN ('boarded','alighted')),
  at          timestamptz NOT NULL,
  source      text NOT NULL CHECK (source IN ('rfid','qr','manual')),
  notified_at timestamptz
);
CREATE INDEX ix_boarding_trip ON trn.boarding_event (trip_id, student_id);

CREATE TABLE trn.fuel_log (                        -- TRN-06 (P3)
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  vehicle_id  uuid NOT NULL REFERENCES trn.vehicle(id),
  filled_on   date NOT NULL,
  litres      numeric(7,2) NOT NULL CHECK (litres > 0),
  cost_paisa  core.paisa_nn NOT NULL,
  odometer_km integer
);

CREATE TABLE trn.maintenance_log (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  vehicle_id    uuid NOT NULL REFERENCES trn.vehicle(id),
  kind          text NOT NULL CHECK (kind IN ('service','repair','inspection')),
  description   text NOT NULL,
  started_on    date NOT NULL,
  completed_on  date,
  cost_paisa    core.paisa_nn,
  odometer_km   integer
);
