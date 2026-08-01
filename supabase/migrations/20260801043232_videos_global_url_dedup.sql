-- Duplicate-video detection: make video links unique GLOBALLY (across all
-- editors) and across every status (pending_approval, approved, published),
-- not just within a single editor. Editors are paid per video, so the same
-- content submitted twice = double billing. Normalise like the client does
-- (strip trailing slashes + lowercase) so "URL/" and "url" collide.

-- The old guard was per-editor only; the new global drive_url index subsumes it.
alter table videos drop constraint if exists videos_editor_drive_url_unique;

create unique index if not exists videos_drive_url_norm_unique
  on videos (lower(rtrim(drive_url, '/')))
  where drive_url is not null and drive_url <> '';

-- Same for the post-publish social links: one Instagram/LinkedIn/YouTube post
-- may back only one billable video row.
create unique index if not exists videos_instagram_url_norm_unique
  on videos (lower(rtrim(instagram_url, '/')))
  where instagram_url is not null and instagram_url <> '';

create unique index if not exists videos_linkedin_url_norm_unique
  on videos (lower(rtrim(linkedin_url, '/')))
  where linkedin_url is not null and linkedin_url <> '';

create unique index if not exists videos_youtube_url_norm_unique
  on videos (lower(rtrim(youtube_url, '/')))
  where youtube_url is not null and youtube_url <> '';
