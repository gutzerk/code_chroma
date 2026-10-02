import Prism from "prismjs";
import "prismjs/components/prism-sql";
import { createPrismHighlighter } from "./prismAdapter";

export const sqlHighlighter = createPrismHighlighter("sql", Prism.languages.sql);
