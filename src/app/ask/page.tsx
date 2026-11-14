import type { Metadata } from "next";
import { AskChat } from "@/components/AskChat";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Ask delta." };

export default function AskPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Ask delta." />
      <AskChat />
    </div>
  );
}
