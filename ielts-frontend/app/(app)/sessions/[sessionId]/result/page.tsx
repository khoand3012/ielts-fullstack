import type { Metadata } from "next";
import { ResultScreen } from "@/components/result/result-screen";

export const metadata: Metadata = { title: "Result · IELTS Practice" };

export default async function ResultPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <ResultScreen sessionId={sessionId} />;
}
