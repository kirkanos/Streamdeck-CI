declare const __PLUGIN_ID__: string;

/**
 * Plugin id, injected at build time: "com.kirkanos.ci", or
 * "com.kirkanos.ci-dev" for the parallel-installable dev build.
 */
export const PLUGIN_ID: string = typeof __PLUGIN_ID__ === "string" ? __PLUGIN_ID__ : "com.kirkanos.ci";
