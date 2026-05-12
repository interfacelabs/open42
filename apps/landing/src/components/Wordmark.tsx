import Link from "next/link";

export function Wordmark({
  href = "/",
  size = "default",
}: {
  href?: string;
  size?: "default" | "lg";
}) {
  const text = size === "lg" ? "text-[22px]" : "text-[18px]";
  const dot = size === "lg" ? "h-[7px] w-[7px]" : "h-1.5 w-1.5";
  return (
    <Link
      href={href}
      aria-label="Open42 home"
      className="group inline-flex items-center gap-2"
    >
      <span
        className={
          "block rounded-full bg-ink transition-transform duration-300 group-hover:scale-110 " +
          dot
        }
      />
      <span
        className={
          "font-sans font-semibold tracking-[-0.02em] text-ink " + text
        }
      >
        Open42
      </span>
    </Link>
  );
}
