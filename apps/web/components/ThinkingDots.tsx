export function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Thinking">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="h-1.5 w-1.5 rounded-full bg-text-faint opacity-40"
          style={{ animation: `pulse 1.4s ease-in-out ${dot * 0.2}s infinite` }}
        />
      ))}
    </span>
  );
}
