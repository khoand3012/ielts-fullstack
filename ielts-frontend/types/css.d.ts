// Ambient declaration so side-effect imports of plain stylesheets
// (`import "./globals.css"`) type-check. Next only declares `*.module.css`.
// Newer TypeScript versions (6+) check side-effect imports by default.
declare module "*.css";
