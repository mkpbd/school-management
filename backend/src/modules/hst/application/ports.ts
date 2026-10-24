import type { HostelGender, OutpassStatus, RollStatus, RoomType } from '../domain/hostel.js';

export interface HostelRow {
  id: string;
  campusId: string;
  code: string;
  name: string;
  gender: HostelGender;
  wardenStaffId: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface BedRow {
  id: string;
  code: string;
  isActive: boolean;
  roomId: string;
  roomCode: string;
  roomType: RoomType;
  monthlyFeePaisa: number;
  roomActive: boolean;
  hostelId: string;
  campusId: string;
}

export interface AllocationRow {
  id: string;
  campusId: string;
  hostelId: string;
  bedId: string;
  studentId: string;
  enrolmentId: string;
  validFrom: string;
  validTo: string | null;
  mealPlan: 'full' | 'none';
  monthlyFeePaisa: number;
  mealFeePaisa: number;
}

export interface ResidentRow {
  allocationId: string;
  studentId: string;
  mealPlan: 'full' | 'none';
  diet: 'regular' | 'vegetarian' | 'no_beef' | 'diabetic' | 'gluten_free' | 'other';
  dietNote: string | null;
  bedId: string;
  bedCode: string;
  roomId: string;
  roomCode: string;
  floor: number;
  validFrom: string;
}

export interface OccupancyRoom {
  roomId: string;
  code: string;
  floor: number;
  roomType: RoomType;
  monthlyFeePaisa: number;
  beds: Array<{
    bedId: string;
    code: string;
    isActive: boolean;
    studentId: string | null;
    allocationId: string | null;
  }>;
}

export interface OutpassRow {
  id: string;
  campusId: string;
  hostelId: string;
  studentId: string;
  kind: string;
  destination: string;
  reason: string | null;
  escortName: string | null;
  escortPhone: string | null;
  outFrom: Date;
  returnBy: Date;
  requestedBy: string | null;
  requestedByType: 'guardian' | 'staff';
  status: OutpassStatus;
  decidedAt: Date | null;
  decisionNote: string | null;
  checkedOutAt: Date | null;
  checkedInAt: Date | null;
  overdueNotifiedAt: Date | null;
}

export interface RollRow {
  studentId: string;
  status: RollStatus;
  note: string | null;
  markedAt: Date;
}

export interface VisitorRow {
  id: string;
  hostelId: string;
  studentId: string;
  visitorName: string;
  relation: string;
  phone: string | null;
  purpose: string | null;
  inAt: Date;
  outAt: Date | null;
}

export interface HstRepository {
  hostel(id: string): Promise<HostelRow | null>;
  hostels(campusId?: string): Promise<HostelRow[]>;
  insertRoom(values: Record<string, unknown>): Promise<string>;
  insertBeds(rows: Array<Record<string, unknown>>): Promise<number>;
  room(id: string): Promise<{ id: string; hostelId: string; campusId: string; code: string } | null>;
  bed(id: string): Promise<BedRow | null>;
  occupancy(hostelId: string, onDate: string): Promise<OccupancyRoom[]>;
  // allocations
  activeAllocationOf(studentId: string, onDate: string): Promise<AllocationRow | null>;
  allocation(id: string, forUpdate: boolean): Promise<AllocationRow | null>;
  insertAllocation(values: Record<string, unknown>): Promise<string>;
  endAllocation(id: string, validTo: string, reason: string): Promise<void>;
  residents(hostelId: string, onDate: string): Promise<ResidentRow[]>;
  // roll call
  rollCall(hostelId: string, date: string, session: 'morning' | 'night'): Promise<RollRow[]>;
  upsertRollCall(rows: Array<Record<string, unknown>>): Promise<void>;
  // out-passes
  insertOutpass(values: Record<string, unknown>): Promise<string>;
  outpass(id: string, forUpdate: boolean): Promise<OutpassRow | null>;
  updateOutpass(id: string, patch: Record<string, unknown>): Promise<void>;
  outpasses(f: { hostelId?: string; studentId?: string; status?: string; limit: number }): Promise<OutpassRow[]>;
  overlappingOutpass(studentId: string, from: Date, to: Date): Promise<boolean>;
  studentsOut(hostelId: string): Promise<string[]>;
  overdueOutpasses(now: Date, limit: number): Promise<OutpassRow[]>;
  // visitors
  insertVisitor(values: Record<string, unknown>): Promise<string>;
  visitor(id: string): Promise<VisitorRow | null>;
  setVisitorOut(id: string, at: Date): Promise<boolean>;
  visitors(f: { hostelId?: string; studentId?: string; from?: Date; to?: Date; limit: number }): Promise<VisitorRow[]>;
}
