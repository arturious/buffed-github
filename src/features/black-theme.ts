// Pure black dark theme: GitHub's dark mode with black backgrounds and flatter
// borders. CSS only; light mode is left alone.
import type { Feature } from "../feature";
import css from "./black-theme.css";

const feature: Feature = {
  id: "black-theme",
  name: "Black theme",
  description: "Pure black backgrounds and flatter borders in dark mode.",
  css,
};

export default feature;
