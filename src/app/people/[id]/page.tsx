"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CandidateProfile } from "@/components/candidate-profile";
import { btn } from "@/components/ui";

/** Full profile page: the target of a shared link or a refresh. */
export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const hl = useSearchParams().get("hl")?.split(",").filter(Boolean) ?? [];
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <Link href="/" className={`${btn.ghost} -ml-2.5 mb-4`}>
          <ArrowLeft size={16} /> Back to search
        </Link>
        <div className="rounded-2xl border border-line bg-surface p-5 md:p-8">
          <CandidateProfile id={decodeURIComponent(id)} highlight={hl} />
        </div>
      </div>
    </AppShell>
  );
}
