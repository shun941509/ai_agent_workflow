export function assetNumber(id:string) { return id.slice(0, 8); }

export function duplicateAssetNames(assets:readonly {name:string}[]) {
  const names = new Set<string>();
  const duplicates = new Set<string>();
  for (const {name} of assets) {
    if (names.has(name)) duplicates.add(name);
    names.add(name);
  }
  return duplicates;
}
