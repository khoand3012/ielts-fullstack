import type { Metadata } from "next";
import { SessionScreen } from "@/components/session/session-screen";

export const metadata: Metadata = { title: "Test · IELTS Practice" };

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <SessionScreen sessionId={sessionId} />;
}
