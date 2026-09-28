import { parseVideoUrl } from "../../shared/importer";

/** YouTube の公式埋め込みで再生する（動画ファイルは保存しない） */
export function VideoEmbed({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const v = parseVideoUrl(url);
  if (!v) return null;
  return (
    <div className={className}>
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-video">
        <iframe
          src={`${v.embedUrl}?rel=0&playsinline=1`}
          title="出典の動画"
          className="absolute inset-0 size-full"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <a
        href={v.watchUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 inline-block text-xs text-sub underline"
      >
        YouTube で開く
      </a>
    </div>
  );
}
