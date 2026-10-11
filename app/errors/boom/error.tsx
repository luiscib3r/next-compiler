"use client";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">error.tsx atrapó el error</h1>
      <p className="font-mono text-sm">digest: {error.digest ?? "(sin digest)"}</p>
      <button type="button" onClick={retry} className="w-fit rounded border px-3 py-1">
        Reintentar
      </button>
    </div>
  );
}
