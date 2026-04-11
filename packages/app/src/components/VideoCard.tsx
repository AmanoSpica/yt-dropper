import { checkDownloadJobStatus, createDownloadJob } from "@/lib/api";
import type { VideoData } from "@/lib/types";
import { formatDuration, formatFileSize } from "@/lib/utils";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { CopyButton } from "./ui/copy-button";
import { Progress } from "./ui/progress";

export default function VideoCard({
  videoData,
  formatChoice,
  onDownloadingChange,
  downloadAllSignal,
}: {
  videoData: VideoData;
  formatChoice: "MP4" | "MP3";
  onDownloadingChange?: (videoId: string, isDownloading: boolean) => void;
  downloadAllSignal?: number;
}) {
  const [activeFormat, setActiveFormat] = useState(videoData.formats[0]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isReadyToSave, setIsReadyToSave] = useState(false);
  const [savedFileData, setSavedFileData] = useState<{
    filename: string;
    size: number | null;
  } | null>(null);
  const lastDownloadAllSignalRef = useRef<number | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setIsDownloading(false);
  };

  useEffect(() => {
    onDownloadingChange?.(videoData.id, isDownloading);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      onDownloadingChange?.(videoData.id, false);
    };
  }, [isDownloading, onDownloadingChange, videoData.id]);

  function triggerSave(targetJobId: string, filename?: string | null) {
    const downloadUrl = `/api/download/${encodeURIComponent(targetJobId)}`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    if (filename) {
      link.download = filename;
    }
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const handleDownload = useCallback(async () => {
    if (isDownloading) {
      return;
    }

    setIsReadyToSave(false);
    setSavedFileData(null);
    setIsDownloading(true);
    setProgress(0);
    try {
      const result = await createDownloadJob(
        videoData.url,
        formatChoice,
        videoData.title,
        videoData.thumbnail,
        activeFormat.id,
      );
      const createdJobId = result.job_id;
      setJobId(createdJobId);

      let finished = false;
      const checkJobStatus = async () => {
        if (finished) {
          return;
        }

        console.log(`Checking status for job ID: ${createdJobId}`);
        const status = await checkDownloadJobStatus(createdJobId);

        if (typeof status.progress === "number") {
          setProgress(status.progress);
        }

        if (status.status === "done" && status.filename) {
          finished = true;
          stopPolling();
          setProgress(100);
          setSavedFileData({
            filename: status.filename,
            size: status.file_size_kb,
          });
          setIsReadyToSave(true);
          triggerSave(createdJobId, status.filename);
          toast.success("ダウンロードが完了しました");
        } else if (status.status === "error") {
          finished = true;
          stopPolling();
          toast.error(`ダウンロードに失敗しました: ${status.error}`);
        }
      };

      await checkJobStatus();
      if (!finished) {
        pollingIntervalRef.current = setInterval(checkJobStatus, 2000);
      }
    } catch (error) {
      stopPolling();
      const message =
        error instanceof Error
          ? error.message
          : "ダウンロードの開始に失敗しました";
      toast.error(message);
    }
  }, [
    activeFormat.id,
    formatChoice,
    isDownloading,
    videoData.title,
    videoData.url,
    videoData.thumbnail,
  ]);

  const handleSave = () => {
    if (!jobId) {
      return;
    }

    triggerSave(jobId, savedFileData?.filename);
  };

  useEffect(() => {
    if (downloadAllSignal === undefined) {
      return;
    }
    if (downloadAllSignal <= 0) {
      return;
    }
    if (lastDownloadAllSignalRef.current === downloadAllSignal) {
      return;
    }

    lastDownloadAllSignalRef.current = downloadAllSignal;

    if (isDownloading || isReadyToSave) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void handleDownload();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [downloadAllSignal, handleDownload, isDownloading, isReadyToSave]);

  return (
    <div className="grid w-full grid-cols-[7.5rem_1fr] grid-rows-[auto_auto] gap-x-3 rounded-lg border p-3">
      <div className="row-span-2 h-20 w-30 self-start">
        <img
          className="w-full h-full object-cover rounded-md"
          src={videoData.thumbnail}
          alt="Video Thumbnail"
        />
      </div>
      <div className="row-span-2">
        <a
          href={videoData.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline-offset-2 hover:underline"
        >
          {videoData.title}
        </a>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <p>{videoData.uploader}</p>
          <p>・</p>
          <p>
            {formatChoice === "MP3" && videoData.mp3_size !== undefined
              ? formatFileSize(videoData.mp3_size)
              : activeFormat.size !== undefined
                ? formatFileSize(activeFormat.size)
                : "N/A"}
          </p>
          <p>・</p>
          <p>{formatDuration(videoData.duration)}</p>
        </div>
        {isReadyToSave && (
          <p className="text-sm text-muted-foreground">
            Downloaded:{" "}
            {savedFileData?.size !== undefined
              ? formatFileSize(savedFileData.size)
              : "N/A"}
          </p>
        )}
      </div>
      <div className="col-span-2 mt-2 space-y-2">
        {isDownloading ? (
          <div className="text-primary">
            <div className="font-mono text-sm flex items-center gap-2">
              <LoaderCircle className="animate-spin" size={16} />
              DOWNLOADING...
            </div>
            <div className="flex">
              <Progress value={progress} className="mt-2" />
              <span className="font-mono text-sm ml-3">{progress}%</span>
            </div>
          </div>
        ) : isReadyToSave ? (
          <div className="flex min-w-0 items-center">
            <Button
              className="bg-success rounded-lg font-mono h-7"
              onClick={handleSave}
              disabled={isDownloading}
            >
              SAVED
            </Button>
            <p className="ml-2 min-w-0 flex-1 break-all text-xs text-muted-foreground">
              {savedFileData?.filename}
            </p>
          </div>
        ) : (
          <>
            {formatChoice === "MP4" && (
              <div className="flex gap-2 flex-wrap font-mono">
                {videoData.formats.map((format) => (
                  <button
                    key={format.id}
                    className={`cursor-pointer inline-block rounded-lg border px-2 py-0.5 text-xs font-medium ${
                      activeFormat.id === format.id
                        ? "text-primary border-primary font-bold bg-primary/5"
                        : "text-muted-foreground"
                    }`}
                    onClick={() => setActiveFormat(format)}
                  >
                    {format.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                className="rounded-lg font-mono h-7"
                onClick={handleDownload}
                disabled={isDownloading}
              >
                DOWNLOAD
              </Button>
              <CopyButton
                text={
                  formatChoice === "MP3"
                    ? `yt-dlp -x --audio-format mp3 -S acodec:aac "${videoData.url}"`
                    : `yt-dlp -f ${activeFormat.id}+bestaudio/best --merge-output-format mp4 -S acodec:aac "${videoData.url}"`
                }
              >
                CMD
              </CopyButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
