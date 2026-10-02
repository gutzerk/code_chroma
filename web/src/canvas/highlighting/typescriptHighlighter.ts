import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import { createPrismHighlighter } from "./prismAdapter";

export const typescriptHighlighter = createPrismHighlighter("typescript", Prism.languages.typescript);
