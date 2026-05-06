import { useEffect, useState } from 'react';

const items = ['Brain status', 'Import Notion zip', 'Chat', 'Refund-policy skill'];

export function QuickSwitcher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/10 px-4 pt-24" onClick={() => setOpen(false)}>
      <div
        className="mx-auto max-w-xl rounded-2xl border border-border bg-white p-3 shadow-[0_18px_50px_rgba(0,0,0,0.08)]"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          placeholder="Search Open42"
          className="h-11 w-full rounded-input border border-border px-4 text-sm outline-none focus:border-input"
        />
        <div className="mt-2 space-y-1">
          {items.map((item) => (
            <button
              key={item}
              type="button"
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-text-body hover:bg-muted"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
