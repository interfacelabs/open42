import Link from 'next/link';
import { Brain, FileArchive, LogOut, MessageSquare, WandSparkles } from 'lucide-react';

const nav = [
  { href: '/auth/home', label: 'Brain status', icon: Brain },
  { href: '/auth/onboard', label: 'Connectors', icon: FileArchive },
  { href: '/auth/chat', label: 'Chat', icon: MessageSquare },
  { href: '/auth/skills/refund-policy', label: 'Skills', icon: WandSparkles },
  { href: '/sign_out', label: 'Sign out', icon: LogOut },
];

export function Sidebar() {
  return (
    <aside className="h-screen w-60 shrink-0 border-r border-border bg-white px-4 py-5">
      <Link href="/auth/home" className="font-mono text-sm text-text-subtle">
        open42
      </Link>
      <nav className="mt-8 space-y-1">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex h-10 items-center gap-3 rounded-md px-3 text-sm text-text-body transition-colors hover:bg-muted hover:text-text-primary"
          >
            <item.icon size={16} strokeWidth={1.5} />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
