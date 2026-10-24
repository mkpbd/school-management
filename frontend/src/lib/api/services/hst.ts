import { client, idempotencyKey, unwrap } from "../client";
import { resource } from "../resource";
import type { Body, IdempotencyOptions, Query } from "../types";

// Response shapes (backend/src/modules/hst/application/HostelUseCases.ts, MessUseCases.ts, ports.ts). Type aliases,
// so they are assignable to Row. Instants arrive as ISO strings.

export type HostelGender = "boys" | "girls" | "mixed";
export type RoomType = "single" | "double" | "triple" | "quad" | "dormitory";
export type MealPlan = "full" | "none";
export type RollSession = "morning" | "night";
export type RollStatus = "present" | "absent" | "late" | "on_leave";
export type OutpassKind = "day_out" | "home_leave" | "medical" | "other";
export type OutpassStatus =
  "pending" | "approved" | "rejected" | "cancelled" | "out" | "returned";
export type Meal = "breakfast" | "lunch" | "snacks" | "dinner";
export type Diet =
  "regular" | "vegetarian" | "no_beef" | "diabetic" | "gluten_free" | "other";

/** Hostel / room / bed rows of the generic CRUD (with rowVersion for If-Match). */
export type HostelRow = {
  id: string;
  campusId: string;
  code: string;
  name: string;
  gender: HostelGender;
  wardenStaffId: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  rowVersion: number;
};

export type RoomRow = {
  id: string;
  campusId: string;
  hostelId: string;
  code: string;
  floor: number;
  roomType: RoomType;
  monthlyFeePaisa: number;
  isActive: boolean;
  rowVersion: number;
};

export type BedRow = {
  id: string;
  campusId: string;
  roomId: string;
  code: string;
  isActive: boolean;
  rowVersion: number;
};

export type OccupancyBed = {
  bedId: string;
  code: string;
  isActive: boolean;
  studentId: string | null;
  allocationId: string | null;
  studentName: string | null;
};

export type Occupancy = {
  hostel: HostelRow;
  date: string;
  rooms: Array<{
    roomId: string;
    code: string;
    floor: number;
    roomType: RoomType;
    monthlyFeePaisa: number;
    beds: OccupancyBed[];
  }>;
  totals: { beds: number; occupied: number; free: number; inactive: number };
};

export type AllocationRow = {
  id: string;
  campusId: string;
  hostelId: string;
  bedId: string;
  studentId: string;
  enrolmentId: string;
  validFrom: string;
  validTo: string | null;
  mealPlan: MealPlan;
  monthlyFeePaisa: number;
  mealFeePaisa: number;
};

export type ResidentRow = {
  allocationId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  mealPlan: "full" | "none";
  diet: Diet;
  dietNote: string | null;
  bedId: string;
  bedCode: string;
  roomId: string;
  roomCode: string;
  floor: number;
  validFrom: string;
};

export type RollMark = {
  studentId: string;
  status: RollStatus;
  note: string | null;
  markedAt: string;
};

export type RollSheet = {
  hostelId: string;
  date: string;
  session: RollSession;
  rows: Array<{
    studentId: string;
    studentName: string;
    roomCode: string;
    bedCode: string;
    outOnPass: boolean;
    mark: RollMark | null;
  }>;
};

export type OutpassRow = {
  id: string;
  campusId: string;
  hostelId: string;
  studentId: string;
  kind: OutpassKind;
  destination: string;
  reason: string | null;
  escortName: string | null;
  escortPhone: string | null;
  outFrom: string;
  returnBy: string;
  requestedBy: string | null;
  requestedByType: "guardian" | "staff";
  status: OutpassStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  checkedOutAt: string | null;
  checkedInAt: string | null;
  overdueNotifiedAt: string | null;
  studentName: string;
  admissionNo: string;
};

export type VisitorRow = {
  id: string;
  hostelId: string;
  studentId: string;
  visitorName: string;
  relation: string;
  phone: string | null;
  purpose: string | null;
  inAt: string;
  outAt: string | null;
  studentName: string;
  admissionNo: string;
};

export type StudentHostel = {
  studentId: string;
  allocation:
    | (AllocationRow & {
        hostelName: string;
        roomCode: string;
        bedCode: string;
      })
    | null;
  warden: { name: string; phone: string } | null;
  hostelPhone: string | null;
  outpasses: OutpassRow[];
  lastRollCalls: Array<{
    date: string;
    session: RollSession;
    status: RollStatus;
  }>;
};

export type MenuEntry = {
  dayOfWeek: number;
  meal: Meal;
  items: string;
  itemsBn: string | null;
};

export type OptOutRow = {
  studentId: string;
  date: string;
  meal: Meal;
  reason: string | null;
  requestedBy: string | null;
  requestedAt: string;
};

export type MealHeadcount = {
  meal: Meal;
  at: string;
  residents: number;
  onMealPlan: number;
  away: number;
  optedOut: number;
  expected: number;
  diets: Partial<Record<Diet, number>>;
  served: number | null;
};

export type KitchenDay = {
  date: string;
  menu: MenuEntry[];
  meals: MealHeadcount[];
};

export type ServiceRow = {
  date: string;
  meal: Meal;
  expected: number;
  served: number;
  note: string | null;
};

export type MessMonthReport = {
  month: string;
  skippedByStudent: Array<{
    studentId: string;
    studentName: string;
    skipped: number;
  }>;
  services: ServiceRow[];
  totals: { expected: number; served: number };
};

export type StudentMeals = {
  hostelId: string | null;
  mealPlan: MealPlan | null;
  menu: MenuEntry[];
  optOuts: OptOutRow[];
};

/**
 * Hostel and mess (backend/src/modules/hst/presentation/HstController.ts, MessController.ts): hostels, rooms, beds,
 * allocations (rent + meal fee billed monthly via FEE), roll call, out-passes and gate, visitors, weekly menu, kitchen
 * headcount, meal opt-outs. Fees are integer paisa.
 */
export const hst = {
  /** Hostel buildings of a campus (boys / girls / mixed) with warden and phone. */
  hostels: {
    ...resource("/api/v1/hst/hostels", "/api/v1/hst/hostels/{id}"),
    /** Add a room with its beds (single 1, double 2, triple 3, quad 4; dormitory: `beds` required). */
    addRoom: <T = { roomId: string; beds: number }>(
      id: string,
      body: Body<"/api/v1/hst/hostels/{id}/rooms", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hst/hostels/{id}/rooms", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Room / bed map with who sleeps where on a date (default today), totals of free / occupied beds. */
    occupancy: <T = Occupancy>(
      id: string,
      query?: Query<"/api/v1/hst/hostels/{id}/occupancy", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/hst/hostels/{id}/occupancy", {
          params: { path: { id }, query },
        }),
      ),
    /** Residents on a date with room and bed. */
    residents: <T = ResidentRow[]>(
      id: string,
      query?: Query<"/api/v1/hst/hostels/{id}/residents", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/hst/hostels/{id}/residents", {
          params: { path: { id }, query },
        }),
      ),
    /** Roll call sheet (residents out on a pass are flagged). */
    rollCall: <T = RollSheet>(
      id: string,
      query: Query<"/api/v1/hst/hostels/{id}/roll-call", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/hst/hostels/{id}/roll-call", {
          params: { path: { id }, query },
        }),
      ),
    /** Mark the roll call; a new "absent" texts the guardian. */
    markRollCall: <T = { saved: number; absentAlerts: number }>(
      id: string,
      query: Query<"/api/v1/hst/hostels/{id}/roll-call", "put">,
      body: Body<"/api/v1/hst/hostels/{id}/roll-call", "put">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/hst/hostels/{id}/roll-call", {
          params: { path: { id }, query },
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
  },
  /** Rooms are created per hostel (`hostels.addRoom`); edit changes the monthly fee or takes a room out of use. */
  rooms: (() => {
    const { list, get, update } = resource(
      "/api/v1/hst/rooms",
      "/api/v1/hst/rooms/{id}",
    );
    return {
      list,
      get,
      update,
      addBeds: <T = { added: number }>(
        id: string,
        body: Body<"/api/v1/hst/rooms/{id}/beds", "post">,
      ) =>
        unwrap<T>(
          client.POST("/api/v1/hst/rooms/{id}/beds", {
            params: { path: { id } },
            body,
          }),
        ),
    };
  })(),
  /** Beds (filter by roomId); edit = activate / deactivate. */
  beds: (() => {
    const { list, get, update } = resource(
      "/api/v1/hst/beds",
      "/api/v1/hst/beds/{id}",
    );
    return { list, get, update };
  })(),
  allocations: {
    /** Give a student a bed (gender, campus, one bed at a time); rent + meals billed monthly via FEE. */
    create: <T = AllocationRow>(
      body: Body<"/api/v1/hst/allocations", "post">,
    ) => unwrap<T>(client.POST("/api/v1/hst/allocations", { body })),
    /** Move to another bed from a date. */
    transfer: <T = AllocationRow>(
      id: string,
      body: Body<"/api/v1/hst/allocations/{id}/transfer", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hst/allocations/{id}/transfer", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Leave the hostel (rent and meal billing stop after the last day). */
    vacate: <T = AllocationRow>(
      id: string,
      body: Body<"/api/v1/hst/allocations/{id}/vacate", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hst/allocations/{id}/vacate", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Diet of a resident (kitchen headcount). */
    setDiet: <
      T = { allocationId: string; diet: Diet; dietNote: string | null },
    >(
      id: string,
      body: Body<"/api/v1/hst/allocations/{id}/diet", "patch">,
    ) =>
      unwrap<T>(
        client.PATCH("/api/v1/hst/allocations/{id}/diet", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  /** A student's hostel: room, warden, out-passes, recent roll calls (guardian / student / staff). */
  student: <T = StudentHostel>(studentId: string) =>
    unwrap<T>(
      client.GET("/api/v1/hst/students/{id}", {
        params: { path: { id: studentId } },
      }),
    ),
  outpasses: {
    /** Staff: any (filters); guardians: `studentId` of their own child. */
    list: <T = OutpassRow[]>(query?: Query<"/api/v1/hst/outpasses", "get">) =>
      unwrap<T>(client.GET("/api/v1/hst/outpasses", { params: { query } })),
    /** Request an out-pass (guardian for own child, or hostel staff); times are ISO instants with offset. */
    request: <T = OutpassRow>(body: Body<"/api/v1/hst/outpasses", "post">) =>
      unwrap<T>(client.POST("/api/v1/hst/outpasses", { body })),
    /** Warden approves or rejects (guardian is told). */
    decide: <T = OutpassRow>(
      id: string,
      body: Body<"/api/v1/hst/outpasses/{id}/decide", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hst/outpasses/{id}/decide", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Cancel a pending / approved out-pass (requester or warden). */
    cancel: <T = OutpassRow>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hst/outpasses/{id}/cancel", {
          params: { path: { id } },
        }),
      ),
    /** Gate: student leaves on an approved pass (guardian texted). */
    checkOut: <T = OutpassRow>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hst/outpasses/{id}/check-out", {
          params: { path: { id } },
        }),
      ),
    /** Gate: student is back (minutes late recorded; guardian texted). */
    checkIn: <T = OutpassRow & { minutesLate: number }>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hst/outpasses/{id}/check-in", {
          params: { path: { id } },
        }),
      ),
    /** Alert guardians / wardens of students not back in time (the server also runs it every 10 minutes). */
    alertOverdue: <T = { overdue: number }>() =>
      unwrap<T>(client.POST("/api/v1/hst/tasks/overdue-outpasses")),
  },
  visitors: {
    /** Visitor log (newest first); `date` = signed in on that day. */
    list: <T = VisitorRow[]>(query?: Query<"/api/v1/hst/visitors", "get">) =>
      unwrap<T>(client.GET("/api/v1/hst/visitors", { params: { query } })),
    /** Sign a visitor in; `knownContact` = the phone is the primary guardian's. */
    signIn: <T = VisitorRow & { knownContact: boolean }>(
      body: Body<"/api/v1/hst/visitors", "post">,
    ) => unwrap<T>(client.POST("/api/v1/hst/visitors", { body })),
    signOut: <T = VisitorRow>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hst/visitors/{id}/out", {
          params: { path: { id } },
        }),
      ),
  },
  mess: {
    /** Weekly menu (day 0 = Sunday). */
    menu: <T = { hostelId: string; menu: MenuEntry[] }>(hostelId: string) =>
      unwrap<T>(
        client.GET("/api/v1/hst/hostels/{id}/menu", {
          params: { path: { id: hostelId } },
        }),
      ),
    /** Replace the weekly menu (one entry per day and meal; English / Bangla). */
    setMenu: <T = { entries: number }>(
      hostelId: string,
      body: Body<"/api/v1/hst/hostels/{id}/menu", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/hst/hostels/{id}/menu", {
          params: { path: { id: hostelId } },
          body,
        }),
      ),
    /** Kitchen headcount of a day: expected plates per meal, diets, away / opted out, served. */
    headcount: <T = KitchenDay>(
      hostelId: string,
      query?: Query<"/api/v1/hst/hostels/{id}/meals", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/hst/hostels/{id}/meals", {
          params: { path: { id: hostelId }, query },
        }),
      ),
    /** Record plates served for a meal (kept with the expected count). */
    recordService: <
      T = { expected: number; served: number; difference: number },
    >(
      hostelId: string,
      body: Body<"/api/v1/hst/hostels/{id}/meals/service", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/hst/hostels/{id}/meals/service", {
          params: { path: { id: hostelId } },
          body,
        }),
      ),
    /** Month report: meals skipped per resident, expected vs served. */
    report: <T = MessMonthReport>(
      hostelId: string,
      query: Query<"/api/v1/hst/hostels/{id}/meals/report", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/hst/hostels/{id}/meals/report", {
          params: { path: { id: hostelId }, query },
        }),
      ),
    /** Menu of the resident's hostel and meals skipped in the next 7 days (guardian / student / warden). */
    studentMeals: <T = StudentMeals>(studentId: string) =>
      unwrap<T>(
        client.GET("/api/v1/hst/students/{id}/meals", {
          params: { path: { id: studentId } },
        }),
      ),
    /** Skip meals; residents / guardians until the cutoff before the meal (the warden any time before it). */
    optOut: <T = { added: number; optOuts: OptOutRow[] }>(
      studentId: string,
      body: Body<"/api/v1/hst/students/{id}/meal-opt-outs", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hst/students/{id}/meal-opt-outs", {
          params: { path: { id: studentId } },
          body,
        }),
      ),
    /** Take a skipped meal back (until the cutoff). */
    cancelOptOut: <T = { removed: boolean }>(
      studentId: string,
      date: string,
      meal: Meal,
    ) =>
      unwrap<T>(
        client.DELETE("/api/v1/hst/students/{id}/meal-opt-outs/{date}/{meal}", {
          params: { path: { id: studentId, date, meal } },
        }),
      ),
  },
};
