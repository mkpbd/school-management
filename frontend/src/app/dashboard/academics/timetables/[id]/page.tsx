"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  PlusIcon,
  SaveIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RefLabel, RefSelect, type FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  ConfirmButton,
  DetailList,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, isApiError, type Row } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { refs } from "@/lib/refs";

/** Bangladesh school week: Saturday (6) to Thursday (4); Friday (5) is the weekend. */
const DAYS: Array<[number, string]> = [
  [6, "Sat"],
  [0, "Sun"],
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
];
const ELECTIVES = "__electives";

interface Slot {
  dayOfWeek: number;
  periodDefinitionId: string;
  teachingGroupId: string;
  staffId: string;
  roomId?: string | null;
}

interface SlotView extends Slot {
  id: string;
  periodNo: number;
  periodLabel: string;
  startsAt: string;
  endsAt: string;
  groupName: string;
  subjectId: string;
}

/** Rows of a ref source (shared cache with the selects). */
const useRefRows = (source: (typeof refs)[keyof typeof refs]) =>
  useQuery({
    queryKey: ["ref", source.key],
    queryFn: source.load,
    staleTime: 60_000,
  });

export default function TimetablePage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [tab, setTab] = useState<"edit" | "view">("edit");

  const timetable = useQuery({
    queryKey: ["aca.timetables", "get", id],
    queryFn: async () => (await api.aca.timetables.get(id)).data,
  });
  const slots = useQuery({
    queryKey: ["aca.timetables", "slots", id],
    queryFn: async () =>
      (await api.aca.timetables.view<SlotView[]>(id, {})).data,
  });

  if (timetable.isPending) return <Loading />;
  if (timetable.isError) return <ErrorAlert error={timetable.error} />;

  const tt = timetable.data;
  const isDraft = tt.status === "draft";
  const canEdit = isDraft && can(me, "aca.timetable.edit");
  const activeTab = canEdit ? tab : "view";

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {String(tt.name)} <StatusBadge status={tt.status} />
          </span>
        }
        description={
          <Link
            href="/dashboard/academics/timetables"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <ArrowLeftIcon className="size-3" /> All timetables
          </Link>
        }
        actions={
          isDraft &&
          can(me, "aca.timetable.approve") && <PublishButton id={id} />
        }
      />
      <Card className="mb-6">
        <CardContent>
          <DetailList
            items={[
              [
                "Academic year",
                <RefLabel
                  key="y"
                  source={refs.academicYears}
                  id={tt.academicYearId}
                />,
              ],
              [
                "Campus",
                <RefLabel key="c" source={refs.campuses} id={tt.campusId} />,
              ],
              [
                "Effective",
                `${formatDate(tt.effectiveFrom)} – ${tt.effectiveTo ? formatDate(tt.effectiveTo) : "open"}`,
              ],
              ["Slots", slots.data?.length ?? "…"],
            ]}
          />
        </CardContent>
      </Card>

      {canEdit && (
        <div role="tablist" className="tabs tabs-box mb-4 w-fit">
          <button
            role="tab"
            className={`tab ${activeTab === "edit" ? "tab-active" : ""}`}
            onClick={() => setTab("edit")}
          >
            Edit slots
          </button>
          <button
            role="tab"
            className={`tab ${activeTab === "view" ? "tab-active" : ""}`}
            onClick={() => setTab("view")}
          >
            View
          </button>
        </div>
      )}

      {slots.isPending ? (
        <Loading />
      ) : slots.isError ? (
        <ErrorAlert error={slots.error} />
      ) : activeTab === "edit" ? (
        <SlotEditor
          key={slots.dataUpdatedAt}
          id={id}
          timetable={tt}
          initial={slots.data}
        />
      ) : (
        <TimetableView id={id} timetable={tt} />
      )}
    </>
  );
}

function PublishButton({ id }: { id: string }) {
  const publish = useAction(() => api.aca.timetables.publish(id), {
    success: "Timetable published",
    invalidate: [["aca.timetables"], ["aca.teacherLoad"]],
  });
  return (
    <ConfirmButton
      variant="default"
      size="default"
      title="Publish this timetable?"
      description="Published timetables can no longer be edited. They count towards teacher load and appear to staff and students."
      confirmLabel="Publish"
      onConfirm={() => publish.mutateAsync(undefined)}
    >
      <SendIcon /> Publish
    </ConfirmButton>
  );
}

// ---- editor ----

function SlotEditor({
  id,
  timetable,
  initial,
}: {
  id: string;
  timetable: Row;
  initial: SlotView[];
}) {
  const [draft, setDraft] = useState<Slot[]>(() =>
    initial.map(
      ({
        dayOfWeek,
        periodDefinitionId,
        teachingGroupId,
        staffId,
        roomId,
      }) => ({
        dayOfWeek,
        periodDefinitionId,
        teachingGroupId,
        staffId,
        roomId: roomId ?? null,
      }),
    ),
  );
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState("");
  const [schedule, setSchedule] = useState<"regular" | "ramadan">("regular");
  const [cell, setCell] = useState<{
    day: number;
    periodId: string;
    index: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const periods = useRefRows(refs.periods);
  const sections = useRefRows(refs.sections);
  const groups = useRefRows(refs.teachingGroups);

  const groupById = useMemo(
    () => new Map((groups.data ?? []).map((g) => [String(g.id), g])),
    [groups.data],
  );
  const sectionRow = (sections.data ?? []).find((s) => s.id === section);

  const columns = (periods.data ?? [])
    .filter(
      (p) =>
        p.campusId === timetable.campusId &&
        p.kind === "teaching" &&
        (p.scheduleCode ?? "regular") === schedule &&
        (!sectionRow?.shiftId || p.shiftId === sectionRow.shiftId),
    )
    .sort((a, b) => Number(a.periodNo) - Number(b.periodNo));

  /** Does a slot belong to the section (or to the electives view)? */
  const inView = (s: Slot) => {
    const g = groupById.get(s.teachingGroupId);
    return section === ELECTIVES
      ? !g?.classSectionId
      : g?.classSectionId === section;
  };

  const save = useAction(
    () =>
      api.aca.timetables.replaceSlots<{ slots: number }>(id, { slots: draft }),
    {
      invalidate: [["aca.timetables", "slots", id]],
      toastError: false,
    },
  );

  async function onSave() {
    setError(null);
    try {
      const r = await save.mutateAsync(undefined);
      toast.success(`${r.data.slots} slot(s) saved`);
      setDirty(false);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Something went wrong.");
    }
  }

  function update(next: Slot[]) {
    setDraft(next);
    setDirty(true);
  }

  const editing = cell && cell.index !== null ? draft[cell.index] : undefined;
  const slotFields: FieldDef[] = [
    {
      name: "teachingGroupId",
      label: "Teaching group",
      type: "ref",
      ref: refs.teachingGroups,
      required: true,
      wide: true,
      refFilter: (g) =>
        g.academicYearId === timetable.academicYearId &&
        (section === ELECTIVES
          ? !g.classSectionId
          : g.classSectionId === section),
    },
    {
      name: "staffId",
      label: "Teacher",
      type: "ref",
      ref: refs.staff,
      required: true,
      refFilter: (s) => s.staffType === "teaching",
    },
    {
      name: "roomId",
      label: "Room",
      type: "ref",
      ref: refs.rooms,
      refFilter: (r) => r.campusId === timetable.campusId,
      nullable: true,
    },
  ];

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Slots</CardTitle>
          <CardDescription>
            Pick a section, fill its week, then save. Saving replaces every slot
            of the timetable (all sections).
          </CardDescription>
        </div>
        <Button disabled={!dirty || save.isPending} onClick={onSave}>
          {save.isPending ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <SaveIcon />
          )}
          Save{dirty ? " changes" : ""}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div role="alert" className="alert alert-error alert-soft text-sm">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="Section"
            className="select select-sm h-8 sm:w-64"
            value={section}
            onChange={(e) => setSection(e.target.value)}
          >
            <option value="">Pick a section…</option>
            {(sections.data ?? [])
              .filter(
                (s) =>
                  s.academicYearId === timetable.academicYearId &&
                  s.campusId === timetable.campusId,
              )
              .map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {refs.sections.label(s)}
                </option>
              ))}
            <option value={ELECTIVES}>Elective groups (across sections)</option>
          </select>
          <select
            aria-label="Schedule"
            className="select select-sm h-8 sm:w-40"
            value={schedule}
            onChange={(e) =>
              setSchedule(e.target.value as "regular" | "ramadan")
            }
          >
            <option value="regular">Regular schedule</option>
            <option value="ramadan">Ramadan schedule</option>
          </select>
        </div>

        {!section ? (
          <Empty>Pick a section to edit its slots.</Empty>
        ) : periods.isPending || groups.isPending ? (
          <Loading />
        ) : columns.length === 0 ? (
          <Empty>
            No teaching periods for this campus
            {sectionRow?.shiftId ? " and shift" : ""}. Add them under{" "}
            <Link className="underline" href="/dashboard/academics/periods">
              Bell schedule
            </Link>
            .
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Day</th>
                  {columns.map((p) => (
                    <th key={String(p.id)} className="min-w-36">
                      <div>{String(p.label)}</div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {String(p.startsAt).slice(0, 5)}–
                        {String(p.endsAt).slice(0, 5)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map(([day, label]) => (
                  <tr key={day}>
                    <th>{label}</th>
                    {columns.map((p) => {
                      const items = draft
                        .map((s, index) => ({ s, index }))
                        .filter(
                          ({ s }) =>
                            s.dayOfWeek === day &&
                            s.periodDefinitionId === p.id &&
                            inView(s),
                        );
                      return (
                        <td key={String(p.id)} className="align-top">
                          <div className="flex flex-col gap-1">
                            {items.map(({ s, index }) => (
                              <div
                                key={index}
                                className="group flex items-start gap-1 rounded-md border bg-muted/40 p-1.5 text-xs"
                              >
                                <button
                                  type="button"
                                  className="flex-1 text-left"
                                  onClick={() =>
                                    setCell({
                                      day,
                                      periodId: String(p.id),
                                      index,
                                    })
                                  }
                                >
                                  <div className="font-medium">
                                    {String(
                                      groupById.get(s.teachingGroupId)?.name ??
                                        "?",
                                    )}
                                  </div>
                                  <div className="text-muted-foreground">
                                    <RefLabel
                                      source={refs.staff}
                                      id={s.staffId}
                                    />
                                  </div>
                                  {s.roomId && (
                                    <div className="text-muted-foreground">
                                      <RefLabel
                                        source={refs.rooms}
                                        id={s.roomId}
                                      />
                                    </div>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  aria-label="Remove slot"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() =>
                                    update(draft.filter((_, i) => i !== index))
                                  }
                                >
                                  <XIcon className="size-3" />
                                </button>
                              </div>
                            ))}
                            {(section === ELECTIVES || items.length === 0) && (
                              <Button
                                variant="ghost"
                                size="xs"
                                className="text-muted-foreground"
                                onClick={() =>
                                  setCell({
                                    day,
                                    periodId: String(p.id),
                                    index: null,
                                  })
                                }
                              >
                                <PlusIcon /> Add
                              </Button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <FormDialog
        open={cell !== null}
        onOpenChange={(open) => !open && setCell(null)}
        title={editing ? "Edit slot" : "Add slot"}
        description="Not saved until you press Save changes."
        fields={slotFields}
        row={editing ? (editing as unknown as Row) : undefined}
        submitLabel={editing ? "Apply" : "Add"}
        successMessage={
          editing ? "Slot updated (unsaved)" : "Slot added (unsaved)"
        }
        onSubmit={async (_body, values) => {
          const slot: Slot = {
            dayOfWeek: cell!.day,
            periodDefinitionId: cell!.periodId,
            teachingGroupId: String(values.teachingGroupId),
            staffId: String(values.staffId),
            roomId: values.roomId ? String(values.roomId) : null,
          };
          update(
            cell!.index === null
              ? [...draft, slot]
              : draft.map((s, i) => (i === cell!.index ? slot : s)),
          );
        }}
      />
    </Card>
  );
}

// ---- read-only view ----

function TimetableView({ id, timetable }: { id: string; timetable: Row }) {
  const [by, setBy] = useState<"classSectionId" | "staffId" | "roomId">(
    "classSectionId",
  );
  const [value, setValue] = useState("");
  const view = useQuery({
    queryKey: ["aca.timetables", "view", id, by, value],
    queryFn: async () =>
      (await api.aca.timetables.view<SlotView[]>(id, { [by]: value })).data,
    enabled: Boolean(value),
  });

  const source =
    by === "classSectionId"
      ? refs.sections
      : by === "staffId"
        ? refs.staff
        : refs.rooms;
  const rows = view.data ?? [];
  const periods = [
    ...new Map(rows.map((r) => [r.periodDefinitionId, r])).values(),
  ].sort((a, b) => a.periodNo - b.periodNo);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Timetable view</CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="View by"
            className="select select-sm h-8 sm:w-36"
            value={by}
            onChange={(e) => {
              setBy(e.target.value as typeof by);
              setValue("");
            }}
          >
            <option value="classSectionId">Section</option>
            <option value="staffId">Teacher</option>
            <option value="roomId">Room</option>
          </select>
          <div className="sm:w-64">
            <RefSelect
              source={source}
              value={value}
              onChange={setValue}
              filter={(r) =>
                by === "classSectionId"
                  ? r.academicYearId === timetable.academicYearId &&
                    r.campusId === timetable.campusId
                  : by === "roomId"
                    ? r.campusId === timetable.campusId
                    : true
              }
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!value ? (
          <Empty>Pick a section, teacher or room.</Empty>
        ) : view.isPending ? (
          <Loading />
        ) : view.isError ? (
          <ErrorAlert error={view.error} />
        ) : rows.length === 0 ? (
          <Empty>No slots.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Day</th>
                  {periods.map((p) => (
                    <th key={p.periodDefinitionId} className="min-w-32">
                      <div>{p.periodLabel}</div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {p.startsAt.slice(0, 5)}–{p.endsAt.slice(0, 5)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map(([day, label]) => (
                  <tr key={day}>
                    <th>{label}</th>
                    {periods.map((p) => (
                      <td key={p.periodDefinitionId} className="align-top">
                        {rows
                          .filter(
                            (r) =>
                              r.dayOfWeek === day &&
                              r.periodDefinitionId === p.periodDefinitionId,
                          )
                          .map((r) => (
                            <div
                              key={r.id}
                              className="mb-1 rounded-md border bg-muted/40 p-1.5 text-xs"
                            >
                              <div className="font-medium">{r.groupName}</div>
                              {by !== "staffId" && (
                                <div className="text-muted-foreground">
                                  <RefLabel
                                    source={refs.staff}
                                    id={r.staffId}
                                  />
                                </div>
                              )}
                              {by !== "roomId" && r.roomId && (
                                <div className="text-muted-foreground">
                                  <RefLabel source={refs.rooms} id={r.roomId} />
                                </div>
                              )}
                            </div>
                          ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
