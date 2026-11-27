import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { rejectUnlessLoopback } from "@/lib/loopback";

/** Bad input from a form: its message goes back to the page, nothing is saved. */
export class FormError extends Error {}

/** Redirect to a page with a one-line result (303, relative, so the Host header never matters). */
export const redirectWithMessage = (path: string, msg: string) =>
  new Response(null, { status: 303, headers: { location: `${path}?msg=${encodeURIComponent(msg)}` } });

/** Run a form POST for a loopback request, then redirect to `path` with the returned message. Anything else gets a 403. */
export async function formAction(
  req: Request,
  path: string,
  act: (ctx: { config: ReturnType<typeof loadConfig>; db: ReturnType<typeof getDb>; form: FormData }) => Promise<string>,
): Promise<Response> {
  const denied = rejectUnlessLoopback(req);
  if (denied) return denied;
  const config = loadConfig();
  const form = await req.formData();
  try {
    return redirectWithMessage(path, await act({ config, db: getDb(config.DB_PATH), form }));
  } catch (e) {
    if (e instanceof FormError) return redirectWithMessage(path, `Not saved: ${e.message}`);
    throw e;
  }
}
