import { NextResponse } from "next/server";
import { ask, AskError, type ChatMessage } from "@/lib/ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 20_000;
const MAX_TEXT = 500;
const MAX_TURNS = 8;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return fail("Request too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("Invalid JSON.", 400);
  }
  const list = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(list) || !list.length) return fail("messages must be a non-empty array.", 400);
  const messages: ChatMessage[] = [];
  for (const m of list) {
    const role = (m as ChatMessage)?.role;
    const text = (m as ChatMessage)?.text;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") return fail("Each message needs a role (user or assistant) and text.", 400);
    messages.push({ role, text: text.slice(0, 4000) });
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user") return fail("The last message must be from the user.", 400);
  const q = last.text.trim();
  if (!q || q.length > MAX_TEXT) return fail(`Questions must be 1 to ${MAX_TEXT} characters.`, 400);
  last.text = q;

  // Gemini expects the conversation to start with a user turn.
  let turns = messages.slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== "user") turns = turns.slice(1);

  try {
    const res = await ask(turns);
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof AskError) return fail(e.message, e.status);
    console.error("ask failed", (e as Error).message);
    return fail("Something went wrong while answering. Try again.", 500);
  }
}
