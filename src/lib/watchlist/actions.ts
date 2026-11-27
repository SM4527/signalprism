import { formAction } from "@/lib/form-action";

/** Run a watch list action for a loopback POST, then redirect back to the Watchlist with the message. */
export const watchlistAction = (req: Request, act: Parameters<typeof formAction>[2]) => formAction(req, "/watchlist", act);

export const tickersOf = (form: FormData, field: string): string[] =>
  String(form.get(field) ?? "").split(/[\s,]+/).filter(Boolean);
