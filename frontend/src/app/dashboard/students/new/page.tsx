"use client";

import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, Suspense } from "react";
import { toast } from "sonner";
import {
  buildBody,
  FieldInput,
  initialValues,
  type FieldDef,
  type FormValues,
} from "@/components/crud/fields";
import { PageHeader, Loading } from "@/components/page";
import {
  asBody,
  GUARDIAN_FIELDS,
  STUDENT_FIELDS,
  type Student360,
} from "@/components/sis/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api, isApiError, type Body } from "@/lib/api";
import { todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

type RegisterBody = Body<"/api/v1/sis/students", "post">;

const MAX_GUARDIANS = 6;

const ADMISSION_FIELDS: FieldDef[] = [
  {
    name: "campusId",
    label: "Campus",
    type: "ref",
    ref: refs.campuses,
    help: "Default: your active campus",
  },
  {
    name: "admittedOn",
    label: "Admitted on",
    type: "date",
    required: true,
    defaultValue: todayISO(),
  },
];

const ENROLMENT_FIELDS: FieldDef[] = [
  {
    name: "classSectionId",
    label: "Class section",
    type: "ref",
    ref: refs.sections,
    help: "Optional: enrol now",
  },
  {
    name: "rollNo",
    label: "Roll no",
    type: "number",
    help: "Empty: next free roll number",
  },
];

function newGuardian(first: boolean): FormValues {
  return {
    ...initialValues(GUARDIAN_FIELDS),
    preferredLocale: "bn",
    isPrimaryContact: first,
    isFeePayer: first,
    canPickup: true,
    portalAccess: first,
  };
}

function RegisterStudentPageContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // one key per form: a retry after a timeout replays instead of registering twice
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [admission, setAdmission] = useState<FormValues>(() =>
    initialValues(ADMISSION_FIELDS),
  );
  const [student, setStudent] = useState<FormValues>(() =>
    initialValues(STUDENT_FIELDS),
  );
  const [guardians, setGuardians] = useState<FormValues[]>(() => [
    newGuardian(true),
  ]);
  const [enrolment, setEnrolment] = useState<FormValues>(() =>
    initialValues(ENROLMENT_FIELDS),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const adm = buildBody(ADMISSION_FIELDS, admission);
    const enr = buildBody(ENROLMENT_FIELDS, enrolment);
    const body = {
      ...(adm.campusId ? { campusId: adm.campusId } : {}),
      student: {
        ...buildBody(STUDENT_FIELDS, student),
        admittedOn: adm.admittedOn,
      },
      guardians: guardians.map((g) => {
        // booleans are explicit here (the backend defaults differ per flag)
        const b = buildBody(GUARDIAN_FIELDS, g);
        for (const f of GUARDIAN_FIELDS)
          if (f.type === "boolean") b[f.name] = g[f.name] === true;
        return b;
      }),
      ...(enr.classSectionId ? { enrolment: enr } : {}),
    };
    try {
      const { data } = await api.sis.students.register<
        Pick<Student360, "student"> & { siblingFamily?: unknown }
      >(asBody<RegisterBody>(body), { idempotencyKey });
      toast.success(
        `Registered ${data.student.fullNameEn} (${data.student.admissionNo})${data.siblingFamily ? " — linked to an existing family" : ""}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["sis"] });
      router.push(`/dashboard/students/${data.student.id}`);
    } catch (err) {
      if (isApiError(err)) {
        const mapped: Record<string, string> = {};
        for (const [path, msg] of Object.entries(err.fieldErrors))
          mapped[path.replace(/^body\./, "")] = msg;
        setErrors(mapped);
        setFormError(err.message);
      } else {
        setFormError("Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }

  function grid(
    fields: FieldDef[],
    values: FormValues,
    set: (v: FormValues) => void,
    prefix = "",
  ) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <FieldInput
            key={f.name}
            field={f}
            value={values[f.name] ?? ""}
            values={values}
            error={errors[`${prefix}${f.name}`] ?? errors[f.name]}
            onChange={(v) => set({ ...values, [f.name]: v })}
          />
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <PageHeader
        title="Register student"
        description="Guardians are matched by phone: a known phone links the student to the existing family."
      />

      {formError && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {formError}
        </div>
      )}

      <ul className="steps steps-horizontal w-full text-xs">
        <li className="step step-primary">Admission</li>
        <li className="step step-primary">Student</li>
        <li className={`step ${guardians.length ? "step-primary" : ""}`}>
          Guardians
        </li>
        <li
          className={`step ${enrolment.classSectionId ? "step-primary" : ""}`}
        >
          Enrolment
        </li>
      </ul>

      <Card>
        <CardHeader>
          <CardTitle>Admission</CardTitle>
        </CardHeader>
        <CardContent>
          {grid(ADMISSION_FIELDS, admission, setAdmission, "student.")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Student</CardTitle>
        </CardHeader>
        <CardContent>
          {grid(STUDENT_FIELDS, student, setStudent, "student.")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Guardians</CardTitle>
            <CardDescription>
              1–{MAX_GUARDIANS}. The primary contact receives attendance and fee
              alerts.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={guardians.length >= MAX_GUARDIANS}
            onClick={() => setGuardians((g) => [...g, newGuardian(false)])}
          >
            <PlusIcon /> Add guardian
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {guardians.map((g, i) => (
            <fieldset key={i} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">
                  Guardian {i + 1}
                </legend>
                {guardians.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove guardian ${i + 1}`}
                    onClick={() =>
                      setGuardians((list) => list.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2Icon className="text-destructive" />
                  </Button>
                )}
              </div>
              {grid(
                GUARDIAN_FIELDS,
                g,
                (v) =>
                  setGuardians((list) => list.map((x, j) => (j === i ? v : x))),
                `guardians.${i}.`,
              )}
            </fieldset>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enrolment</CardTitle>
          <CardDescription>
            Optional. Capacity and roll numbers are checked by the server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {grid(ENROLMENT_FIELDS, enrolment, setEnrolment, "enrolment.")}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={busy}>
          {busy && <span className="loading loading-spinner loading-xs" />}
          Register
        </Button>
      </div>
    </form>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function RegisterStudentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RegisterStudentPageContent />
    </Suspense>
  );
}
