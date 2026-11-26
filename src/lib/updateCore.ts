/** Comparing app versions with GitHub release tags like "v1.0.21-build.41" (pure, testable). */

export function versionFromTag(tag: string): string | null {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(tag.trim());
  return m ? m[1] : null;
}

/** <0 if a is older than b, 0 if equal, >0 if newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
    const d = (pa[k] ?? 0) - (pb[k] ?? 0);
    if (d) return d;
  }
  return 0;
}
