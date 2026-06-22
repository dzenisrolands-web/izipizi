import { withAuth } from "@izipizi/auth/middleware";
export default withAuth("business");
export const config = { matcher: ["/((?!_next|favicon|api).*)"] };
