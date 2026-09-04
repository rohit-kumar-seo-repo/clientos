export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-neutral-300">
      <p className="text-sm text-neutral-400">{title} — coming in a later phase.</p>
    </div>
  );
}
