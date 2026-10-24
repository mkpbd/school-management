import { FilePenLineIcon, MessageCircleQuestionIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TrackVisit } from "@/components/admissions-public/track-visit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Admissions" };

const OPTIONS = [
  {
    href: "/admissions/enquire",
    icon: MessageCircleQuestionIcon,
    title: "Ask about admission",
    bn: "ভর্তি সম্পর্কে জানতে চাই",
    text: "Send a short enquiry. Our admissions team will call or message you.",
  },
  {
    href: "/admissions/apply",
    icon: FilePenLineIcon,
    title: "Apply online",
    bn: "অনলাইনে আবেদন",
    text: "Fill in the application form. You can save it and finish later.",
  },
];

export default function AdmissionsHome() {
  return (
    <div className="space-y-6">
      <TrackVisit />
      <div>
        <h1 className="text-2xl font-semibold">Admissions</h1>
        <p className="text-muted-foreground">ভর্তি — How can we help?</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <Link
            key={o.href}
            href={o.href}
            className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <o.icon className="mb-1 size-6 text-primary" />
                <CardTitle className="text-lg">{o.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{o.bn}</p>
              </CardHeader>
              <CardContent className="text-sm">{o.text}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Saved an application earlier? Open the link you were given when you
        saved it — it is the only way back to your draft.
      </p>
    </div>
  );
}
