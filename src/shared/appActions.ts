export type AppActionArea = "make" | "edit" | "performance" | "system";
export type AppActionSideEffect = "read_only" | "local_write" | "external_read" | "external_write";
export type AppActionProgress = "none" | "indeterminate" | "measured";

export interface AppActionDefinition {
  id: string;
  label: string;
  area: AppActionArea;
  description: string;
  prerequisites: readonly string[];
  sideEffect: AppActionSideEffect;
  progress: AppActionProgress;
  cancellable: boolean;
  requiresConfirmation: boolean;
}

export const APP_ACTION_DEFINITIONS = [
  {
    id: "settings.set_tool_path", label: "Configure tool path", area: "system",
    description: "Configure tool path.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "settings.clear_tool_path", label: "Clear tool path", area: "system",
    description: "Clear tool path.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "settings.set_transcription_backend", label: "Set transcription backend", area: "system",
    description: "Set transcription backend.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "settings.set_folder", label: "Configure workspace folder", area: "system",
    description: "Configure workspace folder.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "settings.clear_folder", label: "Clear workspace folder", area: "system",
    description: "Clear workspace folder.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "settings.set_automation", label: "Set workspace automation", area: "system",
    description: "Set workspace automation.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "profiles.save_creator_links", label: "Save creator links", area: "system",
    description: "Save creator links.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "profiles.capture_creator_sample", label: "Capture creator voice sample", area: "system",
    description: "Capture creator voice sample.",
    prerequisites: [], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "profiles.record_voice_sample", label: "Record voice sample", area: "system",
    description: "Record voice sample.",
    prerequisites: [], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "profiles.remove_creator_sample", label: "Remove creator voice sample", area: "system",
    description: "Remove creator voice sample.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "profiles.save_collaborators", label: "Save collaborator profiles", area: "system",
    description: "Save collaborator profiles.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "profiles.save_ai", label: "Save AI profiles and assignments", area: "system",
    description: "Save reviewed AI prompts, learning settings and explicit model/task assignments.",
    prerequisites: ["user_confirmation"], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: true
  },
  {
    id: "settings.set_strict_ai", label: "Set strict AI mode", area: "system",
    description: "Set strict AI mode.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "ai.download_setup_asset", label: "Download local AI asset", area: "system",
    description: "Download local AI asset.",
    prerequisites: [], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "ai.install_recommended_setup", label: "Install recommended local AI", area: "system",
    description: "Install recommended local AI.",
    prerequisites: [], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "ai.cancel_setup_download", label: "Cancel local AI download", area: "system",
    description: "Cancel local AI download.",
    prerequisites: [], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "ai.import_runtime", label: "Import local AI runtime", area: "system",
    description: "Import local AI runtime.",
    prerequisites: [], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "ai.clear_runtime", label: "Clear local AI runtime", area: "system",
    description: "Clear local AI runtime.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "ai.import_model", label: "Import local AI model", area: "system",
    description: "Import local AI model.",
    prerequisites: [], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "profiles.capture_collaborator_sample", label: "Capture collaborator voice sample", area: "system",
    description: "Capture collaborator voice sample.",
    prerequisites: [], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "profiles.remove_collaborator_sample", label: "Remove collaborator voice sample", area: "system",
    description: "Remove collaborator voice sample.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "youtube.save_credentials", label: "Save YouTube credentials", area: "system",
    description: "Save YouTube credentials.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "youtube.clear_credentials", label: "Clear YouTube credentials", area: "system",
    description: "Clear YouTube credentials.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "youtube.connect", label: "Connect YouTube account", area: "system",
    description: "Connect YouTube account.",
    prerequisites: [], sideEffect: "external_read",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "youtube.disconnect", label: "Disconnect YouTube account", area: "system",
    description: "Disconnect YouTube account.",
    prerequisites: [], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "performance.refresh_post", label: "Refresh post analytics", area: "performance",
    description: "Refresh post analytics.",
    prerequisites: [], sideEffect: "external_read",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "clips.clear_workspace_indexes", label: "Archive workspace clip indexes", area: "edit",
    description: "Archive workspace clip indexes.",
    prerequisites: ["user_confirmation"], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: true
  },
  {
    id: "clips.export_stacked_vertical", label: "Export stacked vertical clip", area: "edit",
    description: "Export stacked vertical clip.",
    prerequisites: ["user_confirmation"], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: true
  },
  {
    id: "long_form.export_trimmed", label: "Export trimmed long-form media", area: "make",
    description: "Export trimmed long-form media.",
    prerequisites: ["user_confirmation"], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: true
  },
  {
    id: "long_form.export_stacked_vertical", label: "Export stacked long-form media", area: "make",
    description: "Export stacked long-form media.",
    prerequisites: ["user_confirmation"], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: true
  },
  {
    id: "transcripts.export_srt", label: "Export transcript SRT", area: "edit",
    description: "Export transcript SRT.",
    prerequisites: ["user_confirmation"], sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false, requiresConfirmation: true
  },
  {
    id: "ai.cancel_activity", label: "Cancel AI activity", area: "system",
    description: "Cancel AI activity.",
    prerequisites: [], sideEffect: "local_write",
    progress: "none",
    cancellable: false, requiresConfirmation: false
  },
  {
    id: "clips.import",
    label: "Import clips",
    area: "edit",
    description: "Import supported local video files into the clip workspace index.",
    prerequisites: [],
    sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "long_form.import",
    label: "Import long-form source",
    area: "make",
    description: "Inspect and register a local long-form video in the separate source library.",
    prerequisites: ["source_path"],
    sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "clips.transcribe",
    label: "Transcribe clip",
    area: "edit",
    description: "Extract audio and create a timestamped local transcript for a clip.",
    prerequisites: ["clip_id", "ffmpeg", "whisper_runtime", "whisper_model"],
    sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "long_form.transcribe",
    label: "Transcribe long-form source",
    area: "make",
    description: "Prepare the canonical timestamped transcript used for clip discovery.",
    prerequisites: ["source_id", "ffmpeg", "whisper_runtime", "whisper_model"],
    sideEffect: "local_write",
    progress: "measured",
    cancellable: true,
    requiresConfirmation: false
  },
  {
    id: "long_form.cancel_transcription",
    label: "Cancel long-form transcription",
    area: "make",
    description: "Stop the owned long-form transcription process without changing the original source video.",
    prerequisites: ["source_id", "active_transcription"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: true,
    requiresConfirmation: false
  },
  {
    id: "long_form.save_partial_transcript",
    label: "Save partial transcript",
    area: "make",
    description: "Keep a valid recoverable partial transcript for review without treating it as complete.",
    prerequisites: ["source_id", "recoverable_partial"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "long_form.discard_partial_transcript",
    label: "Discard partial transcript",
    area: "make",
    description: "Remove recoverable partial transcription output while preserving the original source video.",
    prerequisites: ["source_id", "user_confirmation"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "long_form.generate_proposals",
    label: "Generate clip proposals",
    area: "make",
    description: "Ask the assigned local AI to find and rank reviewable clip ranges.",
    prerequisites: ["source_id", "complete_transcript", "local_ai_runtime", "clip_discovery_profile"],
    sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: true,
    requiresConfirmation: false
  },
  {
    id: "long_form.approve_proposal",
    label: "Approve vertical clip proposal",
    area: "make",
    description: "Render a reviewed proposal as a stacked 1080 x 1920 vertical clip in the clip library and preserve lineage.",
    prerequisites: ["source_id", "proposal_id", "valid_trim_range", "clip_library_folder"],
    sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "long_form.reject_proposal",
    label: "Reject clip proposal",
    area: "make",
    description: "Record a review decision without rendering or publishing a file.",
    prerequisites: ["source_id", "proposal_id"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "long_form.reopen_proposal",
    label: "Reopen clip proposal",
    area: "make",
    description: "Return a rejected clip proposal to review without rendering or publishing a file.",
    prerequisites: ["source_id", "proposal_id"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "long_form.cancel_proposals",
    label: "Cancel clip proposal generation",
    area: "make",
    description: "Stop the owned clip-proposal analysis without changing the source or existing decisions.",
    prerequisites: ["source_id", "active_proposal_generation"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: true,
    requiresConfirmation: false
  },
  {
    id: "clips.generate_metadata",
    label: "Generate metadata candidates",
    area: "edit",
    description: "Generate grouped title, description, and tag candidates for review.",
    prerequisites: ["clip_id", "metadata_profile"],
    sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "clips.save_metadata",
    label: "Save metadata package",
    area: "edit",
    description: "Persist the user-selected metadata package for scheduling.",
    prerequisites: ["clip_id", "title"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "transcripts.update",
    label: "Save transcript corrections",
    area: "edit",
    description: "Save canonical transcript text, timing, speaker assignments, and derived SRT together.",
    prerequisites: ["clip_id", "valid_transcript"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "transcripts.auto_assign_speakers",
    label: "Match transcript speakers",
    area: "edit",
    description: "Assign eligible transcript segments using saved voice samples without overwriting manual labels.",
    prerequisites: ["clip_id", "voice_samples"],
    sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "clips.export_trimmed",
    label: "Export trimmed clip",
    area: "edit",
    description: "Render a new trimmed copy without overwriting the source clip.",
    prerequisites: ["clip_id", "valid_trim_range", "output_path"],
    sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "scheduled_posts.create",
    label: "Schedule or publish clip",
    area: "edit",
    description: "Create a scheduled post and, for YouTube, upload the saved package to the connected account.",
    prerequisites: ["clip_id", "saved_metadata", "publish_time"],
    sideEffect: "external_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "scheduled_posts.get_next_slot",
    label: "Find next posting slot",
    area: "edit",
    description: "Find the next unoccupied recurring YouTube posting slot without creating a post or calling YouTube.",
    prerequisites: ["posting_schedule"],
    sideEffect: "read_only",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "scheduled_posts.create_next_slot",
    label: "Publish at next posting slot",
    area: "edit",
    description: "Upload a saved clip to YouTube and use the next unoccupied recurring posting slot for native scheduling.",
    prerequisites: ["clip_id", "saved_metadata", "posting_schedule", "youtube_connection"],
    sideEffect: "external_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "scheduled_posts.retry_captions",
    label: "Retry YouTube captions",
    area: "edit",
    description: "Retry adding the saved complete transcript captions to an already uploaded YouTube video.",
    prerequisites: ["youtube_post_id", "complete_canonical_srt"],
    sideEffect: "external_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "scheduled_posts.reconcile",
    label: "Reconcile YouTube upload",
    area: "edit",
    description: "Check an uncertain YouTube upload before any manual retry decision.",
    prerequisites: ["scheduled_post_id", "youtube_post"],
    sideEffect: "external_read",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "settings.get_posting_schedule",
    label: "Read posting schedule",
    area: "system",
    description: "Read the local recurring YouTube posting-time settings.",
    prerequisites: [],
    sideEffect: "read_only",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "settings.save_posting_schedule",
    label: "Save posting schedule",
    area: "system",
    description: "Save local recurring YouTube posting-time settings without contacting YouTube.",
    prerequisites: ["posting_schedule"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "scheduled_posts.remove",
    label: "Remove queued post",
    area: "edit",
    description: "Remove a post from the local queue.",
    prerequisites: [],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "scheduled_posts.refresh_statuses",
    label: "Refresh scheduled post statuses",
    area: "edit",
    description: "Check known YouTube posts and update their local status without uploading anything.",
    prerequisites: ["manual_refresh"],
    sideEffect: "external_read",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "performance.refresh_dashboard",
    label: "Refresh performance data",
    area: "performance",
    description: "Manually pull owned YouTube performance data using the selected account filters.",
    prerequisites: ["manual_refresh", "filters"],
    sideEffect: "external_read",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "performance.generate_coach",
    label: "Generate performance coaching",
    area: "performance",
    description: "Ask the assigned local AI to explain owned-channel performance and suggest one evidence-linked next test.",
    prerequisites: ["filters", "performance_coach_profile"],
    sideEffect: "read_only",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "performance.import_youtube_history",
    label: "Import YouTube history",
    area: "performance",
    description: "Import historical channel performance into local evidence without changing platform data.",
    prerequisites: ["manual_import"],
    sideEffect: "external_read",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "youtube_videos.refresh",
    label: "Refresh YouTube channel videos",
    area: "performance",
    description: "Manually load owned YouTube videos into the local management cache.",
    prerequisites: ["youtube_connection", "manual_refresh"],
    sideEffect: "external_read",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "youtube_videos.save_draft",
    label: "Save YouTube metadata draft",
    area: "performance",
    description: "Save remote YouTube metadata edits locally without changing YouTube.",
    prerequisites: ["youtube_video", "valid_metadata"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "youtube_videos.generate_metadata",
    label: "Generate YouTube metadata draft",
    area: "performance",
    description: "Generate a reviewable local metadata draft for an owned YouTube video.",
    prerequisites: ["youtube_video", "local_ai_runtime"],
    sideEffect: "read_only",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "youtube_videos.update_metadata",
    label: "Update YouTube metadata",
    area: "performance",
    description: "Apply a reviewed metadata patch to one owned YouTube video.",
    prerequisites: ["youtube_video", "fresh_remote_snapshot", "user_confirmation"],
    sideEffect: "external_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "youtube_videos.bulk_update_metadata",
    label: "Bulk update YouTube metadata",
    area: "performance",
    description: "Apply a reviewed field-level metadata patch to selected owned YouTube videos.",
    prerequisites: ["youtube_videos", "previewed_changes", "user_confirmation"],
    sideEffect: "external_write",
    progress: "measured",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "thumbnails.generate_candidates",
    label: "Generate thumbnail candidates",
    area: "performance",
    description: "Use local AI-assisted frame analysis and local composition to create thumbnail candidates.",
    prerequisites: ["youtube_video", "local_ai_runtime", "youtube_thumbnail_profile"],
    sideEffect: "local_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "thumbnails.save_candidate",
    label: "Save thumbnail candidate",
    area: "performance",
    description: "Keep a reviewed thumbnail candidate in the app-managed thumbnail library.",
    prerequisites: ["thumbnail_candidate"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "thumbnails.apply_to_youtube",
    label: "Apply thumbnail to YouTube",
    area: "performance",
    description: "Upload one reviewed local thumbnail candidate to its owned YouTube video.",
    prerequisites: ["youtube_video", "thumbnail_candidate", "user_confirmation"],
    sideEffect: "external_write",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "metadata.record_feedback",
    label: "Record metadata feedback",
    area: "edit",
    description: "Record a metadata candidate decision for later profile learning.",
    prerequisites: ["clip_id", "variant_id", "decision"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "clips.remove_from_workspace",
    label: "Remove clip from workspace",
    area: "edit",
    description: "Archive a clip from the active workspace index without deleting its source file.",
    prerequisites: ["clip_id"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "clips.delete_app_data",
    label: "Delete clip app data",
    area: "edit",
    description: "Delete selected clip workflow records while preserving source media and protected learning history.",
    prerequisites: ["clip_id", "user_confirmation"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "data_management.scan",
    label: "Scan data health",
    area: "system",
    description: "Scan local references and report safe and protected data-health findings.",
    prerequisites: ["manual_scan"],
    sideEffect: "read_only",
    progress: "indeterminate",
    cancellable: false,
    requiresConfirmation: false
  },
  {
    id: "data_management.clear_clip_library",
    label: "Clear Clip Library index",
    area: "system",
    description: "Archive active Clip Library records without deleting source files or workflow history.",
    prerequisites: ["user_confirmation"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "data_management.clear_long_form",
    label: "Clear Long-form index",
    area: "system",
    description: "Archive active long-form sources without deleting original videos or proposals.",
    prerequisites: ["user_confirmation"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "data_management.cleanup_orphans",
    label: "Delete selected orphaned records",
    area: "system",
    description: "Permanently delete only explicitly selected safe orphan records after backup.",
    prerequisites: ["issue_ids", "user_confirmation"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: true
  },
  {
    id: "ui.save_vertical_layout_preferences",
    label: "Save vertical layout preferences",
    area: "system",
    description: "Persist the user's preferred source or stacked vertical preview layout for future clips.",
    prerequisites: ["valid_layout_preferences"],
    sideEffect: "local_write",
    progress: "none",
    cancellable: false,
    requiresConfirmation: false
  }
] as const satisfies readonly AppActionDefinition[];

export type AppActionId = (typeof APP_ACTION_DEFINITIONS)[number]["id"];

export function getAppActionDefinition(actionId: string): AppActionDefinition | null {
  return APP_ACTION_DEFINITIONS.find((definition) => definition.id === actionId) ?? null;
}
