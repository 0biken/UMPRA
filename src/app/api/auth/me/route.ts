import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireUser } from "@/server/auth/guards";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ user });
  } catch (err) {
    return toErrorResponse(err);
  }
}
