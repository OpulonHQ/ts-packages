// A minimal Nuxt 4 public site on Workers over the fixture host (TSPACK-38): proves
// @opulonjs/cms/site/nuxt on real Workers. See wrangler.jsonc for the deploy steps.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-12',
  // Streamed for browsers, buffered for bots (Nuxt's default botRegex): both paths are exercised.
  experimental: { ssrStreaming: true },
  // Typecheck against the packages' sources, as the rest of the repo does (no build needed).
  typescript: { tsConfig: { compilerOptions: { customConditions: ['@opulonjs/source'] } } },
  nitro: {
    typescript: { tsConfig: { compilerOptions: { customConditions: ['@opulonjs/source'] } } },
    preset: 'cloudflare-module',
    // Real node:net/tls for pg (unenv mocks them otherwise, and every query fails to connect).
    cloudflare: { nodeCompat: true },
    // pg requires its optional native binding lazily; Workers never load it.
    alias: { 'pg-native': 'unenv/mock/empty' },
    // Nitro minifies with terser, which (5.51) prints `yield* (yield* sql)\`...\`` from the
    // packages' dist without its parentheses: every audited write then fails at runtime.
    minify: false,
  },
})
