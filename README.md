# npme-migration

Utility script to migrate @zillow scoped packages from ZNPM to NPME

# Usage

`npm-migration {path} [startIndex, endIndex]`

Looks for a list of package directories in `{path}`, checks for all the versions of each of those packages in ZNPM, downloads tarball if it doesn't exist, updates package.json in each tarball to point `publishConfig.registry` to `NPME`, then publishes using `npm-registry-fetch`.

`[startIndex, endIndex]` are optional params that informs the script to migrate that slice of packages, used for a naive attempt at parallelizing.

`npm-migration /data/npme/packages/\@/\@zillow/ 0 250` would migrate the first 250 packages.