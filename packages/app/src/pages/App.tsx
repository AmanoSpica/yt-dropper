import { LoginPage } from "@/components/LoginPage";
import Settings from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import VideoCard from "@/components/VideoCard";
import { getVideoData, getYoutubePlaylist } from "@/lib/api";
import { logout as apiLogout, fetchMe, type AuthUser } from "@/lib/auth";
import type { VideoData } from "@/lib/types";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const MAX_INPUT_LENGTH = 2000;

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<"MP4" | "MP3">("MP4");
  const [videoDataList, setVideoDataList] = useState<VideoData[]>([]);
  const [downloadAllSignal, setDownloadAllSignal] = useState(0);
  const [downloadingVideoIds, setDownloadingVideoIds] = useState<Set<string>>(
    new Set(),
  );
  const [expectedUrlCount, setExpectedUrlCount] = useState(0);

  const hasActiveDownloads = downloadingVideoIds.size > 0;
  const isInputTooLong = inputValue.length > MAX_INPUT_LENGTH;

  const handleDownloadingChange = useCallback(
    (videoId: string, isDownloading: boolean) => {
      setDownloadingVideoIds((prev) => {
        const alreadyDownloading = prev.has(videoId);

        if (isDownloading && alreadyDownloading) {
          return prev;
        }

        if (!isDownloading && !alreadyDownloading) {
          return prev;
        }

        const next = new Set(prev);
        if (isDownloading) {
          next.add(videoId);
        } else {
          next.delete(videoId);
        }
        return next;
      });
    },
    [],
  );

  const handleFetchButtonClick = async () => {
    const trimmedInput = inputValue.trim();

    if (!trimmedInput) {
      setInputError("URL を 1 件以上入力してください");
      return;
    }

    if (inputValue.length > MAX_INPUT_LENGTH) {
      setInputError(`URL は ${MAX_INPUT_LENGTH} 文字以内で入力してください`);
      return;
    }

    setIsFetching(true);
    setInputError(null);
    setVideoDataList([]);

    try {
      const urls = trimmedInput
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const expandedUrls: string[] = [];
      let playlistFailureCount = 0;
      let videoFailureCount = 0;
      let successfulVideoCount = 0;

      for (const url of urls) {
        if (url.includes("list=")) {
          try {
            const playlistVideos = await getYoutubePlaylist(url);
            expandedUrls.push(...playlistVideos);
          } catch (error) {
            playlistFailureCount += 1;
            console.error(
              `Failed to fetch playlist data for URL: ${url}`,
              error,
            );
          }
        } else {
          expandedUrls.push(url);
        }
      }

      setExpectedUrlCount(expandedUrls.length);

      const seenVideoIds = new Set<string>();

      for (const url of expandedUrls) {
        try {
          const videoData = await getVideoData(url);

          if (seenVideoIds.has(videoData.id)) {
            continue;
          }

          seenVideoIds.add(videoData.id);
          successfulVideoCount += 1;
          setVideoDataList((prevList) => [...prevList, videoData]);
        } catch (error) {
          videoFailureCount += 1;
          console.error(`Failed to fetch video data for URL: ${url}`, error);
        }
      }

      if (playlistFailureCount > 0 || videoFailureCount > 0) {
        toast.error(
          `一部のURLの取得に失敗しました (${playlistFailureCount + videoFailureCount} 件)`,
        );
      }

      if (successfulVideoCount > 0) {
        toast.success("動画情報を取得しました");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "動画情報の取得に失敗しました";
      console.error("Failed to fetch video data:", error);
      toast.error(message);
    } finally {
      setIsFetching(false);
    }
  };

  // ---- Auth check ----
  useEffect(() => {
    fetchMe()
      .then((user) => setAuthUser(user))
      .catch(() => {
        toast.error("認証状態の確認に失敗しました");
      })
      .finally(() => setIsAuthLoading(false));
  }, []);

  async function handleLogout() {
    try {
      await apiLogout();
      setAuthUser(null);
      toast.success("ログアウトしました");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "ログアウトに失敗しました";
      toast.error(message);
    }
  }

  if (isAuthLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">読み込み中…</p>
      </main>
    );
  }

  if (!authUser) {
    return <LoginPage />;
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">yt-Dropper</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            {authUser.avatar_url && (
              <img
                src={authUser.avatar_url}
                alt=""
                className="size-7 rounded-full"
              />
            )}
            <span className="hidden sm:inline">{authUser.name}</span>
            {authUser.role === "ADMIN" && (
              <a
                href="/admin"
                className="text-muted-foreground underline hover:text-foreground"
              >
                管理
              </a>
            )}
            <Link
              to="/history"
              className="text-muted-foreground underline hover:text-foreground"
            >
              履歴
            </Link>
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
      <section className="py-4 space-y-4">
        <div className="space-y-3">
          <Textarea
            placeholder="Paste one or more URLs..."
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (inputError) {
                setInputError(null);
              }
            }}
            maxLength={MAX_INPUT_LENGTH}
            className="max-h-48"
            aria-invalid={isInputTooLong}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              1 行ずつ URL を入力してください。プレイリスト URL
              は自動展開されます。
            </span>
            <span>
              {inputValue.length}/{MAX_INPUT_LENGTH}
            </span>
          </div>
          {inputError && (
            <p className="text-sm text-destructive">{inputError}</p>
          )}
          <div className="flex gap-2 flex-row items-center font-mono">
            <div className="border w-fit shrink-0 rounded-md text-sm">
              <button
                className={`
                  ${
                    downloadFormat === "MP4"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  } py-2 px-3.5 rounded-md transition cursor-pointer
                `}
                onClick={() => setDownloadFormat("MP4")}
              >
                MP4
              </button>
              <button
                className={`
                  ${
                    downloadFormat === "MP3"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  } py-2 px-3.5 rounded-md transition cursor-pointer
                `}
                onClick={() => setDownloadFormat("MP3")}
              >
                MP3
              </button>
            </div>

            <Button
              onClick={handleFetchButtonClick}
              disabled={
                isFetching ||
                hasActiveDownloads ||
                inputValue.trim().length === 0 ||
                isInputTooLong
              }
              size="lg"
              className="w-full flex-1 px-8 text-md h-10"
            >
              {isFetching ? (
                <p className="flex items-center gap-2">
                  <LoaderCircle className="animate-spin" size={16} />
                  Loading...
                </p>
              ) : (
                "FETCH"
              )}
            </Button>

            <Settings />
          </div>
        </div>
      </section>
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {videoDataList.map((videoData) => (
            <VideoCard
              key={videoData.id}
              videoData={videoData}
              formatChoice={downloadFormat}
              onDownloadingChange={handleDownloadingChange}
              downloadAllSignal={downloadAllSignal}
            />
          ))}
          {isFetching &&
            [
              ...Array(Math.max(0, expectedUrlCount - videoDataList.length)),
            ].map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="grid w-full grid-cols-[7.5rem_1fr] gap-x-3 rounded-lg border p-3"
              >
                <div className="h-20 w-30 self-start">
                  <Skeleton className="w-full h-full rounded-md" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </div>
            ))}
        </div>
        {videoDataList.length >= 2 && (
          <div className="mt-3 font-mono">
            <Button
              onClick={() => setDownloadAllSignal((prev) => prev + 1)}
              disabled={
                isFetching || hasActiveDownloads || videoDataList.length === 0
              }
              size="lg"
              className="px-6 text-md h-10 w-full"
            >
              DOWNLOAD ALL
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
