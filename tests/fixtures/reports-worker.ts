import { handleReport } from "../../server/report-endpoint";
export default {
  fetch(request: Request, env: { VISITS: D1Database }) {
    return handleReport(request, {
      ...env,
      REPORT_LIMITER: {
        limit: async ({ key }: { key: string }) => ({ success: key !== "blocked" }),
      },
    });
  },
};
