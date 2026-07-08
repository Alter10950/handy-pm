// Everything customer-facing under /portal is ALWAYS the light theme,
// regardless of the office user's dark-mode preference — `.force-light`
// re-applies the light token set on this subtree (see globals.css /
// docs/DESIGN-SYSTEM.md). Covers the project portal and the change-order
// approval page alike.
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="force-light flex min-h-full flex-1 flex-col bg-background text-foreground">
      {children}
    </div>
  );
}
