import { parseVideoUrl } from "../../shared/importer";
import { sceneUrl } from "../../shared/scene-url";

/** YouTube の公式埋め込みで再生する（動画ファイルは保存しない） */
export function VideoEmbed({
  url,
  className,
  start,
}: {
  url: string;
  className?: string;
  /** この秒から再生する（手順の場面を押したとき） */
  start?: { at: number; n: number } | null;
}) {
  const v = parseVideoUrl(url);
  if (!v) return null;
  return (
    <div className={className}>
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-video">
        <iframe
          // 同じ場面をもう一度押しても、読み込み直して頭から再生する
          key={start ? `scene-${start.n}` : "top"}
          src={
            (start ? sceneUrl(url, start.at) : null) ??
            `${v.embedUrl}?rel=0&playsinline=1`
          }
          title="出典の動画"
          className="absolute inset-0 size-full"
          allow="autoplay; accelerometer; encrypted-media; gyroscope; picture-in-picture"
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
