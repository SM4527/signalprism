import { formAction } from "@/lib/form-action";
import { saveRule } from "@/lib/notify/settings";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => formAction(req, "/rules", async ({ db, form }) => saveRule(db, form));
