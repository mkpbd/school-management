"use client";

import { useQuery } from "@tanstack/react-query";
import { SearchIcon, XIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type StudentListItem } from "@/lib/api";

/** Student 360 (GET /sis/students/:id), the parts the fee pages need. */
export type Student360 = {
  student: {
    id: string;
    familyId: string;
    fullNameEn?: string;
    admissionNo?: string;
    campusId: string;
  };
  guardians: Array<{
    id: string;
    fullNameEn: string;
    phone?: string;
    isFeePayer?: boolean;
    isPrimaryContact?: boolean;
  }>;
  currentEnrolment: {
    id: string;
    academicYearId: string;
    classSectionId: string;
    yearGroupId: string;
  } | null;
  enrolmentHistory: Array<{
    id: string;
    academicYearId: string;
    classSectionId: string;
    status: string;
    startsOn: string;
  }>;
};

export function useStudent360(studentId: string | undefined) {
  return useQuery({
    queryKey: ["sis.students", "get", studentId],
    queryFn: async () =>
      (await api.sis.students.get<Student360>(studentId!)).data,
    enabled: Boolean(studentId),
  });
}

/** Search-as-you-type student picker (name, admission no). */
export function StudentPicker({
  value,
  onChange,
  placeholder = "Search student by name or admission no",
}: {
  value: StudentListItem | null;
  onChange: (student: StudentListItem | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const results = useQuery({
    queryKey: ["sis.students", "picker", search],
    queryFn: async () =>
      (await api.sis.students.search({ q: search, limit: 10 })).data,
    enabled: search.length >= 2 && !value,
  });

  if (value) {
    return (
      <div className="flex h-8 items-center justify-between gap-2 rounded-lg border px-2.5 text-sm">
        <span className="truncate">
          {value.fullNameEn}{" "}
          <span className="font-mono text-xs text-muted-foreground">
            {value.admissionNo}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Clear student"
          onClick={() => onChange(null)}
        >
          <XIcon />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-8"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {search.length >= 2 && (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
          {results.isPending && (
            <li className="p-2 text-muted-foreground">
              <span className="loading loading-spinner loading-xs" />
            </li>
          )}
          {results.isError && (
            <li className="p-2 text-destructive">{results.error.message}</li>
          )}
          {results.data?.length === 0 && (
            <li className="p-2 text-muted-foreground">No students found.</li>
          )}
          {results.data?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => {
                  onChange(s);
                  setQ("");
                }}
              >
                {s.fullNameEn}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {s.admissionNo}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
