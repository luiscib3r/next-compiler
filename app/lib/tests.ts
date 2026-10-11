// Single source of truth for the adapter test site. The home page renders this
// list, and `scripts/smoke.ts` runs the checks against a running server.

export type Check = {
  path: string;
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  status: number;
  /** Text the response body must contain. */
  contains?: string;
  /** Response headers that must be present, with an expected substring. */
  header?: Record<string, string>;
};

export type TestCase = {
  path: string;
  title: string;
  description: string;
  /** What this page exercises in the adapter or the binary. */
  adapter: string;
  checks: Check[];
};

export type TestGroup = {
  name: string;
  tests: TestCase[];
};

export const groups: TestGroup[] = [
  {
    name: "Renderizado",
    tests: [
      {
        path: "/static",
        title: "Página estática",
        description: "Prerenderizada en el build, sin datos de request.",
        adapter: "Sirve HTML prerenderizado desde el FS embebido.",
        checks: [
          { path: "/static", status: 200, contains: "Página estática" },
        ],
      },
      {
        path: "/dynamic?nombre=adapter",
        title: "Runtime APIs",
        description: "headers(), cookies() y searchParams dentro de Suspense.",
        adapter:
          "AsyncLocalStorage compartido entre el servidor empaquetado y los chunks en $bunfs.",
        checks: [
          {
            path: "/dynamic?nombre=adapter",
            headers: { "user-agent": "smoke-test", cookie: "tema=oscuro" },
            status: 200,
            contains: "smoke-test",
          },
        ],
      },
      {
        path: "/stream",
        title: "Streaming",
        description: "Tres Suspense que resuelven a 0.5s, 1s y 2s.",
        adapter: "Respuestas en chunks (Transfer-Encoding) desde el binario.",
        checks: [{ path: "/stream", status: 200, contains: "lento-listo" }],
      },
      {
        path: "/client",
        title: "Client Components",
        description: "useState, useSyncExternalStore, usePathname y next/link.",
        adapter: "Hidratación: los chunks de cliente en .next/static.",
        checks: [{ path: "/client", status: 200, contains: "Contador" }],
      },
    ],
  },
  {
    name: "Caché y revalidación",
    tests: [
      {
        path: "/cache",
        title: "use cache + tags",
        description:
          "Funciones cacheadas con cacheLife y cacheTag, revalidateTag y updateTag desde server actions.",
        adapter:
          "Caché incremental en memoria (isrFlushToDisk = false, FS de solo lectura).",
        checks: [{ path: "/cache", status: 200, contains: "Generado" }],
      },
      {
        path: "/isr/a",
        title: "ISR con generateStaticParams",
        description:
          "/isr/a y /isr/b se prerenderizan; cualquier otro slug se genera en runtime y se guarda.",
        adapter: "Escrituras al caché ISR en runtime sin disco.",
        checks: [
          { path: "/isr/a", status: 200, contains: "slug: a" },
          { path: "/isr/nuevo", status: 200, contains: "slug: nuevo" },
        ],
      },
    ],
  },
  {
    name: "Mutaciones",
    tests: [
      {
        path: "/actions",
        title: "Server Actions",
        description:
          "Formulario con useActionState, cookies().set y redirect() desde una acción.",
        adapter:
          "server-reference-manifest y el endpoint de acciones (POST con Next-Action).",
        checks: [{ path: "/actions", status: 200, contains: "Server Actions" }],
      },
    ],
  },
  {
    name: "Navegación y errores",
    tests: [
      {
        path: "/navigation",
        title: "Redirects y rewrites",
        description:
          "redirect() en un Server Component, más redirects, rewrites y headers de next.config.",
        adapter: "routes-manifest dentro del binario.",
        checks: [
          {
            path: "/navigation/redirect",
            status: 307,
            header: { location: "/static" },
          },
          {
            path: "/old-static",
            status: 308,
            header: { location: "/static" },
          },
          {
            path: "/rewrite-config",
            status: 200,
            contains: "Página estática",
          },
          {
            path: "/static",
            status: 200,
            header: { "x-config-header": "next.config" },
          },
        ],
      },
      {
        path: "/proxy-test",
        title: "Proxy (middleware)",
        description: "proxy.ts agrega headers, redirige, reescribe y responde directo.",
        adapter: "Carga del proxy desde outputs.middleware y su traza.",
        checks: [
          {
            path: "/proxy-test",
            status: 200,
            header: { "x-proxy": "1" },
          },
          {
            path: "/proxy/redirect",
            status: 307,
            header: { location: "/static" },
          },
          { path: "/proxy/rewrite", status: 200, contains: "Página estática" },
          { path: "/proxy/json", status: 200, contains: '"from":"proxy"' },
        ],
      },
      {
        path: "/errors",
        title: "Errores",
        description: "error.tsx, notFound() y la página 404 personalizada.",
        adapter: "Páginas de error y _not-found desde el FS embebido.",
        checks: [
          { path: "/errors/missing", status: 404, contains: "No encontrado" },
          { path: "/no-existe", status: 404, contains: "No encontrado" },
          { path: "/errors/boom", status: 200 },
        ],
      },
    ],
  },
  {
    name: "Archivos y assets",
    tests: [
      {
        path: "/fs",
        title: "Archivos estáticos",
        description: "Un JSON cargado con import, empaquetado en el chunk.",
        adapter:
          "Los datos importados quedan dentro del chunk del servidor, embebido en el binario.",
        checks: [{ path: "/fs", status: 200, contains: "import: ok" }],
      },
      {
        path: "/image",
        title: "next/image",
        description: "Optimización de un PNG local con /_next/image.",
        adapter: "sharp es un módulo nativo (.node): dlopen desde el binario.",
        checks: [
          { path: "/image", status: 200 },
          // If sharp fails to load, Next silently serves the original PNG.
          // Asking for webp makes that visible.
          {
            path: "/_next/image?url=%2Ftest.png&w=32&q=75",
            headers: { accept: "image/webp" },
            status: 200,
            header: { "content-type": "image/webp" },
          },
        ],
      },
      {
        path: "/og-test",
        title: "Open Graph image",
        description: "opengraph-image.tsx generado con ImageResponse.",
        adapter: "next/og carga WASM (resvg, yoga) y fuentes desde archivos.",
        checks: [
          {
            path: "/og-test/opengraph-image",
            status: 200,
            header: { "content-type": "image/png" },
          },
        ],
      },
      {
        path: "/env",
        title: "Variables de entorno",
        description: "process.env leído en runtime, no en el build.",
        adapter: "El binario recibe el entorno del contenedor.",
        checks: [{ path: "/env", status: 200, contains: "TEST_RUNTIME_ENV" }],
      },
      {
        path: "/sitemap.xml",
        title: "Metadata routes",
        description: "sitemap.ts, robots.ts y favicon.",
        adapter: "Rutas de metadata como route handlers.",
        checks: [
          { path: "/sitemap.xml", status: 200, contains: "<urlset" },
          { path: "/robots.txt", status: 200, contains: "Sitemap:" },
          { path: "/favicon.ico", status: 200 },
          { path: "/next.svg", status: 200 },
        ],
      },
    ],
  },
  {
    name: "Route Handlers",
    tests: [
      {
        path: "/api/hello",
        title: "GET estático",
        description: "Prerenderizado en el build.",
        adapter: "Respuesta prerenderizada de un route handler.",
        checks: [{ path: "/api/hello", status: 200, contains: '"hello"' }],
      },
      {
        path: "/api/time",
        title: "GET dinámico + after()",
        description: "Lee headers en cada request y programa trabajo con after().",
        adapter: "after() usa el AsyncLocalStorage de la request.",
        checks: [
          {
            path: "/api/time",
            headers: { "user-agent": "smoke-test" },
            status: 200,
            contains: "smoke-test",
          },
        ],
      },
      {
        path: "/api/echo",
        title: "POST echo",
        description: "Devuelve el JSON recibido.",
        adapter: "Lectura del body de la request.",
        checks: [
          {
            path: "/api/echo",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"ping":"pong"}',
            status: 200,
            contains: '"ping":"pong"',
          },
        ],
      },
      {
        path: "/api/stream",
        title: "Respuesta en stream",
        description: "ReadableStream que emite cinco chunks.",
        adapter: "Streams web desde un route handler.",
        checks: [{ path: "/api/stream", status: 200, contains: "chunk 4" }],
      },
    ],
  },
];
