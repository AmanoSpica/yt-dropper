import {
  deleteCookies,
  getCookieStatus,
  sendCookies,
  toggleEnableCookies,
} from "@/lib/api";
import {
  ClipboardPaste,
  File,
  LoaderCircle,
  SettingsIcon,
  Trash,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Switch } from "./ui/switch";

function isNetscapeCookies(text: string) {
  const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

  return lines.every((line) => {
    const parts = line.split("\t");
    return (
      parts.length === 7 &&
      (parts[1] === "TRUE" || parts[1] === "FALSE") &&
      (parts[3] === "TRUE" || parts[3] === "FALSE") &&
      /^\d+$/.test(parts[4])
    );
  });
}

function isEmptyCookieText(text: string) {
  return text.trim().length === 0;
}

export default function Settings() {
  const [selectedCookieFile, setSelectedCookieFile] = useState<File | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cookieStatus, setCookieStatus] = useState<{
    cookie_exists: boolean;
    uploaded_at?: string | null;
    enable_cookies: boolean;
  } | null>(null);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const uploadedAtLabel = cookieStatus?.uploaded_at
    ? new Date(cookieStatus.uploaded_at).toLocaleString("ja-JP")
    : null;

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    setError(null);
    setSuccessMessage(null);

    if (!file) {
      setSelectedCookieFile(null);
      setError("cookies.txt が選択されていません。");
      toast.error("cookies.txt が選択されていません。");
      return;
    }

    if (file.size === 0) {
      setSelectedCookieFile(null);
      setError("cookies.txt の中身が空です。");
      toast.error("cookies.txt の中身が空です。");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (isEmptyCookieText(text)) {
        setSelectedCookieFile(null);
        setError("cookies.txt の中身が空です。");
        toast.error("cookies.txt の中身が空です。");
      } else if (isNetscapeCookies(text)) {
        setSelectedCookieFile(file);
      } else {
        setSelectedCookieFile(null);
        setError("無効な cookies.txt ファイル形式です。");
        toast.error("無効な cookies.txt ファイル形式です。");
      }
    };
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDrop,
    accept: { "text/plain": [".txt"] },
    maxFiles: 1,
    disabled: isLoading || isSubmitting || isReadingClipboard,
  });

  const handleReadFromClipboard = async () => {
    if (isLoading || isSubmitting || isReadingClipboard) {
      return;
    }

    setIsReadingClipboard(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (!navigator.clipboard?.readText) {
        throw new Error(
          "このブラウザはクリップボード読み取りに対応していません。",
        );
      }

      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        throw new Error("クリップボードが空です。");
      }

      if (!isNetscapeCookies(text)) {
        throw new Error(
          "クリップボード内のテキストは cookies.txt 形式ではありません。",
        );
      }

      const file = new window.File([text], "cookies.txt", {
        type: "text/plain",
      });
      setSelectedCookieFile(file);
      toast.success("クリップボードから cookies.txt を読み込みました。");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "クリップボードの読み取りに失敗しました。";
      setSelectedCookieFile(null);
      setError(message);
      toast.error(message);
    } finally {
      setIsReadingClipboard(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedCookieFile) {
      setError("ファイルが選択されていません。");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await sendCookies(selectedCookieFile);
      await fetchCookieStatus();
      setSelectedCookieFile(null);
      setSuccessMessage("cookies.txt をアップロードしました。");
      toast.success("cookies.txt をアップロードしました。");
    } catch (err) {
      console.error("Failed to upload cookies:", err);
      const message =
        (err as Error).message || "cookies.txt のアップロードに失敗しました。";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!cookieStatus?.cookie_exists) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await deleteCookies();
      await fetchCookieStatus();
      setSuccessMessage("cookies.txt を削除しました。");
      toast.success("cookies.txt を削除しました。");
    } catch (err) {
      console.error("Failed to delete cookies:", err);
      const message =
        (err as Error).message || "cookies.txt の削除に失敗しました。";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchCookieStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const status = await getCookieStatus();
      setCookieStatus(status);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch cookie status:", err);
      const message = "cookies の状態取得に失敗しました。";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCookieStatus();
  }, [fetchCookieStatus]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="size-10" variant="outline" type="button">
          <SettingsIcon size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>設定</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Switch
            checked={cookieStatus?.enable_cookies ?? false}
            onCheckedChange={async (checked) => {
              if (!cookieStatus?.cookie_exists || isLoading) {
                return;
              }
              setError(null);
              setSuccessMessage(null);
              try {
                await toggleEnableCookies(checked);
                await fetchCookieStatus();
                toast.success(
                  checked
                    ? "cookies.txt の利用を有効化しました"
                    : "cookies.txt の利用を無効化しました",
                );
              } catch (err) {
                console.error("Failed to toggle cookies:", err);
                const message =
                  (err as Error).message || "cookies の更新に失敗しました。";
                setError(message);
                toast.error(message);
              }
            }}
            disabled={!cookieStatus?.cookie_exists || isLoading}
          />
          cookies.txt のインポートを有効にする
        </div>
        {cookieStatus?.cookie_exists && (
          <div className="flex items-center gap-5 justify-center">
            <File size={40} />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-foreground font-medium">cookies.txt</p>
                <Button
                  size="icon-sm"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isSubmitting || isLoading}
                  type="button"
                >
                  <Trash size={16} />
                </Button>
              </div>
              <p>アップロード日時: {uploadedAtLabel ?? "不明"}</p>
            </div>
          </div>
        )}
        <div>
          <Button
            type="button"
            variant="outline"
            className="mb-2 w-full"
            onClick={() => {
              void handleReadFromClipboard();
            }}
            disabled={isLoading || isSubmitting || isReadingClipboard}
          >
            {isReadingClipboard ? (
              <>
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                クリップボードを読み取り中...
              </>
            ) : (
              <>
                <ClipboardPaste className="mr-2 size-4" />
                クリップボードから読み込む
              </>
            )}
          </Button>
          <div
            className={`text-sm text-muted-foreground border border-dashed text-center rounded-md px-4 py-6 ${
              isLoading || isSubmitting || isReadingClipboard
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer"
            }`}
            {...getRootProps()}
          >
            <input {...getInputProps()} />
            {selectedCookieFile ? (
              <p className="text-primary">
                ファイル選択済み: {selectedCookieFile.name}
              </p>
            ) : error ? (
              <p className="text-destructive">{error}</p>
            ) : cookieStatus?.cookie_exists ? (
              <p className="text-muted-foreground mt-5 pb-4">
                ここをクリックまたはドラッグして cookies.txt を変更
              </p>
            ) : isDragActive ? (
              <p>ファイルをここにドロップしてください</p>
            ) : (
              <p>ここをクリックまたはドラッグして cookies.txt をアップロード</p>
            )}
          </div>
          {successMessage && (
            <p className="mt-1 text-sm text-primary text-center">
              {successMessage}
            </p>
          )}
          {selectedCookieFile && (
            <Button
              className="mt-1 w-full"
              onClick={handleSubmit}
              disabled={isSubmitting || isLoading}
              type="button"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                  アップロード中...
                </>
              ) : (
                "送信"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
