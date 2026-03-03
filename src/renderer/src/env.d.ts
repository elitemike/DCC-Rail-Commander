/// <reference types="vite/client" />

declare interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly PROD: boolean;
    // add other env variables here as needed
}

declare interface ImportMeta {
    readonly env: ImportMetaEnv;
}
