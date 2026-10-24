"use client";

import { CircleCheckIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Loading } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type {
  AdmissionFormSetup,
  AdmissionTracking,
  PublicEnquiryBody,
} from "@/lib/api/services/adm-public";
import {
  CampaignNote,
  Choice,
  defaultChoice,
  ErrorBanner,
  Field,
  Honeypot,
  inputClass,
  isEmail,
  LOCALES,
  normalisePhone,
  opt,
  PHONE_ERROR,
  problemMessage,
  serverFieldErrors,
  SubmitSpinner,
  useFormSetup,
  type FieldErrors,
} from "./common";
import { Turnstile } from "./turnstile";

const CONTACT = [
  { value: "phone", label: "Phone call / ফোন কল" },
  { value: "sms", label: "SMS / এসএমএস" },
  { value: "whatsapp", label: "WhatsApp / হোয়াটসঅ্যাপ" },
  { value: "email", label: "E-mail / ই-মেইল" },
];

type Values = {
  campusId: string;
  academicYearId: string;
  yearGroupId: string;
  childName: string;
  childDob: string;
  guardianName: string;
  phone: string;
  email: string;
  preferredContact: string;
  message: string;
  locale: string;
};

/** Public enquiry form (/admissions/enquire). */
export function EnquiryForm() {
  const setup = useFormSetup("enquiry");
  const [reference, setReference] = useState<string | null>(null);

  if (reference)
    return (
      <EnquiryThanks
        reference={reference}
        onAnother={() => {
          setReference(null);
          void setup.refetch(); // a fresh form token
        }}
      />
    );
  if (setup.isError)
    return <ErrorBanner>{problemMessage(setup.error)}</ErrorBanner>;
  if (!setup.data || setup.isFetching)
    return <Loading label="Loading the form… / ফর্ম লোড হচ্ছে…" />;
  return (
    <EnquiryFields
      setup={setup.data}
      tracking={setup.tracking}
      onDone={setReference}
    />
  );
}

function EnquiryFields({
  setup,
  tracking,
  onDone,
}: {
  setup: AdmissionFormSetup;
  tracking: AdmissionTracking;
  onDone: (reference: string) => void;
}) {
  const [v, setV] = useState<Values>(() => ({
    ...defaultChoice(setup),
    yearGroupId: "",
    childName: "",
    childDob: "",
    guardianName: "",
    phone: "",
    email: "",
    preferredContact: "",
    message: "",
    locale: "en",
  }));
  const [website, setWebsite] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaRound, setCaptchaRound] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof Values) => (value: string) =>
    setV((prev) => ({ ...prev, [key]: value }));
  const needsCaptcha = !!setup.captchaSiteKey;

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!v.campusId) e.campusId = "Choose a campus / ক্যাম্পাস বাছাই করুন";
    if (!v.academicYearId)
      e.academicYearId = "Choose the academic year / শিক্ষাবর্ষ বাছাই করুন";
    if (v.childName.trim().length < 2)
      e.childName = "Enter the child's name / শিশুর নাম লিখুন";
    if (v.guardianName.trim().length < 2)
      e.guardianName = "Enter your name / আপনার নাম লিখুন";
    if (!normalisePhone(v.phone)) e.phone = PHONE_ERROR;
    if (v.email.trim() && !isEmail(v.email))
      e.email = "Enter a valid e-mail address / সঠিক ই-মেইল দিন";
    if (v.preferredContact === "email" && !v.email.trim())
      e.email = "Add an e-mail address to be contacted by e-mail";
    return e;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      setAlert("Please check the highlighted fields. / চিহ্নিত ঘরগুলো দেখে নিন।");
      return;
    }
    const body: PublicEnquiryBody = {
      token: setup.token,
      website,
      ...(captchaToken ? { captchaToken } : {}),
      campusId: v.campusId,
      academicYearId: v.academicYearId,
      ...(v.yearGroupId ? { yearGroupId: v.yearGroupId } : {}),
      childName: v.childName.trim(),
      ...(v.childDob ? { childDob: v.childDob } : {}),
      guardianName: v.guardianName.trim(),
      phone: normalisePhone(v.phone)!,
      email: opt(v.email),
      message: opt(v.message),
      ...(v.preferredContact
        ? {
            preferredContact:
              v.preferredContact as PublicEnquiryBody["preferredContact"],
          }
        : {}),
      locale: v.locale === "bn" ? "bn" : "en",
      tracking,
    };
    setBusy(true);
    setAlert(null);
    try {
      const { data } = await api.adm.publicForm.enquire(body);
      onDone(data.reference);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setAlert(problemMessage(err));
      // a captcha token is single-use
      setCaptchaToken("");
      setCaptchaRound((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative space-y-6">
      {setup.campaign && <CampaignNote name={setup.campaign.name} />}
      {alert && <ErrorBanner>{alert}</ErrorBanner>}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Campus"
          bn="ক্যাম্পাস"
          required
          error={errors.campusId}
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
          error={errors.academicYearId}
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
          label="Class"
          bn="শ্রেণি"
          error={errors.yearGroupId}
          className="sm:col-span-2"
        >
          {(p) => (
            <Choice
              {...p}
              value={v.yearGroupId}
              onChange={set("yearGroupId")}
              placeholder="Not sure yet / এখনও ঠিক করিনি"
              options={setup.yearGroups.map((g) => ({
                value: g.id,
                label: g.nameEn,
              }))}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Child's name"
          bn="শিশুর নাম"
          required
          error={errors.childName}
        >
          {(p) => (
            <Input
              {...p}
              className={inputClass}
              maxLength={120}
              autoComplete="off"
              value={v.childName}
              onChange={(e) => set("childName")(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Child's date of birth"
          bn="জন্ম তারিখ"
          error={errors.childDob}
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
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Your name (parent / guardian)"
          bn="অভিভাবকের নাম"
          required
          error={errors.guardianName}
        >
          {(p) => (
            <Input
              {...p}
              className={inputClass}
              maxLength={120}
              autoComplete="name"
              value={v.guardianName}
              onChange={(e) => set("guardianName")(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Mobile number"
          bn="মোবাইল নম্বর"
          required
          hint="e.g. 01712345678"
          error={errors.phone}
        >
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className={inputClass}
              placeholder="01XXXXXXXXX"
              value={v.phone}
              onChange={(e) => set("phone")(e.target.value)}
              onBlur={() => {
                const n = normalisePhone(v.phone);
                if (n) set("phone")(n);
              }}
            />
          )}
        </Field>
        <Field label="E-mail" bn="ই-মেইল" error={errors.email}>
          {(p) => (
            <Input
              {...p}
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={200}
              className={inputClass}
              value={v.email}
              onChange={(e) => set("email")(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="How should we contact you?"
          bn="কীভাবে যোগাযোগ করব"
          error={errors.preferredContact}
        >
          {(p) => (
            <Choice
              {...p}
              value={v.preferredContact}
              onChange={set("preferredContact")}
              placeholder="Any / যেকোনো"
              options={CONTACT}
            />
          )}
        </Field>
        <Field
          label="Message"
          bn="বার্তা"
          hint="Questions about admission, fees, transport…"
          error={errors.message}
          className="sm:col-span-2"
        >
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              maxLength={2000}
              value={v.message}
              onChange={(e) => set("message")(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Language for SMS"
          bn="এসএমএস-এর ভাষা"
          required
          error={errors.locale}
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
      </fieldset>

      <Honeypot value={website} onChange={setWebsite} />

      {needsCaptcha && (
        <Turnstile
          key={captchaRound}
          siteKey={setup.captchaSiteKey!}
          onToken={setCaptchaToken}
        />
      )}

      <div className="space-y-2">
        <Button
          type="submit"
          size="lg"
          className="h-11 w-full sm:w-auto sm:px-6"
          disabled={busy || (needsCaptcha && !captchaToken)}
        >
          <SubmitSpinner busy={busy} />
          {!busy && <SendIcon />}
          Send enquiry / পাঠান
        </Button>
        {needsCaptcha && !captchaToken && (
          <p className="text-xs text-muted-foreground">
            Please complete the security check above first.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          <span className="text-destructive">*</span> Required / আবশ্যক
        </p>
      </div>
    </form>
  );
}

function EnquiryThanks({
  reference,
  onAnother,
}: {
  reference: string;
  onAnother: () => void;
}) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <CircleCheckIcon className="mx-auto mb-2 size-12 text-success" />
        <CardTitle className="text-xl">
          Thank you — we received your enquiry
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          ধন্যবাদ — আপনার জিজ্ঞাসা আমরা পেয়েছি
        </p>
      </CardHeader>
      <CardContent className="space-y-5" role="status" aria-live="polite">
        <div className="rounded-lg border bg-muted/40 p-4 text-center">
          <div className="text-xs text-muted-foreground uppercase">
            Your reference / রেফারেন্স নম্বর
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold tracking-wide">
            {reference}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Please keep it for when you talk to us.
          </div>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">What happens next</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              You will get an SMS confirming your enquiry (in the language you
              chose).
            </li>
            <li>
              Our admissions team will contact you soon, by your preferred
              method, to answer your questions and arrange a visit.
            </li>
            <li>
              Ready to apply? You can start the online application now.
            </li>
          </ol>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            render={<Link href="/admissions/apply" />}
            nativeButton={false}
            className="h-10"
          >
            Apply online / অনলাইনে আবেদন
          </Button>
          <Button variant="outline" className="h-10" onClick={onAnother}>
            Send another enquiry
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
