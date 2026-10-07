import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isRestorationId } from "@/app/_lib/restoration-id";
import { RestorationOrderPage } from "@/app/_components/restore/restoration-order-page";

export const metadata: Metadata = { title: "Your Restoration | Restore Old Photos", robots: { index: false, follow: false } };

export default async function RestorationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRestorationId(id)) notFound();
  return <RestorationOrderPage key={id} restorationId={id} />;
}
