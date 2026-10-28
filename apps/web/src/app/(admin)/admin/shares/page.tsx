import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminShares } from "@/components/admin/pages/shares";

export const metadata: Metadata = { title: "Shared links" };

export default function Page() {
  return (
    <Suspense>
      <AdminShares />
    </Suspense>
  );
}
