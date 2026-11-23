export function parseJsonResponse(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidates = [fencedMatch?.[1]?.trim() ?? trimmed];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      const start = findJsonStart(candidate);
      const end = findJsonEnd(candidate);
      if (start < 0 || end <= start) {
        continue;
      }

      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        // Keep the response invalid when the extracted JSON is malformed.
      }
    }
  }

  return null;
}

function findJsonStart(value: string): number {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  if (objectStart < 0) {
    return arrayStart;
  }
  if (arrayStart < 0) {
    return objectStart;
  }
  return Math.min(objectStart, arrayStart);
}

function findJsonEnd(value: string): number {
  return Math.max(value.lastIndexOf("}"), value.lastIndexOf("]"));
}
