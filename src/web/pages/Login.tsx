import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/api/client";
import { Loading, PrimaryButton, SecondaryButton } from "@/components/common";
import { authClient } from "@/lib/auth-client";

export function Login() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: apiClient.config });
  const nav = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
    });
    if (res.error) {
      setError("Google でログインできませんでした。もう一度お試しください");
      setBusy(false);
    }
  };

  // ローカル開発だけ（DEV_LOGIN=1）。まだ無ければ作ってからログインする
  const devLogin = async () => {
    setBusy(true);
    setError(null);
    const signIn = await authClient.signIn.email({ email, password });
    if (signIn.error) {
      const signUp = await authClient.signUp.email({
        email,
        password,
        name: email.split("@")[0] ?? "テスト",
      });
      if (signUp.error) {
        setError("ログインできませんでした（パスワードは8文字以上）");
        setBusy(false);
        return;
      }
    }
    await qc.invalidateQueries();
    nav("/", { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-8 px-7 py-10">
      <div className="flex flex-col items-center gap-2.5">
        <div className="flex size-16 items-center justify-center rounded-[20px] bg-accent">
          <svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z" />
            <path d="M9 7c0-1.5 1-2 1-3.5M13 7c0-1.5 1-2 1-3.5" />
          </svg>
        </div>
        <h1 className="font-display text-3xl font-bold">MaiRecipe</h1>
        <p className="text-sm text-sub">見つけたレシピを、自分の味に育てる</p>
      </div>

      {cfg.isPending && <Loading />}

      {cfg.data?.googleLogin && (
        <SecondaryButton
          onClick={google}
          disabled={busy}
          className="h-12 text-[15px]"
        >
          <span className="flex size-[22px] items-center justify-center rounded-full border-2 border-sub text-xs font-bold">
            G
          </span>
          Google でログイン
        </SecondaryButton>
      )}

      {cfg.data?.devLogin && (
        <form
          className="flex flex-col gap-3 rounded-2xl border border-dashed border-field p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void devLogin();
          }}
        >
          <p className="text-xs text-sub">
            ローカル開発用のログイン（本番には出ません）
          </p>
          <input
            id="dev-email"
            type="email"
            required
            className="h-11 rounded-xl border border-field bg-card px-3.5"
            placeholder="you@example.test"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            id="dev-password"
            type="password"
            required
            minLength={8}
            className="h-11 rounded-xl border border-field bg-card px-3.5"
            placeholder="パスワード（8文字以上）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PrimaryButton type="submit" disabled={busy}>
            ログイン
          </PrimaryButton>
        </form>
      )}

      {cfg.data && !cfg.data.googleLogin && !cfg.data.devLogin && (
        <p className="text-center text-sm leading-7 text-sub">
          ログインの準備がまだです。Google
          ログインの鍵を設定してください（README の手順）。
        </p>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
