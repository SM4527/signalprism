import { formAction } from "@/lib/form-action";
import { saveNotifications } from "@/lib/notify/settings";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => formAction(req, "/rules", async ({ db, form }) => saveNotifications(db, form));
