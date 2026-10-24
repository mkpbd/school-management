"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  PlusIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type {
  AdmissionFormSetup,
  AdmissionTracking,
  DraftApplication,
  DraftApplicationBody,
} from "@/lib/api/services/adm-public";
import {
  CampaignNote,
  Choice,
  CopyButton,
  defaultChoice,
  ErrorBanner,
  Field,
  formatLongDate,
  Honeypot,
  inputClass,
  isEmail,
  LOCALES,
  normalisePhone,
  opt,
  PHONE_ERROR,
  problemMessage,
  SectionTitle,
  serverFieldErrors,
  SubmitSpinner,
  type FieldErrors,
} from "./common";
import { Turnstile } from "./turnstile";

// ---------------------------------------------------------------- values

type Relationship = "father" | "mother" | "guardian" | "other";

interface GuardianValues {
  name: string;
  relationship: string;
  phone: string;
  email: string;
  occupation: string;
}

export interface ApplicationValues {
  campusId: string;
  academicYearId: string;
  yearGroupId: string;
  childFirstName: string;
  childLastName: string;
  childNameBn: string;
  childGender: string;
  childDob: string;
  previousSchool: string;
  guardians: GuardianValues[];
  address: string;
  medicalNotes: string;
  locale: string;
  /** extra form answers of a draft, sent back unchanged */
  answers: Record<string, string>;
}

const MAX_GUARDIANS = 3;
const emptyGuardian = (relationship = ""): GuardianValues => ({
  name: "",
  relationship,
  phone: "",
  email: "",
  occupation: "",
});

export function newApplication(setup: AdmissionFormSetup): ApplicationValues {
  return {
    ...defaultChoice(setup),
    yearGroupId: "",
    childFirstName: "",
    childLastName: "",
    childNameBn: "",
    childGender: "",
    childDob: "",
    previousSchool: "",
    guardians: [emptyGuardian()],
    address: "",
    medicalNotes: "",
    locale: "en",
    answers: {},
  };
}

/** Form values of a saved draft; choices no longer offered (e.g. a closed year) are cleared. */
export function draftValues(
  draft: DraftApplication,
  setup: AdmissionFormSetup,
): ApplicationValues {
  const keep = (id: string, list: Array<{ id: string }>) =>
    list.some((x) => x.id === id) ? id : "";
  const f = draft.formData ?? {};
  const guardians = (f.guardians ?? []).slice(0, MAX_GUARDIANS).map((g) => ({
    name: g.name ?? "",
    relationship: g.relationship ?? "",
    phone: g.phone ?? "",
    email: g.email ?? "",
    occupation: g.occupation ?? "",
  }));
  return {
    campusId: keep(draft.campusId, setup.campuses),
    academicYearId: keep(draft.academicYearId, setup.academicYears),
    yearGroupId: keep(draft.yearGroupId, setup.yearGroups),
    childFirstName: draft.childFirstName ?? "",
    childLastName: draft.childLastName ?? "",
    childNameBn: draft.childNameBn ?? "",
    childGender: draft.childGender ?? "",
    childDob: draft.childDob?.slice(0, 10) ?? "",
    previousSchool: draft.previousSchool ?? "",
    guardians: guardians.length ? guardians : [emptyGuardian()],
    address: f.address ?? "",
    medicalNotes: f.medicalNotes ?? "",
    locale: f.locale === "bn" ? "bn" : "en",
    answers: f.answers ?? {},
  };
}

type ApplicationFields = Omit<DraftApplicationBody, "submit">;

/** Request body (shared by POST and PUT). Call after `validate` passed. */
function toBody(v: ApplicationValues): ApplicationFields {
  return {
    campusId: v.campusId,
    academicYearId: v.academicYearId,
    yearGroupId: v.yearGroupId,
    childFirstName: v.childFirstName.trim(),
    childLastName: opt(v.childLastName),
    childNameBn: opt(v.childNameBn),
    childGender: v.childGender === "female" ? "female" : "male",
    childDob: v.childDob,
    previousSchool: opt(v.previousSchool),
    guardians: v.guardians.map((g) => ({
      name: g.name.trim(),
      relationship: g.relationship as Relationship,
      phone: normalisePhone(g.phone) ?? g.phone.trim(),
      email: opt(g.email),
      occupation: opt(g.occupation),
    })),
    address: opt(v.address),
    medicalNotes: opt(v.medicalNotes),
    ...(Object.keys(v.answers).length ? { answers: v.answers } : {}),
    locale: v.locale === "bn" ? "bn" : "en",
  };
}

function validate(v: ApplicationValues): FieldErrors {
  const e: FieldErrors = {};
  const today = new Date().toISOString().slice(0, 10);
  if (v.childFirstName.trim().length < 2)
    e.childFirstName = "Enter the child's first name / প্রথম নাম লিখুন";
  if (!v.childGender) e.childGender = "Choose one / একটি বাছাই করুন";
  if (!v.childDob) e.childDob = "Enter the date of birth / জন্ম তারিখ দিন";
  else if (v.childDob >= today)
    e.childDob = "The date of birth must be in the past";
  if (!v.campusId) e.campusId = "Choose a campus / ক্যাম্পাস বাছাই করুন";
  if (!v.academicYearId)
    e.academicYearId = "Choose the academic year / শিক্ষাবর্ষ বাছাই করুন";
  if (!v.yearGroupId) e.yearGroupId = "Choose a class / শ্রেণি বাছাই করুন";
  v.guardians.forEach((g, i) => {
    if (g.name.trim().length < 2)
      e[`guardians.${i}.name`] = "Enter the name / নাম লিখুন";
    if (!g.relationship)
      e[`guardians.${i}.relationship`] = "Choose the relationship / সম্পর্ক";
    if (!normalisePhone(g.phone)) e[`guardians.${i}.phone`] = PHONE_ERROR;
    if (g.email.trim() && !isEmail(g.email))
      e[`guardians.${i}.email`] = "Enter a valid e-mail / সঠিক ই-মেইল দিন";
  });
  return e;
}

// ---------------------------------------------------------------- steps

const STEPS = [
  {
    title: "Child",
    bn: "শিক্ষার্থী",
    fields: [
      "childFirstName",
      "childLastName",
      "childNameBn",
      "childGender",
      "childDob",
      "previousSchool",
    ],
  },
  {
    title: "Class",
    bn: "শ্রেণি",
    fields: ["campusId", "academicYearId", "yearGroupId"],
  },
  { title: "Parents", bn: "অভিভাবক", fields: ["guardians"] },
  {
    title: "Address & health",
    bn: "ঠিকানা ও স্বাস্থ্য",
    fields: ["address", "medicalNotes", "locale", "answers"],
  },
  { title: "Review", bn: "যাচাই", fields: [] as string[] },
] as const;
const REVIEW = STEPS.length - 1;

function stepOf(key: string): number {
  const i = STEPS.findIndex((s) =>
    (s.fields as readonly string[]).some(
      (f) => key === f || key.startsWith(`${f}.`),
    ),
  );
  return i < 0 ? REVIEW : i;
}

const errorsOfStep = (errors: FieldErrors, step: number) =>
  Object.fromEntries(
    Object.entries(errors).filter(([k]) => stepOf(k) === step),
  );

const GENDERS = [
  { value: "male", label: "Boy / ছেলে" },
  { value: "female", label: "Girl / মেয়ে" },
];
const RELATIONSHIPS = [
  { value: "father", label: "Father / বাবা" },
  { value: "mother", label: "Mother / মা" },
  { value: "guardian", label: "Guardian / অভিভাবক" },
  { value: "other", label: "Other / অন্যান্য" },
];

// ---------------------------------------------------------------- wizard

export interface ResumeLink {
  token: string;
  expiresAt: string | null;
}

/**
 * Multi-step online application. Without `resume` the first save / submit is a POST (form token, honeypot,
 * captcha, tracking); once a draft exists (or on the resume page) it saves with PUT on the secret link.
 */
export function ApplicationWizard({
  setup,
  tracking,
  initial,
  resume: resumeProp = null,
}: {
  setup: AdmissionFormSetup;
  tracking?: AdmissionTracking;
  initial: ApplicationValues;
  resume?: ResumeLink | null;
}) {
  const [v, setV] = useState(initial);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [resume, setResume] = useState<ResumeLink | null>(resumeProp);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submitted, setSubmitted] = useState<{ no: string | null } | null>(
    null,
  );
  const [website, setWebsite] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaRound, setCaptchaRound] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const isNew = resume === null;
  const needsCaptcha = isNew && !!setup.captchaSiteKey;

  // warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update(patch: Partial<ApplicationValues>) {
    setV((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }
  const set = (key: keyof ApplicationValues) => (value: string) =>
    update({ [key]: value });
  const setGuardian = (i: number, patch: Partial<GuardianValues>) =>
    update({
      guardians: v.guardians.map((g, j) => (j === i ? { ...g, ...patch } : g)),
    });

  function goTo(next: number) {
    setStep(next);
    setAlert(null);
    requestAnimationFrame(() => {
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      heading.current?.focus({ preventScroll: true });
    });
  }

  function next() {
    const stepErrors = errorsOfStep(validate(v), step);
    setErrors((prev) => ({
      ...Object.fromEntries(
        Object.entries(prev).filter(([k]) => stepOf(k) !== step),
      ),
      ...stepErrors,
    }));
    if (Object.keys(stepErrors).length) {
      setAlert("Please check the highlighted fields. / চিহ্নিত ঘরগুলো দেখে নিন।");
      return;
    }
    goTo(step + 1);
  }

  /** Validates everything; on errors jumps to the first step that has one. */
  function checkAll(intro: string): boolean {
    const found = validate(v);
    setErrors(found);
    const keys = Object.keys(found);
    if (!keys.length) return true;
    goTo(Math.min(...keys.map(stepOf)));
    setAlert(intro);
    return false;
  }

  function failed(err: unknown) {
    const fieldErrors = serverFieldErrors(err);
    setErrors(fieldErrors);
    const keys = Object.keys(fieldErrors);
    if (keys.length) goTo(Math.min(...keys.map(stepOf)));
    setAlert(problemMessage(err));
    if (isNew) {
      setCaptchaToken(""); // single-use
      setCaptchaRound((n) => n + 1);
    }
  }

  async function save(submit: boolean) {
    if (
      !checkAll(
        submit
          ? "Some details are missing. Please check the highlighted fields."
          : "To save for later, we need at least the child's details, the class and one parent or guardian.",
      )
    )
      return;
    const body = toBody(v);
    setBusy(submit ? "submit" : "save");
    setAlert(null);
    try {
      if (isNew) {
        const { data } = await api.adm.publicForm.apply({
          ...body,
          token: setup.token,
          website,
          ...(captchaToken ? { captchaToken } : {}),
          ...(tracking ? { tracking } : {}),
          draft: !submit,
        });
        if (submit || data.status === "submitted") {
          setSubmitted({ no: data.applicationNo });
        } else {
          if (data.resumeToken)
            setResume({
              token: data.resumeToken,
              expiresAt: data.resumeExpiresAt,
            });
          else {
            // answered without a link: start over next time with a fresh captcha
            setCaptchaToken("");
            setCaptchaRound((n) => n + 1);
          }
          setSavedAt(new Date());
        }
      } else {
        const { data } = await api.adm.publicForm.saveDraft(resume.token, {
          ...body,
          submit,
        });
        if (data.status === "submitted")
          setSubmitted({ no: data.applicationNo });
        else setSavedAt(new Date());
      }
      setDirty(false);
      setErrors({});
      requestAnimationFrame(() =>
        top.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (err) {
      failed(err);
    } finally {
      setBusy(null);
    }
  }

  if (submitted) return <ApplicationThanks applicationNo={submitted.no} />;

  const s = STEPS[step]!;
  const err = (k: string) => errors[k];

  return (
    <div ref={top} className="relative scroll-mt-20 space-y-5">
      {setup.campaign && isNew && <CampaignNote name={setup.campaign.name} />}
      {savedAt && (
        <SavedPanel resume={resume} onClose={() => setSavedAt(null)} />
      )}

      <StepNav current={step} onSelect={goTo} errors={errors} />

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step === REVIEW) void save(true);
          else next();
        }}
        className="space-y-6"
      >
        <fieldset className="space-y-4">
          <legend className="sr-only">
            {s.title} / {s.bn}
          </legend>
          <h2
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            {step + 1}. {s.title}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {s.bn}
            </span>
          </h2>

          {alert && <ErrorBanner>{alert}</ErrorBanner>}

          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="First name"
                bn="প্রথম নাম (ইংরেজিতে)"
                required
                error={err("childFirstName")}
              >
                {(p) => (
                  <Input
                    {...p}
                    className={inputClass}
                    maxLength={120}
                    autoComplete="off"
                    value={v.childFirstName}
                    onChange={(e) => set("childFirstName")(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Last name"
                bn="শেষ নাম"
                error={err("childLastName")}
              >
                {(p) => (
                  <Input
                    {...p}
                    className={inputClass}
                    maxLength={100}
                    autoComplete="off"
                    value={v.childLastName}
                    onChange={(e) => set("childLastName")(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Name in Bangla"
                bn="বাংলায় নাম"
                error={err("childNameBn")}
                className="sm:col-span-2"
              >
                {(p) => (
                  <Input
                    {...p}
                    lang="bn"
                    className={inputClass}
                    maxLength={200}
                    autoComplete="off"
                    value={v.childNameBn}
                    onChange={(e) => set("childNameBn")(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Gender"
                bn="লিঙ্গ"
                required
                error={err("childGender")}
              >
                {(p) => (
                  <Choice
                    {...p}
                    value={v.childGender}
                    onChange={set("childGender")}
                    options={GENDERS}
                  />
                )}
              </Field>
              <Field
                label="Date of birth"
                bn="জন্ম তারিখ"
                required
                error={err("childDob")}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    className={inputClass}
                    value={v.childDob}
                    onChange={(e) => set("childDob")(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Previous school"
                bn="পূর্ববর্তী বিদ্যালয়"
                error={err("previousSchool")}
                className="sm:col-span-2"
              >
                {(p) => (
                  <Input
                    {...p}
                    className={inputClass}
                    maxLength={200}
                    value={v.previousSchool}
                    onChange={(e) => set("previousSchool")(e.target.value)}
                  />
                )}
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Campus"
                bn="ক্যাম্পাস"
                required
                error={err("campusId")}
              >
                {(p) => (
                  <Choice
                    {...p}
                    value={v.campusId}
                    onChange={set("campusId")}
                    options={setup.campuses.map((c) => ({
                      value: c.id,
                      label: c.nameBn ? `${c.nameEn} / ${c.nameBn}` : c.nameEn,
                    }))}
                  />
                )}
              </Field>
              <Field
                label="Academic year"
                bn="শিক্ষাবর্ষ"
                required
                error={err("academicYearId")}
              >
                {(p) => (
                  <Choice
                    {...p}
                    value={v.academicYearId}
                    onChange={set("academicYearId")}
                    options={setup.academicYears.map((y) => ({
                      value: y.id,
                      label: y.code,
                    }))}
                  />
                )}
              </Field>
              <Field
                label="Class applying for"
                bn="যে শ্রেণিতে ভর্তি হতে চায়"
                required
                error={err("yearGroupId")}
                className="sm:col-span-2"
              >
                {(p) => (
                  <Choice
                    {...p}
                    value={v.yearGroupId}
                    onChange={set("yearGroupId")}
                    options={setup.yearGroups.map((g) => ({
                      value: g.id,
                      label: g.nameEn,
                    }))}
                  />
                )}
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {err("guardians") && (
                <ErrorBanner>{err("guardians")}</ErrorBanner>
              )}
              <p className="text-sm text-muted-foreground">
                Add 1 to 3 parents or guardians. The first one receives the
                SMS and e-mail updates.
              </p>
              {v.guardians.map((g, i) => (
                <fieldset
                  key={i}
                  className="space-y-4 rounded-xl border p-4"
                  aria-label={`Parent or guardian ${i + 1}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <SectionTitle
                      title={
                        i === 0
                          ? "Main contact"
                          : `Parent / guardian ${i + 1}`
                      }
                      bn={i === 0 ? "প্রধান যোগাযোগ" : `অভিভাবক ${i + 1}`}
                    />
                    {i > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          update({
                            guardians: v.guardians.filter((_, j) => j !== i),
                          })
                        }
                      >
                        <Trash2Icon /> Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Full name"
                      bn="পূর্ণ নাম"
                      required
                      error={err(`guardians.${i}.name`)}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          className={inputClass}
                          maxLength={120}
                          autoComplete={i === 0 ? "name" : "off"}
                          value={g.name}
                          onChange={(e) =>
                            setGuardian(i, { name: e.target.value })
                          }
                        />
                      )}
                    </Field>
                    <Field
                      label="Relationship to the child"
                      bn="শিশুর সাথে সম্পর্ক"
                      required
                      error={err(`guardians.${i}.relationship`)}
                    >
                      {(p) => (
                        <Choice
                          {...p}
                          value={g.relationship}
                          onChange={(x) => setGuardian(i, { relationship: x })}
                          options={RELATIONSHIPS}
                        />
                      )}
                    </Field>
                    <Field
                      label="Mobile number"
                      bn="মোবাইল নম্বর"
                      required
                      hint="e.g. 01712345678"
                      error={err(`guardians.${i}.phone`)}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          type="tel"
                          inputMode="tel"
                          autoComplete={i === 0 ? "tel" : "off"}
                          placeholder="01XXXXXXXXX"
                          className={inputClass}
                          value={g.phone}
                          onChange={(e) =>
                            setGuardian(i, { phone: e.target.value })
                          }
                          onBlur={() => {
                            const n = normalisePhone(g.phone);
                            if (n && n !== g.phone) setGuardian(i, { phone: n });
                          }}
                        />
                      )}
                    </Field>
                    <Field
                      label="E-mail"
                      bn="ই-মেইল"
                      error={err(`guardians.${i}.email`)}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          type="email"
                          inputMode="email"
                          autoComplete={i === 0 ? "email" : "off"}
                          maxLength={200}
                          className={inputClass}
                          value={g.email}
                          onChange={(e) =>
                            setGuardian(i, { email: e.target.value })
                          }
                        />
                      )}
                    </Field>
                    <Field
                      label="Occupation"
                      bn="পেশা"
                      error={err(`guardians.${i}.occupation`)}
                      className="sm:col-span-2"
                    >
                      {(p) => (
                        <Input
                          {...p}
                          className={inputClass}
                          maxLength={100}
                          value={g.occupation}
                          onChange={(e) =>
                            setGuardian(i, { occupation: e.target.value })
                          }
                        />
                      )}
                    </Field>
                  </div>
                </fieldset>
              ))}
              {v.guardians.length < MAX_GUARDIANS && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() =>
                    update({ guardians: [...v.guardians, emptyGuardian()] })
                  }
                >
                  <PlusIcon /> Add another parent / guardian
                </Button>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4">
              <Field
                label="Home address"
                bn="বাসার ঠিকানা"
                error={err("address")}
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={3}
                    maxLength={1000}
                    autoComplete="street-address"
                    value={v.address}
                    onChange={(e) => set("address")(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Medical notes"
                bn="স্বাস্থ্য সংক্রান্ত তথ্য"
                hint="Allergies, conditions, medicines or support the school should know about."
                error={err("medicalNotes")}
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={3}
                    maxLength={2000}
                    value={v.medicalNotes}
                    onChange={(e) => set("medicalNotes")(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Language for SMS and e-mail"
                bn="এসএমএস ও ই-মেইলের ভাষা"
                required
                error={err("locale")}
                className="sm:max-w-xs"
              >
                {(p) => (
                  <Choice
                    {...p}
                    value={v.locale}
                    onChange={(x) => set("locale")(x || "en")}
                    options={LOCALES}
                  />
                )}
              </Field>
            </div>
          )}

          {step === REVIEW && (
            <Review values={v} setup={setup} onEdit={goTo} />
          )}
        </fieldset>

        {isNew && <Honeypot value={website} onChange={setWebsite} />}

        {needsCaptcha && (
          <Turnstile
            key={captchaRound}
            siteKey={setup.captchaSiteKey!}
            onToken={setCaptchaToken}
          />
        )}

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center">
          {step > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="h-10"
              onClick={() => goTo(step - 1)}
            >
              <ArrowLeftIcon /> Back
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={busy !== null || (needsCaptcha && !captchaToken)}
              onClick={() => void save(false)}
            >
              <SubmitSpinner busy={busy === "save"} />
              {busy !== "save" && <SaveIcon />}
              Save and continue later
            </Button>
            {step < REVIEW ? (
              <Button type="submit" className="h-10" disabled={busy !== null}>
                Next / পরবর্তী <ArrowRightIcon />
              </Button>
            ) : (
              <Button
                type="submit"
                className="h-10"
                disabled={busy !== null || (needsCaptcha && !captchaToken)}
              >
                <SubmitSpinner busy={busy === "submit"} />
                {busy !== "submit" && <SendIcon />}
                Submit application / জমা দিন
              </Button>
            )}
          </div>
        </div>
        {needsCaptcha && !captchaToken && (
          <p className="text-xs text-muted-foreground">
            Please complete the security check above to save or submit.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          <span className="text-destructive">*</span> Required / আবশ্যক
        </p>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function StepNav({
  current,
  onSelect,
  errors,
}: {
  current: number;
  onSelect: (step: number) => void;
  errors: FieldErrors;
}) {
  const withErrors = new Set(Object.keys(errors).map(stepOf));
  return (
    <nav aria-label="Application steps">
      <p className="mb-2 text-sm text-muted-foreground sm:hidden">
        Step {current + 1} of {STEPS.length}
      </p>
      <ol className="grid grid-cols-5 gap-1.5">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={i === current ? "step" : undefined}
              className={`flex w-full flex-col items-start gap-1 rounded-md text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                i === current ? "font-semibold" : "text-muted-foreground"
              }`}
            >
              <span
                className={`h-1.5 w-full rounded-full ${
                  withErrors.has(i)
                    ? "bg-destructive"
                    : i <= current
                      ? "bg-primary"
                      : "bg-muted"
                }`}
              />
              <span className="hidden sm:block">{s.title}</span>
              <span className="sr-only sm:hidden">
                {s.title}
                {withErrors.has(i) ? " (needs attention)" : ""}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Review({
  values: v,
  setup,
  onEdit,
}: {
  values: ApplicationValues;
  setup: AdmissionFormSetup;
  onEdit: (step: number) => void;
}) {
  const campus = setup.campuses.find((c) => c.id === v.campusId);
  const year = setup.academicYears.find((y) => y.id === v.academicYearId);
  const cls = setup.yearGroups.find((g) => g.id === v.yearGroupId);
  const label = (list: Array<{ value: string; label: string }>, x: string) =>
    list.find((o) => o.value === x)?.label ?? x;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Please check the details before you submit. You cannot change them
        online after submitting. / জমা দেওয়ার আগে তথ্য যাচাই করুন।
      </p>
      <ReviewBlock title="Child / শিক্ষার্থী" onEdit={() => onEdit(0)}>
        <Item k="Name">
          {[v.childFirstName, v.childLastName].filter(Boolean).join(" ")}
        </Item>
        <Item k="Name in Bangla">{v.childNameBn}</Item>
        <Item k="Gender">{label(GENDERS, v.childGender)}</Item>
        <Item k="Date of birth">{formatLongDate(v.childDob)}</Item>
        <Item k="Previous school">{v.previousSchool}</Item>
      </ReviewBlock>
      <ReviewBlock title="Class / শ্রেণি" onEdit={() => onEdit(1)}>
        <Item k="Campus">{campus?.nameEn}</Item>
        <Item k="Academic year">{year?.code}</Item>
        <Item k="Class">{cls?.nameEn}</Item>
      </ReviewBlock>
      <ReviewBlock title="Parents / অভিভাবক" onEdit={() => onEdit(2)}>
        {v.guardians.map((g, i) => (
          <Item key={i} k={label(RELATIONSHIPS, g.relationship) || "—"}>
            {[g.name, normalisePhone(g.phone) ?? g.phone, g.email, g.occupation]
              .filter(Boolean)
              .join(" · ")}
          </Item>
        ))}
      </ReviewBlock>
      <ReviewBlock
        title="Address & health / ঠিকানা ও স্বাস্থ্য"
        onEdit={() => onEdit(3)}
      >
        <Item k="Address">{v.address}</Item>
        <Item k="Medical notes">{v.medicalNotes}</Item>
        <Item k="Language">{label(LOCALES, v.locale)}</Item>
      </ReviewBlock>
    </div>
  );
}

function ReviewBlock({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <Button type="button" variant="link" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
        {children}
      </dl>
    </section>
  );
}

function Item({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="wrap-break-word">
        {children || <span className="text-muted-foreground">—</span>}
      </dd>
    </>
  );
}

/** Shown after saving a draft: the secret link is the only way back. */
function SavedPanel({
  resume,
  onClose,
}: {
  resume: ResumeLink | null;
  onClose: () => void;
}) {
  if (!resume)
    return (
      <div role="status" className="alert alert-success alert-soft text-sm">
        Your application has been saved.
      </div>
    );
  const link = `${window.location.origin}/admissions/apply/${resume.token}`;
  return (
    <Card role="status" aria-live="polite" className="ring-warning/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SaveIcon className="size-4" /> Saved — keep this link to continue
          later
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          সংরক্ষিত হয়েছে — পরে আবার শুরু করতে এই লিংকটি রেখে দিন
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            value={link}
            aria-label="Link to continue your application"
            className="h-10 font-mono text-xs"
            onFocus={(e) => e.target.select()}
          />
          <CopyButton text={link} />
        </div>
        <div className="alert alert-warning alert-soft items-start text-sm">
          <TriangleAlertIcon className="size-4" />
          <div className="space-y-1">
            <p>
              <strong>This link is the only way back to your application.</strong>{" "}
              We cannot look it up for you, so copy it, bookmark it or send it
              to yourself now. Anyone with the link can see and change the
              application.
            </p>
            <p>
              এই লিংক ছাড়া আবেদনে ফিরে আসা যাবে না — এখনই কপি করে রাখুন।
            </p>
            {resume.expiresAt && (
              <p>
                The link works until{" "}
                <strong>{formatLongDate(resume.expiresAt)}</strong>. Submit
                before then.
              </p>
            )}
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Continue editing
        </Button>
      </CardContent>
    </Card>
  );
}

function ApplicationThanks({ applicationNo }: { applicationNo: string | null }) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <CircleCheckIcon className="mx-auto mb-2 size-12 text-success" />
        <CardTitle className="text-xl">
          Thank you — your application has been submitted
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          ধন্যবাদ — আপনার আবেদন জমা হয়েছে
        </p>
      </CardHeader>
      <CardContent className="space-y-5" role="status" aria-live="polite">
        {applicationNo && (
          <div className="rounded-lg border bg-muted/40 p-4 text-center">
            <div className="text-xs text-muted-foreground uppercase">
              Application number / আবেদন নম্বর
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold tracking-wide">
              {applicationNo}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Please quote it whenever you contact the school.
            </div>
          </div>
        )}
        <div>
          <h2 className="mb-2 font-semibold">What happens next</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              The main contact receives an acknowledgement by SMS (and e-mail
              if given).
            </li>
            <li>
              The admissions office reviews the application and contacts you
              about the next steps, such as documents, an assessment or an
              interview.
            </li>
            <li>
              If anything needs to change, contact the admissions office with
              your application number.
            </li>
          </ol>
        </div>
        <Button
          render={<Link href="/admissions" />}
          nativeButton={false}
          variant="outline"
          className="h-10"
        >
          Back to admissions
        </Button>
      </CardContent>
    </Card>
  );
}
