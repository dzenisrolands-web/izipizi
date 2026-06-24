import { withAuth } from "@izipizi/auth/middleware";
export default withAuth("courier");
export const config = { matcher: ["/((?!_next|favicon|api).*)"] };
