// Vite's `?raw` imports: a file's text (used to check wrangler.toml).
declare module "*?raw" {
  const content: string;
  export default content;
}
