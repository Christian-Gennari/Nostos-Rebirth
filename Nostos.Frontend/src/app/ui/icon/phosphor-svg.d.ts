/**
 * Module declarations for the Phosphor SVG assets.
 *
 * `angular.json` maps `.svg` to esbuild's `text` loader (`"loader": { ".svg":
 * "text" }`), so a `.svg` import resolves to the file's markup as a STRING and is
 * inlined into the bundle — no network request, no `assets` copy, and only the
 * icons that are imported are shipped.
 *
 * TypeScript has no idea about that loader, so the shape is declared here. The
 * wildcards are per weight and per path form because `@phosphor-icons/core`
 * exports both (`./regular/x.svg` and `./assets/regular/x.svg`).
 */
declare module '@phosphor-icons/core/regular/*.svg' {
  const markup: string;
  export default markup;
}
declare module '@phosphor-icons/core/thin/*.svg' {
  const markup: string;
  export default markup;
}
declare module '@phosphor-icons/core/light/*.svg' {
  const markup: string;
  export default markup;
}
declare module '@phosphor-icons/core/bold/*.svg' {
  const markup: string;
  export default markup;
}
declare module '@phosphor-icons/core/fill/*.svg' {
  const markup: string;
  export default markup;
}
declare module '@phosphor-icons/core/duotone/*.svg' {
  const markup: string;
  export default markup;
}
