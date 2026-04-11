import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// convert sec to mm:ss
export function formatDuration(duration: number): string {
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// convert kb(number) to string(KB, MB, GB)
export function formatFileSize(kb: number | null): string {
  if (kb === null) return "N/A";
  if (kb < 1024) {
    return `${kb.toFixed(2)} KB`;
  } else if (kb < 1024 ** 2) {
    return `${(kb / 1024).toFixed(2)} MB`;
  } else {
    return `${(kb / 1024 ** 2).toFixed(2)} GB`;
  }
}

export function isFileDeleted(deletedAt: string | null): boolean {
  if (!deletedAt) return false;
  return new Date(deletedAt) <= new Date();
}
