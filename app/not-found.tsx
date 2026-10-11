import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">No encontrado (404)</h1>
      <p>Esta es la página not-found.tsx personalizada.</p>
      <Link href="/" className="underline">
        Volver al índice
      </Link>
    </div>
  );
}
