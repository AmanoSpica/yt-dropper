import { AdminPanel } from "@/components/AdminPanel";
import { logout as apiLogout, fetchMe, type AuthUser } from "@/lib/auth";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function AdminPage() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchMe()
      .then((user) => {
        if (!user || user.role !== "ADMIN") {
          navigate("/", { replace: true });
          return;
        }
        setAuthUser(user);
      })
      .catch(() => {
        toast.error("管理者情報の取得に失敗しました");
        navigate("/", { replace: true });
      })
      .finally(() => setIsLoading(false));
  }, [navigate]);

  async function handleLogout() {
    try {
      await apiLogout();
      toast.success("ログアウトしました");
      navigate("/", { replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "ログアウトに失敗しました";
      toast.error(message);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        読み込み中…
      </div>
    );
  }

  if (!authUser) return null;

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">管理パネル</h1>
        <div className="flex items-center gap-4">
          <Link
            to="/history"
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            履歴
          </Link>
          <Link
            to="/"
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            トップに戻る
          </Link>
          <div className="flex items-center gap-2 text-sm">
            {authUser.avatar_url && (
              <img
                src={authUser.avatar_url}
                alt=""
                className="size-7 rounded-full"
              />
            )}
            <span className="hidden sm:inline">{authUser.name}</span>
            <button
              className="text-muted-foreground underline hover:text-foreground"
              onClick={() => {
                handleLogout().catch(() => {});
              }}
            >
              ログアウト
            </button>
          </div>
        </div>
      </div>
      <AdminPanel />
    </main>
  );
}
