import { withAuth } from "@izipizi/auth/middleware";
export default withAuth("franchise");
export const config = { matcher: ["/((?!_next|favicon|api).*)"] };
