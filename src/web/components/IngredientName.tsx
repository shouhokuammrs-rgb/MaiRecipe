import { splitGroup } from "../../shared/groups";

/** 材料名。まとまりの印（【A】しょうゆ）は小さな札にして見せる */
export function IngredientName({ name }: { name: string }) {
  const { group, name: rest } = splitGroup(name);
  if (!group) return <span>{name}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-accent-soft px-1 text-[11px] font-bold text-accent-deep"
        aria-label={`まとまり ${group}`}
      >
        {group}
      </span>
      <span>{rest}</span>
    </span>
  );
}
