import { formAction } from "@/lib/form-action";
import { senderFor } from "@/lib/notify/runtime";
import { sendTestPush } from "@/lib/notify/test-push";

export const dynamic = "force-dynamic";

export const POST = (req: Request) =>
  formAction(req, "/rules", ({ config, db }) =>
    sendTestPush(db, senderFor(config), new Date(), config.DATA_MODE === "mock" ? (m) => console.log(`[notify] ${m}`) : undefined),
  );
