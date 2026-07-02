import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Project portal — Handy PM",
};

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="flex min-h-full flex-1 flex-col items-center bg-background px-4 py-16">
      <div className="w-full max-w-2xl">
        <p className="mb-8 text-xl font-bold tracking-tight text-foreground">
          Handy<span className="text-primary">PM</span>
        </p>
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Project status
          </h1>
          <p className="mt-2 text-muted-foreground">
            Public, read-only view for share token{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm text-foreground">
              {token}
            </code>
            . Project details land in a later phase.
          </p>
        </div>
      </div>
    </main>
  );
}
