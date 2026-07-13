export declare class IgnoreEngine {
    private readonly directoryMatchers;
    private readonly fileMatchers;
    constructor(patterns?: readonly string[]);
    shouldIgnore(relativePath: string, isDirectory: boolean): boolean;
    static createDefault(): IgnoreEngine;
}
export declare const defaultIgnoreEngine: IgnoreEngine;
//# sourceMappingURL=ignore.d.ts.map