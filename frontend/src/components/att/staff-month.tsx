"use client";

import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/crud/data-table";
import { ErrorAlert, Loading } from "@/components/page";
import { api } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import {
  explain,
  toDhakaTime,
  type StaffDayRow,
  type StaffMonth,
} from "./shared";

const minutes = (m: number) => (m ? `${m} min` : "—");

/** Days and payroll summary of a staff member's month (GET /att/staff-month; own month without staffId). */
export function StaffMonthView({
  staffId,
  month,
}: {
  staffId?: string;
  month: string;
}) {
  const q = useQuery({
    queryKey: ["att", "staffMonth", staffId ?? "me", month],
    queryFn: () =>
      api.att.staff.month<StaffMonth>({
        month,
        ...(staffId ? { staffId } : {}),
      }),
    enabled: /^\d{4}-\d{2}$/.test(month),
    retry: false,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={new Error(explain(q.error))} />;
  const { summary: s, days } = q.data.data;
  const stats: Array<[string, string | number, string?]> = [
    ["Present", s.present],
    ["Late", s.late, s.late ? "text-warning" : ""],
    ["Absent", s.absent, s.absent ? "text-error" : ""],
    ["Half day", s.halfDay],
    ["Paid leave", s.paidLeave],
    ["Unpaid leave", s.unpaidLeave],
    ["On duty", s.onDuty],
    ["Overtime", `${(s.overtimeMinutes / 60).toFixed(1)} h`],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {stats.map(([label, value, tone]) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`text-lg font-semibold tabular-nums ${tone ?? ""}`}>
              {value}
            </div>
          </div>
        ))}
      </div>
      <div role="status" className="alert alert-soft text-sm">
        <span>
          <b>{s.lwpDays}</b> day(s) without pay for payroll — unpaid leave{" "}
          {s.lwpBreakdown.unpaidLeave}, absent {s.lwpBreakdown.absent}, half
          days {s.lwpBreakdown.halfDay}, lates {s.lwpBreakdown.late}.
        </span>
      </div>
      <DataTable<StaffDayRow>
        rows={days}
        rowKey={(d) => d.attendanceDate}
        empty="No attendance recorded this month."
        columns={[
          {
            key: "attendanceDate",
            label: "Date",
            render: (d) => formatDate(d.attendanceDate),
          },
          { key: "status", label: "Status", type: "status" },
          {
            key: "checkInAt",
            label: "In",
            render: (d) => toDhakaTime(d.checkInAt) || "—",
          },
          {
            key: "checkOutAt",
            label: "Out",
            render: (d) => toDhakaTime(d.checkOutAt) || "—",
          },
          {
            key: "lateMinutes",
            label: "Late",
            render: (d) => minutes(d.lateMinutes),
          },
          {
            key: "earlyLeaveMinutes",
            label: "Early leave",
            render: (d) => minutes(d.earlyLeaveMinutes),
          },
          {
            key: "overtimeMinutes",
            label: "Overtime",
            render: (d) => minutes(d.overtimeMinutes),
          },
          { key: "source", label: "Source", render: (d) => humanize(d.source) },
        ]}
      />
    </div>
  );
}
