import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import { createPrismHighlighter } from "./prismAdapter";

export const javascriptHighlighter = createPrismHighlighter("javascript", Prism.languages.javascript);
