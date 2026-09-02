import { NextResponse, type NextRequest } from "next/server";

import { isGuestOnlyPath, isPublicPath } from "@/lib/auth/routes";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  // 未ログインで保護ページ（(app) 配下）にアクセス → /login
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") {
      url.searchParams.set("next", `${pathname}${search}`);
    }
    return withCookies(NextResponse.redirect(url), supabaseResponse);
  }

  // ログイン済みで /login, /signup 等にアクセス → /
  if (user && isGuestOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return withCookies(NextResponse.redirect(url), supabaseResponse);
  }

  return supabaseResponse;
}

/** リダイレクト時もリフレッシュ済みのセッション cookie を引き継ぐ */
function withCookies(target: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export const config = {
  matcher: [
    /*
     * 以下を除く全リクエストで実行:
     * - _next/static, _next/image
     * - favicon.ico, 画像などの静的ファイル
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
