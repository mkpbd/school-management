"use client";

import { useQueryClient } from "@tanstack/react-query";
import { GraduationCapIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { meQueryKey } from "@/hooks/use-me";
import { api, isApiError, isMfaChallenge } from "@/lib/api";

type Mode = "staff" | "guardian";

function errorMessage(err: unknown): string {
  return isApiError(err)
    ? err.message
    : "Something went wrong. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("staff");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // staff
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  // guardian
  const [phone, setPhone] = useState("+880");
  const [otpSent, setOtpSent] = useState(false);
  // shared 6-digit code (MFA or OTP)
  const [code, setCode] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function signedIn() {
    await queryClient.invalidateQueries({ queryKey: meQueryKey });
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(
      next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard",
    );
  }

  function onStaffSubmit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (mfaToken) {
        await api.auth.verifyMfa(mfaToken, code);
        return signedIn();
      }
      const { data } = await api.auth.login(identifier, password);
      if (isMfaChallenge(data)) {
        setMfaToken(data.mfaToken);
        setCode("");
        return;
      }
      await signedIn();
    });
  }

  function onGuardianSubmit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (!otpSent) {
        await api.auth.requestOtp(phone);
        setOtpSent(true);
        setCode("");
        return;
      }
      await api.auth.verifyOtp(phone, code);
      await signedIn();
    });
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setCode("");
    setMfaToken(null);
    setOtpSent(false);
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <GraduationCapIcon className="size-6" />
          </div>
          <CardTitle className="text-xl">School Management</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* daisyUI tabs */}
          <div role="tablist" className="tabs tabs-box w-full">
            <button
              type="button"
              role="tab"
              className={`tab flex-1 ${mode === "staff" ? "tab-active" : ""}`}
              onClick={() => switchMode("staff")}
            >
              Staff / Student
            </button>
            <button
              type="button"
              role="tab"
              className={`tab flex-1 ${mode === "guardian" ? "tab-active" : ""}`}
              onClick={() => switchMode("guardian")}
            >
              Guardian
            </button>
          </div>

          {error && (
            <div role="alert" className="alert alert-error alert-soft text-sm">
              {error}
            </div>
          )}

          {mode === "staff" ? (
            <form onSubmit={onStaffSubmit} className="space-y-4">
              {!mfaToken ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="identifier">Username or email</Label>
                    <Input
                      id="identifier"
                      autoComplete="username"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <CodeField
                  label="Authenticator code"
                  value={code}
                  onChange={setCode}
                />
              )}
              <SubmitButton busy={busy}>
                {mfaToken ? "Verify" : "Sign in"}
              </SubmitButton>
            </form>
          ) : (
            <form onSubmit={onGuardianSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Mobile number</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+8801712345678"
                  pattern="^\+[1-9]\d{7,14}$"
                  required
                  disabled={otpSent}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              {otpSent && (
                <CodeField
                  label="Code sent by SMS"
                  value={code}
                  onChange={setCode}
                />
              )}
              <SubmitButton busy={busy}>
                {otpSent ? "Verify code" : "Send code"}
              </SubmitButton>
              {otpSent && (
                <Button
                  type="button"
                  variant="link"
                  className="w-full"
                  onClick={() => setOtpSent(false)}
                >
                  Use a different number
                </Button>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function CodeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="code">{label}</Label>
      <Input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        className="text-center tracking-[0.5em]"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
    </div>
  );
}

function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="submit" className="w-full" size="lg" disabled={busy}>
      {busy && <span className="loading loading-spinner loading-xs" />}
      {children}
    </Button>
  );
}
