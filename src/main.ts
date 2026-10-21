import { ORIGINAL_HTML } from "./original";
import { App } from "./app";

const root = document.getElementById("app")!;
const app = new App(root);
(window as unknown as { railplot: App }).railplot = app;
void ORIGINAL_HTML;
