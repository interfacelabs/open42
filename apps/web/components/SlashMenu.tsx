const commands = [
  { name: '/export refund-policy', description: 'Generate the refund-policy skill bundle' },
  { name: '/sources', description: 'List citations from the last answer' },
  { name: '/inspect', description: 'Open a source page by slug' },
  { name: '/freshness', description: 'Show staleness across cited pages' },
];

export function SlashMenu({ value }: { value: string }) {
  if (!value.startsWith('/')) return null;

  return (
    <div className="absolute bottom-full mb-2 w-full rounded-2xl border border-border bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      {commands.map((command) => (
        <div key={command.name} className="rounded-md px-3 py-2 hover:bg-muted">
          <p className="text-sm font-medium text-text-primary">{command.name}</p>
          <p className="mt-1 text-xs text-text-subtle">{command.description}</p>
        </div>
      ))}
    </div>
  );
}
