// Binary assets (fonts) are imported via esbuild's `loader: 'binary'`, which yields a Uint8Array.
declare module '*.ttf' {
  const data: Uint8Array;
  export default data;
}
declare module '*.otf' {
  const data: Uint8Array;
  export default data;
}
