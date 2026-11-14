import { NextResponse } from "next/server";
import { FavouriteError, listFavourites, toggleFavourite } from "@/lib/favourites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 2_000;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function GET() {
  return NextResponse.json({ favourites: listFavourites().map((f) => ({ kind: f.kind, key: f.key })) });
}

/** Toggles one favourite: `{ kind: "product" | "category" | "subcategory", key }` → `{ kind, key, on }`. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return fail("Request too large.", 413);
  let body: { kind?: unknown; key?: unknown };
  try {
    body = JSON.parse(raw) ?? {};
  } catch {
    return fail("Invalid JSON.", 400);
  }
  try {
    return NextResponse.json(toggleFavourite(body.kind, body.key));
  } catch (e) {
    if (e instanceof FavouriteError) return fail(e.message, 400);
    console.error("favourite toggle failed", (e as Error).message);
    return fail("Could not save the favourite. Try again.", 500);
  }
}
