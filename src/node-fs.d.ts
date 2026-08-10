declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export interface NodeDirectoryEntry {
    name: string;
    /** Directory containing the entry, expressed relative to the path passed in. */
    parentPath: string;
    isFile(): boolean;
  }
  export function readdirSync(path: string, options: { recursive: true; withFileTypes: true }): NodeDirectoryEntry[];
}
