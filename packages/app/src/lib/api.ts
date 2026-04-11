import type { DownloadHistoryJob, DownloadJobStatus, VideoData } from "./types";

/**
 * Parse API error response, handling both FastAPI's 'detail' and frontend's 'error' keys
 */
function parseApiError(body: unknown, fallbackMessage: string): string {
  if (
    body &&
    typeof body === "object" &&
    ("detail" in body || "error" in body)
  ) {
    const detail = (body as { detail?: string }).detail;
    const error = (body as { error?: string }).error;
    return detail || error || fallbackMessage;
  }
  return fallbackMessage;
}

export async function getVideoData(url: string): Promise<VideoData> {
  const res = await fetch("/api/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(parseApiError(body, "動画情報の取得に失敗しました"));
  }
  const data = await res.json();
  return data as VideoData;
}

export async function getYoutubePlaylist(url: string): Promise<string[]> {
  const res = await fetch("/api/youtube-playlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      parseApiError(body, "プレイリスト情報の取得に失敗しました"),
    );
  }
  return (await res.json()).urls as string[];
}

export async function createDownloadJob(
  url: string,
  formatChoice: "MP4" | "MP3",
  title: string,
  thumbnail: string,
  formatId?: string,
): Promise<{ job_id: string }> {
  const res = await fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      format: formatChoice,
      title,
      thumbnail,
      format_id: formatId,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      parseApiError(body, "ダウンロードジョブの作成に失敗しました"),
    );
  }
  return (await res.json()) as { job_id: string };
}

export async function checkDownloadJobStatus(
  jobId: string,
): Promise<DownloadJobStatus> {
  const res = await fetch(`/api/status/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      parseApiError(body, "ダウンロードジョブのステータスの取得に失敗しました"),
    );
  }
  const status = await res.json();
  return status as DownloadJobStatus;
}

export async function getCookieStatus(): Promise<{
  cookie_exists: boolean;
  uploaded_at?: string | null;
  enable_cookies: boolean;
}> {
  const res = await fetch("/api/cookies");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      parseApiError(body, "クッキーのステータスの取得に失敗しました"),
    );
  }
  return (await res.json()) as {
    cookie_exists: boolean;
    uploaded_at?: string | null;
    enable_cookies: boolean;
  };
}

export async function sendCookies(file: File): Promise<void> {
  const formData = new FormData();
  formData.append("cookies_file", file);
  const res = await fetch("/api/cookies", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      parseApiError(body, "クッキーのアップロードに失敗しました"),
    );
  }
}

export async function deleteCookies(): Promise<void> {
  const res = await fetch("/api/cookies", {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(parseApiError(body, "クッキーの削除に失敗しました"));
  }
}

export async function toggleEnableCookies(enable: boolean): Promise<boolean> {
  const res = await fetch("/api/cookies/enable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enable }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      parseApiError(body, "クッキーの有効化状態の更新に失敗しました"),
    );
  }
  const body = (await res.json()) as { status: boolean };
  return body.status;
}

export async function getDownloadHistory(): Promise<DownloadHistoryJob[]> {
  const res = await fetch("/api/download-jobs");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      parseApiError(body, "ダウンロード履歴の取得に失敗しました"),
    );
  }
  const body = (await res.json()) as { jobs: DownloadHistoryJob[] };
  return body.jobs;
}

export async function deleteDownloadFiles(
  jobIds: string[],
): Promise<{ updated: number; skipped: number }> {
  const res = await fetch("/api/download-jobs/delete-files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_ids: jobIds }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(parseApiError(body, "ファイルの削除に失敗しました"));
  }

  return (await res.json()) as { updated: number; skipped: number };
}

export async function deleteDownloadHistory(
  jobIds: string[],
): Promise<{ deleted: number; skipped: number }> {
  const res = await fetch("/api/download-jobs", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_ids: jobIds }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(parseApiError(body, "履歴の削除に失敗しました"));
  }

  return (await res.json()) as { deleted: number; skipped: number };
}
