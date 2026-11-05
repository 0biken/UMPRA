import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireUser } from "@/server/auth/guards";
import { getSubmissionReadUrl } from "@/server/tournament/evidence";
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const url = await getSubmissionReadUrl(id, user.id);
    // The in-memory provider is test-only and exposes a data URL. Serve those
    // exact bytes so browsers exercise the protected image route as they do in
    // production (where Supabase supplies an HTTPS signed URL).
    const dataUrl = /^data:([^;]+);base64,([a-zA-Z0-9+/=]+)$/.exec(url);
    if (dataUrl) {
      return new NextResponse(Buffer.from(dataUrl[2], "base64"), {
        headers: {
          "Content-Type": dataUrl[1],
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (err) { return toErrorResponse(err); }
}
