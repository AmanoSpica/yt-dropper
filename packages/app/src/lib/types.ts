export interface VideoFormat {
  id: string;
  label: string;
  height: number;
  size?: number;
}

export interface VideoData {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  formats: VideoFormat[];
  mp3_size?: number;
}

export interface DownloadJobStatus {
  id: string;
  url: string;
  title: string | null;
  thumbnail: string | null;
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  error: string | null;
  file_size_kb: number | null;
  filename: string | null;
  created_at: string;
}

export interface DownloadHistoryJob extends DownloadJobStatus {
  updated_at: string;
  deleted_at: string | null;
}
