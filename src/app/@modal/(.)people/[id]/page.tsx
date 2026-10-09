"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { use } from "react";
import { RequireAuth } from "@/components/auth";
import { CandidateProfile } from "@/components/candidate-profile";
import { Sheet } from "@/components/ui";

/** Profile in a drawer over the results, keeping the list in place. Same URL as the full page. */
export default function PersonDrawer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const hl = useSearchParams().get("hl")?.split(",").filter(Boolean) ?? [];
  return (
    <RequireAuth>
      <Sheet open onOpenChange={(o) => !o && router.back()} title="Candidate profile" side="right" hideTitle>
        <CandidateProfile id={decodeURIComponent(id)} highlight={hl} />
      </Sheet>
    </RequireAuth>
  );
}
