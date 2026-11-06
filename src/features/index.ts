// All features, in the order they run and appear on the options page.
// A new feature: a file in this folder, then one line here.
import type { Feature } from "../feature";
import blackTheme from "./black-theme";
import filePreview from "./file-preview";
import inlineFolders from "./inline-folders";

export const features: Feature[] = [inlineFolders, filePreview, blackTheme];
