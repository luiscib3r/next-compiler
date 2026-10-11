export function PageHeader({
  title,
  adapter,
  children,
}: {
  title: string;
  adapter: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="text-zinc-600 dark:text-zinc-400">{children}</p>}
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <span className="font-semibold">Qué prueba del adapter:</span> {adapter}
      </p>
    </header>
  );
}

export function Box({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-2 font-medium">{title}</h2>
      <div className="font-mono text-sm">{children}</div>
    </section>
  );
}
