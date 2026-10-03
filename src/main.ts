import "./style.css";
import { startApp } from "./ui/app.ts";

const root = document.querySelector<HTMLElement>("#app");
if (root) void startApp(root);
