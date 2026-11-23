const APPROVED_CLIP_FILE_NAME_MAX_LENGTH = 120;
const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function sanitizeClipFileName(value: string, fallback = "approved-clip"): string {
  const withoutExtension = value.trim().replace(/\.mp4$/i, "");
  const sanitized = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, APPROVED_CLIP_FILE_NAME_MAX_LENGTH)
    .replace(/[. -]+$/g, "");

  if (!sanitized) {
    return fallback;
  }

  return WINDOWS_RESERVED_FILE_NAME.test(sanitized) ? `clip-${sanitized}` : sanitized;
}

export function suggestClipFileName(sourceDisplayName: string, hook: string): string {
  const sourceLeaf = sourceDisplayName.split(/[\\/]/).pop() ?? sourceDisplayName;
  const sourceBaseName = sourceLeaf.replace(/\.[^.]+$/, "").trim();
  const hookText = hook.trim();
  const suggestion = [sourceBaseName, hookText].filter(Boolean).join(" - ");
  return sanitizeClipFileName(suggestion);
}
