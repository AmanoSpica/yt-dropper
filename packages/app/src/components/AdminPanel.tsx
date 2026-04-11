import { Button } from "@/components/ui/button";
import {
  addAllowedEmail,
  adminDeleteDownloadFiles,
  deleteAllowedEmail,
  deleteUser,
  fetchActiveDownloads,
  fetchAdminDiskUsage,
  fetchAdminStorageLimit,
  fetchAllowedEmails,
  fetchCompletedDownloads,
  fetchUsers,
  updateAdminStorageLimit,
  type AdminDiskUsage,
  type AdminDownloadJob,
  type AllowedEmail,
  type ManagedUser,
} from "@/lib/auth";
import { formatFileSize, isFileDeleted } from "@/lib/utils";
import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_STORAGE_LIMIT_GB = 10;

export function AdminPanel() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<AdminDownloadJob[]>(
    [],
  );
  const [completedDownloads, setCompletedDownloads] = useState<
    AdminDownloadJob[]
  >([]);
  const [newEmail, setNewEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingEmailId, setDeletingEmailId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [selectedCompletedJobIds, setSelectedCompletedJobIds] = useState<
    string[]
  >([]);
  const [isDeletingFiles, setIsDeletingFiles] = useState(false);
  const [diskUsage, setDiskUsage] = useState<AdminDiskUsage | null>(null);
  const [maxStorageGb, setMaxStorageGb] = useState<number>(
    DEFAULT_STORAGE_LIMIT_GB,
  );
  const [isSavingStorageLimit, setIsSavingStorageLimit] = useState(false);
  const isNewEmailValid =
    newEmail.trim() === "" || EMAIL_PATTERN.test(newEmail.trim());

  const usagePercent = useMemo(() => {
    if (!diskUsage || maxStorageGb <= 0) return 0;
    return (diskUsage.used_bytes / (maxStorageGb * 1024 * 1024 * 1024)) * 100;
  }, [diskUsage, maxStorageGb]);

  const usagePercentLabel = `${usagePercent.toFixed(1)}%`;
  const usageBarPercent = Math.min(usagePercent, 100);
  const unknownCompletedCount = completedDownloads.filter(
    (job) => job.is_unknown && !job.deleted_at,
  ).length;
  const selectableCompletedDownloads = useMemo(
    () =>
      completedDownloads.filter(
        (job) => !isFileDeleted(job.deleted_at ?? null),
      ),
    [completedDownloads],
  );

  async function refresh() {
    setIsLoading(true);
    try {
      const [
        nextUsers,
        nextEmails,
        nextActiveDownloads,
        nextCompletedDownloads,
        nextDiskUsage,
        nextStorageLimit,
      ] = await Promise.all([
        fetchUsers(),
        fetchAllowedEmails(),
        fetchActiveDownloads(),
        fetchCompletedDownloads(),
        fetchAdminDiskUsage(),
        fetchAdminStorageLimit(),
      ]);
      setUsers(nextUsers);
      setEmails(nextEmails);
      setActiveDownloads(nextActiveDownloads);
      setCompletedDownloads(nextCompletedDownloads);
      setDiskUsage(nextDiskUsage);
      setMaxStorageGb(
        nextStorageLimit.max_storage_gb || DEFAULT_STORAGE_LIMIT_GB,
      );
      setSelectedCompletedJobIds((prev) => {
        const ids = new Set(
          nextCompletedDownloads
            .filter((job) => !job.deleted_at)
            .map((job) => job.id),
        );
        return prev.filter((id) => ids.has(id));
      });
    } catch {
      toast.error("一覧の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSaveStorageLimit() {
    if (!Number.isFinite(maxStorageGb) || maxStorageGb <= 0) {
      toast.error("最大使用量は 1 以上で入力してください");
      return;
    }
    setIsSavingStorageLimit(true);
    try {
      const result = await updateAdminStorageLimit(maxStorageGb);
      setMaxStorageGb(result.max_storage_gb);
      toast.success("最大使用量を保存しました");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "最大使用量の保存に失敗しました",
      );
    } finally {
      setIsSavingStorageLimit(false);
    }
  }

  async function handleAddEmail() {
    const trimmed = newEmail.trim();
    if (!trimmed) {
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      toast.error("有効なメールアドレスを入力してください");
      return;
    }
    setIsAdding(true);
    try {
      await addAllowedEmail(trimmed);
      setNewEmail("");
      refresh();
      toast.success("メールアドレスを追加しました");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "追加に失敗しました");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDeleteEmail(id: string) {
    setDeletingEmailId(id);
    try {
      await deleteAllowedEmail(id);
      refresh();
      toast.success("メールアドレスを削除しました");
    } catch {
      toast.error("削除に失敗しました");
    } finally {
      setDeletingEmailId(null);
    }
  }

  async function handleDeleteUser(id: string) {
    setDeletingUserId(id);
    try {
      await deleteUser(id);
      refresh();
      toast.success("ユーザーを削除しました");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeletingUserId(null);
    }
  }

  function toggleCompletedJob(jobId: string) {
    setSelectedCompletedJobIds((prev) => {
      if (prev.includes(jobId)) {
        return prev.filter((id) => id !== jobId);
      }
      return [...prev, jobId];
    });
  }

  async function handleDeleteSelectedFiles() {
    if (selectedCompletedJobIds.length === 0) return;
    setIsDeletingFiles(true);
    try {
      const result = await adminDeleteDownloadFiles(selectedCompletedJobIds);
      toast.success(`ファイルを削除しました: ${result.updated}件`);
      if (result.skipped > 0) {
        toast.info(`削除スキップ: ${result.skipped}件`);
      }
      await refresh();
      setSelectedCompletedJobIds([]);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "ファイル削除に失敗しました",
      );
    } finally {
      setIsDeletingFiles(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">ユーザー管理</h2>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">許可メールアドレス</h3>
          <p className="text-xs text-muted-foreground">
            ここに追加されたメールアドレスのユーザーのみ GitHub
            ログインが許可されます。ADMIN_EMAIL は自動で許可されます。
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
              placeholder="user@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              aria-invalid={!isNewEmailValid}
              disabled={isLoading || isAdding}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddEmail();
              }}
            />
            <div>
              <Button
                size="sm"
                disabled={
                  isAdding || isLoading || !newEmail.trim() || !isNewEmailValid
                }
                onClick={handleAddEmail}
                type="button"
                className="h-full"
              >
                {isAdding ? (
                  <>
                    <LoaderCircle className="mr-2 size-3.5 animate-spin" />
                    追加中...
                  </>
                ) : (
                  "追加"
                )}
              </Button>
            </div>
          </div>
          {newEmail.trim() !== "" && !isNewEmailValid && (
            <p className="text-xs text-destructive">
              メールアドレスの形式が正しくありません
            </p>
          )}
          {isLoading ? (
            <p className="text-xs text-muted-foreground">読み込み中...</p>
          ) : emails.length > 0 ? (
            <ul className="space-y-1">
              {emails.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                >
                  <span>{e.email}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    disabled={deletingEmailId === e.id}
                    type="button"
                    onClick={() => handleDeleteEmail(e.id)}
                  >
                    {deletingEmailId === e.id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      "削除"
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              許可メールアドレスはまだありません
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">登録済みユーザー</h3>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">読み込み中...</p>
          ) : users.length === 0 ? (
            <p className="text-xs text-muted-foreground">ユーザーはいません</p>
          ) : (
            <ul className="space-y-1">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {u.avatar_url && (
                      <img
                        src={u.avatar_url}
                        alt=""
                        className="size-6 rounded-full"
                      />
                    )}
                    <span>{u.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {u.email}
                    </span>
                    {u.role === "ADMIN" && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        ADMIN
                      </span>
                    )}
                  </div>
                  {u.role !== "ADMIN" && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-destructive"
                      disabled={deletingUserId === u.id}
                      type="button"
                      onClick={() => handleDeleteUser(u.id)}
                    >
                      {deletingUserId === u.id ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        "削除"
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="space-y-4 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">ダウンロード状況</h2>

        <section className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">ディスク使用量</h3>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              最大使用量(GB)
              <input
                type="number"
                min={1}
                step={1}
                className="w-20 rounded-md border bg-background px-2 py-1 text-right text-xs"
                value={maxStorageGb}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next > 0) {
                    setMaxStorageGb(next);
                  }
                }}
              />
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={isSavingStorageLimit}
                onClick={() => {
                  void handleSaveStorageLimit();
                }}
              >
                {isSavingStorageLimit ? "保存中..." : "保存"}
              </Button>
            </label>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                使用中: {diskUsage?.used_gb.toFixed(2) ?? "0.00"} GB /{" "}
                {maxStorageGb.toFixed(2)} GB
              </span>
              <span
                className={
                  usagePercent > 100 ? "font-semibold text-destructive" : ""
                }
              >
                {usagePercentLabel}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className={`h-full ${usagePercent > 100 ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${usageBarPercent}%` }}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">現在ダウンロード中の動画</h3>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">読み込み中...</p>
          ) : activeDownloads.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              現在ダウンロード中の動画はありません
            </p>
          ) : (
            <ul className="space-y-1">
              {activeDownloads.map((job) => (
                <li
                  key={job.id}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-2 block font-medium underline-offset-2 hover:underline"
                      >
                        {job.title || "(タイトル不明)"}
                      </a>
                      <div className="text-xs text-muted-foreground">
                        進捗: {Math.round(job.progress)}%
                      </div>
                      {job.error && (
                        <p className="text-xs text-destructive">
                          エラー: {job.error}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium">
                        ダウンロードユーザー
                      </p>
                      <div className="mt-1 flex items-center justify-end gap-2">
                        {job.user?.avatar_url && (
                          <img
                            src={job.user.avatar_url}
                            alt=""
                            className="size-6 rounded-full"
                          />
                        )}
                        <div className="text-xs">
                          <p className="font-medium">
                            {job.user?.name ?? "不明"}
                          </p>
                          <p className="text-muted-foreground">
                            {job.user?.email ?? "-"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">ダウンロード済みの動画</h3>
            {unknownCompletedCount > 0 && (
              <p className="text-xs font-medium text-amber-700">
                不明な動画({unknownCompletedCount}本)
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">
              {selectedCompletedJobIds.length}件選択中
            </p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={
                isLoading ||
                isDeletingFiles ||
                selectableCompletedDownloads.length === 0
              }
              onClick={() => {
                const allIds = selectableCompletedDownloads.map(
                  (job) => job.id,
                );
                setSelectedCompletedJobIds(allIds);
              }}
            >
              全選択
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isDeletingFiles || selectedCompletedJobIds.length === 0}
              onClick={() => setSelectedCompletedJobIds([])}
            >
              選択解除
            </Button>
            <Button
              type="button"
              variant="destructiveOutline"
              size="xs"
              disabled={isDeletingFiles || selectedCompletedJobIds.length === 0}
              onClick={() => {
                void handleDeleteSelectedFiles();
              }}
            >
              {isDeletingFiles ? "削除中..." : "選択ファイルを削除"}
            </Button>
          </div>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">読み込み中...</p>
          ) : completedDownloads.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              ダウンロード済みの動画はありません
            </p>
          ) : (
            <ul className="space-y-1">
              {completedDownloads.map((job) => (
                <li
                  key={job.id}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={selectedCompletedJobIds.includes(job.id)}
                      disabled={
                        isFileDeleted(job.deleted_at ?? null) || isDeletingFiles
                      }
                      onChange={() => toggleCompletedJob(job.id)}
                    />
                    <div className="min-w-0 space-y-1">
                      {job.is_unknown ? (
                        <p className="font-medium">不明な動画</p>
                      ) : (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 block font-medium underline-offset-2 hover:underline"
                        >
                          {job.title || "(タイトル不明)"}
                        </a>
                      )}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {job.user?.avatar_url && (
                          <div className="shrink-0">
                            <div className="mt-1 flex items-center justify-end gap-2">
                              <img
                                src={job.user.avatar_url}
                                alt=""
                                className="size-6 rounded-full"
                              />
                            </div>
                          </div>
                        )}
                        <div>
                          {job.is_unknown && job.filename && (
                            <p className="text-xs text-amber-700">
                              DBに履歴がないファイル: {job.filename}
                            </p>
                          )}
                          <div className="text-xs text-muted-foreground">
                            完了日時:{" "}
                            {new Date(job.created_at).toLocaleString("ja-JP")}
                          </div>
                          {job.file_size_kb && (
                            <p className="text-xs text-muted-foreground">
                              サイズ: {formatFileSize(job.file_size_kb)}
                            </p>
                          )}
                          {isFileDeleted(job.deleted_at ?? null) && (
                            <p className="text-xs text-destructive">
                              ファイル削除済み:{" "}
                              {new Date(job.deleted_at ?? "").toLocaleString(
                                "ja-JP",
                              )}
                            </p>
                          )}
                          {job.error && (
                            <p className="text-xs text-destructive">
                              エラー: {job.error}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
