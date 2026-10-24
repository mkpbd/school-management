"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRightIcon,
  CheckIcon,
  DownloadIcon,
  PencilIcon,
  ReceiptIcon,
  SchoolIcon,
  UploadIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, Suspense } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, type FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { DocumentUploadDialog } from "@/components/sis/document-upload-dialog";
import {
  asBody,
  GUARDIAN_FIELDS,
  openFile,
  STUDENT_EDIT_FIELDS,
  type AttendanceSummary,
  type GuardianLink,
  type Student360,
  type StudentDocument,
} from "@/components/sis/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Body } from "@/lib/api";
import { formatDate, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

type Dialog = "edit" | "guardian" | "enrol" | "transfer" | "document" | null;

const ENROL_FIELDS: FieldDef[] = [
  {
    name: "classSectionId",
    label: "Class section",
    type: "ref",
    ref: refs.sections,
    required: true,
  },
  {
    name: "startsOn",
    label: "Starts on",
    type: "date",
    defaultValue: todayISO(),
  },
  {
    name: "rollNo",
    label: "Roll no",
    type: "number",
    help: "Empty: next free roll number",
  },
];

const TRANSFER_FIELDS: FieldDef[] = [
  {
    name: "toClassSectionId",
    label: "To class section",
    type: "ref",
    ref: refs.sections,
    required: true,
  },
  {
    name: "onDate",
    label: "From date",
    type: "date",
    required: true,
    defaultValue: todayISO(),
  },
  { name: "reason", label: "Reason", type: "textarea", required: true },
];

function StudentPageContent() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [dialog, setDialog] = useState<Dialog>(null);
  const key = ["sis", "student", id];

  const q = useQuery({
    queryKey: key,
    queryFn: () => api.sis.students.get<Student360>(id),
  });
  const close = (open: boolean) => !open && setDialog(null);
  const refresh = { invalidate: [key, ["sis", "students"]], toastError: false };

  const update = useAction(
    (body: Record<string, unknown>) =>
      api.sis.students.update(
        id,
        asBody<Body<"/api/v1/sis/students/{id}", "patch">>(body),
        {
          rowVersion: q.data?.rowVersion ?? q.data?.data.student.rowVersion,
        },
      ),
    refresh,
  );
  const addGuardian = useAction(
    (body: Record<string, unknown>) =>
      api.sis.students.addGuardian(
        id,
        asBody<Body<"/api/v1/sis/students/{id}/guardians", "post">>(body),
      ),
    refresh,
  );
  const enrol = useAction(
    (body: Record<string, unknown>) =>
      api.sis.students.enrol(
        id,
        asBody<Body<"/api/v1/sis/students/{id}/enrolments", "post">>(body),
      ),
    refresh,
  );
  const transfer = useAction(
    (body: Record<string, unknown>) =>
      api.sis.students.transfer(
        id,
        asBody<Body<"/api/v1/sis/students/{id}/transfer", "post">>(body),
      ),
    refresh,
  );
  const verify = useAction(
    ({ docId, status }: { docId: string; status: "verified" | "rejected" }) =>
      api.sis.documents.verify(docId, { status }),
    { invalidate: [key], success: "Document updated" },
  );

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;

  const { student, guardians, currentEnrolment, enrolmentHistory, documents } =
    q.data.data;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {student.fullNameEn}
            <StatusBadge status={student.status} />
          </span>
        }
        description={
          <>
            <span className="font-mono">{student.admissionNo}</span>
            {student.fullNameBn && <> · {student.fullNameBn}</>}
          </>
        }
        actions={
          <>
            {can(me, "sis.student.edit") && (
              <Button variant="outline" onClick={() => setDialog("edit")}>
                <PencilIcon /> Edit
              </Button>
            )}
            {can(me, "sis.enrolment.edit") && (
              <Button variant="outline" onClick={() => setDialog("enrol")}>
                <SchoolIcon /> Enrol
              </Button>
            )}
            {currentEnrolment && can(me, "sis.enrolment.approve") && (
              <Button variant="outline" onClick={() => setDialog("transfer")}>
                <ArrowLeftRightIcon /> Transfer
              </Button>
            )}
            {student.familyId && can(me, "fee.billing.view") && (
              <Link
                href={`/dashboard/fees/statement?familyId=${student.familyId}`}
                className={buttonVariants({ variant: "outline" })}
              >
                <ReceiptIcon /> Family statement
              </Link>
            )}
          </>
        }
      />

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="guardians">
            Guardians ({guardians.length})
          </TabsTrigger>
          <TabsTrigger value="placements">Placements</TabsTrigger>
          <TabsTrigger value="documents">
            Documents ({documents.length})
          </TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardContent className="space-y-6">
              <DetailList
                items={[
                  ["First name", student.firstNameEn],
                  ["Last name", student.lastNameEn ?? "—"],
                  ["Preferred name", student.preferredName ?? "—"],
                  ["Gender", humanize(student.gender)],
                  ["Date of birth", formatDate(student.dateOfBirth)],
                  ["Birth certificate", student.hasBirthCert ? "On file" : "—"],
                  ["Nationality", student.nationality],
                  ["Religion", student.religion ?? "—"],
                  ["Blood group", student.bloodGroup ?? "—"],
                  [
                    "House",
                    student.houseId ? (
                      <RefLabel
                        key="house"
                        source={refs.houses}
                        id={student.houseId}
                      />
                    ) : (
                      "—"
                    ),
                  ],
                  ["Mother tongue", student.motherTongue ?? "—"],
                  ["Previous school", student.previousSchool ?? "—"],
                  ["Admitted on", formatDate(student.admittedOn)],
                  ["Left on", formatDate(student.leftOn)],
                ]}
              />
              <div className="rounded-lg border p-4">
                <div className="mb-2 text-sm font-medium">
                  Current placement
                </div>
                {currentEnrolment ? (
                  <DetailList
                    items={[
                      [
                        "Section",
                        <SectionName
                          key="s"
                          id={currentEnrolment.classSectionId}
                        />,
                      ],
                      ["Roll", currentEnrolment.rollNo ?? "—"],
                      ["Since", formatDate(currentEnrolment.startsOn)],
                    ]}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Not enrolled today.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="guardians">
          <Card>
            <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Guardians</CardTitle>
              {can(me, "sis.guardian.create") && (
                <Button variant="outline" onClick={() => setDialog("guardian")}>
                  <UserPlusIcon /> Add guardian
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <DataTable<GuardianLink>
                rows={guardians}
                empty="No guardians."
                columns={[
                  { key: "fullNameEn", label: "Name" },
                  { key: "relationship", label: "Relationship", type: "enum" },
                  { key: "phone", label: "Phone", type: "mono" },
                  { key: "email", label: "Email" },
                  { key: "isPrimaryContact", label: "Primary", type: "bool" },
                  { key: "isFeePayer", label: "Fee payer", type: "bool" },
                  { key: "canPickup", label: "Pickup", type: "bool" },
                  { key: "portalAccess", label: "Portal", type: "bool" },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="placements">
          <Card>
            <CardHeader>
              <CardTitle>Placement history</CardTitle>
              <CardDescription>
                Enrolments and transfers; earlier placements are kept.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                rows={enrolmentHistory}
                empty="Never enrolled."
                columns={[
                  {
                    key: "academicYearId",
                    label: "Year",
                    ref: refs.academicYears,
                  },
                  {
                    key: "classSectionId",
                    label: "Section",
                    ref: refs.sections,
                  },
                  { key: "campusId", label: "Campus", ref: refs.campuses },
                  { key: "rollNo", label: "Roll" },
                  { key: "startsOn", label: "From", type: "date" },
                  { key: "endsOn", label: "To", type: "date" },
                  { key: "status", label: "Status", type: "status" },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Documents</CardTitle>
              {can(me, "sis.document.create") && (
                <Button variant="outline" onClick={() => setDialog("document")}>
                  <UploadIcon /> Upload
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <DataTable<StudentDocument>
                rows={documents}
                empty="No documents."
                columns={[
                  { key: "docType", label: "Type", type: "enum" },
                  { key: "expiresOn", label: "Expires", type: "date" },
                  {
                    key: "verificationStatus",
                    label: "Verification",
                    type: "status",
                  },
                ]}
                actions={(d) => (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Download"
                      onClick={() => void openFile(d.fileId)}
                    >
                      <DownloadIcon />
                    </Button>
                    {can(me, "sis.document.approve") &&
                      d.verificationStatus !== "verified" && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Verify"
                          onClick={() =>
                            verify.mutate({ docId: d.id, status: "verified" })
                          }
                        >
                          <CheckIcon className="text-success" />
                        </Button>
                      )}
                    {can(me, "sis.document.approve") &&
                      d.verificationStatus !== "rejected" && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Reject"
                          onClick={() =>
                            verify.mutate({ docId: d.id, status: "rejected" })
                          }
                        >
                          <XIcon className="text-destructive" />
                        </Button>
                      )}
                  </>
                )}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance">
          <AttendanceCard studentId={id} />
        </TabsContent>
      </Tabs>

      <FormDialog
        open={dialog === "edit"}
        onOpenChange={close}
        title="Edit student"
        fields={STUDENT_EDIT_FIELDS}
        row={student}
        onSubmit={(body) => update.mutateAsync(body)}
      />
      <FormDialog
        open={dialog === "guardian"}
        onOpenChange={close}
        title="Add guardian"
        description="A phone already in this family links that guardian; a phone from another family is rejected."
        fields={GUARDIAN_FIELDS}
        submitLabel="Add"
        successMessage="Guardian added"
        onSubmit={(body) => addGuardian.mutateAsync(body)}
      />
      <FormDialog
        open={dialog === "enrol"}
        onOpenChange={close}
        title="Enrol in a class section"
        description="Placements cannot overlap; section capacity is checked."
        fields={ENROL_FIELDS}
        submitLabel="Enrol"
        successMessage="Enrolled"
        onSubmit={(body) => enrol.mutateAsync(body)}
      />
      <FormDialog
        open={dialog === "transfer"}
        onOpenChange={close}
        title="Transfer"
        description="Ends the current placement the day before and starts the new one."
        fields={TRANSFER_FIELDS}
        submitLabel="Transfer"
        successMessage="Transferred"
        onSubmit={(body) => transfer.mutateAsync(body)}
      />
      <DocumentUploadDialog
        studentId={id}
        open={dialog === "document"}
        onOpenChange={(open) => setDialog(open ? "document" : null)}
        onDone={() => void q.refetch()}
      />
    </>
  );
}

function SectionName({ id }: { id: string }) {
  const sections = useQuery({
    queryKey: ["ref", refs.sections.key],
    queryFn: refs.sections.load,
    staleTime: 60_000,
  });
  const row = sections.data?.find((r) => r.id === id);
  return <>{row ? refs.sections.label(row) : "…"}</>;
}

function AttendanceCard({ studentId }: { studentId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useQuery({
    queryKey: ["att", "summary", studentId, from, to],
    queryFn: () =>
      api.att.studentSummary<AttendanceSummary>(studentId, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
  });
  const s = q.data?.data;

  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Attendance</CardTitle>
          <CardDescription>
            Default: academic year to date. Late counts as present, half day as
            0.5.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Input
            type="date"
            aria-label="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            type="date"
            aria-label="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorAlert error={q.error} />
        ) : (
          s && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {formatDate(s.from)} – {formatDate(s.to)} · {s.countedDays}{" "}
                school days counted
              </p>
              <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
                <div className="stat">
                  <div className="stat-title">Attendance</div>
                  <div className="stat-value text-2xl">
                    {s.percent === null ? "—" : `${s.percent}%`}
                  </div>
                </div>
                {(
                  [
                    ["Present", s.present],
                    ["Absent", s.absent],
                    ["Late", s.late],
                    ["Leave", s.leave],
                    ["Half day", s.halfDay],
                    ["Excused", s.excused],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label} className="stat">
                    <div className="stat-title">{label}</div>
                    <div className="stat-value text-2xl">{n}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function StudentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StudentPageContent />
    </Suspense>
  );
}
