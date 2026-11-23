import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

export interface LocalMediaRequest {
  url: string;
  method: string;
  headers: Headers;
}

interface ByteRange {
  end: number;
  start: number;
}

function getContentType(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function parseByteRange(value: string | null, size: number): ByteRange | null {
  if (!value || !value.startsWith("bytes=") || value.includes(",") || size <= 0) {
    return null;
  }

  const [startValue, endValue] = value.slice("bytes=".length).split("-", 2);
  const parsedStart = Number.parseInt(startValue, 10);
  const parsedEnd = endValue ? Number.parseInt(endValue, 10) : size - 1;

  if (startValue === "") {
    const suffixLength = Number.parseInt(endValue, 10);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1
    };
  }

  if (
    !Number.isInteger(parsedStart) ||
    !Number.isInteger(parsedEnd) ||
    parsedStart < 0 ||
    parsedStart >= size ||
    parsedEnd < parsedStart
  ) {
    return null;
  }

  return {
    start: parsedStart,
    end: Math.min(parsedEnd, size - 1)
  };
}

function streamBody(filePath: string, range: ByteRange): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    createReadStream(filePath, {
      start: range.start,
      end: range.end
    })
  ) as ReadableStream<Uint8Array>;
}

export async function createLocalMediaResponse(request: LocalMediaRequest): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Only GET and HEAD are supported for local media.", {
      status: 405,
      headers: { Allow: "GET, HEAD" }
    });
  }

  const mediaUrl = new URL(request.url);
  const filePath = mediaUrl.searchParams.get("path");
  if (!filePath || !path.isAbsolute(filePath)) {
    return new Response("Invalid local media path.", { status: 400 });
  }

  let fileStats;
  try {
    fileStats = await fs.stat(filePath);
  } catch {
    return new Response("Local media file was not found.", { status: 404 });
  }

  if (!fileStats.isFile()) {
    return new Response("Local media path is not a file.", { status: 404 });
  }

  const fullRange = { start: 0, end: Math.max(fileStats.size - 1, 0) };
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseByteRange(rangeHeader, fileStats.size) : fullRange;

  if (!range) {
    return new Response("Requested media range is not satisfiable.", {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${fileStats.size}`
      }
    });
  }

  const contentLength = range.end - range.start + 1;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Length": String(contentLength),
    "Content-Type": getContentType(filePath)
  });

  if (rangeHeader) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${fileStats.size}`);
  }

  return new Response(request.method === "HEAD" ? null : streamBody(filePath, range), {
    status: rangeHeader ? 206 : 200,
    headers
  });
}
