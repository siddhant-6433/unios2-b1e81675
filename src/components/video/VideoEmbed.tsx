import { ExternalLink } from "lucide-react";
import { toVideoEmbedUrl, videoSourceLabel } from "@/lib/videoEmbed";

/**
 * Inline player for a submitted video. Google Drive files render via
 * /preview in an iframe; YouTube via /embed. When the URL isn't embeddable it
 * degrades to an open-in-new-tab link so the reviewer can still watch it.
 */
export function VideoEmbed({
  url,
  title,
  className,
}: {
  url: string;
  title?: string;
  className?: string;
}) {
  const embed = toVideoEmbedUrl(url);

  if (!embed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
      >
        <ExternalLink className="h-4 w-4" /> Open {videoSourceLabel(url)} Link
      </a>
    );
  }

  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-black ${className || ""}`}>
      <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
        <iframe
          src={embed}
          title={title ? `${title} — video preview` : "Video preview"}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    </div>
  );
}
