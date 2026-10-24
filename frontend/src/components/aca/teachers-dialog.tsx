"use client";

import { useQuery } from "@tanstack/react-query";
import { UserMinusIcon, UserPlusIcon } from "lucide-react";
import { DataTable } from "@/components/crud/data-table";
import { ConfirmButton } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { api, type Row } from "@/lib/api";
import { refs } from "@/lib/refs";

interface GroupTeacher extends Row {
  staffId: string;
  role: "main" | "assistant";
  periodsPerWeek: number;
  validFrom: string;
  validTo: string | null;
}

/** Teachers allocated to a teaching group today, with "End" per allocation and a hand-off to allocate another. */
export function TeachersDialog({
  group,
  canEdit,
  onClose,
  onAllocate,
}: {
  group: Row | null;
  canEdit: boolean;
  onClose: () => void;
  onAllocate: (group: Row) => void;
}) {
  return (
    <Dialog open={group !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {group && (
          <TeachersBody
            group={group}
            canEdit={canEdit}
            onClose={onClose}
            onAllocate={onAllocate}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TeachersBody({
  group,
  canEdit,
  onClose,
  onAllocate,
}: {
  group: Row;
  canEdit: boolean;
  onClose: () => void;
  onAllocate: (group: Row) => void;
}) {
  const id = String(group.id);
  const teachers = useQuery({
    queryKey: ["aca.groupTeachers", id],
    queryFn: async () =>
      (await api.aca.teachingGroups.teachers<GroupTeacher[]>(id)).data,
  });
  const end = useAction(
    (staffId: string) => api.aca.teachingGroups.endTeacher(id, staffId),
    {
      success: "Allocation ended",
      invalidate: [["aca.groupTeachers"], ["aca.teacherLoad"]],
    },
  );

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Teachers of {String(group.name)}</DialogTitle>
        <DialogDescription>
          Current allocations. Ending one stops it from today; history is kept.
        </DialogDescription>
      </DialogHeader>
      <DataTable<GroupTeacher>
        rows={teachers.data}
        isPending={teachers.isPending}
        error={teachers.error}
        rowKey={(r) => `${r.staffId}-${r.validFrom}`}
        empty="No teacher allocated."
        columns={[
          { key: "staffId", label: "Teacher", ref: refs.staff },
          { key: "role", label: "Role", type: "enum" },
          { key: "periodsPerWeek", label: "Periods / week" },
          { key: "validFrom", label: "From", type: "date" },
          { key: "validTo", label: "Until", type: "date" },
        ]}
        actions={
          canEdit
            ? (r) =>
                r.validTo === null ? (
                  <ConfirmButton
                    size="xs"
                    destructive
                    title="End this allocation?"
                    description="The teacher no longer teaches this group from today."
                    confirmLabel="End allocation"
                    onConfirm={() => end.mutateAsync(r.staffId)}
                  >
                    <UserMinusIcon /> End
                  </ConfirmButton>
                ) : null
            : undefined
        }
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        {canEdit && (
          <Button onClick={() => onAllocate(group)}>
            <UserPlusIcon /> Allocate teacher
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
