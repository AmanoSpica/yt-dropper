import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  deleteDownloadFiles,
  deleteDownloadHistory,
  getDownloadHistory,
} from "@/lib/api";
import { logout as apiLogout, fetchMe, type AuthUser } from "@/lib/auth";
import type { DownloadHistoryJob } from "@/lib/types";
import { formatFileSize, isFileDeleted } from "@/lib/utils";
import { Check, Download, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

function statusLabel(status: DownloadHistoryJob["status"]): string {
  if (status === "queued") return "待機中";
  if (status === "downloading") return "進行中";
  if (status === "done") return "完了";
  return "失敗";
}

export default function HistoryPage() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [jobs, setJobs] = useState<DownloadHistoryJob[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingFiles, setIsDeletingFiles] = useState(false);
  const [isDeletingHistory, setIsDeletingHistory] = useState(false);
  const navigate = useNavigate();

  const loadHistory = useCallback(
    async (silent = false) => {
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const [user, historyJobs] = await Promise.all([
          fetchMe(),
          getDownloadHistory(),
        ]);
        if (!user) {
          navigate("/", { replace: true });
          return;
        }
        setAuthUser(user);
        setJobs(historyJobs);
        setSelectedJobIds((prev) => {
          const availableJobIds = new Set(historyJobs.map((job) => job.id));
          return prev.filter((jobId) => availableJobIds.has(jobId));
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "ダウンロード履歴の取得に失敗しました";
        toast.error(message);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [navigate],
  );

  useEffect(() => {
    void loadHistory(false);
  }, [loadHistory]);

  const downloadingCount = useMemo(
    () =>
      jobs.filter(
        (job) => job.status === "queued" || job.status === "downloading",
      ).length,
    [jobs],
  );

  const selectedCount = selectedJobIds.length;
  const fileDeletableSelectedJobIds = useMemo(() => {
    const selectedSet = new Set(selectedJobIds);
    return jobs
      .filter(
        (job) =>
          selectedSet.has(job.id) &&
          job.status === "done" &&
          !isFileDeleted(job.deleted_at),
      )
      .map((job) => job.id);
  }, [jobs, selectedJobIds]);

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

  function handleRedownload(job: DownloadHistoryJob) {
    if (job.status !== "done") {
      return;
    }
    window.location.assign(`/api/download/${encodeURIComponent(job.id)}`);
  }

  function toggleSelectJob(jobId: string) {
    setSelectedJobIds((prev) => {
      if (prev.includes(jobId)) {
        return prev.filter((id) => id !== jobId);
      }
      return [...prev, jobId];
    });
  }

  async function handleDeleteFiles() {
    if (fileDeletableSelectedJobIds.length === 0) {
      return;
    }

    setIsDeletingFiles(true);
    try {
      const result = await deleteDownloadFiles(fileDeletableSelectedJobIds);
      toast.success(`ファイルを削除しました: ${result.updated}件`);
      if (result.skipped > 0) {
        toast.info(`ダウンロード中のためスキップ: ${result.skipped}件`);
      }
      await loadHistory(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "ファイルの削除に失敗しました";
      toast.error(message);
    } finally {
      setIsDeletingFiles(false);
    }
  }

  async function handleDeleteHistory() {
    if (selectedJobIds.length === 0) {
      return;
    }

    setIsDeletingHistory(true);
    try {
      const result = await deleteDownloadHistory(selectedJobIds);
      toast.success(`履歴を削除しました: ${result.deleted}件`);
      if (result.skipped > 0) {
        toast.info(`ダウンロード中のためスキップ: ${result.skipped}件`);
      }
      await loadHistory(true);
      setSelectedJobIds([]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "履歴の削除に失敗しました";
      toast.error(message);
    } finally {
      setIsDeletingHistory(false);
    }
  }

  async function handleDeleteSingleHistory(jobId: string) {
    if (isDeletingFiles || isDeletingHistory) {
      return;
    }
    setIsDeletingHistory(true);
    try {
      const result = await deleteDownloadHistory([jobId]);
      toast.success(`履歴を削除しました: ${result.deleted}件`);
      if (result.skipped > 0) {
        toast.info(`削除できない履歴がありました: ${result.skipped}件`);
      }
      await loadHistory(true);
      setSelectedJobIds((prev) => prev.filter((id) => id !== jobId));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "履歴の削除に失敗しました";
      toast.error(message);
    } finally {
      setIsDeletingHistory(false);
    }
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">履歴を読み込み中…</p>
      </main>
    );
  }

  if (!authUser) {
    return null;
  }

  return (
    <main
      className={`mx-auto max-w-6xl space-y-4 p-4 md:p-8 ${
        selectedCount > 0 ? "pb-28" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ダウンロード履歴</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link
            to="/"
            className="text-muted-foreground underline hover:text-foreground"
          >
            トップ
          </Link>
          {authUser.role === "ADMIN" && (
            <Link
              to="/admin"
              className="text-muted-foreground underline hover:text-foreground"
            >
              管理
            </Link>
          )}
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

      <section className="flex items-center justify-between rounded-lg border p-3">
        <div className="text-sm text-muted-foreground">
          合計 {jobs.length} 件 / 進行中 {downloadingCount} 件
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSelectedJobIds(jobs.map((job) => job.id));
            }}
            disabled={jobs.length === 0 || selectedCount === jobs.length}
          >
            すべて選択
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void loadHistory(true);
            }}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <>
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                更新中...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 size-4" />
                更新
              </>
            )}
          </Button>
        </div>
      </section>

      {selectedCount > 0 && (
        <section className="fixed bottom-4 left-1/2 z-50 inline-flex w-max -translate-x-1/2 flex-col gap-2 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
          <p className="text-xs text-muted-foreground">
            {selectedCount}件を選択中
          </p>
          <div className="flex w-max gap-2 flex-wrap max-w-full">
            <Button
              type="button"
              variant="destructiveOutline"
              onClick={() => {
                void handleDeleteFiles();
              }}
              disabled={
                isDeletingFiles ||
                isDeletingHistory ||
                fileDeletableSelectedJobIds.length === 0
              }
            >
              {isDeletingFiles ? "削除中..." : "ファイル削除"}
            </Button>
            <Button
              type="button"
              variant="destructiveOutline"
              onClick={() => {
                void handleDeleteHistory();
              }}
              disabled={isDeletingFiles || isDeletingHistory}
            >
              {isDeletingHistory ? "削除中..." : "履歴削除"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelectedJobIds([])}
              disabled={isDeletingFiles || isDeletingHistory}
            >
              選択解除
            </Button>
          </div>
        </section>
      )}

      {jobs.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground">
          まだダウンロード履歴がありません
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {jobs.map((job) => {
            const deleted = isFileDeleted(job.deleted_at);
            const selected = selectedJobIds.includes(job.id);
            return (
              <article
                key={job.id}
                className={`flex h-full w-full flex-col gap-2 rounded-lg border p-3 ${
                  selected ? "ring-2 ring-primary" : ""
                }`}
              >
                <button
                  type="button"
                  className="relative aspect-video w-full self-start overflow-hidden rounded-md"
                  onClick={() => toggleSelectJob(job.id)}
                >
                  <img
                    className="h-full w-full rounded-md object-cover"
                    src={job.thumbnail || undefined}
                    alt="Video Thumbnail"
                  />
                  {selected && (
                    <>
                      <span
                        className="absolute inset-0 bg-white/50"
                        aria-hidden="true"
                      />
                      <span className="absolute inset-0 inline-flex items-center justify-center">
                        <span className="inline-flex size-10 items-center justify-center text-primary-foreground">
                          <Check className="size-12" />
                        </span>
                      </span>
                    </>
                  )}
                </button>

                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium line-clamp-2 underline-offset-2 hover:underline"
                >
                  {job.title || "(タイトル不明)"}
                </a>
                <div className="shrink-0 text-left">
                  <p
                    className={`text-xs font-medium ${
                      job.status === "done"
                        ? "text-primary"
                        : job.status === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    {statusLabel(job.status)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(job.created_at).toLocaleString("ja-JP")}
                  </p>
                </div>

                {job.error ? (
                  <div>
                    <p className="font-medium text-destructive">
                      ダウンロード失敗
                    </p>
                  </div>
                ) : deleted ? (
                  <div>
                    <p className="font-medium text-muted-foreground">
                      保存期間終了
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>進捗</span>
                      <span>{Math.round(job.progress)}%</span>
                    </div>
                    <Progress value={job.progress} />
                  </div>
                )}

                <div className="mt-auto flex items-center justify-between">
                  <div className="min-w-0 flex-1 break-all text-xs text-muted-foreground">
                    {deleted ? (
                      <div className="space-y-1">
                        <p>
                          削除日時:{" "}
                          {new Date(job.deleted_at!).toLocaleString("ja-JP")}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {job.file_size_kb && (
                          <p>{formatFileSize(job.file_size_kb)}</p>
                        )}
                        {job.error && (
                          <p className="text-xs text-destructive">
                            {job.error}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {job.status === "error" || deleted ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructiveOutline"
                      onClick={() => {
                        void handleDeleteSingleHistory(job.id);
                      }}
                      disabled={isDeletingFiles || isDeletingHistory}
                      className="shrink-0"
                    >
                      <Trash2 className="mr-0.5 size-4" />
                      履歴削除
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleRedownload(job)}
                      disabled={job.status !== "done"}
                      variant="default"
                      className="shrink-0"
                    >
                      <>
                        <Download className="mr-0.5 size-4" />
                        ダウンロード
                      </>
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}
      {jobs.length > 0 && (
        <p className="text-muted-foreground text-xs">
          サムネイルをクリックして選択
        </p>
      )}
    </main>
  );
}
