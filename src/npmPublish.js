const npmFetch = require('npm-registry-fetch');
const npa = require('npm-package-arg')
const semver = require('semver');
const fs = require('fs-extra');
const ssri = require('ssri');

const { NPME_URL, ZNPM_URL } = require('./constants');

module.exports = npmPublish;
async function npmPublish(manifest) {
    console.log(`Publishing ${manifest.name}@${manifest.version}`);

    const { tarballPath } = manifest;
    const registry = NPME_URL;
    const spec = npa.resolve(`${manifest.name}`, manifest.version);
    const opts = {
        spec,
        registry,
        defaultTag: 'latest',
        access: 'restricted',
        algorithms: ['sha512'],
        token: process.env.NPME_TOKEN,
    };

    const cleanedVersion = semver.clean(manifest.version);
    manifest.version = cleanedVersion;
    
    const tarballData = await getTarballData({tarballPath, spec, manifest});
    const metadata = buildMetadata(registry, manifest, tarballData, opts);

    // return;
    await npmFetch(spec.escapedName, {
      ...opts,
      method: 'PUT',
      body: metadata,
      ignoreBody: true
    });
}

async function getTarballData({tarballPath, spec, manifest}) {
  const { dist: { integrity } } = manifest;
  const resolved = null;
  const from = `${spec.name}@${spec.rawSpec}`;
  let tarballData = await fs.readFile(tarballPath);

  console.log(`Uploading ${tarballData.length} bytes for package ${tarballPath}`);

  tarballData.integrity = integrity;
  tarballData.resolved = resolved;
  tarballData.from = from;

  return tarballData;
}

function buildMetadata(registry, _manifest, tarballData, opts) {
    const manifest = { ..._manifest };
    const { access, defaultTag, algorithms } = opts
    const root = {
      _id: manifest.name,
      name: manifest.name,
      description: manifest.description,
      'dist-tags': {},
      versions: {},
      access,
      readme: manifest.readme || ''
    }

    const tarballName = `${manifest.name}-${manifest.version}.tgz`
    const tarballURI = `${manifest.name}/-/${tarballName}`
    const integrity = ssri.fromData(tarballData, {
      algorithms: [...['sha1'], ...algorithms],
    });

    // Don't bother having sha1 in the actual integrity field
    manifest.dist.integrity = integrity.sha512[0].toString();
    // Legacy shasum support
    manifest.dist.shasum = integrity.sha1[0].hexDigest();

    delete manifest.distTags;
    delete manifest.tarballPath;
  
    root.versions[manifest.version] = manifest;

    const tag = manifest.tag || defaultTag
    root['dist-tags'][tag] = manifest.version
    manifest._id = `${manifest.name}@${manifest.version}`

    // NB: the CLI always fetches via HTTPS if the registry is HTTPS,
    // regardless of what's here.  This makes it so that installing
    // from an HTTP-only mirror doesn't cause problems, though.
    manifest.dist.tarball = new URL(tarballURI, registry).href
      .replace(/^https:\/\//, 'http://')
  
    root._attachments = {}
    root._attachments[tarballName] = {
      'content-type': 'application/octet-stream',
      data: tarballData.toString('base64'),
      length: tarballData.length
    }
  
    return root
}