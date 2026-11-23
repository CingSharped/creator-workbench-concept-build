import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import TimestampedTranscriptPanel from "../../src/renderer/TimestampedTranscriptPanel";
import { buildTranscriptSegmentsFromSrt } from "../../src/shared/transcriptSegments";
import type { CreatorAppApi, TranscriptRecord } from "../../src/shared/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let owner: string;
let saved: TranscriptRecord[];
let requests: Array<{ id: string; text: string }>;
let response: ReturnType<typeof deferred<TranscriptRecord>>;
const srt = "1\n00:00:01,000 --> 00:00:02,000\nHello\n";
function record(id: string): TranscriptRecord {
  return { id: "transcript-" + id, clipId: id, textContent: "Hello", srtContent: srt,
    updatedAt: "2026-10-21T10:00:00Z", segments: buildTranscriptSegmentsFromSrt(srt, "Hello") } as TranscriptRecord;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function expect(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function render(id = owner): Promise<void> {
  owner = id;
  await act(async () => root.render(<React.StrictMode>
    <TimestampedTranscriptPanel clipId={id} selectedTranscript={record(id)} transcriptLoading={false}
      onTranscriptSaved={value => saved.push(value)} />
  </React.StrictMode>));
}
async function click(label: string): Promise<void> {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  expect(button && !button.disabled, "Available button " + label);
  await act(async () => button.click());
}
async function type(value: string): Promise<void> {
  const input = host.querySelector<HTMLTextAreaElement>("textarea.review-transcript-input");
  expect(input, "Timed segment editor");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function initialize(): Promise<void> {
  owner = "a"; saved = []; requests = []; response = deferred<TranscriptRecord>();
  window.creatorApp = {
    updateTranscript: async (id: string, text: string) => { requests.push({ id, text }); return response.promise; }
  } as unknown as CreatorAppApi;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
}
const cases: Array<[string, () => Promise<void>]> = [
  ["an old clip save cannot call the current callback or clear a newer save's busy state", async () => {
    await click("Edit"); await type("Submitted A"); await click("Save Transcript Edits");
    const first = response;
    await render("b");
    response = deferred<TranscriptRecord>();
    await click("Edit"); await type("Submitted B"); await click("Save Transcript Edits");
    await act(async () => first.resolve(record("a")));
    expect(saved.length === 0, "Old A callback suppressed");
    expect(host.textContent?.includes("Saving..."), "B save remains busy");
    expect(requests[0].id === "a" && requests[0].text === "Submitted A", "Original save captured A and its text");
    await act(async () => response.resolve(record("b")));
    expect(saved.length === 1 && saved[0].clipId === "b", "Only B callback applied");
    expect(!host.textContent?.includes("Saving..."), "Current busy cleared");
  }],
  ["local typing during a save keeps the newer text and edit mode", async () => {
    await click("Edit"); await type("Submitted"); await click("Save Transcript Edits");
    await type("Newer draft");
    await act(async () => response.resolve(record("a")));
    expect(saved.length === 0, "Stale save cannot replace parent transcript");
    expect(host.querySelector<HTMLTextAreaElement>("textarea.review-transcript-input")?.value === "Newer draft", "New draft retained");
    expect(host.textContent?.includes("Save Transcript Edits"), "Editing stays open and busy clears");
  }],
  ["returning to the original asset cannot accept an earlier visit's failure or completion", async () => {
    await click("Edit"); await click("Save Transcript Edits");
    await render("b"); await render("a");
    await act(async () => response.reject(new Error("Old save failed")));
    expect(!host.textContent?.includes("Old save failed"), "No stale failure on new visit");
    expect(saved.length === 0, "No stale callback");
    await click("Edit");
    expect(host.querySelector("textarea"), "New visit remains usable");
  }],
  ["unmount suppresses a completed save callback", async () => {
    await click("Edit"); await click("Save Transcript Edits");
    await act(async () => root.unmount());
    await act(async () => response.resolve(record("a")));
    expect(saved.length === 0, "Unmounted panel cannot update parent");
  }]
];
async function run(): Promise<void> {
  const results: Array<{ name: string; error?: string }> = [];
  for (const [name, check] of cases) {
    try { await initialize(); await check(); results.push({ name }); }
    catch (error) { results.push({ name, error: error instanceof Error ? error.stack : String(error) }); }
    finally { await act(async () => root?.unmount()); host?.remove(); }
  }
  console.log("TRANSCRIPT_SESSION_RESULTS:" + JSON.stringify(results));
}
void run();
