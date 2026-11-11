import "./ui/style.css";
import { mountApp } from "./ui/app";
import { getTheme, setTheme } from "./ui/theme";

setTheme(getTheme()); // a saved choice survives reload
mountApp(document.getElementById("app")!);
