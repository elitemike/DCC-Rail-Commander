/// <reference types="vite/client" />

declare interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly PROD: boolean;
    // add other env variables here as needed
}

/** package.json's `version`, injected at build time (see `define` in electron.vite.config.ts). */
declare const __APP_VERSION__: string;

declare interface ImportMeta {
    readonly env: ImportMetaEnv;
}
