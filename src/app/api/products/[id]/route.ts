import { NextResponse } from "next/server";
import { productHistory } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ history: productHistory(decodeURIComponent(id)) });
}
