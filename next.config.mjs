/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The judge loads QuickJS's .wasm from node_modules at runtime; keep it
  // out of the bundle so the file is traced and shipped as-is.
  serverExternalPackages: ["quickjs-emscripten", "quickjs-emscripten-core", "@jitl/quickjs-wasmfile-release-sync"],
};
