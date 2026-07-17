-- Prevent duplicate video submissions by drive URL per editor.
alter table videos
  add constraint videos_editor_drive_url_unique
  unique (editor_id, drive_url);
