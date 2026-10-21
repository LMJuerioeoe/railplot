// The page exactly as it was loaded, captured before the app builds its interface, so Railplot
// can install itself on a controller. Empty when running inside a hosted page shell.
export const ORIGINAL_HTML: string =
  typeof document !== "undefined" && document.doctype && document.getElementById("app")?.childElementCount === 0
    ? `<!doctype html>\n${document.documentElement.outerHTML}`
    : "";
