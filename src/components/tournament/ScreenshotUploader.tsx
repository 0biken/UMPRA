"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";

/**
 * Resizes an image file on the client so the long edge is at most `maxDimension` (1600px)
 * per `06 §Responsive and accessibility`.
 */
async function resizeImageClientSide(
  file: File,
  maxDimension = 1600
): Promise<File> {
  if (typeof window === "undefined" || !("createImageBitmap" in window)) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (width <= maxDimension && height <= maxDimension) {
      bitmap.close();
      return file;
    }

    const scale = maxDimension / Math.max(width, height);
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const outMime =
      file.type === "image/png" || file.type === "image/webp"
        ? file.type
        : "image/jpeg";

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outMime, 0.9)
    );
    if (!blob) return file;

    return new File([blob], file.name, {
      type: outMime,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

export function ScreenshotUploader({
  matchId,
  existingSubmissionId,
  canReplace,
  onUploaded,
}: {
  matchId: string;
  existingSubmissionId?: string | null;
  canReplace: boolean;
  onUploaded?: () => void;
}) {
  const { pushToast } = useToast();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;

    setError(null);
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(
        rawFile.type.toLowerCase()
      )
    ) {
      setError("Unsupported file format. Upload a PNG, JPEG, or WebP screenshot.");
      return;
    }

    const resized = await resizeImageClientSide(rawFile, 1600);
    if (resized.size > 5 * 1024 * 1024) {
      setError(
        "Screenshot exceeds the 5 MB limit. Resize or compress the image and try again."
      );
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(resized);
    setPreviewUrl(URL.createObjectURL(resized));
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch(`/api/matches/${matchId}/submissions`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data?.error?.message ??
            "We couldn't read that screenshot. Upload one that shows the final score and both player names."
        );
        return;
      }

      pushToast("Screenshot uploaded", "info");
      setSelectedFile(null);
      onUploaded?.();
    } catch {
      setError("Network error while uploading screenshot. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileSelect}
        className="sr-only"
        id={`screenshot-input-${matchId}`}
      />

      {previewUrl ? (
        <div className="space-y-3 rounded-[var(--radius-field)] border border-line bg-chalk p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Preview of your selected match result screenshot"
            className="max-h-56 w-auto rounded-[var(--radius-field)] border border-line object-contain"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              loading={uploading}
              onClick={handleUpload}
            >
              Upload screenshot
            </Button>
            <Button
              variant="secondary"
              size="compact"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              Choose another image
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-[var(--radius-field)] border border-dashed border-line-strong bg-chalk p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <label
                htmlFor={`screenshot-input-${matchId}`}
                className="type-small font-medium text-ink cursor-pointer"
              >
                {existingSubmissionId
                  ? "Replace your result screenshot"
                  : "Upload your result screenshot"}
              </label>
              <p className="type-caption text-muted">
                PNG, JPEG, or WebP up to 5 MB. Must show the final score and both player names.
              </p>
            </div>
            {canReplace && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" strokeWidth={1.75} />
                <span>
                  {existingSubmissionId
                    ? "Replace screenshot"
                    : "Select screenshot"}
                </span>
              </Button>
            )}
          </div>
        </div>
      )}

      {error && <Banner variant="problem">{error}</Banner>}
    </div>
  );
}
