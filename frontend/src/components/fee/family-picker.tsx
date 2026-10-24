"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import type { StudentListItem } from "@/lib/api";
import {
  StudentPicker,
  useStudent360,
  type Student360,
} from "./student-picker";

/**
 * Family chooser: a student search (family resolved through the student 360), or a family id given in the URL.
 * Calls `onFamily` with the family id and, when known, the student 360 (guardians for "paid by").
 */
export function FamilyPicker({
  initialFamilyId,
  onFamily,
}: {
  initialFamilyId?: string | null;
  onFamily: (familyId: string | null, student?: Student360) => void;
}) {
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const s360 = useStudent360(student?.id);

  useEffect(() => {
    if (student && s360.data) onFamily(s360.data.student.familyId, s360.data);
    // onFamily is a setter-like callback from the page; re-run only when the resolved student changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, s360.data]);

  return (
    <div className="space-y-1.5">
      <Label>Family (search a student)</Label>
      <StudentPicker
        value={student}
        onChange={(s) => {
          setStudent(s);
          if (!s) onFamily(initialFamilyId ?? null);
        }}
      />
      {student && s360.isPending && (
        <p className="text-xs text-muted-foreground">Finding family…</p>
      )}
      {s360.isError && (
        <p className="text-xs text-destructive">{s360.error.message}</p>
      )}
      {!student && initialFamilyId && (
        <p className="text-xs text-muted-foreground">
          Family <span className="font-mono">{initialFamilyId}</span> from the
          link.
        </p>
      )}
    </div>
  );
}
