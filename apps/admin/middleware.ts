import { withAuth } from "@izipizi/auth/middleware";
export default withAuth("admin");
export const config = { matcher: ["/((?!_next|favicon|api).*)"] };
