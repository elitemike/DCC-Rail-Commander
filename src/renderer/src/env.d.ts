/// <reference types="vite/client" />

declare interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly PROD: boolean;
    // add other env variables here as needed
}

declare interface ImportMeta {
    readonly env: ImportMetaEnv;
}

/** Injected by electron.vite.config.ts's renderer `define` from package.json's version. */
declare const __APP_VERSION__: string;
