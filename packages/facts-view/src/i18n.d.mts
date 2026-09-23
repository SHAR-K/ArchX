/** 英文原句即 key；{name} 占位由 vars 填 */
export declare function t(text: string, vars?: Record<string, string | number | null | undefined>): string;
export declare function setLocale(language: string | null | undefined): "en" | "zh-CN";
export declare function getLocale(): "en" | "zh-CN";
export declare function normalizeLocale(language: string | null | undefined): "en" | "zh-CN";
