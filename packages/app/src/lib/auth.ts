// ---- Auth helpers ----

export interface AuthUser {
  id: string;
  github_id: number;
  email: string;
  name: string;
  avatar_url: string | null;
  role: "ADMIN" | "USER";
  created_at: string;
  updated_at: string;

  cookies_txt?: string | null;
  enable_cookies: boolean;
  cookies_uploaded_at?: string | null;
}

export interface ManagedUser {
  id: string;
  github_id: number;
  email: string;
  name: string;
  avatar_url: string | null;
  role: string;
  created_at: string;
}

export interface AllowedEmail {
  id: string;
  email: string;
  created_at: string;
}

export interface AdminDownloadJob {
  id: string;
  url: string;
  title: string | null;
  thumbnail: string | null;
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  error: string | null;
  file_size_kb?: number | null;
  filename?: string | null;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
  is_unknown?: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    role: string;
  } | null;
}

export interface AdminDiskUsage {
  used_bytes: number;
  used_mb: number;
  used_gb: number;
}

export interface AdminStorageLimit {
  max_storage_gb: number;
}

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  return (await res.json()) as AuthUser;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

// ---- Admin helpers ----

export async function fetchUsers(): Promise<ManagedUser[]> {
  const res = await fetch("/api/admin/users");
  if (!res.ok) throw new Error("ユーザー一覧の取得に失敗しました");
  const body = (await res.json()) as { users: ManagedUser[] };
  return body.users;
}

export async function deleteUser(userId: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { detail?: string } | null)?.detail ??
        "ユーザーの削除に失敗しました",
    );
  }
}

export async function fetchAllowedEmails(): Promise<AllowedEmail[]> {
  const res = await fetch("/api/admin/allowed-emails");
  if (!res.ok) throw new Error("許可メール一覧の取得に失敗しました");
  const body = (await res.json()) as { emails: AllowedEmail[] };
  return body.emails;
}

export async function addAllowedEmail(email: string): Promise<AllowedEmail> {
  const res = await fetch("/api/admin/allowed-emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { detail?: string } | null)?.detail ??
        "メールアドレスの追加に失敗しました",
    );
  }
  return (await res.json()) as AllowedEmail;
}

export async function deleteAllowedEmail(emailId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/allowed-emails/${encodeURIComponent(emailId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("メールアドレスの削除に失敗しました");
}

export async function fetchAdminDownloadJobs(
  status: "downloading" | "done",
): Promise<AdminDownloadJob[]> {
  const res = await fetch(`/api/admin/download-jobs?status=${status}`);
  if (!res.ok) throw new Error("管理用ダウンロード一覧の取得に失敗しました");
  const body = (await res.json()) as { jobs: AdminDownloadJob[] };
  return body.jobs;
}

export async function fetchActiveDownloads(): Promise<AdminDownloadJob[]> {
  return fetchAdminDownloadJobs("downloading");
}

export async function fetchCompletedDownloads(): Promise<AdminDownloadJob[]> {
  return fetchAdminDownloadJobs("done");
}

export async function adminDeleteDownloadFiles(
  jobIds: string[],
): Promise<{ updated: number; skipped: number }> {
  const res = await fetch("/api/admin/download-jobs/delete-files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_ids: jobIds }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { detail?: string } | null)?.detail ??
        "ファイルの一括削除に失敗しました",
    );
  }

  return (await res.json()) as { updated: number; skipped: number };
}

export async function fetchAdminDiskUsage(): Promise<AdminDiskUsage> {
  const res = await fetch("/api/admin/disk-usage");
  if (!res.ok) throw new Error("ディスク使用量の取得に失敗しました");
  return (await res.json()) as AdminDiskUsage;
}

export async function fetchAdminStorageLimit(): Promise<AdminStorageLimit> {
  const res = await fetch("/api/admin/storage-limit");
  if (!res.ok) throw new Error("最大使用量の取得に失敗しました");
  return (await res.json()) as AdminStorageLimit;
}

export async function updateAdminStorageLimit(
  maxStorageGb: number,
): Promise<AdminStorageLimit> {
  const res = await fetch("/api/admin/storage-limit", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_storage_gb: maxStorageGb }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { detail?: string } | null)?.detail ??
        "最大使用量の保存に失敗しました",
    );
  }
  return (await res.json()) as AdminStorageLimit;
}
