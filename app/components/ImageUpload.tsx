"use client";

import React, { useRef, useCallback, useState } from "react";
import Image from "next/image";
import { generateId } from "../utils/generateId";
import { ImageWithCaption } from "../types/section";

/**
 * Converts HEIC/HEIF files to JPEG blob
 * Dynamically imports heic2any to avoid SSR issues
 */
async function convertHeicToBlob(file: File): Promise<Blob> {
  const heic2any = (await import("heic2any")).default;

  try {
    const result = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.85,
    });

    return Array.isArray(result) ? result[0] : result;
  } catch (error) {
    console.error("Error converting HEIC to JPEG:", error);
    if (error && (error as any).message && (error as any).message.includes("Image is already browser readable")) {
      return file;
    }
    // As a safe fallback return the original file (File extends Blob) so the return type is always satisfied.
    return file;
  }
  // heic2any can return an array of blobs or a single blob

}

/**
 * Converts an image file to JPEG format using Canvas (for non-HEIC files)
 */
async function convertToJpegWithCanvas(file: File, quality: number = 0.85): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = document.createElement("img");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Failed to get canvas context"));
      return;
    }

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw white background (for transparent images)
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw the image
      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to convert image to JPEG"));
            return;
          }

          // Create a new filename with .jpg extension
          const originalName = file.name.replace(/\.[^/.]+$/, "");
          const newFile = new File([blob], `${originalName}.jpg`, {
            type: "image/jpeg",
          });

          // Revoke the object URL to free memory
          URL.revokeObjectURL(img.src);

          resolve(newFile);
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image for conversion"));
    };

    // Create object URL for the image
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Converts an image file to JPEG format
 * Handles HEIC/HEIF files specially using heic2any library
 */
async function convertToJpeg(file: File, quality: number = 0.85): Promise<File> {
  const isHeic = file.type === "image/heic" ||
    file.type === "image/heif" ||
    file.name.toLowerCase().endsWith(".heic") ||
    file.name.toLowerCase().endsWith(".heif");

  if (isHeic) {
    // Convert HEIC to JPEG using heic2any
    const jpegBlob = await convertHeicToBlob(file);
    const originalName = file.name.replace(/\.[^/.]+$/, "");
    return new File([jpegBlob], `${originalName}.jpg`, {
      type: "image/jpeg",
    });
  }

  // For other formats, use canvas conversion
  return convertToJpegWithCanvas(file, quality);
}

/**
 * Converts a File to base64 string
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads an image to the server (converts to JPEG first)
 */
async function uploadImage(
  file: File
): Promise<{ imageId: string; url?: string }> {
  // Convert image to JPEG before uploading
  console.log("Converting image to JPEG for upload:", file);
  const jpegFile = await convertToJpeg(file);
  console.log("Uploading JPEG file:", jpegFile);
  const base64Image = await fileToBase64(jpegFile);

  const response = await fetch("/api/upload-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64Image,
      filename: jpegFile.name,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.details || error.error || "Failed to upload image");
  }

  const result = await response.json();
  return { imageId: result.imageId, url: result.url };
}

interface ImageUploadProps {
  images: ImageWithCaption[];
  maxImages: number;
  onImagesChange: (images: ImageWithCaption[]) => void;
  onUploadingChange?: (isUploading: boolean) => void;
  label?: string;
  isWithCaption?: boolean;
}

export default function ImageUpload({
  images,
  maxImages,
  onImagesChange,
  onUploadingChange,
  label = "Images",
  isWithCaption = true,
}: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<ImageWithCaption[]>(images);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const [dragOverImageId, setDragOverImageId] = useState<string | null>(null);

  // Keep ref in sync with images prop
  React.useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Notify parent when uploading state changes
  React.useEffect(() => {
    const isUploading = images.some((img) => img.uploadStatus === "uploading");
    onUploadingChange?.(isUploading);
  }, [images, onUploadingChange]);

  const updateImageInState = useCallback(
    (imageId: string, updates: Partial<ImageWithCaption>) => {
      const currentImages = imagesRef.current;
      const updatedImages = currentImages.map((img) =>
        img.id === imageId ? { ...img, ...updates } : img
      );
      imagesRef.current = updatedImages;
      onImagesChange(updatedImages);
    },
    [onImagesChange]
  );

  const handleUploadImage = useCallback(
    async (image: ImageWithCaption) => {
      if (!image.file) return;

      // Set uploading status
      updateImageInState(image.id, { uploadStatus: "uploading" });

      try {
        const { imageId, url } = await uploadImage(image.file);
        // Update with success status
        updateImageInState(image.id, {
          uploadStatus: "success",
          uploadedImageId: imageId,
          preview: url || image.preview,
        });
      } catch (error) {
        // Update with error status
        updateImageInState(image.id, {
          uploadStatus: "error",
          uploadError: error instanceof Error ? error.message : "Upload failed",
        });
      }
    },
    [updateImageInState]
  ); 

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const remainingSlots = maxImages - images.length;
    const filesToAdd = Array.from(files).slice(0, remainingSlots);

    // First, create placeholder images with "converting" status
    const placeholderImages: ImageWithCaption[] = filesToAdd.map((file) => ({
      id: generateId(),
      file,
      preview: "", // Empty preview initially
      caption: "View showing the",
      uploadStatus: "converting" as const,
    }));

    // Add placeholders immediately to show converting state
    const allImagesWithPlaceholders = [...images, ...placeholderImages];
    imagesRef.current = allImagesWithPlaceholders;
    onImagesChange(allImagesWithPlaceholders);
    e.target.value = "";

    // Process each file and update with preview
    for (const placeholderImage of placeholderImages) {
      const file = placeholderImage.file!;
      const isHeic = file.type === "image/heic" ||
        file.type === "image/heif" ||
        file.name.toLowerCase().endsWith(".heic") ||
        file.name.toLowerCase().endsWith(".heif");

      let previewUrl: string;
      try {
        if (isHeic) {
          // Convert HEIC to JPEG for preview
          const jpegBlob = await convertHeicToBlob(file);
          previewUrl = URL.createObjectURL(jpegBlob);
        } else {
          previewUrl = URL.createObjectURL(file);
        }

        // Update the image with the preview and change status to pending
        updateImageInState(placeholderImage.id, {
          preview: previewUrl,
          uploadStatus: "pending",
        });

        // Start uploading the image
        handleUploadImage({ ...placeholderImage, preview: previewUrl, uploadStatus: "pending" });
      } catch (error) {
        // If conversion fails, mark as error
        updateImageInState(placeholderImage.id, {
          uploadStatus: "error",
          uploadError: "Failed to process image",
        });
      }
    }
  };

  const processFiles = useCallback(
    async (files: File[]) => {
      const remainingSlots = maxImages - imagesRef.current.length;
      // Filter to only image files (also check extension for HEIC files which may not have proper MIME type)
      const imageFiles = files.filter((file) => {
        const isImageByType = file.type.startsWith("image/");
        const isHeicByExtension = file.name.toLowerCase().endsWith(".heic") ||
          file.name.toLowerCase().endsWith(".heif");
        return isImageByType || isHeicByExtension;
      });
      const filesToAdd = imageFiles.slice(0, remainingSlots);
      
      if (filesToAdd.length === 0) return;

      // First, create placeholder images with "converting" status
      const placeholderImages: ImageWithCaption[] = filesToAdd.map((file) => ({
        id: generateId(),
        file,
        preview: "", // Empty preview initially
        caption: "View showing the",
        uploadStatus: "converting" as const,
      }));

      // Add placeholders immediately to show converting state
      const allImagesWithPlaceholders = [...imagesRef.current, ...placeholderImages];
      imagesRef.current = allImagesWithPlaceholders;
      onImagesChange(allImagesWithPlaceholders);

      // Process each file and update with preview
      for (const placeholderImage of placeholderImages) {
        const file = placeholderImage.file!;
        const isHeic = file.type === "image/heic" ||
          file.type === "image/heif" ||
          file.name.toLowerCase().endsWith(".heic") ||
          file.name.toLowerCase().endsWith(".heif");

        let previewUrl: string;
        try {
          if (isHeic) {
            // Convert HEIC to JPEG for preview
            const jpegBlob = await convertHeicToBlob(file);
            previewUrl = URL.createObjectURL(jpegBlob);
          } else {
            previewUrl = URL.createObjectURL(file);
          }

          // Update the image with the preview and change status to pending
          updateImageInState(placeholderImage.id, {
            preview: previewUrl,
            uploadStatus: "pending",
          });

          // Start uploading the image
          handleUploadImage({ ...placeholderImage, preview: previewUrl, uploadStatus: "pending" });
        } catch (error) {
          // If conversion fails, mark as error
          console.error("Error processing file:", error);
          updateImageInState(placeholderImage.id, {
            uploadStatus: "error",
            uploadError: "Failed to process image",
          });
        }
      }
    },
    [maxImages, onImagesChange, handleUploadImage, updateImageInState]
  );
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    // Check for Files or URL types (for browser-dragged images)
    const types = e.dataTransfer.types;
    if (types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;

      // First, try to get files directly (works for local files on all platforms)
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        processFiles(Array.from(files));
        return;
      }

      // For browser-dragged images (especially on Mac), try to extract from dataTransfer.items
      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        const filePromises: Promise<File | null>[] = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          
          // Try to get file from item (works for some browser drag scenarios)
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file && file.type.startsWith("image/")) {
              filePromises.push(Promise.resolve(file));
            }
          }
          // Handle image URLs dragged from browser (Mac Safari/Chrome)
          else if (item.kind === "string" && item.type === "text/uri-list") {
            filePromises.push(
              new Promise((resolve) => {
                item.getAsString(async (url) => {
                  try {
                    // Fetch the image from the URL
                    const response = await fetch(url);
                    if (!response.ok) {
                      resolve(null);
                      return;
                    }
                    const blob = await response.blob();
                    if (!blob.type.startsWith("image/")) {
                      resolve(null);
                      return;
                    }
                    // Create a File from the blob
                    const filename = url.split("/").pop()?.split("?")[0] || "image";
                    const extension = blob.type.split("/")[1] || "jpg";
                    const file = new File([blob], `${filename}.${extension}`, { type: blob.type });
                    resolve(file);
                  } catch {
                    resolve(null);
                  }
                });
              })
            );
          }
        }

        const resolvedFiles = await Promise.all(filePromises);
        const validFiles = resolvedFiles.filter((f): f is File => f !== null);
        
        if (validFiles.length > 0) {
          processFiles(validFiles);
        }
      }
    },
    [processFiles]
  );

  const handleRetryUpload = (image: ImageWithCaption) => {
    handleUploadImage(image);
  };

  const handleCaptionChange = (id: string, caption: string) => {
    onImagesChange(
      images.map((img) => (img.id === id ? { ...img, caption } : img))
    );
  };

  const handleRemoveImage = (id: string) => {
    const imageToRemove = images.find((img) => img.id === id);
    // Only revoke blob URLs (not external URLs from loaded images)
    if (imageToRemove?.preview?.startsWith("blob:")) {
      URL.revokeObjectURL(imageToRemove.preview);
    }
    onImagesChange(images.filter((img) => img.id !== id));
  };

  // Image reordering handlers
  const handleImageDragStart = (e: React.DragEvent, imageId: string) => {
    setDraggedImageId(imageId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", imageId);
    // Add a slight delay to show the drag effect
    setTimeout(() => {
      const element = e.target as HTMLElement;
      element.style.opacity = "0.5";
    }, 0);
  };

  const handleImageDragEnd = (e: React.DragEvent) => {
    setDraggedImageId(null);
    setDragOverImageId(null);
    const element = e.target as HTMLElement;
    element.style.opacity = "1";
  };

  const handleImageDragOver = (e: React.DragEvent, imageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedImageId && draggedImageId !== imageId) {
      setDragOverImageId(imageId);
    }
  };

  const handleImageDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverImageId(null);
  };

  const handleImageDropOnImage = (e: React.DragEvent, targetImageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedImageId || draggedImageId === targetImageId) {
      setDraggedImageId(null);
      setDragOverImageId(null);
      return;
    }

    const draggedIndex = images.findIndex((img) => img.id === draggedImageId);
    const targetIndex = images.findIndex((img) => img.id === targetImageId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedImageId(null);
      setDragOverImageId(null);
      return;
    }

    // Reorder the images
    const newImages = [...images];
    const [draggedImage] = newImages.splice(draggedIndex, 1);
    newImages.splice(targetIndex, 0, draggedImage);

    imagesRef.current = newImages;
    onImagesChange(newImages);
    setDraggedImageId(null);
    setDragOverImageId(null);
  };

  return (
    <div
      className={`space-y-4 relative ${isDragging ? "ring-2 ring-blue-500 ring-offset-2 rounded-lg" : ""
        }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-500 bg-blue-50/90 dark:bg-blue-900/90">
          <div className="flex flex-col items-center gap-2 text-blue-600 dark:text-blue-300">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <span className="text-lg font-medium">Drop images here</span>
            <span className="text-sm">
              {images.length < maxImages
                ? `${maxImages - images.length} slot${maxImages - images.length !== 1 ? "s" : ""
                } remaining`
                : "Maximum images reached"}
            </span>
          </div>
        </div>
      )}      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label} ({images.length}/{maxImages})
        {images.length > 1 && (
          <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
            — Drag to reorder
          </span>
        )}
      </label>

      {/* Drop zone hint when no images */}
      {images.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-600 dark:bg-zinc-800/50">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-10 w-10 text-zinc-400 dark:text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Drag & drop images here
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            or use the buttons below to upload
          </p>
        </div>      
      )}      
      
      {/* Image previews */}
      {images.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image, index) => (
            <div
              key={image.id}
              className={`relative rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800 cursor-move transition-all ${
                dragOverImageId === image.id ? "ring-2 ring-blue-500 scale-105" : ""
              } ${draggedImageId === image.id ? "opacity-50" : ""}`}
              draggable
              onDragStart={(e) => handleImageDragStart(e, image.id)}
              onDragEnd={handleImageDragEnd}
              onDragOver={(e) => handleImageDragOver(e, image.id)}
              onDragLeave={handleImageDragLeave}
              onDrop={(e) => handleImageDropOnImage(e, image.id)}
            >
              {/* Image number indicator */}
              <div className="absolute left-3 top-3 z-20 flex h-6 min-w-6 items-center justify-center rounded bg-black/40 px-1 text-xs font-medium text-white">
                {index + 1}
              </div>
              <div className="relative aspect-video w-full overflow-hidden rounded-md bg-zinc-200 dark:bg-zinc-700">
                {/* Drag handle indicator - covers image area only */}
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 text-white opacity-0 hover:bg-black/30 hover:opacity-100 transition-all">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-8 w-8 drop-shadow-lg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 8h16M4 16h16"
                    />
                  </svg>
                </div>
                {image.preview && (
                  <Image
                    src={image.preview}
                    alt={image.caption || "Uploaded image"}
                    fill
                    className="object-cover"
                  />
                )}
                {/* Converting status overlay */}
                {image.uploadStatus === "converting" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-300 dark:bg-zinc-600">
                    <div className="flex flex-col items-center gap-2">
                      <svg
                        className="h-8 w-8 animate-spin text-zinc-600 dark:text-zinc-300"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                        Processing...
                      </span>
                    </div>
                  </div>
                )}
                {/* Upload status overlay */}
                {image.uploadStatus === "uploading" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="flex flex-col items-center gap-2">
                      <svg
                        className="h-8 w-8 animate-spin text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span className="text-sm font-medium text-white">
                        Uploading...
                      </span>
                    </div>
                  </div>
                )}
                {image.uploadStatus === "error" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-500/70">
                    <div className="flex flex-col items-center gap-2 px-2 text-center">
                      <svg
                        className="h-8 w-8 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <span className="text-xs font-medium text-white">
                        {image.uploadError || "Upload failed"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRetryUpload(image)}
                        className="rounded bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )}
                {image.uploadStatus === "success" && (
                  <div className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white">
                    <svg
                      className="h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                )}
              </div>
              {isWithCaption && index != 0 && (
                <input
                  type="text"
                  placeholder="Enter caption..."
                  value={image.caption}
                  onChange={(e) => handleCaptionChange(image.id, e.target.value)}
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 dark:placeholder-zinc-500"
                />
              )}            <button
                type="button"
                onClick={() => handleRemoveImage(image.id)}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-md hover:bg-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload buttons */}
      {images.length < maxImages && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            Upload Image
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Take Photo
          </button>
        </div>
      )}
    </div>
  );
}
